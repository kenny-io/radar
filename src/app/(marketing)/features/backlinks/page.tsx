import { metadataFor } from '@/lib/seo';
import type { Viewport } from 'next';
import { Backlinks } from '@/features/marketing/Backlinks';

export const dynamic = 'force-static';
export const metadata = metadataFor('/features/backlinks');
export const viewport: Viewport = { themeColor: '#efeeeb', colorScheme: 'light' };

export default function Page() { return <Backlinks />; }
