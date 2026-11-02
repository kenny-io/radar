import type { Viewport } from 'next';
import { metadataFor } from '@/lib/seo';
import { DailyBrief } from '@/features/marketing/DailyBrief';

export const dynamic = 'force-static';
export const metadata = metadataFor('/features/daily-brief');
export const viewport: Viewport = { themeColor: '#efeeeb', colorScheme: 'light' };
export default function Page() { return <DailyBrief />; }
