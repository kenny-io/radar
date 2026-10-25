import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { onboardingGuard } from '@/server/billing/guard';
import { OnboardingStage } from '@/features/onboarding/OnboardingStage';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set up your business · Radar' };
// Signed-in onboarding (journey B, and a returning user's unsaved draft). A guest goes back to /start.
export default async function Page({ searchParams }: { searchParams: Promise<{ domain?: string | string[] }> }) {
  const d = (await searchParams).domain;
  const g = await onboardingGuard(typeof d === 'string' ? d : null);
  if ('redirect' in g) redirect(g.redirect);
  return <Suspense><OnboardingStage {...g.props} /></Suspense>;
}
