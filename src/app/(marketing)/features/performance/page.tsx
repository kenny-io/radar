import type { Viewport } from 'next';
import { metadataFor } from '@/lib/seo';
import { Performance } from '@/features/marketing/Performance';

export const dynamic = 'force-static';
export const metadata = metadataFor('/features/performance');
export const viewport: Viewport = { themeColor: '#efeeeb', colorScheme: 'light' };
export default function Page() { return <Performance />; }
