import type { Metadata, Viewport } from 'next';
import { AiVisibility } from '@/features/marketing/AiVisibility';

export const metadata: Metadata = { title: 'AI visibility · Radar', description: 'See whether ChatGPT, Perplexity, Gemini, Claude and Grok mention your product, and turn every gap into an article.' };
export const viewport: Viewport = { themeColor: '#efeeeb', colorScheme: 'light' };

export default function Page() { return <AiVisibility />; }
