import { jsonLd, metadataFor, publicStructuredData } from '@/lib/seo';
import type { Viewport } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/server/auth/session';
import { Home } from '@/features/marketing/Home';

export const dynamic = 'force-dynamic';
export const metadata = metadataFor('/');
export const viewport: Viewport = { themeColor: '#111318', colorScheme: 'light' };

// Signed-in users go straight to the app (D3); everyone else sees the marketing home. A failed session lookup still
// renders the public page (as the root layout does).
export default async function Page() { if (await currentUser().catch(() => null)) redirect('/dashboard'); return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(publicStructuredData()) }} /><Home /></>; }
