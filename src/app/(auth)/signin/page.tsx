import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { currentUser } from '@/server/auth/session';
import { Signup } from '@/features/onboarding/Signup';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in · Radar' };
export default async function Page() { if (await currentUser()) redirect('/dashboard'); return <Suspense><Signup mode="signin" /></Suspense>; }
