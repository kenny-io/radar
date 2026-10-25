import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/server/auth/session';
import { accountOf } from '@/server/billing/access';
import { trialGuard } from '@/server/billing/guard';
import { TrialPage } from '@/features/billing/TrialPage';
import { trialPageTitle } from '@/features/billing/copy';
export const dynamic = 'force-dynamic';
// The title names the mode the page renders, from a read with no side effects: the guard can commit a draft, and Next
// resolves metadata again when the page redirects, so the guard runs only in the page. Same rule as billingState's
// mode (src/server/billing/state.ts); a user with access is redirected, so 'none' never needs a title.
export async function generateMetadata(): Promise<Metadata> {
  const u = await currentUser();
  const a = u ? await accountOf(u.id) : null;
  return { title: trialPageTitle({ mode: a?.everSubscribed ? 'restart' : 'trial' }) };
}
// The gate (handoff §3.4): no session → /signup; trialing/active → /dashboard; otherwise the $1 card confirmation.
export default async function Page() {
  const g = await trialGuard();
  if ('redirect' in g) redirect(g.redirect);
  return <TrialPage {...g.props} />;
}
