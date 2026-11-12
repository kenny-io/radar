import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Keep metadata in the initial head for AI/search crawlers as well as social preview bots.
  htmlLimitedBots: /.*/,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // @daytona/sdk is loaded only by the worker through a dynamic import; keep its OpenTelemetry and AWS tree out of the server bundle.
  serverExternalPackages: ['@napi-rs/canvas', 'pg', 'framer-api', '@daytona/sdk'],
  images: { unoptimized: true },
  async headers() {
    const privateRoutes = ['signup', 'signin', 'verify-email', 'login', 'start-trial', 'start', 'onboarding', 'dashboard', 'calendar', 'settings', 'brief', 'article', 'performance', 'backlinks', 'profile', 'api'];
    return [
      { source: '/:path*', headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] },
      // Headers also cover redirect responses, which do not render layout metadata. HTML remains crawlable.
      ...privateRoutes.map(route => ({ source: `/${route}/:path*`, headers: [{ key: 'X-Robots-Tag', value: route === 'api' ? 'noindex, nofollow' : 'noindex, follow' }] })),
      ...['/verify-email', '/api/auth/:path*'].map(source => ({ source, headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }] })),
      // The workspace page shares a prefix with public /social/*.png preview assets.
      { source: '/social', headers: [{ key: 'X-Robots-Tag', value: 'noindex, follow' }] },
      ...['forgot-password', 'reset-password', 'email-preferences', 'ai-email-preferences', 'api/ai-email-preferences', 'email/learn', 'email/open'].map(route => ({ source: `/${route}/:path*`, headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }] })),
    ];
  },
};
export default nextConfig;
