import { redirect } from 'next/navigation';
import { currentUser } from '@/server/auth/session';
import { Signup } from '@/features/onboarding/Signup';
export const dynamic = 'force-dynamic';
export default async function Page() { if (await currentUser()) redirect('/dashboard'); return <Signup mode="signup" />; }
