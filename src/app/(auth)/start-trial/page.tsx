import { redirect } from 'next/navigation';
import { trialGuard } from '@/server/billing/guard';
import { TrialPage } from '@/features/billing/TrialPage';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Start your free trial · Radar' };
// The gate (handoff §3.4): no session → /signup; trialing/active → /dashboard; otherwise the $1 card confirmation.
export default async function Page() {
  const g = await trialGuard();
  if ('redirect' in g) redirect(g.redirect);
  return <TrialPage {...g.props} />;
}
