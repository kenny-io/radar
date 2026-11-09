import { Suspense } from 'react';
import type { Metadata } from 'next';
import { EmailVerification } from '@/features/onboarding/EmailVerification';
import { env } from '@/server/env';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Confirm your email · Radar', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default function Page() { return <Suspense><EmailVerification turnstileRequired={env.signupTurnstileRequired} turnstileSiteKey={env.turnstileSiteKey} devStubs={env.devStubs} /></Suspense>; }
