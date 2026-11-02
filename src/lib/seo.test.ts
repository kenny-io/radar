import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FEE_CENTS, PRICE_CENTS, TRIAL_DAYS } from './billing';
import { absoluteUrl, INDEXABLE_PAGES, jsonLd, llmsFullText, llmsText, metadataFor, pricingMarkdown, PRICING, publicStructuredData, ROOT_METADATA, SEO_PAGES, SITE_ORIGIN } from './seo';
import robots from '../app/robots';
import sitemap from '../app/sitemap';
import { GET as getLlms } from '../app/llms.txt/route';
import { GET as getFullLlms } from '../app/llms-full.txt/route';
import { GET as getPricing } from '../app/pricing.md/route';
import nextConfig from '../../next.config';
import { shouldServeStreamingMetadata } from 'next/dist/server/lib/streaming-metadata';

describe('public SEO boundaries', () => {
  it('keeps initial-head metadata blocking for AI, search, social and future crawler identities', () => {
    // Exercise the installed Next decision function, not just a regexp snapshot. Default bot detection
    // streamed metadata into body for several AI/search crawlers during the production acceptance run.
    const pattern = nextConfig.htmlLimitedBots?.source;
    expect(pattern).toBeDefined();
    for (const ua of ['OAI-SearchBot/1.4', 'PerplexityBot/1.0', 'Claude-SearchBot/1.0', 'Googlebot/2.1', 'bingbot/2.0', 'Twitterbot/1.0', 'facebookexternalhit/1.1', 'LinkedInBot/1.0', 'Slackbot/1.0', 'Discordbot/2.0', 'WhatsApp/2.0', 'FutureSearchCrawler/1.0', 'Mozilla/5.0']) {
      expect(shouldServeStreamingMetadata(ua, pattern), ua).toBe(false);
    }
  });
  it('indexes only the explicit public route allowlist, never accounts or customer resources', () => {
    const urls = sitemap().map(p => p.url);
    expect(urls).toEqual(['/', '/features/organic-search', '/features/ai-visibility', '/features/backlinks', '/privacy', '/terms', '/bot'].map(absoluteUrl));
    expect(INDEXABLE_PAGES).toHaveLength(7);
    for (const url of urls) { expect(new URL(url).origin).toBe(SITE_ORIGIN); expect(new URL(url).search).toBe(''); }
    expect(ROOT_METADATA.robots).toEqual({ index: false, follow: true });
    expect(metadataFor('/signup').robots).toEqual({ index: false, follow: true });
    expect(metadataFor('/signin').robots).toEqual({ index: false, follow: true });
  });
  it('gives public and account-entry pages complete, fixed-origin preview tags without relying on inheritance', () => {
    const titles = new Set(), descriptions = new Set();
    for (const page of SEO_PAGES) {
      const m = metadataFor(page.path); titles.add(m.title); descriptions.add(m.description);
      expect(m.alternates?.canonical).toBe(absoluteUrl(page.path));
      expect(m.openGraph).toMatchObject({ type: 'website', url: absoluteUrl(page.path), title: m.title, description: m.description, images: [{ url: `${SITE_ORIGIN}/social/${page.slug}.png`, width: 1200, height: 630, type: 'image/png' }] });
      expect(m.twitter).toMatchObject({ card: 'summary_large_image', title: m.title, description: m.description, images: [{ url: `${SITE_ORIGIN}/social/${page.slug}.png`, alt: expect.stringContaining('Radar by Thally') }] });
    }
    expect(titles.size).toBe(SEO_PAGES.length); expect(descriptions.size).toBe(SEO_PAGES.length);
  });
  it('ships a distinct, valid, reasonably sized 1200×630 PNG for every declared preview', () => {
    const payloads = new Set();
    for (const page of SEO_PAGES) {
      const png = readFileSync(path.resolve('public/social', `${page.slug}.png`));
      expect(png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))).toBe(true);
      expect(png.toString('ascii',12,16)).toBe('IHDR');
      expect(png.readUInt32BE(16)).toBe(1200); expect(png.readUInt32BE(20)).toBe(630);
      expect(png.length).toBeLessThan(1024 * 1024); payloads.add(png.toString('base64'));
    }
    expect(payloads.size).toBe(SEO_PAGES.length);
  });
  it('keeps HTML crawlable for noindex and protects redirected account/API responses with headers', async () => {
    expect(robots()).toEqual({ rules: { userAgent: '*', allow: '/', disallow: '/api/' }, sitemap: `${SITE_ORIGIN}/sitemap.xml` });
    const headers = await nextConfig.headers!();
    for (const route of ['signup', 'signin', 'login', 'start-trial', 'start', 'onboarding', 'dashboard', 'calendar', 'settings', 'brief', 'article', 'performance', 'backlinks', 'profile', 'api']) {
      expect(headers).toContainEqual({ source: `/${route}/:path*`, headers: [{ key: 'X-Robots-Tag', value: route === 'api' ? 'noindex, nofollow' : 'noindex, follow' }] });
    }
    expect(headers).toContainEqual({ source: '/social', headers: [{ key: 'X-Robots-Tag', value: 'noindex, follow' }] });
    // Public social card images must not inherit the workspace page's noindex header.
    expect(headers.some(h => h.source.startsWith('/social/') && h.headers.some(v => v.key === 'X-Robots-Tag'))).toBe(false);
    expect(headers.find(h => h.source === '/:path*')?.headers.some(h => h.key === 'X-Robots-Tag')).toBe(false);
  });
});

