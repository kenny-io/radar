import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  serverExternalPackages: ['@napi-rs/canvas', 'pg', 'framer-api'],
  images: { unoptimized: true },
  async headers() {
    const privateRoutes = ['signup', 'signin', 'login', 'start-trial', 'start', 'onboarding', 'dashboard', 'calendar', 'settings', 'brief', 'article', 'performance', 'backlinks', 'profile', 'api'];
    return [
      { source: '/:path*', headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] },
      // Headers also cover redirect responses, which do not render layout metadata. HTML remains crawlable.
      ...privateRoutes.map(route => ({ source: `/${route}/:path*`, headers: [{ key: 'X-Robots-Tag', value: route === 'api' ? 'noindex, nofollow' : 'noindex, follow' }] })),
      // The workspace page shares a prefix with public /social/*.png preview assets.
      { source: '/social', headers: [{ key: 'X-Robots-Tag', value: 'noindex, follow' }] },
    ];
  },
};
export default nextConfig;
