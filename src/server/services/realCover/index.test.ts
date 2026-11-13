// The two ways to a real cover: the automatic search for the subject's page and its picture, and the address a person
// gives. The guarded request (fetchOwn) is replaced by a scripted site, the crawl table by rows and storage by a spy;
// the page reader, the matching rules and the picture checks (decode included) are real.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ fetch: vi.fn(), rows: [] as any[], rowsError: null as Error | null, put: vi.fn() }));
vi.mock('./fetch', async original => ({ ...(await original<typeof import('./fetch')>()), fetchOwn: H.fetch }));
vi.mock('../../db', () => ({
  db: { select: () => ({ from: () => ({ where: async () => { if (H.rowsError) throw H.rowsError; return H.rows; } }) }) },
  schema: { crawlPages: { businessId: 'businessId', url: 'url', title: 'title', h1: 'h1' } },
}));
vi.mock('../storage', () => ({ putObject: H.put, objectKey: (bid: string, kind: string, ext: string) => `${bid}/${kind}/test.${ext}` }));
vi.mock('@/server/env', () => ({ env: { devStubs: false, crawlerUserAgent: 'RadarBot/1.0 (+https://radar.test/bot)' } }));

import { createCanvas } from '@napi-rs/canvas';
import { ACCEPT, SitePictureError } from './fetch';
import { probeImage } from './picture';
import { AUTO_BUDGET_MS, OWNER_BUDGET_MS, REAL_COVER_RETRY_MS, findSubjectPicture, pictureFromAddress, realCoverKey, storeRealCover } from './index';
import { DEFAULT_CARD, HOME, HOME_URL, LISTING, PRINCESS, PRINCESS_PICTURE, PRINCESS_URL, REVIEW_POST, REVIEW_POST_URL, SITE, TOWER_B, TOWER_B_URL, WASL, WASL_PICTURE, WASL_URL, subjectPage } from './page.fixtures';
import type { Article } from '@/lib/types';

