// Invite accept link: {APP_URL}/api/invites/{token} (sent by team.invite).
// Signed in → activate the membership, make it the current business, open the Dashboard.
// Signed out → /signup?next=/api/invites/{token}; the auth screens send the user back here after sign-up / sign-in.
import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth/session';
import { BIZ_COOKIE } from '@/server/auth/users';
import { acceptInvite, findInvite } from '@/server/services/team/invites';
import { bump } from '@/server/workspace';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);
  try {
    const user = await currentUser();
    if (!user) {
      // Only bounce through signup for a link that could work; a dead link just goes to sign-in.
      const hit = await findInvite(token);
      if (!hit) return to('/signin');
      return to('/signup?next=' + encodeURIComponent(`/api/invites/${token}`));
    }
    const r = await acceptInvite(token, user);
    if (!r.ok) {
      console.warn(`[invites] ${r.reason} invite link used by ${user.id}`);
      return to('/dashboard');
    }
    await bump(r.businessId).catch(() => {});
    const res = to('/dashboard');
    res.cookies.set(BIZ_COOKIE, r.businessId, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 864e2 });
    return res;
  } catch (e) {
    console.error('[invites]', e);
    return to('/dashboard');
  }
}
