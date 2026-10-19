import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { currentUser } from '@/server/auth/session';
import { Signup } from '@/features/onboarding/Signup';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create your account · Radar' };
export default async function Page() { if (await currentUser()) redirect('/dashboard'); return <Suspense><Signup mode="signup" /></Suspense>; }
