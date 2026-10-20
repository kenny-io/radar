import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import '@fontsource/roboto/500.css'; // Google sign-in button spec (Roboto Medium 14px), bundled locally
import { ToastHost } from '@/components/ui';
import { currentUser } from '@/server/auth/session';
import './radar.css';

export const metadata: Metadata = { title: 'Radar', description: 'Search and social marketing that runs on what makes your business yours.' };
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, colorScheme: 'light dark',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#fbfbf9' }, { media: '(prefers-color-scheme: dark)', color: '#141518' }],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Appearance: "system" follows the OS (no attribute); light/dark are pinned on <html> server-side, so there's no flash.
  const u = await currentUser().catch(() => null);
  const theme = u?.appearance === 'light' || u?.appearance === 'dark' ? u.appearance : undefined;
  return <html lang="en" data-theme={theme} className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning><body><ToastHost>{children}</ToastHost></body></html>;
}
