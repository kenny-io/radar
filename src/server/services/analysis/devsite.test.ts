// The stub site's place pages and pictures (RADAR_DEV_STUBS), and both ways to a real cover run against them with no
// network: the stub site answers the guarded request, and everything after it (page reading, matching, the picture
// checks, the decode and the draw) is the real code.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock('@/server/env', () => ({ env: { devStubs: true, crawlerUserAgent: 'RadarBot/1.0 (+https://radar.test/bot)' } }));
vi.mock('../../db', () => ({ db: { select: () => ({ from: () => ({ where: async () => H.rows }) }) }, schema: { crawlPages: { businessId: 'businessId', url: 'url', title: 'title', h1: 'h1' } } }));
vi.mock('../storage', () => ({ putObject: vi.fn(), objectKey: () => 'k' }));

import { DEV_PLACES, devFetch, devProfileFor } from './devsite';
import { crawlSite } from './crawl';
import { probeImage } from '../realCover/picture';
import { namesSubject, readPage, subjectPictures } from '../realCover/page';
import { SitePictureError, findSubjectPicture, pictureFromAddress } from '../realCover';

const fetchMock = vi.fn(async () => { throw new Error('the network must not be used in stub mode'); });
beforeEach(() => { H.rows = []; vi.stubGlobal('fetch', fetchMock); });
const DOMAIN = 'northbeam.test';
const at = (path: string) => `https://${DOMAIN}${path}`;
const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { expect(e).toBeInstanceOf(SitePictureError); return (e as SitePictureError).code; } throw new Error('expected a SitePictureError'); };

describe('the stub site’s places', () => {
  it('has three, and two of them have a picture', () => {
    expect(DEV_PLACES.map(p => [p.slug, p.name, p.picture])).toEqual([['harbour-house', 'Harbour House', true], ['harbour-house-annex', 'Harbour House Annex', true], ['mill-lane-studios', 'Mill Lane Studios', false]]);
  });
  it.each(['northbeam.test', 'fieldnote.app', 'acme-coffee.test'])('every stub domain serves them and lists them in its sitemap, without adding them to its navigation: %s', async domain => {
    const map = (await devFetch(`https://${domain}/sitemap.xml`)).body.toString();
    const home = (await devFetch(`https://${domain}/`)).body.toString();
    for (const place of DEV_PLACES) {
      expect(map).toContain(`<loc>https://${domain}/places/${place.slug}</loc>`);
      expect(home).not.toContain('/places/');
      const r = await devFetch(`https://${domain}/places/${place.slug}`);
      expect(r).toMatchObject({ status: 200, type: 'text/html; charset=utf-8' });
      const page = readPage(r.body.toString(), `https://${domain}/places/${place.slug}`, domain);
      expect(page).toMatchObject({ h1: place.name, entityNames: place.picture ? [place.name] : [] });
      expect(page).toMatchObject({ article: false, listing: false, offSite: [] });
      const picture = `https://${domain}/media/${place.slug}.png`;
      // With a picture: tied to the place by structured data and by alt text. Without: only the site-wide share image.
      expect(page.pictures).toEqual([...(place.picture ? [{ url: picture, alt: '', from: 'ld', of: place.name }, { url: picture, alt: `${place.name} · photo 1`, from: 'img' }] : []), { url: `https://${domain}/og.png`, alt: '', from: 'share' }]);
    }
    expect(devProfileFor(domain).pages.some(p => p.path.startsWith('/places/'))).toBe(false);
    expect(map.match(/<loc>/g)).toHaveLength(devProfileFor(domain).pages.length + 3);
  });
  it('serves a stub picture for each place that has one, and one file for each way a picture can be refused', async () => {
    const file = async (name: string) => devFetch(at('/media/' + name));
    for (const slug of ['harbour-house', 'harbour-house-annex']) expect(probeImage((await file(slug + '.png')).body)).toEqual({ type: 'image/png', width: 1600, height: 900, complete: true });
    expect((await file('harbour-house.png')).body.equals((await file('harbour-house-annex.png')).body)).toBe(false); // two places, two pictures
    expect((await file('harbour-house.png')).body.equals((await file('harbour-house.png')).body)).toBe(true); // and the same one every time
    expect(probeImage((await file('portrait.png')).body)).toMatchObject({ width: 800, height: 1200, complete: true });
    expect(probeImage((await file('tiny.png')).body)).toMatchObject({ width: 300, height: 200, complete: true });
    expect((await file('too-large.png')).body.length).toBe(9 * 1024 * 1024);
    expect(probeImage((await file('broken.png')).body)).toMatchObject({ type: 'image/png', width: 1600, height: 900, complete: false });
    expect(await file('page.png')).toMatchObject({ status: 200, type: 'text/html; charset=utf-8' });
    for (const name of ['mill-lane-studios.png', 'nothing.png']) expect((await file(name)).status).toBe(404);
    expect((await devFetch(at('/og.png'))).status).toBe(404); // the share card is left unserved, as before
  });
  it('the stub crawl reads the three place pages as ordinary pages', async () => {
    const crawl = await crawlSite(DOMAIN);
    const places = crawl.pages.filter(p => p.path.startsWith('/places/'));
    expect(places.map(p => [p.path, p.h1, p.kind]).sort()).toEqual(DEV_PLACES.map(p => ['/places/' + p.slug, p.name, 'page']).sort());
    expect(crawl.pages).toHaveLength(devProfileFor(DOMAIN).pages.length + 3);
  });
});

