// Shared fixtures for the *.live.test.ts suites: they call the real connector modules against the local harness
// (scripts/connectors/). Each suite is skipped unless its harness env vars are set:
//   set -a; source .data/connectors/harness.env; set +a; npx vitest run src/server/services/publishing
import { createCanvas } from '@napi-rs/canvas';
import type { Block } from '@/lib/types';
import { blocksToHtml, blocksToMarkdown } from '../render';
import type { ConnCtx, PublishPayload } from '../types';
import type { ConnType } from '@/lib/types';

export const H = {
  wpUrl: process.env.RADAR_IT_WP_URL || '', wpUser: process.env.RADAR_IT_WP_USER || '', wpPass: process.env.RADAR_IT_WP_PASS || '',
  wpAuthor: process.env.RADAR_IT_WP_AUTHOR_USER || '', wpAuthorPass: process.env.RADAR_IT_WP_AUTHOR_PASS || '',
  ghostUrl: process.env.RADAR_IT_GHOST_URL || '', ghostKey: process.env.RADAR_IT_GHOST_KEY || '',
  hookUrl: process.env.RADAR_IT_WEBHOOK_URL || '', hookSecret: process.env.RADAR_IT_WEBHOOK_SECRET || '',
};

/** Unique per run so reruns against long-lived containers never collide by accident. */
export const RUN = Date.now().toString(36);

export function ctx(type: ConnType, fields: Record<string, string>, creds: Record<string, any> = {}, secret: string | null = null): ConnCtx {
  return { type, fields, creds, target: null, targetId: null, secret, bid: '00000000-0000-0000-0000-000000000000', domain: 'fieldnote.test', businessName: 'Fieldnote' };
}

export const BODY: Block[] = [
  ['p', 'Pricing a freelance design project starts with knowing your costs.'],
  ['h2', 'Work out your floor'],
  ['p', 'Add up rent, software & insurance — then divide by billable hours.'],
  ['h3', 'Billable hours are fewer than you think'],
  ['ul', ['Admin takes a day a week', 'Sales calls are unbilled', 'Revisions creep in']],
  ['h2', 'Quote the project, not the hour'],
  ['p', 'Clients compare totals, so anchor on the outcome.'],
];
export const VIDEOS = [{ id: 'dQw4w9WgXcQ', title: 'Pricing design work', channel: 'The Futur', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }];
export const SOURCES = [{ title: 'Freelance rates survey 2026', url: 'https://example.org/survey' }, { title: 'AIGA design census', url: 'https://example.org/census' }];
/** An approved outbound link, as backlinks/outbound.ts inserts it. */
export const LINK = '<p>See <a href="https://partner.example.org/guide" rel="sponsored">the partner guide</a> (Partner link).</p>';

let png: Buffer | null = null;
export function heroPng(): Buffer {
  if (png) return png;
  const c = createCanvas(1200, 628); const g = c.getContext('2d');
  g.fillStyle = '#1F4D3A'; g.fillRect(0, 0, 1200, 628); g.fillStyle = '#F2B544'; g.fillRect(80, 80, 400, 200);
  return (png = c.toBuffer('image/png'));
}

export function payload(o: Partial<PublishPayload> & { slug: string; title?: string; withImage?: boolean } ): PublishPayload {
  const opts = { videos: VIDEOS, sources: SOURCES.map(x => ({ ...x, use: '' })) };
  const html = blocksToHtml(BODY, opts) + '\n' + LINK;
  const { slug, withImage, ...rest } = o;
  return {
    entryId: 'e_' + slug, title: 'How to price a freelance design project', html, markdown: blocksToMarkdown(BODY, opts), blocks: BODY,
    seoTitle: 'Freelance design pricing: a practical guide', meta: 'A practical guide to pricing freelance design work: costs, hours and quotes.', keyword: 'how to price freelance design', date: '2026-10-25',
    image: withImage === false ? null : { url: 'http://localhost:3201/api/files/test/hero.png', alt: 'A designer’s desk with a pricing sheet', bytes: async () => ({ buf: heroPng(), type: 'image/png', name: `${slug}.png` }) },
    canonical: null, mode: 'new', refreshUrl: null, sources: SOURCES, videos: VIDEOS, author: 'Fieldnote', ...rest, slug,
  } as PublishPayload;
}

/** GET a public page (no credentials) and return its HTML. */
export async function page(url: string): Promise<{ status: number; html: string }> {
  const r = await fetch(url, { redirect: 'follow' });
  return { status: r.status, html: await r.text() };
}

/** What a reader should see on the live page for the standard BODY. */
export function expectRendered(html: string, expect: (v: any) => any) {
  expect(html).toContain('Work out your floor');
  expect(html).toMatch(/<h2[^>]*>\s*Work out your floor\s*<\/h2>/);
  expect(html).toMatch(/<h3[^>]*>\s*Billable hours are fewer than you think\s*<\/h3>/);
  expect(html).toMatch(/<li[^>]*>\s*Admin takes a day a week\s*<\/li>/);
  expect(html).toMatch(/rent, software (&amp;|&#038;|&) insurance/);
  // Radar's nocookie iframe, or the platform's own YouTube player (WordPress oEmbed).
  expect(html).toMatch(/<iframe[^>]+src="https:\/\/www\.youtube(-nocookie)?\.com\/embed\/dQw4w9WgXcQ/);
  expect(html).toContain('Watch on YouTube');
  // (Ghost's default "outbound link tagging" appends ?ref={site} to external links.)
  expect(html).toMatch(/<a[^>]+href="https:\/\/example\.org\/survey(\?ref=[^"]*)?"[^>]*>\s*Freelance rates survey 2026\s*<\/a>/);
  expect(html).toMatch(/<a[^>]+href="https:\/\/partner\.example\.org\/guide(\?ref=[^"]*)?"[^>]*rel="sponsored"|<a[^>]+rel="sponsored"[^>]*href="https:\/\/partner\.example\.org\/guide/);
  // Exactly one player per video (no leftover iframe next to a platform embed).
  expect(html.match(/<iframe[^>]+youtube(-nocookie)?\.com\/embed\/dQw4w9WgXcQ/g)).toHaveLength(1);
}