type Answer = { type: string; body: Buffer; url?: string } | Error | (() => Promise<{ type: string; body: Buffer }>);
let site: Map<string, Answer>;
const html = (page: string): Answer => ({ type: 'text/html; charset=utf-8', body: Buffer.from(page) });
const picture = (w: number, h: number, type: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png'): Answer => {
  const canvas = createCanvas(w, h); const ctx = canvas.getContext('2d'); ctx.fillStyle = '#1f4d3a'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#f2b544'; ctx.fillRect(w / 4, h / 4, w / 2, h / 2);
  return { type, body: canvas.toBuffer(type as 'image/png') };
};
const sitemap = (...addresses: string[]): Answer => ({ type: 'application/xml', body: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${addresses.map(a => `<url><loc>${a.replace(/&/g, '&amp;')}</loc><lastmod>2026-11-01</lastmod></url>`).join('')}</urlset>`) });
const text = (s: string): Answer => ({ type: 'text/plain', body: Buffer.from(s) });
const requested = () => H.fetch.mock.calls.map(c => (c[0] as URL).href);
const ROBOTS = 'https://lived.ae/robots.txt', SITEMAP = 'https://lived.ae/sitemap.xml';

beforeEach(() => {
  H.fetch.mockReset(); H.put.mockReset(); H.rows = []; H.rowsError = null; site = new Map();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // The scripted site honours the same request count and deadline as the real guard; an address it does not have is unreachable.
  H.fetch.mockImplementation(async (address: URL, o: any) => {
    if (o.requests.left-- <= 0 || o.signal.aborted) throw new SitePictureError('unreachable');
    const hit = site.get(address.href);
    if (!hit) throw new SitePictureError('unreachable');
    if (hit instanceof Error) throw hit;
    const answer = typeof hit === 'function' ? await hit() : hit;
    if (o.signal.aborted) throw new SitePictureError('unreachable');
    return { url: (answer as any).url ?? address.href, type: answer.type, body: answer.body };
  });
});
const find = (name: string, kind = 'building', budgetMs?: number) => findSubjectPicture({ bid: 'biz', domain: SITE, subject: { name, kind }, ...(budgetMs ? { budgetMs } : {}) });
/** A site with a sitemap listing `pages`, each with its HTML, and the home page. */
function withPages(pages: Record<string, string>, more: Record<string, Answer> = {}) {
  site.set(SITEMAP, sitemap(HOME_URL, ...Object.keys(pages)));
  site.set(HOME_URL, html(HOME));
  for (const [url, page] of Object.entries(pages)) site.set(url, html(page));
  for (const [url, answer] of Object.entries(more)) site.set(url, answer);
}

describe('the automatic search', () => {
  it('finds the subject’s page through the sitemap, confirms it by name, and takes the picture its structured data gives', async () => {
    site.set(ROBOTS, text('User-agent: *\nDisallow: /admin\n'));
    withPages({ [WASL_URL]: WASL, [PRINCESS_URL]: PRINCESS, 'https://lived.ae/property/marina-tower': subjectPage({ name: 'Marina Tower' }) }, { [PRINCESS_PICTURE]: picture(740, 1110, 'image/jpeg') });
    const { picture: found, searched } = await find('Princess Tower');
    expect(searched).toBe(true);
    expect(found).toMatchObject({ page: PRINCESS_URL, src: PRINCESS_PICTURE, w: 740, h: 1110, fit: 'backdrop', alt: '' });
    expect(probeImage(found!.png)).toMatchObject({ type: 'image/png', width: 1200, height: 628, complete: true });
    // The usual four requests, each with the right Accept and limit, sharing one deadline and one request count.
    expect(requested()).toEqual([ROBOTS, SITEMAP, PRINCESS_URL, PRINCESS_PICTURE]);
    const options = H.fetch.mock.calls.map(c => c[1]);
    expect(options.map(o => [o.accept, o.maxBytes, o.over])).toEqual([[ACCEPT.text, 500 * 1024, 'truncate'], [ACCEPT.text, 3 * 1024 * 1024, 'truncate'], [ACCEPT.page, 3 * 1024 * 1024, 'truncate'], [ACCEPT.picture, 8 * 1024 * 1024, 'reject']]);
    for (const o of options) { expect(o.domain).toBe(SITE); expect(o.requests).toBe(options[0].requests); expect(o.signal).toBe(options[0].signal); }
    expect(options[0].requests.left).toBe(12 - 4);
  });
  it('takes a picture tied to the subject by alt text, through the site’s own optimiser', async () => {
    withPages({ [WASL_URL]: WASL }, { [WASL_PICTURE]: picture(1200, 800, 'image/webp') });
    const { picture: found } = await find('Wasl 611');
    expect(found).toMatchObject({ page: WASL_URL, src: WASL_PICTURE, w: 1200, h: 800, fit: 'crop', alt: 'Wasl 611 · photo 1' });
  });
  it('a page the crawl already knows by its h1 or its title is used without reading the sitemap, whatever its address', async () => {
    H.rows = [
      { url: 'http://lived.ae/p/12345', title: 'Princess Tower — Apartment in Dubai Marina | Lived', h1: 'Find your tower' },
      { url: 'https://lived.ae/p/777', title: 'Somewhere', h1: 'Princess   Tower' },
      { url: 'https://evil.example/property/princess-tower', title: 'Princess Tower', h1: 'Princess Tower' }, // not this business's site: ignored
      { url: 'https://lived.ae/about', title: 'About', h1: 'About' },
    ];
    site.set('https://lived.ae/p/12345', html(PRINCESS)); site.set(PRINCESS_PICTURE, picture(1600, 900));
    const { picture: found } = await find('Princess Tower');
    expect(found).toMatchObject({ page: 'https://lived.ae/p/12345', src: PRINCESS_PICTURE });
    expect(requested()).toEqual([ROBOTS, 'https://lived.ae/p/12345', PRINCESS_PICTURE]); // robots was asked for (and was missing); the sitemap never
  });
  it('asks the origin the crawl used most, and reads robots.txt and the sitemap there', async () => {
    H.rows = [{ url: 'https://www.lived.ae/', title: 'Lived', h1: 'Home' }, { url: 'https://www.lived.ae/about', title: 'About', h1: 'About' }, { url: 'https://lived.ae/old', title: 'Old', h1: 'Old' }];
    await find('Princess Tower');
    expect(requested()).toEqual(['https://www.lived.ae/robots.txt', 'https://www.lived.ae/sitemap.xml']);
  });

  describe('near misses (architecture §4.4): no picture, and the search is finished', () => {
    const none = { picture: null, searched: true };
    it('Wasl 61, when the site has wasl-611-al-warsan: no page qualifies and none is requested', async () => {
      withPages({ [WASL_URL]: WASL }, { [WASL_PICTURE]: picture(1200, 800) });
      expect(await find('Wasl 61')).toEqual(none);
      expect(requested()).toEqual([ROBOTS, SITEMAP]);
    });
    it('Wasl 611, when the only page is "Wasl 611 Tower B": requested, not confirmed, no picture requested', async () => {
      withPages({ [TOWER_B_URL]: TOWER_B }, { 'https://lived.ae/api/media/3hh8wq2zz0p.jpg?bucket=properties': picture(1200, 800) });
      expect(await find('Wasl 611')).toEqual(none);
      expect(requested()).toEqual([ROBOTS, SITEMAP, TOWER_B_URL]);
    });
    it('Marina Tower, when the site has princess-tower-dubai-marina; Princess Tower, when it has marina-tower', async () => {
      withPages({ [PRINCESS_URL]: PRINCESS }, { [PRINCESS_PICTURE]: picture(740, 1110) });
      expect(await find('Marina Tower')).toEqual(none);
      site.clear(); withPages({ 'https://lived.ae/property/marina-tower': subjectPage({ name: 'Marina Tower' }) });
      expect(await find('Princess Tower')).toEqual(none);
      expect(requested().filter(u => u.includes('/property/'))).toEqual([]);
    });
    it('blog posts about the subject are never requested, by their address', async () => {
      withPages({ 'https://lived.ae/blog/why-wasl-611-is-popular': subjectPage({}), [REVIEW_POST_URL]: REVIEW_POST, 'https://lived.ae/news/wasl-611': subjectPage({}), 'https://lived.ae/blog/dubai-marina-vs-jbr': subjectPage({ name: 'Dubai Marina' }) },
        { 'https://lived.ae/api/media/5tt1blog77x.png?bucket=blog': picture(1200, 628) });
      expect(await find('Wasl 611')).toEqual(none);
      expect(await find('Dubai Marina', 'place')).toEqual(none);
      expect(requested().filter(u => u !== ROBOTS && u !== SITEMAP)).toEqual([]);
    });
    it('an article that is not under a blog address is requested, read as an article, and passed over', async () => {
      withPages({ 'https://lived.ae/reviews/wasl-611': REVIEW_POST.replace('Wasl 611 review: what tenants say</h1>', 'Wasl 611</h1>') }, { 'https://lived.ae/api/media/5tt1blog77x.png?bucket=blog': picture(1200, 628) });
      expect(await find('Wasl 611')).toEqual(none);
      expect(requested()).toEqual([ROBOTS, SITEMAP, 'https://lived.ae/reviews/wasl-611']);
    });
    it('a listing page named after the subject', async () => {
      withPages({ 'https://lived.ae/explore/wasl-611': LISTING }, { 'https://lived.ae/api/media/1aa2listing3.jpg?bucket=properties': picture(1200, 800) });
      expect(await find('Wasl 611')).toEqual(none);
      expect(requested()).toEqual([ROBOTS, SITEMAP, 'https://lived.ae/explore/wasl-611']);
    });
    it('the right page, whose only picture has an alt text that does not name the subject', async () => {
      withPages({ [WASL_URL]: subjectPage({ main: '<img src="/api/media/1thumb.jpg" alt="Property thumbnail 1" width="1200" height="800">' }) }, { 'https://lived.ae/api/media/1thumb.jpg': picture(1200, 800) });
      expect(await find('Wasl 611')).toEqual(none);
      expect(requested()).toEqual([ROBOTS, SITEMAP, WASL_URL, HOME_URL]); // the home page is read to judge the share image; the thumbnail never
    });
    it('the right page, whose share image is the home page’s: never taken, never requested', async () => {
      withPages({ [WASL_URL]: subjectPage({}) }, { [DEFAULT_CARD]: picture(1200, 630) });
      expect(await find('Wasl 611')).toEqual(none);
      expect(requested()).not.toContain(DEFAULT_CARD);
    });
    it('the right page, whose picture is on another host: never requested', async () => {
      withPages({ [WASL_URL]: subjectPage({ share: 'https://cdn.other.com/wasl-card.jpg', main: '<img src="https://cdn.other.com/wasl-611.jpg" alt="Wasl 611 · photo 1" width="1200" height="800">' }) });
      expect(await find('Wasl 611')).toEqual(none);
      expect(requested()).toEqual([ROBOTS, SITEMAP, WASL_URL]);
      expect(requested().some(u => u.includes('other.com'))).toBe(false);
    });
    it('the right page, whose picture is a cover Radar generated earlier ("Illustration of …")', async () => {
      withPages({ [WASL_URL]: subjectPage({ main: '<img src="/api/media/5tt1blog77x.png" alt="Illustration of Wasl 611" width="1200" height="628">' }) }, { 'https://lived.ae/api/media/5tt1blog77x.png': picture(1200, 628) });
      expect(await find('Wasl 611')).toEqual(none);
      expect(requested()).not.toContain('https://lived.ae/api/media/5tt1blog77x.png');
    });
    it('a subject too short to match on safely: nothing is requested', async () => {
      expect(await find('Q 1')).toEqual(none);
      expect(await find(' — ')).toEqual(none);
      expect(H.fetch).not.toHaveBeenCalled();
    });
  });

  describe('the share image', () => {
    it('is taken when the page has its own, different from the home page’s', async () => {
      withPages({ [WASL_URL]: subjectPage({ share: 'https://lived.ae/api/og/wasl-611.jpg' }) }, { 'https://lived.ae/api/og/wasl-611.jpg': picture(1200, 630, 'image/jpeg') });
      const { picture: found, searched } = await find('Wasl 611');
      expect(found).toMatchObject({ page: WASL_URL, src: 'https://lived.ae/api/og/wasl-611.jpg', fit: 'crop' });
      expect(searched).toBe(true);
      expect(requested()).toEqual([ROBOTS, SITEMAP, WASL_URL, HOME_URL, 'https://lived.ae/api/og/wasl-611.jpg']);
    });
    it('is not taken when the home page cannot be read, and the search is not remembered as finished', async () => {
      withPages({ [WASL_URL]: subjectPage({ share: 'https://lived.ae/api/og/wasl-611.jpg' }) }, { 'https://lived.ae/api/og/wasl-611.jpg': picture(1200, 630) });
      site.delete(HOME_URL);
      expect(await find('Wasl 611')).toEqual({ picture: null, searched: false });
      expect(requested()).not.toContain('https://lived.ae/api/og/wasl-611.jpg');
    });
    it('is not taken when the home page answers with something that is not a page', async () => {
      withPages({ [WASL_URL]: subjectPage({ share: 'https://lived.ae/api/og/wasl-611.jpg' }) }, { 'https://lived.ae/api/og/wasl-611.jpg': picture(1200, 630) });
      site.set(HOME_URL, { type: 'application/json', body: Buffer.from('{}') });
      expect((await find('Wasl 611')).picture).toBeNull();
    });
  });

  describe('robots.txt, as in the crawl', () => {
    it('a disallowed page is not requested', async () => {
      site.set(ROBOTS, text('User-agent: *\nDisallow: /property/\n'));
      withPages({ [PRINCESS_URL]: PRINCESS }, { [PRINCESS_PICTURE]: picture(740, 1110) });
      expect(await find('Princess Tower')).toEqual({ picture: null, searched: true });
      expect(requested()).toEqual([ROBOTS, SITEMAP]);
    });
    it('a disallowed picture is not requested; the next tied picture is', async () => {
      site.set(ROBOTS, text('User-agent: *\nDisallow: /api/\n'));
      withPages({ [PRINCESS_URL]: PRINCESS }, { [PRINCESS_PICTURE]: picture(740, 1110), 'https://lived.ae/_next/image?url=%2Fapi%2Fmedia%2F9zt4c0de1fg.jpg%3Fbucket%3Dproperties&w=1200&q=75': picture(1200, 1800) });
      const { picture: found } = await find('Princess Tower');
      expect(found!.src).toContain('/_next/image');
      expect(requested()).not.toContain(PRINCESS_PICTURE);
    });
    it('rules for Radar’s own crawler name apply, and rules for another crawler do not', async () => {
      site.set(ROBOTS, text('User-agent: RadarBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n'));
      withPages({ [PRINCESS_URL]: PRINCESS }, { [PRINCESS_PICTURE]: picture(740, 1110) });
      expect((await find('Princess Tower')).picture).toBeNull();
      site.set(ROBOTS, text('User-agent: OtherBot\nDisallow: /\n'));
      expect((await find('Princess Tower')).picture).not.toBeNull();
    });
    it('takes the sitemap addresses robots.txt names when they are on the site, and follows an index but not into post, tag or media files', async () => {
      site.set(ROBOTS, text('Sitemap: https://lived.ae/sitemap-index.xml\nSitemap: https://sitemaps.other.com/lived.xml\n'));
      const index = ['properties', 'posts', 'blog-1', 'news', 'tags', 'categories', 'authors', 'image', 'video', 'areas'].map(n => `<sitemap><loc>https://lived.ae/sitemaps/${n}.xml</loc></sitemap>`).join('');
      site.set('https://lived.ae/sitemap-index.xml', { type: 'application/xml', body: Buffer.from(`<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${index}<sitemap><loc>https://sitemaps.other.com/more.xml</loc></sitemap></sitemapindex>`) });
      site.set('https://lived.ae/sitemaps/properties.xml', sitemap(PRINCESS_URL, 'https://other.example/property/princess-tower'));
      site.set('https://lived.ae/sitemaps/areas.xml', sitemap('https://lived.ae/areas/dubai-marina'));
      site.set(PRINCESS_URL, html(PRINCESS)); site.set(PRINCESS_PICTURE, picture(740, 1110));
      expect((await find('Princess Tower')).picture).toMatchObject({ page: PRINCESS_URL });
      expect(requested()).toEqual([ROBOTS, 'https://lived.ae/sitemap-index.xml', 'https://lived.ae/sitemaps/properties.xml', 'https://lived.ae/sitemaps/areas.xml', PRINCESS_URL, PRINCESS_PICTURE]);
    });
    it('reads four sitemap files at most', async () => {
      site.set(SITEMAP, { type: 'application/xml', body: Buffer.from(`<sitemapindex>${Array.from({ length: 9 }, (_, i) => `<sitemap><loc>https://lived.ae/sitemaps/part-${i}.xml</loc></sitemap>`).join('')}</sitemapindex>`) });
      for (let i = 0; i < 9; i++) site.set(`https://lived.ae/sitemaps/part-${i}.xml`, sitemap(`https://lived.ae/areas/area-${i}`));
      await find('Princess Tower');
      expect(requested()).toEqual([ROBOTS, SITEMAP, 'https://lived.ae/sitemaps/part-0.xml', 'https://lived.ae/sitemaps/part-1.xml', 'https://lived.ae/sitemaps/part-2.xml']);
    });
  });

  describe('limits', () => {
    it('requests two candidate pages at most, the closest addresses first', async () => {
      const page = (name: string) => subjectPage({ name });
      withPages({
        'https://lived.ae/property/wasl-611-al-warsan-dubai-uae': page('Wasl 611 Al Warsan'), 'https://lived.ae/property/wasl-611-tower-b': page('Wasl 611 Tower B'),
        'https://lived.ae/property/wasl-611-a': page('Wasl 611 A'), 'https://lived.ae/areas/wasl-611.html': page('Wasl 611 area'), 'https://lived.ae/property/wasl-611-annex': page('Wasl 611 Annex'),
      });
      expect(await find('Wasl 611')).toEqual({ picture: null, searched: true });
      expect(requested()).toEqual([ROBOTS, SITEMAP, 'https://lived.ae/areas/wasl-611.html', 'https://lived.ae/property/wasl-611-a']);
    });
    it('tries two tied pictures at most on a page', async () => {
      const main = [1, 2, 3].map(n => `<img src="/api/media/w${n}.jpg" alt="Wasl 611 · photo ${n}" width="1200" height="800">`).join('');
      withPages({ [WASL_URL]: subjectPage({ main }) }, { 'https://lived.ae/api/media/w1.jpg': picture(300, 200), 'https://lived.ae/api/media/w2.jpg': { type: 'image/svg+xml', body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }, 'https://lived.ae/api/media/w3.jpg': picture(1200, 800) });
      expect(await find('Wasl 611')).toEqual({ picture: null, searched: true }); // too small and not a picture: unusable, and the search is finished
      expect(requested()).toEqual([ROBOTS, SITEMAP, WASL_URL, 'https://lived.ae/api/media/w1.jpg', 'https://lived.ae/api/media/w2.jpg']);
    });
    it('the second tied picture is taken when the first cannot be used', async () => {
      const main = [1, 2].map(n => `<img src="/api/media/w${n}.jpg" alt="Wasl 611 · photo ${n}" width="1200" height="800">`).join('');
      withPages({ [WASL_URL]: subjectPage({ main }) }, { 'https://lived.ae/api/media/w1.jpg': new SitePictureError('too_large'), 'https://lived.ae/api/media/w2.jpg': picture(1200, 800) });
      expect((await find('Wasl 611')).picture).toMatchObject({ src: 'https://lived.ae/api/media/w2.jpg', alt: 'Wasl 611 · photo 2' });
    });
    it('the second candidate page is used when the first is not the subject’s', async () => {
      withPages({ 'https://lived.ae/areas/princess-tower': subjectPage({ name: 'Princess Tower area guide' }), [PRINCESS_URL]: PRINCESS }, { [PRINCESS_PICTURE]: picture(740, 1110) });
      expect((await find('Princess Tower')).picture).toMatchObject({ page: PRINCESS_URL });
    });
    it('stops when its requests run out', async () => {
      withPages({ [PRINCESS_URL]: PRINCESS }, { [PRINCESS_PICTURE]: picture(740, 1110) });
      H.fetch.mockImplementationOnce(async (_address: URL, o: any) => { o.requests.left = 2; throw new SitePictureError('unreachable'); }); // robots.txt, then two requests left
      expect(await find('Princess Tower')).toEqual({ picture: null, searched: false });
      // Both tied pictures were asked for and both were refused by the count; nothing reached the site after the page.
      expect(requested()).toEqual([ROBOTS, SITEMAP, PRINCESS_URL, PRINCESS_PICTURE, 'https://lived.ae/_next/image?url=%2Fapi%2Fmedia%2F9zt4c0de1fg.jpg%3Fbucket%3Dproperties&w=1200&q=75']);
      expect(H.fetch.mock.calls[0][1].requests.left).toBeLessThan(0);
    });
    it('gives up at its deadline, without a picture and without remembering a miss', async () => {
      withPages({ [PRINCESS_URL]: PRINCESS }, { [PRINCESS_PICTURE]: picture(740, 1110) });
      site.set(SITEMAP, async () => { await new Promise(r => setTimeout(r, 120)); return sitemap(PRINCESS_URL) as { type: string; body: Buffer }; });
      const started = Date.now();
      expect(await find('Princess Tower', 'building', 40)).toEqual({ picture: null, searched: false });
      expect(Date.now() - started).toBeLessThan(2000);
      expect(requested()).not.toContain(PRINCESS_PICTURE);
    });
    it('its budgets are the designed ones', () => { expect([AUTO_BUDGET_MS, OWNER_BUDGET_MS, REAL_COVER_RETRY_MS]).toEqual([20_000, 25_000, 7 * 864e5]); });
  });

  describe('when Radar could not finish looking', () => {
    it('the candidate page could not be reached', async () => {
      withPages({ [PRINCESS_URL]: PRINCESS }); site.delete(PRINCESS_URL);
      expect(await find('Princess Tower')).toEqual({ picture: null, searched: false });
    });
    it('a tied picture exists and could not be reached (the site’s media endpoint is down)', async () => {
      withPages({ [WASL_URL]: WASL });
      expect(await find('Wasl 611')).toEqual({ picture: null, searched: false });
      expect(requested()).toContain(WASL_PICTURE);
    });
    it('a page that redirects off the site is a finished search, not an unfinished one', async () => {
      withPages({ [PRINCESS_URL]: PRINCESS }); site.set(PRINCESS_URL, new SitePictureError('left_site', 'other.com'));
      expect(await find('Princess Tower')).toEqual({ picture: null, searched: true });
    });
    it('a fault of Radar’s own while reading a tied picture: no picture, and nothing is remembered', async () => {
      withPages({ [WASL_URL]: WASL }, { [WASL_PICTURE]: new TypeError('boom') });
      expect(await find('Wasl 611')).toEqual({ picture: null, searched: false });
    });
    it.each([
      ['the crawl table cannot be read', () => { H.rowsError = new Error('connection terminated'); }],
      ['the request layer throws something unexpected', () => { H.fetch.mockImplementation(async () => { throw new TypeError('boom'); }); }],
      ['a page is not HTML at all', () => { withPages({ [PRINCESS_URL]: PRINCESS }); site.set(PRINCESS_URL, { type: 'text/html', body: Buffer.from([0xff, 0xfe, 0x00, 0x00, 0xd8]) }); }],
    ])('never throws: %s', async (_name, arrange) => {
      arrange();
      const out = await find('Princess Tower');
      expect(out.picture).toBeNull();
    });
  });
});

