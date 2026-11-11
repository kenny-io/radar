import { NextResponse } from 'next/server';
import { env } from '@/server/env';
import { createGoogleState } from '@/server/auth/googleState';
import { limitAuthIp } from '@/server/auth/requests';
import { handle } from '@/server/http/handle';
import { safeNext } from '@/server/billing/guard';

export const GET = handle(async (req: Request) => {
  await limitAuthIp(req, 'google');
  const rawNext = new URL(req.url).searchParams.get('next');
  const next = rawNext && rawNext.length <= 2000 ? safeNext(rawNext) || '/' : '/';
  if (!env.googleClientId && !env.devStubs) return NextResponse.redirect(`${env.appUrl}/signup?error=google`);
  const state = await createGoogleState(next);
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
});
