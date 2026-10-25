import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  serverExternalPackages: ['@napi-rs/canvas', 'pg', 'framer-api'],
  images: { unoptimized: true },
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }, { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] }];
  },
};
export default nextConfig;
