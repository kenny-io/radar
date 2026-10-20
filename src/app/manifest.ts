import type { MetadataRoute } from 'next';

// PWA manifest (UPDATE-2026-10-21 §1.4): icons exported from assets/radar-app-icon.svg (white mark on #070709).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Radar', short_name: 'Radar', description: 'Search and social marketing that runs on what makes your business yours.',
    start_url: '/dashboard', display: 'standalone', background_color: '#070709', theme_color: '#141518',
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
  };
}
