import { NextResponse } from 'next/server';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { randomToken } from '@/server/crypto';

export async function GET(req: Request) {
  const next = new URL(req.url).searchParams.get('next') || '/';
  const state = randomToken(16);
  await db.insert(schema.oauthStates).values({ state, provider: 'google-signin', data: { next } });
  if (!env.googleClientId) {
    if (env.devStubs) {
      const as = !env.isProd ? new URL(req.url).searchParams.get('dev_as') : null;   // dev stub: sign in as this email
      return NextResponse.redirect(`${env.appUrl}/api/auth/google/callback?state=${state}&code=${encodeURIComponent(as ? 'dev:' + as : 'dev')}`);
    }
    return NextResponse.redirect(`${env.appUrl}/signup?error=google`);
  }
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({ client_id: env.googleClientId, redirect_uri: `${env.appUrl}/api/auth/google/callback`, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' }).toString();
  return NextResponse.redirect(u.toString());
}
