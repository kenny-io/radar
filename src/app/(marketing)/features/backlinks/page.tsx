import type { Metadata, Viewport } from 'next';
import { Backlinks } from '@/features/marketing/Backlinks';

export const metadata: Metadata = { title: 'Backlinks network · Radar', description: 'An optional network of businesses that link to each other only where it genuinely helps readers. Every link approved and disclosed.' };
export const viewport: Viewport = { themeColor: '#efeeeb', colorScheme: 'light' };

export default function Page() { return <Backlinks />; }
