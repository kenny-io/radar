import type { Metadata } from 'next';
import { PasswordRecovery } from '@/features/onboarding/PasswordRecovery';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Forgot your password · Radar', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default function Page() { return <PasswordRecovery mode="request" />; }
