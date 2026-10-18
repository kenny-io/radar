import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { ToastHost } from '@/components/ui';
import './radar.css';

export const metadata: Metadata = { title: 'Radar', description: 'Search and social marketing that runs on what makes your business yours.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}><body><ToastHost>{children}</ToastHost></body></html>;
}
