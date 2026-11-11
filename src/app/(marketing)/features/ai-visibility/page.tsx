import { metadataFor } from '@/lib/seo';
import type { Viewport } from 'next';
import { AiVisibility } from '@/features/marketing/AiVisibility';

export const dynamic = 'force-static';
export const metadata = metadataFor('/features/ai-visibility');
export const viewport: Viewport = { themeColor: '#efeeeb', colorScheme: 'light' };

export default function Page() { return <AiVisibility />; }
