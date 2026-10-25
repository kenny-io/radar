import type { Metadata, Viewport } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/server/auth/session';
import { Home } from '@/features/marketing/Home';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Radar — Get discovered by people and AI', description: 'Radar carries what you built beyond your network: into Google, AI answers, and the conversations where people ask for it.' };
export const viewport: Viewport = { themeColor: '#111318', colorScheme: 'light' };

// Signed-in users go straight to the app (D3); everyone else sees the marketing home. A failed session lookup still
// renders the public page (as the root layout does).
export default async function Page() { if (await currentUser().catch(() => null)) redirect('/dashboard'); return <Home />; }
