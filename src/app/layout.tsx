import type { Metadata, Viewport } from 'next';
import { ROOT_METADATA } from '@/lib/seo';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import '@fontsource/roboto/500.css'; // Google sign-in button spec (Roboto Medium 14px), bundled locally
import { ToastHost } from '@/components/ui';
import { currentUser } from '@/server/auth/session';
import './radar.css';

export const metadata: Metadata = {
  ...ROOT_METADATA,
  // Match the browser's appearance so the mark stays visible in the tab bar.
  icons: {
    icon: [
      { url: '/brand/radar-mark.svg', type: 'image/svg+xml', sizes: 'any', media: '(prefers-color-scheme: light)' },
      { url: '/brand/radar-mark-white.svg', type: 'image/svg+xml', sizes: 'any', media: '(prefers-color-scheme: dark)' },
    ],
  },
};
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
