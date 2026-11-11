import { reportFailure } from '@/server/observability/failures';
import { NextResponse } from 'next/server';
import { track } from '@/server/events';
import { EMAIL_RE } from '@/lib/format';
import { isGuestEmail } from '@/server/auth/session';
import { and, eq } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify } from 'jose';
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), { timeoutDuration: 10000 });
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { attachInvites } from '@/server/auth/users';
import { finishAuth } from '@/server/auth/claim';
import { consumeGoogleState } from '@/server/auth/googleState';
import { queueSignupEmails } from '@/server/auth/signupEmails';
import { currentGuest } from '@/server/auth/session';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const state = q.get('state') || ''; const code = q.get('code');
  if (!code || code.length > 4096) return NextResponse.redirect(`${env.appUrl}/signup?error=google`);
  const st = await consumeGoogleState(state);
  if (!st) return NextResponse.redirect(`${env.appUrl}/signup?error=google`);
  let sub: string, email: string, name: string;
  if (env.devStubs && !env.googleClientId) {
    // Dev stub: code=dev signs in as dev@radar.local; outside production, code=dev:<email> picks the account (QA, tests).
    const as = !env.isProd && code.startsWith('dev:') ? code.slice(4).trim().toLowerCase() : '';
    if (as && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(as) && !as.endsWith('@guest.radar.invalid')) { sub = 'dev-google-' + as; email = as; name = as.split('@')[0]; }
    else { sub = 'dev-google-user'; email = 'dev@radar.local'; name = 'Dev User'; }
  }
  else {
    try {
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000), body: new URLSearchParams({ code, client_id: env.googleClientId, client_secret: env.googleClientSecret, redirect_uri: `${env.appUrl}/api/auth/google/callback`, grant_type: 'authorization_code' }) });
      if (!r.ok) {
        await reportFailure(new Error('Google OAuth token exchange failed'), { source: 'http', operation: 'auth.google.exchange', provider: 'Google', status: r.status });
        return NextResponse.redirect(`${env.appUrl}/signup?error=google`);
      }
      const tok = await r.json();
      const { payload: claims } = await jwtVerify(tok.id_token, googleKeys, { audience: env.googleClientId, issuer: ['accounts.google.com', 'https://accounts.google.com'], algorithms: ['RS256'] });
      if (claims.aud !== env.googleClientId || claims.email_verified !== true || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 ||
        !['accounts.google.com', 'https://accounts.google.com'].includes(String(claims.iss)) ||
        typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000 || typeof claims.email !== 'string' || claims.email.length > 320 || !EMAIL_RE.test(claims.email) || isGuestEmail(claims.email))
        return NextResponse.redirect(`${env.appUrl}/signup?error=google`);
      sub = claims.sub; email = claims.email.toLowerCase(); name = typeof claims.name === 'string' ? claims.name.slice(0, 200) : email.split('@')[0];
    } catch (error) { await reportFailure(error, { source: 'http', operation: 'auth.google.exchange', provider: 'Google' }); return NextResponse.redirect(`${env.appUrl}/signup?error=google`); }
  }
  // An email match is never proof that this provider owns an existing Radar credential.
  const found = (await db.select().from(schema.users).where(and(eq(schema.users.googleSub, sub), eq(schema.users.guest, false))).limit(1))[0];
  let user: typeof schema.users.$inferSelect;
  if (found) user = found;
  else {
    const guest = await currentGuest();
    const created = await db.transaction(async tx => {
      const [u] = await tx.insert(schema.users).values({ name, email, googleSub: sub, emailVerifiedAt: new Date() }).onConflictDoNothing().returning();
      if (u) await queueSignupEmails(tx, u, guest?.id);
      return u;
    });
    if (created) { user = created; await track('user.signed_up', { uid: user.id, props: { method: 'google' } }); }
    else {
      // A concurrent callback may have inserted the same provider identity. Email-only collisions are refused.
      const [existing] = await db.select().from(schema.users).where(and(eq(schema.users.googleSub, sub), eq(schema.users.guest, false))).limit(1);
      if (!existing) return NextResponse.redirect(`${env.appUrl}/signin?error=google_link`);
      user = existing;
    }
  }
  // A matching Google subject proves this provider identity even if a partial/manual import lacks its timestamp.
  if (!user.emailVerifiedAt) {
    await db.transaction(async tx => {
      await tx.update(schema.users).set({ emailVerifiedAt: new Date(), passwordHash: null }).where(eq(schema.users.id, user.id));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    });
  }
  await attachInvites(user.id, user.email);
  // The Lax radar_guest cookie arrives on this top-level redirect, so the guest draft is claimed here too (AC-G5).
  const r = await finishAuth({ id: user.id, name: user.name, email: user.email, appearance: user.appearance }, (st.data as any)?.next);
  return NextResponse.redirect(`${env.appUrl}${r.next}`);
}
