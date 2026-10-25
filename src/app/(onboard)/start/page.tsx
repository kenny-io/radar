import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { startGuard } from '@/server/billing/guard';
import { OnboardingStage } from '@/features/onboarding/OnboardingStage';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set up your business · Radar' };
// Anonymous onboarding (journey A). A signed-in user is sent to /onboarding; the guest is created by POST /api/b.
export default async function Page({ searchParams }: { searchParams: Promise<{ domain?: string | string[] }> }) {
  const d = (await searchParams).domain;
  const g = await startGuard(typeof d === 'string' ? d : null);
  if ('redirect' in g) redirect(g.redirect);
  return <Suspense><OnboardingStage {...g.props} /></Suspense>;
}
