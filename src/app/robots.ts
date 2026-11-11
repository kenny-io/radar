import type { MetadataRoute } from 'next';
import { SITE_ORIGIN } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  // Leave HTML crawlable so its noindex tags can be seen. Existing model-training access is unchanged.
  return { rules: { userAgent: '*', allow: '/', disallow: '/api/' }, sitemap: `${SITE_ORIGIN}/sitemap.xml` };
}
