import { NextResponse } from 'next/server';
import { track } from '@/server/events';
import { and, eq, or } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { attachInvites } from '@/server/auth/users';
import { finishAuth } from '@/server/auth/claim';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const state = q.get('state') || ''; const code = q.get('code');
  const st = (await db.select().from(schema.oauthStates).where(eq(schema.oauthStates.state, state)).limit(1))[0];
  if (!st || st.provider !== 'google-signin' || !code) return NextResponse.redirect(`${env.appUrl}/signup?error=google`);
  await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, state));
  let sub: string, email: string, name: string;
  if (env.devStubs && !env.googleClientId) {
    // Dev stub: code=dev signs in as dev@radar.local; outside production, code=dev:<email> picks the account (QA, tests).
    const as = !env.isProd && code.startsWith('dev:') ? code.slice(4).trim().toLowerCase() : '';
    if (as && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(as) && !as.endsWith('@guest.radar.invalid')) { sub = 'dev-google-' + as; email = as; name = as.split('@')[0]; }
    else { sub = 'dev-google-user'; email = 'dev@radar.local'; name = 'Dev User'; }
  }
  else {
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: env.googleClientId, client_secret: env.googleClientSecret, redirect_uri: `${env.appUrl}/api/auth/google/callback`, grant_type: 'authorization_code' }) });
    if (!r.ok) return NextResponse.redirect(`${env.appUrl}/signup?error=google`);
    const tok = await r.json();
    // id_token received directly from Google's token endpoint over TLS (OIDC §3.1.3.7 permits skipping signature checks here).
    const claims: any = decodeJwt(tok.id_token);
    if (claims.aud !== env.googleClientId || !claims.email_verified) return NextResponse.redirect(`${env.appUrl}/signup?error=google`);
    sub = claims.sub; email = String(claims.email).toLowerCase(); name = claims.name || email.split('@')[0];
  }
  const found = (await db.select().from(schema.users).where(and(or(eq(schema.users.googleSub, sub), eq(schema.users.email, email)), eq(schema.users.guest, false))).limit(1))[0];
  let user: typeof schema.users.$inferSelect;
  if (found) { user = found; if (!found.googleSub) await db.update(schema.users).set({ googleSub: sub }).where(eq(schema.users.id, found.id)); }
  else { [user] = await db.insert(schema.users).values({ name, email, googleSub: sub }).returning(); await track('user.signed_up', { uid: user.id, props: { method: 'google' } }); }
  await attachInvites(user.id, email);
  // The Lax radar_guest cookie arrives on this top-level redirect, so the guest draft is claimed here too (AC-G5).
  const r = await finishAuth({ id: user.id, name: user.name, email: user.email, appearance: user.appearance }, (st.data as any)?.next);
  return NextResponse.redirect(`${env.appUrl}${r.next}`);
}
