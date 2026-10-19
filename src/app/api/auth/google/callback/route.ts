import { NextResponse } from 'next/server';
import { track } from '@/server/events';
import { eq, or } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { createSession } from '@/server/auth/session';
import { attachInvites } from '@/server/auth/users';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const state = q.get('state') || ''; const code = q.get('code');
  const st = (await db.select().from(schema.oauthStates).where(eq(schema.oauthStates.state, state)).limit(1))[0];
  if (!st || st.provider !== 'google-signin' || !code) return NextResponse.redirect(`${env.appUrl}/signup?error=google`);
  await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, state));
  let sub: string, email: string, name: string;
  if (env.devStubs && !env.googleClientId) { sub = 'dev-google-user'; email = 'dev@radar.local'; name = 'Dev User'; }
  else {
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: env.googleClientId, client_secret: env.googleClientSecret, redirect_uri: `${env.appUrl}/api/auth/google/callback`, grant_type: 'authorization_code' }) });
    if (!r.ok) return NextResponse.redirect(`${env.appUrl}/signup?error=google`);
    const tok = await r.json();
    // id_token received directly from Google's token endpoint over TLS (OIDC §3.1.3.7 permits skipping signature checks here).
    const claims: any = decodeJwt(tok.id_token);
    if (claims.aud !== env.googleClientId || !claims.email_verified) return NextResponse.redirect(`${env.appUrl}/signup?error=google`);
    sub = claims.sub; email = String(claims.email).toLowerCase(); name = claims.name || email.split('@')[0];
  }
  const found = (await db.select().from(schema.users).where(or(eq(schema.users.googleSub, sub), eq(schema.users.email, email))).limit(1))[0];
  let userId: string;
  if (found) { userId = found.id; if (!found.googleSub) await db.update(schema.users).set({ googleSub: sub }).where(eq(schema.users.id, found.id)); }
  else { const [u] = await db.insert(schema.users).values({ name, email, googleSub: sub }).returning(); userId = u.id; await track('user.signed_up', { uid: u.id, props: { method: 'google' } }); }
  await attachInvites(userId, email);
  await createSession(userId);
  const next = (st.data as any)?.next || '/';
  return NextResponse.redirect(`${env.appUrl}${next.startsWith('/') && !next.startsWith('//') ? next : '/'}`);
}
