import type { Viewport } from 'next';
import { metadataFor } from '@/lib/seo';
import { BlogIndex } from '@/features/marketing/blog/BlogPages';
export const dynamic = 'force-static';
export const metadata = metadataFor('/blog');
export const viewport: Viewport = { themeColor: '#efeeeb', colorScheme: 'light' };
export default function Page() { return <BlogIndex />; }
