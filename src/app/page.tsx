import { redirect } from 'next/navigation';
import { currentUser } from '@/server/auth/session';
export const dynamic = 'force-dynamic';
export default async function Home() { const u = await currentUser(); redirect(u ? '/dashboard' : '/signup'); }
