import type { Metadata, Viewport } from 'next';
import { OrganicSearch } from '@/features/marketing/OrganicSearch';

export const metadata: Metadata = { title: 'Organic search · Radar', description: 'A month of articles aimed at keywords your site can actually win, researched from your Business Profile and published where your site lives.' };
export const viewport: Viewport = { themeColor: '#efeeeb', colorScheme: 'light' };

export default function Page() { return <OrganicSearch />; }