describe('the address a person gives', () => {
  const from = (address: string, subject: string | null = null) => pictureFromAddress({ domain: SITE, address, subject });
  const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { expect(e).toBeInstanceOf(SitePictureError); return (e as SitePictureError).code; } throw new Error('expected a SitePictureError'); };

  it.each([
    ['https://example.org/a.png', 'not_your_site', 'example.org'], ['https://lived.ae.evil.com/a.png', 'not_your_site', 'lived.ae.evil.com'], ['https://notlived.ae/a.png', 'not_your_site', 'notlived.ae'],
    ['https://lived.ae@evil.com/a.png', 'invalid_address', undefined], ['https://lived.ae:8443/a.png', 'invalid_address', undefined], ['ftp://lived.ae/a.png', 'invalid_address', undefined], ['not a url', 'invalid_address', undefined],
  ])('%s is refused with %s and nothing is requested', async (address, expected, host) => {
    const error = await from(address).catch(e => e);
    expect(error).toMatchObject({ code: expected, ...(host ? { host } : {}) });
    expect(H.fetch).not.toHaveBeenCalled();
  });
  it('a picture address becomes the cover and is never read as a page; the first request accepts either, with the picture limit', async () => {
    site.set('https://lived.ae/api/media/9zt4c0de1fg.jpg?bucket=properties', picture(1600, 900, 'image/jpeg'));
    const found = await from('lived.ae/api/media/9zt4c0de1fg.jpg?bucket=properties#photo');
    expect(found).toMatchObject({ page: null, src: PRINCESS_PICTURE, w: 1600, h: 900, fit: 'crop', alt: '' });
    expect(probeImage(found.png)).toMatchObject({ width: 1200, height: 628 });
    expect(requested()).toEqual([PRINCESS_PICTURE]);
    expect(H.fetch.mock.calls[0][1]).toMatchObject({ accept: ACCEPT.any, maxBytes: 8 * 1024 * 1024, over: 'reject', domain: SITE, requests: { left: 11 } });
  });
  it('records the address that answered, after redirects on the site', async () => {
    site.set('https://lived.ae/photo', { ...(picture(1600, 900) as any), url: 'https://media.lived.ae/files/photo-1600.png' });
    expect(await from('/photo')).toMatchObject({ page: null, src: 'https://media.lived.ae/files/photo-1600.png' });
  });
  it.each([
    ['an SVG', { type: 'image/svg+xml', body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"/>') }, 'not_a_picture'],
    ['a GIF', { type: 'image/gif', body: Buffer.from('GIF89a') }, 'not_a_picture'],
    ['a PNG served as a download', { ...(picture(1600, 900) as any), type: 'application/octet-stream' }, 'not_a_picture'],
    ['a text file', { type: 'text/plain', body: Buffer.from('hello') }, 'not_a_picture'],
    ['a JSON error body', { type: 'application/json', body: Buffer.from('{"error":"Image unavailable"}') }, 'not_a_picture'],
    ['a picture that is too small', picture(300, 200), 'too_small'],
    ['an address the site does not answer', new SitePictureError('unreachable'), 'unreachable'],
    ['an address that redirects away', new SitePictureError('left_site', 'cdn.other.com'), 'left_site'],
    ['a file over the size limit', new SitePictureError('too_large'), 'too_large'],
  ] as [string, Answer, string][])('%s is refused as %s', async (_name, answer, expected) => {
    site.set('https://lived.ae/a.png', answer);
    expect(await code(from('https://lived.ae/a.png'))).toBe(expected);
    expect(H.fetch).toHaveBeenCalledTimes(1);
  });
  it('what an address is, is decided by the answer: a page behind a .png name is read as a page', async () => {
    site.set('https://lived.ae/media/page.png', html('<html><body><h1>Not a picture</h1></body></html>'));
    expect(await code(from('https://lived.ae/media/page.png'))).toBe('no_picture');
  });

  it('a page address: the picture the page gives for the article’s subject, with the page as its source', async () => {
    site.set(PRINCESS_URL, html(PRINCESS)); site.set(PRINCESS_PICTURE, picture(740, 1110, 'image/jpeg'));
    const found = await from(PRINCESS_URL, 'Princess Tower');
    expect(found).toMatchObject({ page: PRINCESS_URL, src: PRINCESS_PICTURE, w: 740, h: 1110, fit: 'backdrop', alt: '' });
    expect(requested()).toEqual([PRINCESS_URL, PRINCESS_PICTURE]);
    expect(H.fetch.mock.calls[1][1]).toMatchObject({ accept: ACCEPT.picture, over: 'reject' });
    expect(H.fetch.mock.calls[1][1].requests).toBe(H.fetch.mock.calls[0][1].requests);
  });
  it('a page address with no subject: structured data, then the page’s own share image, then its pictures', async () => {
    site.set(HOME_URL, html(HOME));
    site.set(WASL_URL, html(WASL)); site.set(WASL_PICTURE, picture(1200, 800, 'image/webp'));
    // The share image is the site's default card, so it is passed over (after reading the home page) and the gallery picture is used.
    expect(await from(WASL_URL)).toMatchObject({ page: WASL_URL, src: WASL_PICTURE, alt: 'Wasl 611 · photo 1' });
    expect(requested()).toEqual([WASL_URL, HOME_URL, WASL_PICTURE]);
    expect(requested()).not.toContain(DEFAULT_CARD);
  });
  it('a page’s own share image is used when it differs from the home page’s, and not when the home page cannot be read', async () => {
    const page = subjectPage({ share: 'https://lived.ae/api/og/wasl-611.jpg' });
    site.set(WASL_URL, html(page)); site.set('https://lived.ae/api/og/wasl-611.jpg', picture(1200, 630)); site.set(HOME_URL, html(HOME));
    expect(await from(WASL_URL)).toMatchObject({ src: 'https://lived.ae/api/og/wasl-611.jpg' });
    site.delete(HOME_URL); H.fetch.mockClear();
    expect(await code(from(WASL_URL))).toBe('no_picture');
    expect(requested()).not.toContain('https://lived.ae/api/og/wasl-611.jpg');
  });
  it('tries two pictures at most: the second when the first cannot be used, never a third', async () => {
    const main = [1, 2, 3].map(n => `<img src="/api/media/w${n}.jpg" alt="photo ${n}" width="1200" height="800">`).join('');
    site.set(WASL_URL, html(subjectPage({ share: '', main })));
    site.set('https://lived.ae/api/media/w1.jpg', picture(300, 200)); site.set('https://lived.ae/api/media/w2.jpg', picture(1200, 800)); site.set('https://lived.ae/api/media/w3.jpg', picture(1200, 800));
    expect(await from(WASL_URL)).toMatchObject({ src: 'https://lived.ae/api/media/w2.jpg', alt: 'photo 2' });
    site.set('https://lived.ae/api/media/w2.jpg', new SitePictureError('unreachable')); H.fetch.mockClear();
    expect(await code(from(WASL_URL))).toBe('no_picture');
    expect(requested()).toEqual([WASL_URL, 'https://lived.ae/api/media/w1.jpg', 'https://lived.ae/api/media/w2.jpg']);
  });
  it('end state: the page’s pictures are all on another host, and the error names it', async () => {
    site.set(HOME_URL, html(HOME));
    site.set(WASL_URL, html(subjectPage({ main: '<img src="https://images.cdn-host.net/wasl-611.jpg" alt="Wasl 611" width="1200" height="800">' })));
    const error = await from(WASL_URL, 'Wasl 611').catch(e => e);
    expect(error).toMatchObject({ code: 'off_site_picture', host: 'images.cdn-host.net' });
    expect(requested().some(u => u.includes('cdn-host'))).toBe(false);
  });
  it('end state: the one picture on the page could not be used, and the error is that picture’s', async () => {
    site.set(WASL_URL, html(subjectPage({ share: '', main: '<img src="/api/media/tiny.jpg" alt="Wasl 611" width="1200" height="800">' }))); site.set('https://lived.ae/api/media/tiny.jpg', picture(300, 200));
    expect(await code(from(WASL_URL))).toBe('too_small');
    site.set('https://lived.ae/api/media/tiny.jpg', new SitePictureError('too_large'));
    expect(await code(from(WASL_URL))).toBe('too_large');
    site.delete('https://lived.ae/api/media/tiny.jpg');
    expect(await code(from(WASL_URL))).toBe('unreachable');
  });
  it('end state: a page with no picture at all', async () => {
    site.set(HOME_URL, html(HOME)); site.set(WASL_URL, html(subjectPage({})));
    expect(await code(from(WASL_URL))).toBe('no_picture');
  });
  it('a fault of Radar’s own while reading a picture is not turned into a message about the picture', async () => {
    site.set(WASL_URL, html(subjectPage({ share: '', main: '<img src="/api/media/w1.jpg" alt="Wasl 611" width="1200" height="800">' })));
    site.set('https://lived.ae/api/media/w1.jpg', new TypeError('boom'));
    const error = await from(WASL_URL).catch(e => e);
    expect(error).toBeInstanceOf(TypeError); expect(error).not.toBeInstanceOf(SitePictureError);
  });
  it('robots.txt is not consulted for an address a person gave', async () => {
    site.set(ROBOTS, text('User-agent: *\nDisallow: /\n')); site.set(PRINCESS_URL, html(PRINCESS)); site.set(PRINCESS_PICTURE, picture(740, 1110));
    await from(PRINCESS_URL, 'Princess Tower');
    expect(requested()).not.toContain(ROBOTS);
  });
});

describe('storing a real cover', () => {
  const img: Article['img'] = { style: 'illustration', seed: 3, prompt: 'A direction', promptBy: 'radar', alt: 'Illustration of something', url: '/api/files/biz/hero/old.png', urlKey: 'illustration:3', placeholder: { reason: 'failed', at: 'x' } };
  const found = { png: Buffer.from('png-bytes'), page: PRINCESS_URL, src: PRINCESS_PICTURE, w: 740, h: 1110, fit: 'backdrop' as const, alt: 'Princess Tower · photo 1' };
  it('stores the PNG under the business’s hero folder and returns the cover with its record', async () => {
    H.put.mockResolvedValue('/api/files/biz/hero/test.png');
    const out = await storeRealCover('biz', img, found, 'radar', { subject: 'Princess Tower', alt: 'Princess Tower' });
    expect(H.put).toHaveBeenCalledWith('biz/hero/test.png', found.png, 'image/png');
    expect(out).toEqual({ style: 'illustration', seed: 3, prompt: 'A direction', promptBy: 'radar', alt: 'Princess Tower', url: '/api/files/biz/hero/test.png', urlKey: 'illustration:3',
      real: { by: 'radar', url: '/api/files/biz/hero/test.png', page: PRINCESS_URL, src: PRINCESS_PICTURE, at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), w: 740, h: 1110, fit: 'backdrop', subject: 'Princess Tower' } });
  });
  it('keeps an alt a person wrote, and records no subject for a picture a person chose', async () => {
    H.put.mockResolvedValue('/api/files/biz/hero/test.png');
    const out = await storeRealCover('biz', { ...img, alt: 'My words', altBy: 'owner' }, { ...found, page: null }, 'owner', { alt: 'Princess Tower' });
    expect(out).toMatchObject({ alt: 'My words', altBy: 'owner', real: { by: 'owner', page: null } });
    expect('subject' in out.real!).toBe(false);
  });
  it('throws when the file cannot be stored', async () => {
    H.put.mockRejectedValue(new Error('storage unavailable'));
    await expect(storeRealCover('biz', img, found, 'owner')).rejects.toThrow('storage unavailable');
  });
  it('a miss is remembered per subject and per domain, however the name is written', () => {
    expect(realCoverKey('Wasl 611', 'lived.ae')).toBe('wasl 611@lived.ae');
    expect(realCoverKey('  WASL-611 ', 'lived.ae')).toBe(realCoverKey('Wasl 611', 'lived.ae'));
    expect(realCoverKey('Wasl 61', 'lived.ae')).not.toBe(realCoverKey('Wasl 611', 'lived.ae'));
    expect(realCoverKey('Wasl 611', 'other.ae')).not.toBe(realCoverKey('Wasl 611', 'lived.ae'));
  });
});
