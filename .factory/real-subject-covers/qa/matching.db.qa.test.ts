// QA probe: automatic matching (AC5, D3) end to end below the draft: the real findSubjectPicture, the real fetchOwn,
// the real page reader and the real decoder, against a made-up site served by a replaced global `fetch` (no network).
// crawl_pages is the real table (DATABASE_URL). Each case says which picture, if any, becomes the cover.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
delete process.env.RADAR_DEV_STUBS;
import fs from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { db, schema } from '@/server/db';
import { Fixtures, uniq } from '@/server/testing/fixtures';
import { findSubjectPicture, pictureFromAddress, SitePictureError } from '@/server/services/realCover';

const lines: string[] = [];
afterAll(() => { fs.mkdirSync('.factory/real-subject-covers/qa/evidence', { recursive: true }); fs.writeFileSync('.factory/real-subject-covers/qa/evidence/matching-outcomes.txt', lines.join('\n') + '\n'); });
const F = new Fixtures();
afterAll(() => F.cleanup());

const D = 'stays.test';
// Round 2: a sky gradient with three blocks. It was one flat colour (#336699) in round 1; decision D18 now refuses a
// flat-colour picture, so the stand-in for "a usable photograph" has to look like one. Nothing else about it matters.
const PNG = (() => { const c = createCanvas(1600, 900); const g = c.getContext('2d'); const sky = g.createLinearGradient(0, 0, 0, 900); sky.addColorStop(0, '#87b7e0'); sky.addColorStop(1, '#f2d7b0'); g.fillStyle = sky; g.fillRect(0, 0, 1600, 900); g.fillStyle = '#3b3f4a'; g.fillRect(300, 300, 260, 600); g.fillStyle = '#c9a227'; g.fillRect(700, 420, 200, 480); g.fillStyle = '#336699'; g.fillRect(1050, 200, 300, 700); return c.toBuffer('image/png'); })();
type Route = { status?: number; type?: string; body?: string | Buffer; location?: string; delay?: number; throws?: boolean };
type Site = Record<string, Route | string | Buffer>;
const fetchMock = vi.fn(); let asked: string[] = [];
function serve(site: Site, hostOk = (h: string) => h === D || h.endsWith('.' + D)) {
  asked = [];
  fetchMock.mockImplementation(async (address: string, init: any) => {
    const u = new URL(address); asked.push(u.href);
    if (!hostOk(u.hostname) || u.protocol !== 'https:') throw new Error('QA: a request left the site: ' + u.href);
    const hit = site[u.pathname + u.search] ?? site[u.pathname];
    const r: Route = typeof hit === 'string' || Buffer.isBuffer(hit) ? { body: hit } : hit ?? { status: 404, body: 'not found' };
    if (r.delay) await new Promise((ok, no) => { const t = setTimeout(ok, r.delay); init?.signal?.addEventListener('abort', () => { clearTimeout(t); no(new DOMException('aborted', 'AbortError')); }); });
    if (r.throws) throw new TypeError('fetch failed');
    if (r.location) return new Response(null, { status: r.status || 302, headers: { location: r.location } });
    const body = r.body ?? ''; const type = r.type ?? (Buffer.isBuffer(body) ? 'image/png' : u.pathname.endsWith('.xml') ? 'application/xml' : u.pathname.endsWith('.txt') ? 'text/plain' : 'text/html; charset=utf-8');
    return new Response(body, { status: r.status || 200, headers: { 'content-type': type } });
  });
}
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const page = (o: { title?: string; h1?: string; head?: string; body?: string }) => `<!doctype html><html><head><title>${o.title ?? ''}</title>${o.head ?? ''}</head><body><header><img src="/brand/logo.png" alt="Stays logo"></header><main>${o.h1 !== undefined ? `<h1>${o.h1}</h1>` : ''}${o.body ?? ''}</main></body></html>`;
const sitemap = (...paths: string[]) => `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(p => `<url><loc>https://${D}${p}</loc></url>`).join('')}</urlset>`;
const HOME = page({ title: 'Stays', h1: 'Stays', head: `<meta property="og:image" content="https://${D}/og.png">` });
const ld = (o: any) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...o })}</script>`;
const base = (paths: string[], more: Site = {}): Site => ({ '/robots.txt': 'User-agent: *\nAllow: /\n', '/sitemap.xml': sitemap(...paths), '/': HOME, '/og.png': PNG, ...more });
const find = async (subject: string, site: Site, o: { bid?: string; kind?: string; budgetMs?: number } = {}) => {
  serve(site);
  const t = Date.now();
  const r = await findSubjectPicture({ bid: o.bid || '00000000-0000-4000-8000-000000000000', domain: D, subject: { name: subject, kind: o.kind || 'building' }, ...(o.budgetMs ? { budgetMs: o.budgetMs } : {}) });
  return { src: r.picture?.src ?? null, page: r.picture?.page ?? null, searched: r.searched, requests: asked.length, ms: Date.now() - t };
};
const note = (name: string, r: { src: string | null; searched: boolean; requests: number }, verdict = '') => lines.push(`${name.padEnd(96)} picture: ${String(r.src).replace('https://' + D, '').padEnd(46)} searched: ${String(r.searched).padEnd(5)} requests: ${r.requests} ${verdict}`);

describe.skipIf(!process.env.DATABASE_URL)('automatic matching', () => {
  it('control: the subject’s page with a picture tied to it by structured data', async () => {
    const r = await find('Harbour House', base(['/places/harbour-house'], { '/places/harbour-house': page({ title: 'Harbour House — Stays', h1: 'Harbour House', body: ld({ '@type': 'Place', name: 'Harbour House', image: `https://${D}/media/hh.png` }) }), '/media/hh.png': PNG }));
    note('control: exact page, structured-data picture', r); expect(r.src).toBe(`https://${D}/media/hh.png`); expect(r.requests).toBeLessThanOrEqual(4);
  });
  it('control: tied by alt text only', async () => {
    const r = await find('Harbour House', base(['/places/harbour-house'], { '/places/harbour-house': page({ title: 'Harbour House — Stays', h1: 'Harbour House', body: '<img src="/media/hh.png" alt="Harbour House · photo 1" width="1600" height="900">' }), '/media/hh.png': PNG }));
    note('control: exact page, alt-text picture', r); expect(r.src).toBe(`https://${D}/media/hh.png`);
  });

  describe('near misses from architecture §4.4: no picture', () => {
    const cases: [string, string, Site][] = [
      ['Wasl 61 against wasl-611-al-warsan', 'Wasl 61', base(['/property/wasl-611-al-warsan'], { '/property/wasl-611-al-warsan': page({ title: 'Wasl 611 — Stays', h1: 'Wasl 611', body: '<img src="/media/a.png" alt="Wasl 611 photo">' }), '/media/a.png': PNG })],
      ['Wasl 611 against a page whose h1 is Wasl 611 Tower B', 'Wasl 611', base(['/property/wasl-611-tower-b'], { '/property/wasl-611-tower-b': page({ title: 'Wasl 611 Tower B — Stays', h1: 'Wasl 611 Tower B', body: '<img src="/media/a.png" alt="Wasl 611 Tower B">' }), '/media/a.png': PNG })],
      ['Marina Tower against princess-tower-dubai-marina', 'Marina Tower', base(['/property/princess-tower-dubai-marina'], { '/property/princess-tower-dubai-marina': page({ title: 'Princess Tower — Stays', h1: 'Princess Tower', body: '<img src="/media/a.png" alt="Princess Tower, Dubai Marina tower view">' }), '/media/a.png': PNG })],
      ['Princess Tower against /property/marina-tower', 'Princess Tower', base(['/property/marina-tower'], { '/property/marina-tower': page({ title: 'Marina Tower — Stays', h1: 'Marina Tower', body: '<img src="/media/a.png" alt="Marina Tower next to Princess Tower">' }), '/media/a.png': PNG })],
      ['a blog post: /blog/why-wasl-611-is-popular', 'Wasl 611', base(['/blog/why-wasl-611-is-popular'], { '/blog/why-wasl-611-is-popular': page({ title: 'Wasl 611', h1: 'Wasl 611', body: '<img src="/media/a.png" alt="Wasl 611">' }), '/media/a.png': PNG })],
      ['a blog post: /blog/wasl-611-review', 'Wasl 611', base(['/blog/wasl-611-review'], { '/blog/wasl-611-review': page({ title: 'Wasl 611', h1: 'Wasl 611', body: '<img src="/media/a.png" alt="Wasl 611">' }), '/media/a.png': PNG })],
      ['Dubai Marina against /blog/dubai-marina-vs-jbr', 'Dubai Marina', base(['/blog/dubai-marina-vs-jbr'], { '/blog/dubai-marina-vs-jbr': page({ title: 'Dubai Marina', h1: 'Dubai Marina', body: '<img src="/media/a.png" alt="Dubai Marina">' }), '/media/a.png': PNG })],
      ['right page, picture alt "Property thumbnail 1"', 'Wasl 611', base(['/property/wasl-611'], { '/property/wasl-611': page({ title: 'Wasl 611 — Stays', h1: 'Wasl 611', body: '<img src="/media/a.png" alt="Property thumbnail 1">' }), '/media/a.png': PNG })],
      ['right page, og:image equal to the home page’s', 'Wasl 611', base(['/property/wasl-611'], { '/property/wasl-611': page({ title: 'Wasl 611 — Stays', h1: 'Wasl 611', head: `<meta property="og:image" content="https://${D}/og.png"><meta property="og:image:alt" content="Wasl 611 — Apartment">` }) })],
      ['right page, picture on cdn.other.com', 'Wasl 611', base(['/property/wasl-611'], { '/property/wasl-611': page({ title: 'Wasl 611 — Stays', h1: 'Wasl 611', body: `<img src="https://cdn.other.com/a.png" alt="Wasl 611">${ld({ '@type': 'Place', name: 'Wasl 611', image: 'https://cdn.other.com/a.png' })}` }) })],
      ['a page with JSON-LD ItemList', 'Wasl 611', base(['/property/wasl-611'], { '/property/wasl-611': page({ title: 'Wasl 611 — Stays', h1: 'Wasl 611', body: `<img src="/media/a.png" alt="Wasl 611">${ld({ '@type': 'ItemList', name: 'Wasl 611' })}` }), '/media/a.png': PNG })],
      ['a page with JSON-LD CollectionPage', 'Wasl 611', base(['/property/wasl-611'], { '/property/wasl-611': page({ title: 'Wasl 611 — Stays', h1: 'Wasl 611', body: `<img src="/media/a.png" alt="Wasl 611">${ld({ '@type': 'CollectionPage', name: 'Wasl 611' })}` }), '/media/a.png': PNG })],
      ['picture alt "Illustration of Wasl 611"', 'Wasl 611', base(['/property/wasl-611'], { '/property/wasl-611': page({ title: 'Wasl 611 — Stays', h1: 'Wasl 611', body: '<img src="/media/a.png" alt="Illustration of Wasl 611">' }), '/media/a.png': PNG })],
    ];
    it.each(cases)('%s', async (name, subject, site) => {
      const r = await find(subject, site);
      note('§4.4: ' + name, r); expect(r.src).toBeNull();
      for (const u of asked) expect(new URL(u).hostname).toBe(D);
    });
  });

  describe('QA’s own near misses: each of these would put another subject’s picture, or a picture of nothing, on the article', () => {
    const PLACE = (body: string, o: { title?: string; h1?: string; head?: string } = {}) => page({ title: o.title ?? 'Harbour House — Stays', h1: o.h1 ?? 'Harbour House', head: o.head, body });
    const cases: [string, string, Site, string | null][] = [
      ['Q1 right page; its own photo has a generic alt; a "similar places" card below is alt "Harbour House Annex · photo 1"', 'Harbour House',
        base(['/places/harbour-house'], { '/places/harbour-house': PLACE('<img src="/media/hh.png" alt="Photo 1" width="1600" height="900"><section><h2>Similar places</h2><a href="/places/harbour-house-annex"><img src="/media/annex.png" alt="Harbour House Annex · photo 1" width="800" height="600"></a></section>'), '/media/hh.png': PNG, '/media/annex.png': PNG }), null],
      ['Q2 right page; its photo alt is "View from Harbour House of the old mill"', 'Harbour House',
        base(['/places/harbour-house'], { '/places/harbour-house': PLACE('<img src="/media/mill.png" alt="The old mill, five minutes from Harbour House" width="1600" height="900">'), '/media/mill.png': PNG }), null],
      ['Q3 only the Annex page exists; its <title> is "Harbour House - Annex | Stays", h1 "Harbour House Annex"', 'Harbour House',
        base(['/places/harbour-house-annex'], { '/places/harbour-house-annex': PLACE('<img src="/media/annex.png" alt="Harbour House Annex" width="1600" height="900">', { title: 'Harbour House - Annex | Stays', h1: 'Harbour House Annex' }), '/media/annex.png': PNG }), null],
      ['Q4 only the Annex page exists; its <title> is "Harbour House, Annex wing"', 'Harbour House',
        base(['/places/harbour-house-annex'], { '/places/harbour-house-annex': PLACE('<img src="/media/annex.png" alt="Harbour House Annex" width="1600" height="900">', { title: 'Harbour House, Annex wing', h1: 'Harbour House Annex' }), '/media/annex.png': PNG }), null],
      ['Q5 a blog post outside /blog/: /harbour-house-review, <title> "Harbour House: our honest review", no og:type', 'Harbour House',
        base(['/harbour-house-review'], { '/harbour-house-review': PLACE('<article><time datetime="2026-01-01">Jan 2026</time><img src="/media/chart.png" alt="Chart of Harbour House prices by month" width="1600" height="900"></article>', { title: 'Harbour House: our honest review', h1: 'Harbour House: our honest review' }), '/media/chart.png': PNG }), null],
      ['Q6 right page; no picture of its own; its og:image is the site card /share.png, and the HOME page has a different card', 'Harbour House',
        base(['/places/harbour-house'], { '/': page({ title: 'Stays', h1: 'Stays', head: `<meta property="og:image" content="https://${D}/home-hero.png">` }), '/places/harbour-house': PLACE('', { head: `<meta property="og:image" content="https://${D}/share.png">` }), '/share.png': PNG, '/home-hero.png': PNG }), null],
      ['Q7 right page; og:image is the site card with a cache-buster the home page does not carry (/og.png?v=2 against /og.png)', 'Harbour House',
        base(['/places/harbour-house'], { '/places/harbour-house': PLACE('', { head: `<meta property="og:image" content="https://${D}/og.png?v=2">` }), '/og.png?v=2': PNG }), null],
      ['Q8 right page on www; og:image is the apex-host card, the www home page names the www card', 'Harbour House',
        { ...base([]), '/sitemap.xml': `<?xml version="1.0"?><urlset><url><loc>https://www.${D}/places/harbour-house</loc></url></urlset>`, '/': page({ title: 'Stays', h1: 'Stays', head: `<meta property="og:image" content="https://www.${D}/og.png">` }), '/places/harbour-house': PLACE('', { head: `<meta property="og:image" content="https://${D}/og.png">` }) }, null],
      ['Q9 an area page (no listing markup): h1 "Dubai Marina", cards alt "Marina Gate 1 — Dubai Marina"', 'Dubai Marina',
        base(['/areas/dubai-marina'], { '/areas/dubai-marina': page({ title: 'Dubai Marina — Stays', h1: 'Dubai Marina', body: '<ul><li><img src="/media/gate.png" alt="Marina Gate 1 — Dubai Marina" width="800" height="600"></li><li><img src="/media/jbr.png" alt="Sadaf 4 — Dubai Marina" width="800" height="600"></li></ul>' }), '/media/gate.png': PNG, '/media/jbr.png': PNG }), null],
      ['Q10 right page; structured data names the subject but is a Review of it with the reviewer’s photo', 'Harbour House',
        base(['/places/harbour-house'], { '/places/harbour-house': PLACE(ld({ '@type': 'Review', name: 'Harbour House', image: `https://${D}/media/reviewer.png` })), '/media/reviewer.png': PNG }), null],
      ['Q11 right page; the tied picture redirects to a CDN', 'Harbour House',
        base(['/places/harbour-house'], { '/places/harbour-house': PLACE('<img src="/media/hh.png" alt="Harbour House">'), '/media/hh.png': { location: 'https://cdn.other.com/hh.png' } }), null],
      ['Q12 the subject is named in the middle of the slug: /places/the-harbour-house', 'Harbour House',
        base(['/places/the-harbour-house'], { '/places/the-harbour-house': PLACE('<img src="/media/hh.png" alt="Harbour House">', { title: 'The Harbour House', h1: 'The Harbour House' }), '/media/hh.png': PNG }), null],
      ['Q13 numbers: subject "Tower 1", page /towers/tower-10 titled "Tower 1 0"', 'Tower 1',
        base(['/towers/tower-10'], { '/towers/tower-10': page({ title: 'Tower 10 — Stays', h1: 'Tower 10', body: '<img src="/media/t.png" alt="Tower 10">' }), '/media/t.png': PNG }), null],
      ['Q14 numbers: subject "Wasl 611", page /property/wasl-611-2 (a second listing) h1 "Wasl 611 (2)"', 'Wasl 611',
        base(['/property/wasl-611-2'], { '/property/wasl-611-2': page({ title: 'Wasl 611 (2) — Stays', h1: 'Wasl 611 (2)', body: '<img src="/media/t.png" alt="Wasl 611 (2)">' }), '/media/t.png': PNG }), null],
      ['Q15 robots.txt disallows the page for RadarBot', 'Harbour House',
        { ...base(['/places/harbour-house'], { '/places/harbour-house': PLACE('<img src="/media/hh.png" alt="Harbour House">'), '/media/hh.png': PNG }), '/robots.txt': 'User-agent: RadarBot\nDisallow: /places/\n' }, null],
      ['Q16 robots.txt disallows the picture folder', 'Harbour House',
        { ...base(['/places/harbour-house'], { '/places/harbour-house': PLACE('<img src="/media/hh.png" alt="Harbour House">'), '/media/hh.png': PNG }), '/robots.txt': 'User-agent: *\nDisallow: /media/\n' }, null],
      ['Q17 the page is og:type article', 'Harbour House',
        base(['/harbour-house'], { '/harbour-house': PLACE('<img src="/media/hh.png" alt="Harbour House">', { head: '<meta property="og:type" content="article">' }), '/media/hh.png': PNG }), null],
      ['Q18 a tag archive: /tag/harbour-house, h1 "Harbour House"', 'Harbour House',
        base(['/tag/harbour-house'], { '/tag/harbour-house': PLACE('<img src="/media/post.png" alt="Harbour House opening party">'), '/media/post.png': PNG }), null],
      ['Q19 control: the right page listed in the sitemap with a query string', 'Harbour House',
        base(['/harbour-house?view=gallery&page=2'], { '/harbour-house?view=gallery&page=2': PLACE('<img src="/media/hh.png" alt="Harbour House">'), '/harbour-house': PLACE('<img src="/media/hh.png" alt="Harbour House">'), '/media/hh.png': PNG }), `https://${D}/media/hh.png`],
      ['Q20 right page; photos on a CDN; og:image is a per-page generated title card (/places/harbour-house/opengraph-image?3f2a), home has its own (/opengraph-image?91bc)', 'Harbour House',
        base(['/places/harbour-house'], { '/': page({ title: 'Stays', h1: 'Stays', head: `<meta property="og:image" content="https://${D}/opengraph-image?91bc">` }), '/places/harbour-house': PLACE('<img src="https://cdn.other.com/hh.jpg" alt="Harbour House">', { head: `<meta property="og:image" content="https://${D}/places/harbour-house/opengraph-image?3f2a">` }), '/places/harbour-house/opengraph-image?3f2a': PNG }), null],
      ['Q21 right page; a carousel card alt "Harbour House Annex" comes BEFORE the place’s own photo alt "Harbour House · photo 1"', 'Harbour House',
        base(['/places/harbour-house'], { '/places/harbour-house': PLACE('<div class="featured"><img src="/media/annex.png" alt="Harbour House Annex" width="800" height="600"></div><img src="/media/hh.png" alt="Harbour House · photo 1" width="1600" height="900">'), '/media/hh.png': PNG, '/media/annex.png': PNG }), `https://${D}/media/hh.png`],
      ['Q22 both pages exist; the right page’s only photo is on a CDN; the Annex page is titled "Harbour House - Annex | Stays"', 'Harbour House',
        base(['/places/harbour-house', '/places/harbour-house-annex'], { '/places/harbour-house': PLACE('<img src="https://cdn.other.com/hh.jpg" alt="Harbour House">'), '/places/harbour-house-annex': PLACE('<img src="/media/annex.png" alt="Harbour House Annex" width="1600" height="900">', { title: 'Harbour House - Annex | Stays', h1: 'Harbour House Annex' }), '/media/annex.png': PNG }), null],
      ['Q23 control: the stub site’s own near miss: Annex page titled "Harbour House Annex — Stays"', 'Harbour House',
        base(['/places/harbour-house-annex'], { '/places/harbour-house-annex': PLACE('<img src="/media/annex.png" alt="Harbour House Annex · photo 1" width="1600" height="900">', { title: 'Harbour House Annex — Stays', h1: 'Harbour House Annex' }), '/media/annex.png': PNG }), null],
    ];
    it.each(cases)('%s', async (name, subject, site, want) => {
      const r = await find(subject, site, { kind: name.startsWith('Q9') ? 'place' : 'building' });
      const verdict = r.src === want ? '' : `  <-- QA expected ${want}`;
      note(name, r, verdict);
      for (const u of asked) expect(new URL(u).hostname.endsWith(D)).toBe(true);
      expect(r.src, name).toBe(want);
    });
  });

  describe('it never throws, stays inside its budget, and remembers only finished searches', () => {
    it('every request failing', async () => { const r = await find('Harbour House', new Proxy({}, { get: () => ({ throws: true }) }) as Site); note('every request throws', r); expect(r).toMatchObject({ src: null }); });
    it('the site answers with garbage everywhere', async () => { const r = await find('Harbour House', new Proxy({}, { get: (_t, k) => (String(k) === 'then' ? undefined : { body: '\u0000￿<<<>>>{"@graph":[', type: 'text/html' }) }) as Site); note('garbage everywhere', r); expect(r.src).toBeNull(); });
    it('a slow site: the answer comes at the deadline, not after the sum of the delays, and is not remembered as a miss', async () => {
      const r = await find('Harbour House', base(['/places/harbour-house'], { '/robots.txt': { delay: 300, body: '' }, '/sitemap.xml': { delay: 300, body: sitemap('/places/harbour-house') }, '/places/harbour-house': { delay: 60_000, body: 'x' } }), { budgetMs: 1500 });
      note('slow site, 1.5 s budget (took ' + r.ms + ' ms)', r); expect(r.src).toBeNull(); expect(r.searched).toBe(false); expect(r.ms).toBeLessThan(3500);
    });
    it('at most 12 requests, however the site is arranged (a sitemap index of 50 files, redirect chains on every page)', async () => {
      const site: Site = { '/robots.txt': `Sitemap: https://${D}/sitemap.xml\n`, '/sitemap.xml': `<sitemapindex>${Array.from({ length: 50 }, (_, i) => `<sitemap><loc>https://${D}/s${i}.xml</loc></sitemap>`).join('')}</sitemapindex>` };
      for (let i = 0; i < 50; i++) site[`/s${i}.xml`] = sitemap(`/places/harbour-house-${i}`, '/places/harbour-house');
      site['/places/harbour-house'] = { location: '/r1' }; site['/r1'] = { location: '/r2' }; site['/r2'] = { location: '/r3' }; site['/r3'] = { location: '/r4' }; site['/r4'] = { location: '/r5' };
      const r = await find('Harbour House', site);
      note('sitemap index of 50 and redirect chains', r); expect(r.requests).toBeLessThanOrEqual(12); expect(r.src).toBeNull();
    });
    it('a sitemap of 60,000 addresses and a 3 MB page do not hang it', async () => {
      const many = sitemap(...Array.from({ length: 60_000 }, (_, i) => `/places/harbour-house-${i}`));
      const r = await find('Harbour House', base([], { '/sitemap.xml': many, '/places/harbour-house-0': page({ title: 'x', h1: 'x', body: '<p>' + 'a'.repeat(3_500_000) + '</p>' }) }));
      note(`sitemap of 60,000 addresses (${(many.length / 1048576).toFixed(1)} MB), took ${r.ms} ms`, r); expect(r.src).toBeNull(); expect(r.ms).toBeLessThan(10_000);
    });
    it('a subject under four letters is not searched for; an unknown business id is not an error', async () => {
      const r = await find('W1', base(['/w1'], { '/w1': page({ title: 'W1', h1: 'W1', body: '<img src="/media/a.png" alt="W1">' }), '/media/a.png': PNG }));
      note('subject "W1"', r); expect(r).toMatchObject({ src: null, searched: true, requests: 0 });
    });
    it('searched is true for a finished search with nothing found, false when the tied picture could not be reached', async () => {
      const none = await find('Harbour House', base(['/about']));
      expect(none).toMatchObject({ src: null, searched: true });
      const down = await find('Harbour House', base(['/places/harbour-house'], { '/places/harbour-house': page({ title: 'Harbour House', h1: 'Harbour House', body: '<img src="/media/hh.png" alt="Harbour House">' }), '/media/hh.png': { status: 502, body: '{"error":"Image unavailable"}', type: 'application/json' } }));
      note('tied picture answers 502', down); expect(down).toMatchObject({ src: null, searched: false });
    });
  });

  describe('pages the crawl already knows (crawl_pages)', () => {
    it('a crawled page whose h1 equals the subject is used without reading the sitemap; rows of another business and off-site rows are ignored', async () => {
      const user = await F.user(); const mine = await F.biz(user, { domain: D + '.' + uniq() }); const other = await F.biz(user);
      // The business's domain in this test is stays.test.<uniq>, so the made-up site must answer for it.
      const dom = mine.domain;
      await db.insert(schema.crawlPages).values([
        { businessId: mine.id, url: `https://${dom}/p/12345`, path: '/p/12345', title: 'Harbour House — Stays', h1: 'Harbour House' },
        { businessId: mine.id, url: `https://evil.example/harbour-house`, path: '/harbour-house', title: 'Harbour House', h1: 'Harbour House' },
        { businessId: other.id, url: `https://${dom}/other/harbour-house`, path: '/other/harbour-house', title: 'Harbour House', h1: 'Harbour House' },
      ]);
      const site: Site = { '/robots.txt': '', '/p/12345': page({ title: 'Harbour House — Stays', h1: 'Harbour House', body: '<img src="/media/hh.png" alt="Harbour House">' }), '/media/hh.png': PNG };
      serve(site, h => h === dom);
      const r = await findSubjectPicture({ bid: mine.id, domain: dom, subject: { name: 'Harbour House', kind: 'building' } });
      expect(r.picture?.src).toBe(`https://${dom}/media/hh.png`);
      expect(asked.map(u => new URL(u).pathname)).toEqual(['/robots.txt', '/p/12345', '/media/hh.png']);
      lines.push(`crawl_pages: id-style address /p/12345 found by its crawled h1; requests: ${asked.map(u => new URL(u).pathname).join(', ')}`);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Round 2 (revision 2b034f26, decisions D14 to D20): new adversarial cases against the new rules.
describe.skipIf(!process.env.DATABASE_URL)('round 2: the tightened rules', () => {
  const PLACE = (body: string, o: { title?: string; h1?: string; head?: string } = {}) => page({ title: o.title ?? 'Harbour House — Stays', h1: o.h1 ?? 'Harbour House', head: o.head, body });
  const raw = (head: string, body: string) => `<!doctype html><html><head><title>Stays</title>${head}</head><body><main>${body}</main></body></html>`;
  const HH = `https://${D}/media/hh.png`;
  const one = (path: string, html: string, more: Site = {}) => base([path], { [path]: html, '/media/hh.png': PNG, '/media/annex.png': PNG, '/media/other.png': PNG, ...more });
  const OWN = '<img src="/media/hh.png" alt="Photo 1" width="1600" height="900">'; // the place's own photo, generic alt: never tied

  describe('D14: only the h1 confirms a page (structured data only when there is no h1; the title never)', () => {
    const cases: [string, string, Site, string | null][] = [
      ['R1 two h1: "Harbour House Annex" first, "Harbour House" second', 'Harbour House', one('/places/harbour-house-annex', raw('', '<h1>Harbour House Annex</h1><h1>Harbour House</h1><img src="/media/annex.png" alt="Harbour House">')), null],
      ['R2 h1 "Harbour House <span>Annex</span>"', 'Harbour House', one('/places/harbour-house-annex', raw('', '<h1>Harbour House <span class="sub">Annex</span></h1><img src="/media/annex.png" alt="Harbour House">')), null],
      ['R3 h1 holds only an image (alt "Harbour House Annex"); title "Harbour House | Stays"; no structured data', 'Harbour House', one('/places/harbour-house-annex', `<!doctype html><html><head><title>Harbour House | Stays</title><meta property="og:title" content="Harbour House"></head><body><main><h1><img src="/media/wordmark.png" alt="Harbour House Annex"></h1><img src="/media/annex.png" alt="Harbour House"></main></body></html>`), null],
      ['R4 empty h1; structured data names only the Annex', 'Harbour House', one('/places/harbour-house-annex', raw(ld({ '@type': 'Place', name: 'Harbour House Annex', image: `https://${D}/media/annex.png` }), '<h1></h1><img src="/media/annex.png" alt="Harbour House">')), null],
      ['R5 empty h1; breadcrumb, Review, Offer, AggregateRating, ImageObject all named "Harbour House" (generic); the Annex is the Place', 'Harbour House', one('/places/harbour-house-annex', raw(ld({ '@graph': [{ '@type': 'BreadcrumbList', name: 'Harbour House' }, { '@type': 'Review', name: 'Harbour House', image: `https://${D}/media/other.png` }, { '@type': 'Offer', name: 'Harbour House', image: `https://${D}/media/other.png` }, { '@type': 'AggregateRating', name: 'Harbour House' }, { '@type': 'ImageObject', name: 'Harbour House', contentUrl: `https://${D}/media/other.png` }, { '@type': 'Comment', name: 'Harbour House', image: `https://${D}/media/other.png` }, { '@type': 'VideoObject', name: 'Harbour House', image: `https://${D}/media/other.png` }, { '@type': 'Place', name: 'Harbour House Annex', image: `https://${D}/media/annex.png` }] }), '<h1> </h1>')), null],
      ['R6 no h1; the entity named for the subject is nested (containedInPlace) inside the Annex entity', 'Harbour House', one('/places/harbour-house-annex', raw(ld({ '@type': 'Place', name: 'Harbour House Annex', image: `https://${D}/media/annex.png`, containedInPlace: { '@type': 'Place', name: 'Harbour House', image: `https://${D}/media/annex.png` } }), '<p>Annex</p>')), null],
      ['R7 control: no h1 at all; a Place entity named exactly for the subject with its picture', 'Harbour House', one('/places/harbour-house', raw(ld({ '@type': 'Place', name: 'Harbour House', image: HH }), '<p>About the place.</p>')), HH],
      ['R8 the site title is the first h1 on every page ("Harbour House" is also the business); the page is the Annex page (second h1)', 'Harbour House', one('/places/harbour-house-annex', raw('', '<header><h1>Harbour House</h1></header><h1>Harbour House Annex</h1><img src="/media/annex.png" alt="Harbour House Annex · photo 1" width="1600" height="900">' + ld({ '@type': 'Place', name: 'Harbour House Annex', image: `https://${D}/media/annex.png` }))), null],
      ['R9 h1 equal but upper case, extra spaces, accents and "&" ("HARBOUR  HOUSE"; subject "Café & Bar" against h1 "Cafe and Bar")', 'Café & Bar', one('/places/cafe-and-bar', page({ title: 'x', h1: '  CAFE   and BAR ', body: '<img src="/media/hh.png" alt="Café & Bar">' })), HH],
    ];
    it.each(cases)('%s', async (name, subject, site, want) => { const r = await find(subject, site); note(name, r, r.src === want ? '' : `  <-- QA expected ${want}`); expect(r.src, name).toBe(want); });
  });

  describe('D15: an alt ties a picture only when it names the subject and nothing else', () => {
    const alt = (text: string) => OWN + `<section><img src="/media/other.png" alt="${text}" width="800" height="600"></section>`;
    const OTHER = `https://${D}/media/other.png`;
    const cases: [string, string, string, string | null][] = [
      // [case, subject, alt of the second picture on the subject's own page, expected]
      ['A1 "Harbour House Annex · photo 1"', 'Harbour House', 'Harbour House Annex · photo 1', null],
      ['A2 "Harbour House 2" (a second building)', 'Harbour House', 'Harbour House 2', null],
      ['A3 "Marina Gate 2" for "Marina Gate"', 'Marina Gate', 'Marina Gate 2', null],
      ['A4 "Marina Gate II"', 'Marina Gate', 'Marina Gate II', null],
      ['A5 "Marina Gate Two"', 'Marina Gate', 'Marina Gate Two', null],
      ['A6 "The old mill, five minutes from Harbour House"', 'Harbour House', 'The old mill, five minutes from Harbour House', null],
      ['A7 "Harbour House floor plan"', 'Harbour House', 'Harbour House floor plan', null],
      ['A8 "Harbour House owner Jane Smith"', 'Harbour House', 'Harbour House owner Jane Smith', null],
      ['A9 "Not Harbour House"', 'Harbour House', 'Not Harbour House', null],
      ['A10 "Illustration of Harbour House"', 'Harbour House', 'Illustration of Harbour House', null],
      ['A11 "Map of Harbour House"', 'Harbour House', 'Map of Harbour House', null],
      ['A12 "Harbour House logo"', 'Harbour House', 'Harbour House logo', null],
      // A neighbour whose name is the subject's plus a word on the generic-picture-word list.
      ['A13 "Harbour House View" (another place)', 'Harbour House', 'Harbour House View', null],
      ['A14 "Harbour House Gallery" (another place)', 'Harbour House', 'Harbour House Gallery', null],
      ['A15 "Main Street Cafe" for "Street Cafe"', 'Street Cafe', 'Main Street Cafe', null],
      ['A16 "Harbour House Building 2" (another building)', 'Harbour House', 'Harbour House Building 2', null],
      ['A17 "1 Hyde Park" (a tower) on the page of "Hyde Park"', 'Hyde Park', '1 Hyde Park', null],
      ['A18 "Park View" on the page of "Park" (4 letters)', 'Park', 'Park View', null],
      // Controls: these are pictures of the subject.
      ['A19 control "Harbour House"', 'Harbour House', 'Harbour House', OTHER],
      ['A20 control "Harbour House · photo 3"', 'Harbour House', 'Harbour House · photo 3', OTHER],
      ['A21 (a control in round 2; ties nothing since D22) "Exterior view of the Harbour House building"', 'Harbour House', 'Exterior view of the Harbour House building', null],
      ['A22 (a control in round 2; ties nothing since D22) "harbour house main image"', 'Harbour House', 'harbour house main image', null],
      ['A23 control numbers in the name: "Wasl 611 photo 2" for "Wasl 611"', 'Wasl 611', 'Wasl 611 photo 2', OTHER],
      // Coverage, recorded: the generic words are English only, so these correct pictures are not taken (the safe side).
      ['A24 other language "Foto de Harbour House"', 'Harbour House', 'Foto de Harbour House', null],
      ['A25 other language "Vue extérieure de Harbour House"', 'Harbour House', 'Vue extérieure de Harbour House', null],
      ['A26 other language "صورة Harbour House"', 'Harbour House', 'صورة Harbour House', null],
      ['A27 engineer’s stated cost: "Wasl 611 1" (photo number straight after the name)', 'Wasl 611', 'Wasl 611 1', null],
      // Round 3 (D22): the shorter word list.
      ['A28 engineer’s stated cost: "Wasl 611 – image 12 of 30"', 'Wasl 611', 'Wasl 611 – image 12 of 30', null],
      ['A29 "Photo of 1 Hyde Park" for "Hyde Park"', 'Hyde Park', 'Photo of 1 Hyde Park', null],
      ['A30 "Harbour House front" / cover / hero / gallery words no longer generic: "Harbour House Front"', 'Harbour House', 'Harbour House Front', null],
      ['A31 "Harbour House Cover"', 'Harbour House', 'Harbour House Cover', null],
      ['A32 "Harbour House Interiors" (a firm; plural is not on the list)', 'Harbour House', 'Harbour House Interiors', null],
      ['A33 control "Exterior of Harbour House"', 'Harbour House', 'Exterior of Harbour House', OTHER],
      ['A34 control "An interior photo of the Harbour House"', 'Harbour House', 'An interior photo of the Harbour House', OTHER],
      ['A35 control "Harbour House – picture 4"', 'Harbour House', 'Harbour House – picture 4', OTHER],
      ['A36 control "Photos: Harbour House"', 'Harbour House', 'Photos: Harbour House', OTHER],
    ];
    it.each(cases)('%s', async (name, subject, text, want) => {
      const slug = '/places/' + subject.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const r = await find(subject, one(slug, page({ title: subject + ' — Stays', h1: subject, body: alt(text) })));
      note('alt ' + name, r, r.src === want ? '' : `  <-- QA expected ${want === null ? 'null' : want.replace('https://' + D, '')}`); expect(r.src, name).toBe(want);
    });
    it('a generic-word-only subject ("The View", a building): its own page and picture are found; a neighbour "The View Gallery" is not taken for it', async () => {
      const ok = await find('The View', one('/places/the-view', page({ title: 'The View', h1: 'The View', body: '<img src="/media/hh.png" alt="The View" width="1600" height="900">' })));
      note('generic-word subject "The View", own picture', ok); expect(ok.src).toBe(HH);
      const stock = await find('The View', one('/places/the-view', page({ title: 'The View', h1: 'The View', body: '<img src="/media/other.png" alt="Front view of the building" width="1600" height="900"><img src="/media/other.png" alt="The view from the gallery">' })));
      note('generic-word subject "The View", alts "Front view of the building", "The view from the gallery"', stock); expect(stock.src).toBeNull();
      const neighbour = await find('The View', one('/places/the-view', page({ title: 'The View', h1: 'The View', body: OWN + '<img src="/media/other.png" alt="The View Gallery" width="800" height="600">' })));
      note('generic-word subject "The View", neighbour card alt "The View Gallery"', neighbour, neighbour.src === null ? '' : '  <-- QA expected null'); expect(neighbour.src).toBeNull();
    });
  });

  describe('D16: no share image reaches the automatic path, by any route', () => {
    const CARD = `<meta property="og:image" content="https://${D}/og.png"><meta name="twitter:image" content="https://${D}/og.png"><link rel="image_src" href="https://${D}/og.png">`;
    const cases: [string, Site, string | null][] = [
      ['S1 og:image, twitter:image and image_src all name a card that differs from the home page’s; no other picture', base(['/places/harbour-house'], { '/': page({ title: 'Stays', h1: 'Stays', head: `<meta property="og:image" content="https://${D}/home.png">` }), '/places/harbour-house': PLACE('', { head: CARD.replaceAll('/og.png', '/share-hh.png') }), '/share-hh.png': PNG }), null],
      ['S2 per-page generated title card as og:image, photos on a CDN (round-1 Q20)', base(['/places/harbour-house'], { '/places/harbour-house': PLACE('<img src="https://cdn.other.com/hh.jpg" alt="Harbour House">', { head: `<meta property="og:image" content="https://${D}/places/harbour-house/opengraph-image?3f2a">` }), '/places/harbour-house/opengraph-image?3f2a': PNG }), null],
      ['S3 structured data of the subject gives the SITE DEFAULT card as its image (the same address as the home page’s og:image)', base(['/places/harbour-house'], { '/places/harbour-house': PLACE(ld({ '@type': 'Place', name: 'Harbour House', image: `https://${D}/og.png` }), { head: CARD }) }), null],
      ['S4 structured data of the subject gives the page’s own generated title card as its image (same address as the page’s og:image)', base(['/places/harbour-house'], { '/places/harbour-house': PLACE(ld({ '@type': 'Place', name: 'Harbour House', image: `https://${D}/places/harbour-house/opengraph-image?3f2a` }), { head: `<meta property="og:image" content="https://${D}/places/harbour-house/opengraph-image?3f2a">` }), '/places/harbour-house/opengraph-image?3f2a': PNG }), null],
      ['S5 the site default card is also an <img> on the page with alt "Harbour House"', base(['/places/harbour-house'], { '/places/harbour-house': PLACE('<img src="/og.png" alt="Harbour House" width="1200" height="630">', { head: CARD }) }), null],
      ['S6 control: og:image and structured data both give the place’s real photo', base(['/places/harbour-house'], { '/places/harbour-house': PLACE(ld({ '@type': 'Place', name: 'Harbour House', image: HH }), { head: `<meta property="og:image" content="${HH}">` }), '/media/hh.png': PNG }), HH],
    ];
    it.each(cases)('%s', async (name, site, want) => {
      const r = await find('Harbour House', site);
      note(name, r, r.src === want ? '' : `  <-- QA expected ${want}`);
      if (name.startsWith('S1') || name.startsWith('S2')) expect(asked.some(u => /share-hh|opengraph-image/.test(u)), 'the card must not even be requested').toBe(false);
      expect(r.src, name).toBe(want);
    });
  });

  describe('D17: listings by path, and entities that are about a subject, not the subject', () => {
    const TIED = '<img src="/media/hh.png" alt="Harbour House" width="1600" height="900">';
    it.each(['/tag/harbour-house', '/tags/harbour-house', '/category/harbour-house', '/categories/places/harbour-house', '/topic/harbour-house', '/topics/harbour-house', '/author/harbour-house', '/search/harbour-house', '/archive/harbour-house', '/archives/2026/harbour-house', '/Tag/harbour-house', '/en/category/harbour-house', '/tagged/harbour-house', '/label/harbour-house', '/labels/harbour-house'])('%s is a listing: nothing is taken, the page is not even requested', async path => {
      const r = await find('Harbour House', one(path, PLACE(TIED)));
      note('listing path ' + path, r); expect(r.src).toBeNull(); expect(asked.map(u => new URL(u).pathname)).not.toContain(path);
    });
    it.each(['/collections/harbour-house', '/t/harbour-house', '/places/harbour-house/page/2', '/harbour-house/feed'])('recorded, not asserted: %s is not on the listing list', async path => {
      const r = await find('Harbour House', one(path, PLACE(TIED)));
      note('other listing-like path ' + path + ' (recorded only)', r);
    });
  });

  describe('D20: an unreachable site is not remembered as a miss', () => {
    const down: Route = { throws: true }, e503: Route = { status: 503, body: 'down' }, e404: Route = { status: 404, body: 'no' }, e403: Route = { status: 403, body: 'forbidden' };
    const cases: [string, Site, boolean][] = [
      ['robots no answer, sitemap no answer', { '/robots.txt': down, '/sitemap.xml': down }, false],
      ['robots 503, sitemap 503', { '/robots.txt': e503, '/sitemap.xml': e503 }, false],
      ['robots no answer, sitemap 502', { '/robots.txt': down, '/sitemap.xml': { status: 502, body: '' } }, false],
      ['robots 404, sitemap 404 (a small site with neither file)', { '/robots.txt': e404, '/sitemap.xml': e404 }, true],
      ['robots 403, sitemap 403 (the site refuses the crawler)', { '/robots.txt': e403, '/sitemap.xml': e403 }, true],
      ['robots 200 empty, sitemap 200 with other pages', { '/robots.txt': '', '/sitemap.xml': sitemap('/about') }, true],
    ];
    it.each(cases)('%s', async (name, site, want) => { const r = await find('Harbour House', site); note('D20 ' + name, r); expect(r).toMatchObject({ src: null, searched: want }); });
    // Round 3 (D24): with no crawled candidate, a sitemap that gave no answer or a 5xx means the search did not finish, whatever robots.txt said.
    const mixed: [string, Site, boolean][] = [
      ['robots 200, the sitemap gives no answer', { '/robots.txt': '', '/sitemap.xml': down }, false],
      ['robots 200, the sitemap answers 503', { '/robots.txt': '', '/sitemap.xml': e503 }, false],
      ['robots no answer, sitemap 404', { '/robots.txt': down, '/sitemap.xml': e404 }, true],
      ['robots 200 naming a sitemap on another host only; the own-site sitemap gives no answer', { '/robots.txt': 'Sitemap: https://cdn.other.com/sitemap.xml\n', '/sitemap.xml': down }, false],
      ['robots 200 naming two own-site sitemaps: the first 503, the second lists other pages', { '/robots.txt': `Sitemap: https://${D}/a.xml\nSitemap: https://${D}/b.xml\n`, '/a.xml': e503, '/b.xml': sitemap('/about') }, true],
    ];
    it.each(mixed)('D24: %s', async (name, site, want) => { const r = await find('Harbour House', site); note('D24 ' + name, r); expect(r).toMatchObject({ src: null, searched: want }); });
    it('recorded (the engineer’s stated consequence): a sitemap index that answers while every child file answers 503 counts as read', async () => {
      const r = await find('Harbour House', { '/robots.txt': '', '/sitemap.xml': `<sitemapindex><sitemap><loc>https://${D}/s1.xml</loc></sitemap><sitemap><loc>https://${D}/s2.xml</loc></sitemap></sitemapindex>`, '/s1.xml': e503, '/s2.xml': e503 });
      note('D24 sitemap index answers, both child files 503 (recorded only)', r); expect(r.src).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Round 3 (revision 9e7683c6, decisions D21 to D24).
describe.skipIf(!process.env.DATABASE_URL)('round 3: share cards by any route (D21) and card words', () => {
  const PLACE = (body: string, head = '') => page({ title: 'Harbour House — Stays', h1: 'Harbour House', head, body });
  const og = (address: string) => `<meta property="og:image" content="${address.startsWith('http') ? address : 'https://' + D + address}">`;
  const LD = (image: string) => ld({ '@type': 'Place', name: 'Harbour House', image: image.startsWith('http') ? image : 'https://' + D + image });
  const home = (address: string | null) => page({ title: 'Stays', h1: 'Stays', head: address ? og(address) : '' });
  const site = (o: { home?: Route | string; page: string; files: string[] }): Site => ({ '/robots.txt': '', '/sitemap.xml': sitemap('/places/harbour-house'), '/': o.home ?? home('/og.png'), '/places/harbour-house': o.page, ...Object.fromEntries(o.files.map(f => [f, PNG])) });
  const paths = () => asked.map(u => { const x = new URL(u); return x.pathname + x.search; });

  it('a real photo that the page gives both as og:image and in structured data is taken, after the home page is read', async () => {
    const r = await find('Harbour House', site({ page: PLACE(LD('/media/hh.png'), og('/media/hh.png')), files: ['/media/hh.png'] }));
    note('D21 control: real photo is og:image and structured-data image; home page has /og.png', r);
    expect(r.src).toBe(`https://${D}/media/hh.png`); expect(paths()).toContain('/');
  });
  it('the home page cannot be read: the picture is not taken and the search is unfinished', async () => {
    for (const bad of [{ status: 503, body: 'down' } as Route, { throws: true } as Route, { status: 404, body: 'no' } as Route, { type: 'application/json', body: '{}' } as Route]) {
      const r = await find('Harbour House', site({ home: bad, page: PLACE(LD('/media/hh.png'), og('/media/hh.png')), files: ['/media/hh.png'] }));
      note(`D21 home page ${bad.throws ? 'gives no answer' : bad.status ? 'answers ' + bad.status : 'is not HTML'}`, r);
      expect(r).toMatchObject({ src: null, searched: false }); expect(paths()).not.toContain('/media/hh.png');
    }
  });
  it('recorded (the engineer’s stated consequence): robots.txt forbids the home page: not taken, and the search counts as finished', async () => {
    const s = site({ page: PLACE(LD('/media/hh.png'), og('/media/hh.png')), files: ['/media/hh.png'] }); s['/robots.txt'] = 'User-agent: *\nDisallow: /$\n';
    const r = await find('Harbour House', s); note('D21 robots.txt forbids the home page (recorded only)', r); expect(r.src).toBeNull(); expect(paths()).not.toContain('/');
  });
  it('a picture that is not one of the page’s share images costs no home-page request', async () => {
    const r = await find('Harbour House', site({ page: PLACE(LD('/media/hh.png'), og('/og.png')), files: ['/media/hh.png'] }));
    expect(r.src).toBe(`https://${D}/media/hh.png`); expect(paths()).not.toContain('/');
  });

  describe('card words in the address: never a candidate, on the automatic path', () => {
    it.each(['/og.png', '/OG.PNG', '/og-image.jpg', '/images/og/harbour-house.png', '/opengraph-image', '/places/harbour-house/opengraph-image?3f2a', '/api/og?title=Harbour%20House', '/social/harbour-house.png', '/uploads/share/hh.png', '/media/hh-twitter.png', '/twitter-image.png', '/static/social_card.png', '/lived-social-preview.png'])('%s as the structured-data image and an <img alt="Harbour House">: nothing taken, the file is never requested', async file => {
      const r = await find('Harbour House', site({ home: home('/home-card.png'), page: PLACE(LD(file) + `<img src="${file}" alt="Harbour House" width="1200" height="630">`), files: [file] }));
      note('card word in the address: ' + file, r); expect(r.src).toBeNull(); expect(paths()).not.toContain(file);
    });
    it.each(['/blog-media/hh.png', '/shared-house/dogs.png', '/photos/together.png', '/catalog/frogs.png', '/sharepoint/hh.png', '/media/hh-socialite.png', '/ogden/hh.png', '/twitterati/hh.png', '/media/shares.png', '/media/og2.png'])('%s holds a card word only inside a longer word: it is a picture like any other and is taken', async file => {
      const r = await find('Harbour House', site({ page: PLACE(`<img src="${file}" alt="Harbour House" width="1600" height="900">`), files: [file] }));
      note('card word inside a longer word: ' + file, r, r.src === `https://${D}${file}` ? '' : '  <-- QA expected the picture'); expect(r.src).toBe(`https://${D}${file}`);
    });
  });

  describe('the site card under a name with none of the five words', () => {
    // The same file is the page's og:image and its structured-data image (a template that fills both from one value).
    it.each(['/assets/brand-banner.png', '/ogimage.png', '/socialcard.png', '/images/preview.png', '/sharing/hh.png', '/seo/card.png'])('%s, and the home page carries the same card: not taken', async file => {
      const r = await find('Harbour House', site({ home: home(file), page: PLACE(LD(file), og(file)), files: [file] }));
      note('card with no card word, same as the home page’s: ' + file, r); expect(r.src).toBeNull(); expect(paths()).not.toContain(file);
    });
    it('the home page carries it under the www host, or with a cache-buster: still not taken', async () => {
      for (const form of [`https://www.${D}/assets/brand-banner.png`, `https://${D}/assets/brand-banner.png?v=7`]) {
        const r = await find('Harbour House', site({ home: home(form), page: PLACE(LD('/assets/brand-banner.png'), og('/assets/brand-banner.png')), files: ['/assets/brand-banner.png'] }));
        expect(r.src, form).toBeNull();
      }
    });
    // Residual routes. Recorded, not asserted: the outcome is reported and judged in qa.md.
    it.each([
      ['L1 the home page has a DIFFERENT card (/assets/home-hero.png); inner pages share /assets/brand-banner.png as og:image and structured-data image', () => site({ home: home('/assets/home-hero.png'), page: PLACE(LD('/assets/brand-banner.png'), og('/assets/brand-banner.png')), files: ['/assets/brand-banner.png'] })],
      ['L2 the home page has no share image at all; the page has the card as og:image and structured-data image', () => site({ home: home(null), page: PLACE(LD('/assets/brand-banner.png'), og('/assets/brand-banner.png')), files: ['/assets/brand-banner.png'] })],
      ['L3 the page has NO share tags; the card is only its structured-data image (the home page has it as og:image)', () => site({ home: home('/assets/brand-banner.png'), page: PLACE(LD('/assets/brand-banner.png')), files: ['/assets/brand-banner.png'] })],
      ['L4 the card is served through an image optimiser: /_next/image?url=%2Fog.png&w=1200 on the page (og:image and structured data), /og.png on the home page', () => site({ home: home('/og.png'), page: PLACE(LD('/_next/image?url=%2Fog.png&w=1200'), og('/_next/image?url=%2Fog.png&w=1200')), files: ['/_next/image?url=%2Fog.png&w=1200'] })],
      ['L5 safe-side miss: pictures served as /api/media?id=…: the page’s og:image is ?id=card, its tied photo is ?id=photo, the home page has ?id=card', () => site({ home: home('/api/media?id=card'), page: PLACE(LD('/api/media?id=photo'), og('/api/media?id=card')), files: ['/api/media?id=photo', '/api/media?id=card'] })],
    ] as const)('recorded: %s', async (name, make) => {
      const r = await find('Harbour House', make()); note('residual ' + name + ' (recorded only)', r);
    });
  });
});

describe('owner path over the same made-up site (no database)', () => {
  const own = async (address: string, site: Site, subject: string | null = null) => {
    serve(site);
    try { const p = await pictureFromAddress({ domain: D, address, subject }); return `ok src=${p.src} page=${p.page} fit=${p.fit}`; }
    catch (e: any) { return e instanceof SitePictureError ? e.code + (e.host ? ' ' + e.host : '') : 'THROWN ' + e?.message; }
  };
  it('an address off the site makes no request at all', async () => {
    for (const a of ['https://example.org/a.png', 'https://stays.test.evil.com/a.png', 'https://user:pw@stays.test/a.png', 'https://stays.test:8443/a.png', 'ftp://stays.test/a.png', 'javascript:alert(1)']) {
      const out = await own(a, {}); expect(out).toMatch(/^(not_your_site|invalid_address)/); expect(asked).toEqual([]);
    }
  });
  it('a page whose pictures are all on another host names that host; nothing is requested from it', async () => {
    const out = await own('/p', { '/p': page({ title: 'P', h1: 'P', body: '<img src="https://images.cdn-host.com/a.jpg" alt="x">' }) });
    expect(out).toBe('off_site_picture images.cdn-host.com'); expect(asked).toEqual([`https://${D}/p`]);
  });
  it('a picture address that answers HTML with a picture’s name is not parsed for more pictures when its header says image', async () => {
    const out = await own('/a.png', { '/a.png': { type: 'image/png', body: '<html><img src="/media/hh.png"></html>' }, '/media/hh.png': PNG });
    expect(out).toBe('not_a_picture'); expect(asked).toEqual([`https://${D}/a.png`]);
  });
  it('the site default share image is not used by the owner path either; a page with only that says no_picture', async () => {
    const out = await own('/p', { '/': HOME, '/p': page({ title: 'P', h1: 'P', head: `<meta property="og:image" content="https://${D}/og.png">` }), '/og.png': PNG });
    expect(out).toBe('no_picture');
  });
  it('round 2, D16: the owner path treats /og.png?v=2 and the www form as the home page’s card, and still uses a share picture that is the page’s own', async () => {
    const home = page({ title: 'Stays', h1: 'Stays', head: `<meta property="og:image" content="https://${D}/og.png">` });
    expect(await own('/p', { '/': home, '/p': page({ title: 'P', h1: 'P', head: `<meta property="og:image" content="https://${D}/og.png?v=2">` }), '/og.png?v=2': PNG })).toBe('no_picture');
    expect(await own('/p', { '/': home, '/p': page({ title: 'P', h1: 'P', head: `<meta property="og:image" content="https://www.${D}/og.png">` }), '/og.png': PNG })).toBe('no_picture');
    expect(await own('/p', { '/': home, '/p': page({ title: 'P', h1: 'P', head: `<meta property="og:image" content="https://${D}/media/p.png">` }), '/media/p.png': PNG })).toBe(`ok src=https://${D}/media/p.png page=https://${D}/p fit=crop`);
  });
  it('round 2, D19: a structured-data picture takes the alt of the <img> with the same address (relative or http form included); not when the addresses differ by a query', async () => {
    const alt = async (site: Site) => { serve(site); return (await pictureFromAddress({ domain: D, address: '/p', subject: null })).alt; };
    const LD = (image: string) => ld({ '@type': 'Place', name: 'Harbour House', image });
    expect(await alt({ '/p': page({ title: 'P', h1: 'P', body: LD(`https://${D}/media/hh.png`) + '<img src="/media/hh.png" alt="Harbour House · photo 1">' }), '/media/hh.png': PNG })).toBe('Harbour House · photo 1');
    expect(await alt({ '/p': page({ title: 'P', h1: 'P', body: LD(`http://${D}/media/hh.png`) + '<img src="media/hh.png" alt="Seen from the quay">' }), '/media/hh.png': PNG })).toBe('Seen from the quay');
    expect(await alt({ '/p': page({ title: 'P', h1: 'P', body: LD(`https://${D}/media/hh.png`) + '<img src="/media/hh.png?w=1200" alt="Sized copy">' }), '/media/hh.png': PNG, '/media/hh.png?w=1200': PNG })).toBe('');
    expect(await alt({ '/p': page({ title: 'P', h1: 'P', body: LD(`https://${D}/media/hh.png`) + '<img src="/media/other.png" alt="Another picture">' }), '/media/hh.png': PNG, '/media/other.png': PNG })).toBe('');
  });
  it('round 3 (the engineer’s stated consequence): a page whose only picture has a card word in its address offers nothing; the picture’s own address still works', async () => {
    const homeHtml = page({ title: 'Stays', h1: 'Stays', head: `<meta property="og:image" content="https://${D}/og.png">` });
    const site: Site = { '/': homeHtml, '/p': page({ title: 'P', h1: 'P', head: `<meta property="og:image" content="https://${D}/uploads/social/harbour-house.png">`, body: '<img src="/uploads/social/harbour-house.png" alt="Harbour House">' }), '/uploads/social/harbour-house.png': PNG };
    expect(await own('/p', site)).toBe('no_picture');
    expect(await own('/uploads/social/harbour-house.png', site)).toBe(`ok src=https://${D}/uploads/social/harbour-house.png page=null fit=crop`);
  });
  it('at most two pictures are tried on a page, and the logo in the header is never one of them', async () => {
    const out = await own('/p', { '/p': page({ title: 'P', h1: 'P', body: '<img src="/1.png" alt="a"><img src="/2.png" alt="b"><img src="/3.png" alt="c">' }), '/1.png': { status: 404 }, '/2.png': { status: 404 }, '/3.png': PNG });
    expect(out).toBe('no_picture'); expect(asked.map(u => new URL(u).pathname)).toEqual(['/p', '/1.png', '/2.png']);
  });
  it('a 12-request budget holds for the owner path too (redirect loop on the page)', async () => {
    const out = await own('/loop', { '/loop': { location: '/loop' } });
    expect(out).toBe('unreachable'); expect(asked.length).toBeLessThanOrEqual(4);
  });
});
