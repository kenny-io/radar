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
/** No answer at all: a refused connection, a failed lookup, a timeout. */
const DOWN = () => new SitePictureError('unreachable');
const status = (code: number) => new SitePictureError('unreachable', undefined, code);

beforeEach(() => {
  H.fetch.mockReset(); H.put.mockReset(); H.rows = []; H.rowsError = null; site = new Map();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // The scripted site honours the same request count and deadline as the real guard. An address it does not have
  // answers 404, as a real site does; DOWN is an address that gives no answer at all.
  H.fetch.mockImplementation(async (address: URL, o: any) => {
    if (o.requests.left-- <= 0 || o.signal.aborted) throw new SitePictureError('unreachable');
    const hit = site.get(address.href);
    if (!hit) throw new SitePictureError('unreachable', undefined, 404);
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
  it('a page the crawl already knows by its h1 is used without reading the sitemap, whatever its address', async () => {
    H.rows = [
      { url: 'https://lived.ae/p/100', title: 'Princess Tower — Apartment in Dubai Marina | Lived', h1: 'Find your tower' }, // its title leads with the name, its h1 says otherwise: not a candidate
      { url: 'http://lived.ae/p/12345', title: 'Somewhere', h1: 'Princess   Tower' },
      { url: 'https://evil.example/property/princess-tower', title: 'Princess Tower', h1: 'Princess Tower' }, // not this business's site: ignored
      { url: 'https://lived.ae/about', title: 'About', h1: 'About' },
    ];
    site.set('https://lived.ae/p/12345', html(PRINCESS)); site.set('https://lived.ae/p/100', html(PRINCESS)); site.set(PRINCESS_PICTURE, picture(1600, 900));
    const { picture: found } = await find('Princess Tower');
    expect(found).toMatchObject({ page: 'https://lived.ae/p/12345', src: PRINCESS_PICTURE });
    expect(requested()).toEqual([ROBOTS, 'https://lived.ae/p/12345', PRINCESS_PICTURE]); // robots was asked for (and was missing); the sitemap never
  });
  it('a crawled page with no h1 is a candidate by the lead of its title, and is still confirmed only by what the page itself says', async () => {
    H.rows = [{ url: 'https://lived.ae/p/1', title: 'Princess Tower - Annex | Lived', h1: '' }, { url: 'https://lived.ae/p/2', title: 'Princess Tower | Lived', h1: '' }];
    const noH1 = (ld: unknown) => `<html><head><title>Princess Tower | Lived</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><img src="/media/pt.png" alt="Princess Tower" width="1200" height="800"></body></html>`;
    site.set('https://lived.ae/p/1', html(noH1({ '@type': 'Place', name: 'Princess Tower Annex' }))); // candidate by its title lead; names something else
    site.set('https://lived.ae/p/2', html(noH1({ '@type': 'Place', name: 'Princess Tower' })));
    site.set('https://lived.ae/media/pt.png', picture(1200, 800));
    expect((await find('Princess Tower')).picture).toMatchObject({ page: 'https://lived.ae/p/2', src: 'https://lived.ae/media/pt.png' });
    expect(requested()).toEqual([ROBOTS, 'https://lived.ae/p/1', 'https://lived.ae/p/2', 'https://lived.ae/media/pt.png']);
    // The same page with neither an h1 nor structured data: its title alone confirms nothing.
    site.set('https://lived.ae/p/2', html('<html><head><title>Princess Tower | Lived</title></head><body><img src="/media/pt.png" alt="Princess Tower" width="1200" height="800"></body></html>'));
    expect(await find('Princess Tower')).toEqual({ picture: null, searched: true });
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
      expect(requested()).toEqual([ROBOTS, SITEMAP, WASL_URL]); // neither the thumbnail nor the share image is asked for
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

  describe('share images are never taken automatically (decision D16)', () => {
    const none = { picture: null, searched: true };
    const onlyShare = async (share: string, home = HOME, more: Record<string, Answer> = {}) => {
      withPages({ [WASL_URL]: subjectPage({ share }) }, { [share]: picture(1200, 630), ...more });
      site.set(HOME_URL, html(home));
      const out = await find('Wasl 611');
      expect(requested()).toEqual([ROBOTS, SITEMAP, WASL_URL]); // neither the share image nor the home page is asked for
      return out;
    };
    it('a page’s own share image, different from the home page’s', async () => { expect(await onlyShare('https://lived.ae/api/og/wasl-611.jpg')).toEqual(none); });
    it('the site card, when the home page carries a different one (QA Q6)', async () => {
      expect(await onlyShare('https://lived.ae/share.png', HOME.replace(/lived-social-preview\.png/g, 'home-hero.png'))).toEqual(none);
    });
    it('the site card with a cache-buster the home page does not carry (QA Q7)', async () => { expect(await onlyShare(DEFAULT_CARD + '?v=2')).toEqual(none); });
    it('the apex-host card on a www page (QA Q8)', async () => { expect(await onlyShare('https://www.lived.ae/lived-social-preview.png')).toEqual(none); });
    it('a title card generated for the page, when its photos are on another host (QA Q20)', async () => {
      const card = 'https://lived.ae/property/wasl-611-al-warsan/opengraph-image?3f2a';
      withPages({ [WASL_URL]: subjectPage({ share: card, main: '<img src="https://cdn.other.com/wasl.jpg" alt="Wasl 611" width="1200" height="800">' }) }, { [card]: picture(1200, 630) });
      expect(await find('Wasl 611')).toEqual(none);
      expect(requested()).toEqual([ROBOTS, SITEMAP, WASL_URL]);
    });
    it('a picture tied by structured data or alt text is still taken on a page that also has a share image', async () => {
      withPages({ [WASL_URL]: WASL }, { [WASL_PICTURE]: picture(1200, 800), [DEFAULT_CARD]: picture(1200, 630) });
      expect((await find('Wasl 611')).picture).toMatchObject({ src: WASL_PICTURE });
      expect(requested()).not.toContain(HOME_URL);
    });
  });

  describe('a tied picture that is also the page’s share image (decision D21, QA N1)', () => {
    const none = { picture: null, searched: true };
    const HH = 'https://lived.ae/places/harbour-house', PHOTO = 'https://lived.ae/media/hh.png';
    const place = (o: { head?: string; body?: string }) => `<!doctype html><html><head><title>Harbour House — Stays</title>${o.head ?? ''}</head><body><main><h1>Harbour House</h1>${o.body ?? ''}</main></body></html>`;
    const og = (address: string) => `<meta property="og:image" content="${address}"><meta name="twitter:image" content="${address}"><link rel="image_src" href="${address}">`;
    const ld = (image: string) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Place', name: 'Harbour House', image })}</script>`;
    const home = (address: string) => html(`<html><head><title>Stays</title><meta property="og:image" content="${address}"></head><body><h1>Stays</h1></body></html>`);
    it('S3: structured data gives the site’s default card as the subject’s image: not taken, not requested', async () => {
      withPages({ [HH]: place({ head: og('https://lived.ae/og.png'), body: ld('https://lived.ae/og.png') }) }, { 'https://lived.ae/og.png': picture(1200, 630) });
      site.set(HOME_URL, home('https://lived.ae/og.png'));
      expect(await find('Harbour House')).toEqual(none);
      expect(requested()).toEqual([ROBOTS, SITEMAP, HH]);
    });
    it('S4: structured data gives the page’s own generated title card: not taken, not requested', async () => {
      const card = 'https://lived.ae/places/harbour-house/opengraph-image?3f2a';
      withPages({ [HH]: place({ head: og(card), body: ld(card) }) }, { [card]: picture(1200, 630) });
      expect(await find('Harbour House')).toEqual(none);
      expect(requested()).toEqual([ROBOTS, SITEMAP, HH]);
    });
    it('S5: the default card is also an <img> on the page with the subject’s name as its alt: not taken', async () => {
      withPages({ [HH]: place({ head: og('https://lived.ae/og.png'), body: '<img src="/og.png" alt="Harbour House" width="1200" height="630">' }) }, { 'https://lived.ae/og.png': picture(1200, 630) });
      expect(await find('Harbour House')).toEqual(none);
      expect(requested()).toEqual([ROBOTS, SITEMAP, HH]);
    });
    it('S6 (control): a real photo given as both the share image and the structured-data image is taken, after the home page shows it is not the site’s card', async () => {
      withPages({ [HH]: place({ head: og(PHOTO), body: ld(PHOTO) }) }, { [PHOTO]: picture(1600, 900) });
      site.set(HOME_URL, home('https://lived.ae/og.png'));
      expect(await find('Harbour House')).toMatchObject({ picture: { page: HH, src: PHOTO }, searched: true });
      expect(requested()).toEqual([ROBOTS, SITEMAP, HH, HOME_URL, PHOTO]);
      expect(H.fetch.mock.calls[3][1]).toMatchObject({ accept: ACCEPT.page, over: 'truncate' });
      expect(H.fetch.mock.calls[0][1].requests.left).toBe(12 - 5); // the home page is counted like any other request
    });
    it('a default card with a plain name, given as the subject’s image: recognised on the home page, in any host form or with a cache-buster, and not taken', async () => {
      for (const [onPage, onHome] of [['https://lived.ae/img/cover.jpg', 'https://lived.ae/img/cover.jpg'], ['https://lived.ae/img/cover.jpg?v=3', 'https://www.lived.ae/img/cover.jpg'], ['https://www.lived.ae/img/cover.jpg', 'https://lived.ae/img/cover.jpg?v=1']]) {
        site.clear(); H.fetch.mockClear();
        withPages({ [HH]: place({ head: og(onPage), body: ld(onPage) + `<img src="${onPage}" alt="Harbour House" width="1200" height="630">` }) }, { [onPage]: picture(1200, 630) });
        site.set(HOME_URL, home(onHome));
        expect(await find('Harbour House'), onPage).toEqual(none);
        expect(requested()).toEqual([ROBOTS, SITEMAP, HH, HOME_URL]); // the card itself is never requested
      }
    });
    it('the home page cannot be read: the picture is not taken, and the search is not remembered as finished', async () => {
      for (const answer of [DOWN(), status(500), status(404), { type: 'application/json', body: Buffer.from('{}') }] as Answer[]) {
        site.clear(); H.fetch.mockClear();
        withPages({ [HH]: place({ head: og(PHOTO), body: ld(PHOTO) }) }, { [PHOTO]: picture(1600, 900) });
        site.set(HOME_URL, answer);
        expect(await find('Harbour House')).toEqual({ picture: null, searched: false });
        expect(requested()).toEqual([ROBOTS, SITEMAP, HH, HOME_URL]);
      }
    });
    it('robots.txt forbids the home page: it is not read, and the picture is not taken', async () => {
      site.set(ROBOTS, text('User-agent: *\nDisallow: /$\n'));
      withPages({ [HH]: place({ head: og(PHOTO), body: ld(PHOTO) }) }, { [PHOTO]: picture(1600, 900) });
      expect((await find('Harbour House')).picture).toBeNull();
      expect(requested()).toEqual([ROBOTS, SITEMAP, HH]);
    });
    it('the home page is read once for a page, and the next tied picture is still taken when the first is the site’s card', async () => {
      const card = 'https://lived.ae/img/cover.jpg';
      withPages({ [HH]: place({ head: og(card) + og(PHOTO), body: ld(card) + '<img src="/media/hh.png" alt="Harbour House · photo 1" width="1600" height="900">' }) }, { [PHOTO]: picture(1600, 900), [card]: picture(1200, 630) });
      site.set(HOME_URL, home(card));
      expect((await find('Harbour House')).picture).toMatchObject({ src: PHOTO, alt: 'Harbour House · photo 1' });
      expect(requested()).toEqual([ROBOTS, SITEMAP, HH, HOME_URL, PHOTO]);
    });
    it('a tied picture that is not among the page’s share images needs no home page', async () => {
      withPages({ [HH]: place({ head: og('https://lived.ae/og.png'), body: ld(PHOTO) }) }, { [PHOTO]: picture(1600, 900) });
      expect((await find('Harbour House')).picture).toMatchObject({ src: PHOTO });
      expect(requested()).toEqual([ROBOTS, SITEMAP, HH, PHOTO]);
    });
    it('the home page request is refused when the requests have run out, and then nothing is taken or remembered', async () => {
      withPages({ [HH]: place({ head: og(PHOTO), body: ld(PHOTO) }) }, { [PHOTO]: picture(1600, 900) });
      site.set(HOME_URL, home('https://lived.ae/og.png'));
      H.fetch.mockImplementationOnce(async (_address: URL, o: any) => { o.requests.left = 2; throw status(404); }); // robots.txt, then two requests left: sitemap and page
      expect(await find('Harbour House')).toEqual({ picture: null, searched: false });
    });
  });

  describe('a neighbour named with a "picture word" or a number is not the subject (decision D22, QA N2)', () => {
    const none = { picture: null, searched: true };
    it.each([
      ['A13', 'Harbour House', 'Harbour House View'], ['A14', 'Harbour House', 'Harbour House Gallery'], ['A15', 'Street Cafe', 'Main Street Cafe'],
      ['A16', 'Harbour House', 'Harbour House Building 2'], ['A17', 'Hyde Park', '1 Hyde Park'], ['A18', 'Park Row', 'Park Row View'], ['The View', 'The View', 'The View Gallery'],
    ])('%s: on the page of "%s", whose own photo has a generic alt, a card with alt "%s" is not taken', async (_q, subject, alt) => {
      const url = 'https://lived.ae/places/' + subject.toLowerCase().replace(/ /g, '-');
      const body = (own: string) => `<html><head><title>${subject}</title></head><body><h1>${subject}</h1><img src="/media/own.png" alt="${own}" width="1600" height="900"><img src="/media/other.png" alt="${alt}" width="800" height="600"></body></html>`;
      withPages({ [url]: body('Photo 1') }, { 'https://lived.ae/media/own.png': picture(1600, 900), 'https://lived.ae/media/other.png': picture(800, 600) });
      expect(await find(subject)).toEqual(none);
      expect(requested()).toEqual([ROBOTS, SITEMAP, url]);
      // With its own photo labelled, that photo is the one taken.
      site.set(url, html(body(`${subject} · photo 1`)));
      expect((await find(subject)).picture).toMatchObject({ src: 'https://lived.ae/media/own.png' });
    });
    it('A18 as QA ran it: "Park View" on the page of the four-letter subject "Park"', async () => {
      const url = 'https://lived.ae/places/park';
      withPages({ [url]: '<html><body><h1>Park</h1><img src="/media/own.png" alt="Photo 1" width="1600" height="900"><img src="/media/other.png" alt="Park View" width="800" height="600"></body></html>' }, { 'https://lived.ae/media/other.png': picture(800, 600) });
      expect(await find('Park', 'place')).toEqual(none);
    });
  });

  describe('another subject’s page or picture is never taken (QA D1, D3)', () => {
    const none = { picture: null, searched: true };
    const HH = 'https://lived.ae/places/harbour-house', ANNEX = 'https://lived.ae/places/harbour-house-annex';
    const HH_PNG = 'https://lived.ae/media/hh.png', ANNEX_PNG = 'https://lived.ae/media/annex.png';
    const place = (o: { title?: string; h1?: string; body?: string; head?: string }) => `<!doctype html><html><head><title>${o.title ?? 'Harbour House — Stays'}</title>${o.head ?? ''}</head><body><header><img src="/brand/logo.png" alt="Stays logo"></header><main><h1>${o.h1 ?? 'Harbour House'}</h1>${o.body ?? ''}</main></body></html>`;
    const pictures = { [HH_PNG]: picture(1600, 900), [ANNEX_PNG]: picture(1600, 900) };
    it('Q1: the right page, whose own photo has a generic alt, with a neighbour’s card below it', async () => {
      withPages({ [HH]: place({ body: '<img src="/media/hh.png" alt="Photo 1" width="1600" height="900"><section><h2>Similar places</h2><a href="/places/harbour-house-annex"><img src="/media/annex.png" alt="Harbour House Annex · photo 1" width="800" height="600"></a></section>' }) }, pictures);
      expect(await find('Harbour House')).toEqual(none);
      expect(requested()).toEqual([ROBOTS, SITEMAP, HH]);
    });
    it.each([['Q3', 'Harbour House - Annex | Stays'], ['Q4', 'Harbour House, Annex wing']])('%s: only the Annex page exists, titled "%s", h1 "Harbour House Annex"', async (_q, title) => {
      withPages({ [ANNEX]: place({ title, h1: 'Harbour House Annex', body: '<img src="/media/annex.png" alt="Harbour House Annex" width="1600" height="900">' }) }, pictures);
      expect(await find('Harbour House')).toEqual(none);
      expect(requested()).toEqual([ROBOTS, SITEMAP, ANNEX]); // read, not confirmed, nothing taken
    });
    it('Q5: a blog post outside the known blog paths, with no og:type', async () => {
      const post = 'https://lived.ae/harbour-house-review';
      withPages({ [post]: place({ title: 'Harbour House: our honest review', h1: 'Harbour House: our honest review', body: '<article><time datetime="2026-01-01">Jan 2026</time><img src="/media/chart.png" alt="Chart of Harbour House prices by month" width="1600" height="900"></article>' }) }, { 'https://lived.ae/media/chart.png': picture(1600, 900) });
      expect(await find('Harbour House')).toEqual(none);
      expect(requested()).not.toContain('https://lived.ae/media/chart.png');
    });
    it('Q9: an area page whose cards all end with the area’s name', async () => {
      const area = 'https://lived.ae/areas/dubai-marina';
      withPages({ [area]: place({ title: 'Dubai Marina — Stays', h1: 'Dubai Marina', body: '<ul><li><img src="/media/gate.png" alt="Marina Gate 1 — Dubai Marina" width="800" height="600"></li><li><img src="/media/jbr.png" alt="Sadaf 4 — Dubai Marina" width="800" height="600"></li></ul>' }) }, { 'https://lived.ae/media/gate.png': picture(800, 600), 'https://lived.ae/media/jbr.png': picture(800, 600) });
      expect(await find('Dubai Marina', 'place')).toEqual(none);
      expect(requested()).toEqual([ROBOTS, SITEMAP, area]);
    });
    it('Q10: structured data that is a Review of the subject, with the reviewer’s photo', async () => {
      withPages({ [HH]: place({ body: `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Review', name: 'Harbour House', image: 'https://lived.ae/media/reviewer.png' })}</script>` }) }, { 'https://lived.ae/media/reviewer.png': picture(1600, 900) });
      expect(await find('Harbour House')).toEqual(none);
      expect(requested()).not.toContain('https://lived.ae/media/reviewer.png');
    });
    it.each(['tag', 'tagged', 'label', 'labels'])('Q18: a /%s/ archive named after the subject is not even requested', async segment => {
      const tag = `https://lived.ae/${segment}/harbour-house`;
      withPages({ [tag]: place({ body: '<img src="/media/post.png" alt="Harbour House" width="1600" height="900">' }) }, { 'https://lived.ae/media/post.png': picture(1600, 900) });
      expect(await find('Harbour House')).toEqual(none);
      expect(requested()).toEqual([ROBOTS, SITEMAP]);
    });
    it('Q21: a neighbour’s card comes before the place’s own photo: the place’s own photo is the one taken', async () => {
      withPages({ [HH]: place({ body: '<div class="featured"><img src="/media/annex.png" alt="Harbour House Annex" width="800" height="600"></div><img src="/media/hh.png" alt="Harbour House · photo 1" width="1600" height="900">' }) }, pictures);
      expect((await find('Harbour House')).picture).toMatchObject({ page: HH, src: HH_PNG, alt: 'Harbour House · photo 1' });
      expect(requested()).toEqual([ROBOTS, SITEMAP, HH, HH_PNG]);
    });
    it('Q22: the right page’s only photo is on another host; the search does not fall through to the Annex page’s picture', async () => {
      withPages({ [HH]: place({ body: '<img src="https://cdn.other.com/hh.jpg" alt="Harbour House">' }), [ANNEX]: place({ title: 'Harbour House - Annex | Stays', h1: 'Harbour House Annex', body: '<img src="/media/annex.png" alt="Harbour House Annex" width="1600" height="900">' }) }, pictures);
      expect(await find('Harbour House')).toEqual(none);
      expect(requested()).toEqual([ROBOTS, SITEMAP, HH, ANNEX]);
    });
    it('and the Annex’s own article still gets the Annex’s picture', async () => {
      withPages({ [HH]: place({ body: '<img src="/media/hh.png" alt="Harbour House · photo 1" width="1600" height="900">' }), [ANNEX]: place({ title: 'Harbour House - Annex | Stays', h1: 'Harbour House Annex', body: '<img src="/media/annex.png" alt="Harbour House Annex · photo 1" width="1600" height="900">' }) }, pictures);
      expect((await find('Harbour House Annex')).picture).toMatchObject({ page: ANNEX, src: ANNEX_PNG });
      expect((await find('Harbour House')).picture).toMatchObject({ page: HH, src: HH_PNG });
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
    describe('a search is finished only when the list of pages was read (decisions D20 and D24, QA D6)', () => {
      it.each([
        ['no answer at all for robots.txt or the sitemap', DOWN(), DOWN(), false],
        ['a server error for both', status(503), status(502), false],
        ['no answer for robots.txt and a server error for the sitemap', DOWN(), status(500), false],
        ['"no such file" for both: the site answered, and has no sitemap', status(404), status(404), true],
        ['no answer for robots.txt, "no such file" for the sitemap', DOWN(), status(404), true],
        ['a server error for robots.txt, "forbidden" for the sitemap', status(500), status(403), true],
        ['robots.txt answered, the sitemap did not: the list of pages was never read', text('User-agent: *\nAllow: /\n'), DOWN(), false],
        ['robots.txt answered, the sitemap gave a server error (QA round 2)', text(''), status(503), false],
        ['robots.txt redirects off the site, the sitemap did not answer', new SitePictureError('left_site', 'other.com'), DOWN(), false],
        ['robots.txt answered, the sitemap redirects off the site (an answer: there is no list here)', text(''), new SitePictureError('left_site', 'other.com'), true],
      ] as [string, Answer, Answer, boolean][])('%s → searched: %s', async (_name, robots, map, searched) => {
        site.set(ROBOTS, robots); site.set(SITEMAP, map);
        expect(await find('Princess Tower')).toEqual({ picture: null, searched });
        expect(requested()).toEqual([ROBOTS, SITEMAP]);
      });
      it('crawled pages that are not candidates do not make it a finished search', async () => {
        H.rows = [{ url: 'https://lived.ae/about', title: 'About', h1: 'About' }, { url: 'https://lived.ae/property/marina-tower', title: 'Marina Tower', h1: 'Marina Tower' }];
        site.set(ROBOTS, DOWN()); site.set(SITEMAP, DOWN());
        expect(await find('Princess Tower')).toEqual({ picture: null, searched: false });
      });
      it('robots.txt names only a sitemap on another host, and the site’s own does not answer: unfinished', async () => {
        site.set(ROBOTS, text('Sitemap: https://sitemaps.other.com/lived.xml\n')); site.set(SITEMAP, status(502));
        expect(await find('Princess Tower')).toEqual({ picture: null, searched: false });
        expect(requested()).toEqual([ROBOTS, SITEMAP]);
      });
      it('a sitemap index that answered counts as read, though one of its files did not', async () => {
        site.set(SITEMAP, { type: 'application/xml', body: Buffer.from('<sitemapindex><sitemap><loc>https://lived.ae/sitemaps/a.xml</loc></sitemap></sitemapindex>') }); site.set('https://lived.ae/sitemaps/a.xml', DOWN());
        expect(await find('Princess Tower')).toEqual({ picture: null, searched: true });
      });
      it('a crawled page that is a candidate is looked at even with the sitemap down, and decides the outcome', async () => {
        H.rows = [{ url: 'https://lived.ae/p/9', title: 'x', h1: 'Princess Tower' }];
        site.set(ROBOTS, DOWN()); site.set('https://lived.ae/p/9', html(subjectPage({ name: 'Princess Tower' })));
        expect(await find('Princess Tower')).toEqual({ picture: null, searched: true }); // its page was read and has no picture of it
        expect(requested()).toEqual([ROBOTS, 'https://lived.ae/p/9']);
      });
      it('a sitemap that lists pages, none of them the subject’s, is a finished search even with no robots.txt', async () => {
        site.set(ROBOTS, DOWN()); withPages({ 'https://lived.ae/property/marina-tower': subjectPage({ name: 'Marina Tower' }) });
        expect(await find('Princess Tower')).toEqual({ picture: null, searched: true });
      });
      it('the error says whether the site answered', () => {
        expect(DOWN().status).toBeUndefined();
        expect(status(404)).toMatchObject({ code: 'unreachable', status: 404 });
      });
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
    // The share image is named as a share card (lived-social-preview.png), so it is not a candidate at all, and the gallery picture is used.
    expect(await from(WASL_URL)).toMatchObject({ page: WASL_URL, src: WASL_PICTURE, alt: 'Wasl 611 · photo 1' });
    expect(requested()).toEqual([WASL_URL, WASL_PICTURE]);
    // A default card with a plain name is passed over after reading the home page, which carries it too.
    site.set(HOME_URL, html(HOME.replaceAll('lived-social-preview.png', 'lived-preview.png'))); site.set(WASL_URL, html(WASL.replaceAll('lived-social-preview.png', 'lived-preview.png'))); H.fetch.mockClear();
    expect(await from(WASL_URL)).toMatchObject({ src: WASL_PICTURE });
    expect(requested()).toEqual([WASL_URL, HOME_URL, WASL_PICTURE]);
  });
  it('a page’s own share image is used when it differs from the home page’s, and not when the home page cannot be read', async () => {
    const page = subjectPage({ share: 'https://lived.ae/media/wasl-611-wide.jpg' });
    site.set(WASL_URL, html(page)); site.set('https://lived.ae/media/wasl-611-wide.jpg', picture(1200, 630)); site.set(HOME_URL, html(HOME));
    expect(await from(WASL_URL)).toMatchObject({ src: 'https://lived.ae/media/wasl-611-wide.jpg' });
    site.delete(HOME_URL); H.fetch.mockClear();
    expect(await code(from(WASL_URL))).toBe('no_picture');
    expect(requested()).not.toContain('https://lived.ae/media/wasl-611-wide.jpg');
  });
  it('a share image whose address names a share card is not a candidate on this path either, and is never requested (decision D21)', async () => {
    site.set(HOME_URL, html(HOME));
    for (const share of ['https://lived.ae/api/og/wasl-611.jpg', 'https://lived.ae/property/wasl-611-al-warsan/opengraph-image?3f2a', 'https://lived.ae/img/social-card.png', 'https://lived.ae/share/wasl-611.png', 'https://lived.ae/twitter-wasl.png', DEFAULT_CARD]) {
      site.set(WASL_URL, html(subjectPage({ share }))); site.set(share, picture(1200, 630)); H.fetch.mockClear();
      expect(await code(from(WASL_URL)), share).toBe('no_picture');
      expect(requested()).toEqual([WASL_URL]);
    }
    // Given directly, the same address is the person's explicit choice of that file, and is used.
    expect(await from('https://lived.ae/img/social-card.png')).toMatchObject({ page: null, src: 'https://lived.ae/img/social-card.png' });
  });
  it('the site’s default card is recognised under another host form or with a cache-buster, and is not used (decision D16)', async () => {
    const CARD = 'https://lived.ae/lived-preview.png'; // a default card whose name does not give it away
    site.set(HOME_URL, html(HOME.replaceAll('lived-social-preview.png', 'lived-preview.png')));
    for (const share of [CARD, CARD + '?v=2', 'https://www.lived.ae/lived-preview.png', 'http://www.lived.ae/lived-preview.png?utm=x#y']) {
      site.set(WASL_URL, html(subjectPage({ share }))); site.set(share, picture(1200, 630)); H.fetch.mockClear();
      expect(await code(from(WASL_URL)), share).toBe('no_picture');
      expect(requested()).toEqual([WASL_URL, HOME_URL]);
    }
    // A picture at another path is the page's own, and a person may choose it.
    site.set(WASL_URL, html(subjectPage({ share: 'https://lived.ae/property/wasl-611-al-warsan/wide.jpg?3f2a' }))); site.set('https://lived.ae/property/wasl-611-al-warsan/wide.jpg?3f2a', picture(1200, 630));
    expect(await from(WASL_URL)).toMatchObject({ src: 'https://lived.ae/property/wasl-611-al-warsan/wide.jpg?3f2a' });
  });
  it('a blank picture is refused with its own code', async () => {
    const blank = createCanvas(1600, 900); const g = blank.getContext('2d'); g.fillStyle = '#eeeeee'; g.fillRect(0, 0, 1600, 900);
    site.set('https://lived.ae/a.png', { type: 'image/png', body: blank.toBuffer('image/png') });
    expect(await code(from('https://lived.ae/a.png'))).toBe('blank_picture');
    site.set(WASL_URL, html(subjectPage({ share: '', main: '<img src="/a.png" alt="Wasl 611" width="1600" height="900">' })));
    expect(await code(from(WASL_URL))).toBe('blank_picture'); // the one picture on the page: its own error
  });
  it('a picture listed in structured data keeps the alt text of the <img> with the same address (decision D19, QA D5)', async () => {
    const page = `<html><head><title>Harbour House — Stays</title><meta property="og:image" content="https://lived.ae/og.png"><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Place', name: 'Harbour House', image: 'https://lived.ae/media/harbour-house.png' })}</script></head>
      <body><h1>Harbour House</h1><img src="/media/harbour-house.png" alt="Harbour House · photo 1" width="1600" height="900"></body></html>`;
    site.set('https://lived.ae/places/harbour-house', html(page)); site.set('https://lived.ae/media/harbour-house.png', picture(1600, 900));
    for (const subject of [null, 'Harbour House']) expect(await from('https://lived.ae/places/harbour-house', subject)).toMatchObject({ src: 'https://lived.ae/media/harbour-house.png', alt: 'Harbour House · photo 1' });
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
