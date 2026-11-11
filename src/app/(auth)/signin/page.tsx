import { metadataFor } from '@/lib/seo';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { currentUser } from '@/server/auth/session';
import { signupContext, safeNext } from '@/server/billing/guard';
import { Signup } from '@/features/onboarding/Signup';
import { env } from '@/server/env';
export const dynamic = 'force-dynamic';
export const metadata = { ...metadataFor('/signin'), robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) { const n = (await searchParams).next || ''; if (await currentUser()) redirect(safeNext(n) || '/dashboard'); const { pending } = await signupContext(); return <Suspense><Signup mode="signin" pending={pending} turnstileRequired={env.signupTurnstileRequired} turnstileSiteKey={env.turnstileSiteKey} devStubs={env.devStubs} /></Suspense>; }
