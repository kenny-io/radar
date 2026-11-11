import type { Viewport } from 'next';
import { metadataFor } from '@/lib/seo';
import { SocialMarketing } from '@/features/marketing/SocialMarketing';

export const dynamic = 'force-static';
export const metadata = metadataFor('/features/social-marketing');
export const viewport: Viewport = { themeColor: '#efeeeb', colorScheme: 'light' };
export default function Page() { return <SocialMarketing />; }
