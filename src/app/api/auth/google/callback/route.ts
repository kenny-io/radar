import { NextResponse } from 'next/server';
import { track } from '@/server/events';
import { and, eq, or } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { attachInvites } from '@/server/auth/users';
import { finishAuth } from '@/server/auth/claim';
import { consumeGoogleState } from '@/server/auth/googleState';
import { queueSignupEmails } from '@/server/auth/signupEmails';

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
      if (!r.ok) return NextResponse.redirect(`${env.appUrl}/signup?error=google`);
      const tok = await r.json();
      // id_token received directly from Google's token endpoint over TLS (OIDC §3.1.3.7).
      const claims = decodeJwt(tok.id_token);
      if (claims.aud !== env.googleClientId || claims.email_verified !== true || !claims.sub ||
        !['accounts.google.com', 'https://accounts.google.com'].includes(String(claims.iss)) ||
        typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000 || typeof claims.email !== 'string')
        return NextResponse.redirect(`${env.appUrl}/signup?error=google`);
      sub = claims.sub; email = claims.email.toLowerCase(); name = typeof claims.name === 'string' ? claims.name.slice(0, 200) : email.split('@')[0];
    } catch { return NextResponse.redirect(`${env.appUrl}/signup?error=google`); }
  }
  const found = (await db.select().from(schema.users).where(and(or(eq(schema.users.googleSub, sub), eq(schema.users.email, email)), eq(schema.users.guest, false))).limit(1))[0];
  let user: typeof schema.users.$inferSelect;
  if (found) { user = found; if (!found.googleSub) await db.update(schema.users).set({ googleSub: sub }).where(eq(schema.users.id, found.id)); }
  else {
    const created = await db.transaction(async tx => {
      const [u] = await tx.insert(schema.users).values({ name, email, googleSub: sub }).onConflictDoNothing().returning();
      if (u) await queueSignupEmails(tx, u);
      return u;
    });
    if (created) { user = created; await track('user.signed_up', { uid: user.id, props: { method: 'google' } }); }
    else {
      // Another callback or email signup won the unique-email race. Reuse the account on a verified email.
      const [existing] = await db.select().from(schema.users).where(and(eq(schema.users.email, email), eq(schema.users.guest, false))).limit(1);
      if (!existing || (existing.googleSub && existing.googleSub !== sub)) return NextResponse.redirect(`${env.appUrl}/signup?error=google`);
      user = existing;
      if (!existing.googleSub) await db.update(schema.users).set({ googleSub: sub }).where(eq(schema.users.id, existing.id));
    }
  }
  await attachInvites(user.id, email);
  // The Lax radar_guest cookie arrives on this top-level redirect, so the guest draft is claimed here too (AC-G5).
  const r = await finishAuth({ id: user.id, name: user.name, email: user.email, appearance: user.appearance }, (st.data as any)?.next);
  return NextResponse.redirect(`${env.appUrl}${r.next}`);
}