describe('AI discovery facts and safe serialization', () => {
  it('derives all price arithmetic from billing constants and explains credit rather than promising a free card check', () => {
    expect(PRICING).toEqual({ currency: 'USD', monthly: PRICE_CENTS / 100, confirmation: FEE_CENTS / 100, firstInvoice: (PRICE_CENTS - FEE_CENTS) / 100, trialDays: TRIAL_DAYS });
    for (const doc of [llmsText(), llmsFullText(), pricingMarkdown()]) {
      for (const fact of ['$1', '$49', '$50', '3', 'Fairspleet LLC', 'support@thally.io', 'team@thally.io']) expect(doc).toContain(fact);
      expect(doc).toMatch(/credit/); expect(doc).toMatch(/guarantee/);
      expect(doc).not.toMatch(/https?:\/\/(localhost|127\.|[^\s)]+\/(dashboard|signup|signin|api|article|calendar)(\/|\)|\s))/);
    }
  });
  it('only links public authoritative pages or actually implemented discovery files', () => {
    const allowed = new Set([...INDEXABLE_PAGES.map(p => absoluteUrl(p.path)), absoluteUrl('/#pricing'), absoluteUrl('/pricing.md'), absoluteUrl('/llms-full.txt'), absoluteUrl('/sitemap.xml'), 'https://thally.io']);
    for (const doc of [llmsText(), llmsFullText(), pricingMarkdown()]) for (const match of doc.matchAll(/\]\((https?:[^)]+)\)/g)) expect(allowed.has(match[1])).toBe(true);
  });
  it('returns fetchable static UTF-8 text without cookies and discourages duplicate search results', async () => {
    for (const [get, mime] of [[getLlms, 'text/plain'], [getFullLlms, 'text/plain'], [getPricing, 'text/markdown']] as const) {
      const response = get(); expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(`${mime}; charset=utf-8`);
      expect(response.headers.get('x-robots-tag')).toBe('noindex, follow');
      expect(response.headers.get('set-cookie')).toBeNull(); expect((await response.text()).length).toBeGreaterThan(500);
    }
  });
  it('describes real entities and monthly offer without invented ratings or unsafe script content', () => {
    const graph = publicStructuredData(); const text = jsonLd(graph);
    expect(JSON.parse(text)).toEqual(graph);
    expect(text).toContain('Fairspleet LLC'); expect(text).toContain('BusinessApplication'); expect(text).toContain('USD');
    expect(text).not.toMatch(/aggregateRating|reviewCount|SearchAction/);
    const hostile = jsonLd({ text: '</script><script>alert(1)</script>' });
    expect(hostile).not.toContain('<'); expect(JSON.parse(hostile)).toEqual({ text: '</script><script>alert(1)</script>' });
  });
});
