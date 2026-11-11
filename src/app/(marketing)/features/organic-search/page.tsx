import { metadataFor } from '@/lib/seo';
import type { Viewport } from 'next';
import { OrganicSearch } from '@/features/marketing/OrganicSearch';

export const dynamic = 'force-static';
export const metadata = metadataFor('/features/organic-search');
export const viewport: Viewport = { themeColor: '#efeeeb', colorScheme: 'light' };

export default function Page() { return <OrganicSearch />; }
