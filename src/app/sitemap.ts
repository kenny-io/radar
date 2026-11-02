import type { MetadataRoute } from 'next';
import { absoluteUrl, INDEXABLE_PAGES } from '@/lib/seo';

export default function sitemap(): MetadataRoute.Sitemap {
  // A fixed allowlist prevents account URLs, customer data and query strings from leaking into discovery.
  return INDEXABLE_PAGES.map(page => ({ url: absoluteUrl(page.path) }));
}