describe('real covers against the stub site, offline', () => {
  const owner = (address: string, subject: string | null = null) => pictureFromAddress({ domain: DOMAIN, address, subject });
  const auto = (name: string) => findSubjectPicture({ bid: 'biz', domain: DOMAIN, subject: { name, kind: 'building' } });

  it('owner action, a page address: the place’s picture, with the page as its source', async () => {
    const found = await owner(at('/places/harbour-house'));
    expect(found).toMatchObject({ page: at('/places/harbour-house'), src: at('/media/harbour-house.png'), w: 1600, h: 900, fit: 'crop' });
    expect(probeImage(found.png)).toEqual({ type: 'image/png', width: 1200, height: 628, complete: true });
  });
  it('owner action, a picture address: the picture itself is the source; a portrait is shown whole on a backdrop', async () => {
    expect(await owner(at('/media/harbour-house.png'))).toMatchObject({ page: null, src: at('/media/harbour-house.png'), fit: 'crop' });
    expect(await owner(`${DOMAIN}/media/portrait.png`)).toMatchObject({ page: null, w: 800, h: 1200, fit: 'backdrop' });
  });
  it.each([
    ['https://example.org/a.png', 'not_your_site'], [at('/places/mill-lane-studios'), 'no_picture'], [at('/media/tiny.png'), 'too_small'], [at('/media/too-large.png'), 'too_large'],
    [at('/media/broken.png'), 'not_a_picture'], [at('/media/page.png'), 'no_picture'], [at('/brand/logo.svg'), 'not_a_picture'], [at('/places/nowhere'), 'unreachable'],
  ])('owner action, %s → %s', async (address, expected) => { expect(await code(owner(address))).toBe(expected); });
  it('owner action on a business whose stub site is unreachable', async () => {
    expect(await code(pictureFromAddress({ domain: 'unreachable-studio.test', address: 'https://unreachable-studio.test/places/harbour-house', subject: null }))).toBe('unreachable');
  });

  it('automatic: an article about Harbour House gets the Harbour House picture, not the annex’s', async () => {
    const { picture, searched } = await auto('Harbour House');
    expect(searched).toBe(true);
    expect(picture).toMatchObject({ page: at('/places/harbour-house'), src: at('/media/harbour-house.png'), fit: 'crop' });
    expect((await auto('Harbour House Annex')).picture).toMatchObject({ page: at('/places/harbour-house-annex'), src: at('/media/harbour-house-annex.png') });
  });
  it('automatic: Mill Lane Studios has a page and no picture of its own, so nothing is found and the search is finished', async () => {
    expect(await auto('Mill Lane Studios')).toEqual({ picture: null, searched: true });
  });
  it('owner action: the picture keeps its own alt text from the page, though structured data lists it first', async () => {
    expect((await owner(at('/places/harbour-house'))).alt).toBe('Harbour House · photo 1');
    expect((await owner(at('/places/harbour-house-annex'), 'Harbour House Annex')).alt).toBe('Harbour House Annex · photo 1');
    expect((await owner(at('/media/harbour-house.png'))).alt).toBe(''); // a picture address has no page to take an alt from
  });
  it('automatic: on the Annex page nothing is tied to "Harbour House", by its name or by its photo’s alt text', async () => {
    const annex = readPage((await devFetch(at('/places/harbour-house-annex'))).body.toString(), at('/places/harbour-house-annex'), DOMAIN);
    expect(namesSubject(annex, 'Harbour House')).toBe(false);
    expect(subjectPictures(annex, 'Harbour House')).toEqual([]);
    expect(subjectPictures(annex, 'Harbour House Annex').map(p => p.url)).toEqual([at('/media/harbour-house-annex.png')]); // tied twice over, listed once
  });
  it('automatic: a place the site has no page for, and a site that cannot be reached', async () => {
    expect(await auto('Harbour Lodge')).toEqual({ picture: null, searched: true });
    // A site that never answered was not looked at: nothing is remembered, and the next rewrite looks again.
    expect(await findSubjectPicture({ bid: 'biz', domain: 'unreachable-studio.test', subject: { name: 'Harbour House', kind: 'building' } })).toEqual({ picture: null, searched: false });
  });
  it('none of it touches the network', () => { expect(fetchMock).not.toHaveBeenCalled(); });
});
