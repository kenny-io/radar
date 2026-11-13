// What a draft does about a real picture of its subject: when it looks for one, what it saves when it finds one, what
// it remembers when it does not, and whose cover it never replaces. The model, the image service, body-image
// generation, the database, the search and storage are replaced; draftArticle and the direction step are real.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Article, CalendarEntry, Profile } from '@/lib/types';

const H = vi.hoisted(() => ({ run: vi.fn(), file: vi.fn(), body: vi.fn(), find: vi.fn(), store: vi.fn() }));
vi.mock('../../db', () => {
  const rows: any = { where: () => rows, limit: async () => [], then: (resolve: any) => Promise.resolve([]).then(resolve) };
  return { db: { select: () => ({ from: () => rows }) }, schema: { crawlPages: { businessId: 'businessId' }, calendarEntries: {} } };
});
vi.mock('../../ai', () => ({ ai: { run: H.run }, profileContext: () => 'BUSINESS PROFILE' }));
vi.mock('../images', () => ({ renderImageFile: H.file, renderImage: vi.fn(), defaultArticleImageStyle: () => 'illustration', MODEL_STYLES: ['editorial', 'flat', 'render3d', 'handdrawn', 'photography', 'illustration'] }));
vi.mock('./bodyImages', () => ({ generateArticleBodyImages: H.body }));
vi.mock('../gsc/metrics', () => ({ normKw: (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(), topQueries: async () => [] }));
vi.mock('../calendar/research', () => ({ tokens: (s: string) => s.toLowerCase().split(/\W+/).filter(word => word.length > 2) }));
vi.mock('../realCover', async original => ({ ...(await original<typeof import('../realCover')>()), findSubjectPicture: H.find, storeRealCover: H.store }));

import { defaultArticle } from '@/features/article/blocks';
import { planArticleBodyImages, realCoverOf, withRealCover } from '@/lib/articleImages';
import { REAL_COVER_RETRY_MS, realCoverKey } from '../realCover';
import { draftArticle } from './draft';

const profile = {
  domain: 'lived.test', business: { name: 'Lived', description: 'Tenant reviews', industry: 'Property', positioning: '', offerings: [], differentiators: [] },
  audience: { segments: ['Tenants'], buyers: [], needs: [], competitors: [] }, brand: { voice: 'Plain', language: 'English', markets: ['AE'], primary: '#123456', secondary: '#abcdef' }, keywords: { list: [] },
} as unknown as Profile;
const entry = { id: 'e_wasl', title: 'Wasl 611 Reviews: Tenant Ratings and What to Check First', kw: 'wasl 611 reviews', type: 'Guide', audience: 'Tenants', relevance: 'Tenants compare buildings', mode: 'new', url: null } as unknown as CalendarEntry;
const TEXT = [
  'Wasl 611 is a gated staff accommodation community of three buildings in Al Warsan, Dubai.',
  '## What tenants say about maintenance', 'Repairs are logged at the gate office and most are handled within the week.',
  '## What to check first', 'Walk the corridor and look at the shared kitchen before you sign.',
].join('\n\n');
const DEFAULT = 'Calm, editorial image about wasl 611 reviews';
const COVER = 'The exterior of Wasl 611, a gated staff accommodation community of three buildings in Al Warsan, seen from outside the entrance gate.';
const answer = (subject = 'Wasl 611', subjectKind = 'building') => ({
  subject, subjectKind,
  cover: { direction: COVER, alt: 'Illustration of Wasl 611 in Al Warsan' },
  sections: [
    { i: 0, direction: 'A maintenance worker repairing a door hinge in a plain residential corridor, with a toolbox open on the floor.', alt: 'Illustration of a repair in a corridor' },
    { i: 1, direction: 'A shared kitchen in staff accommodation, seen from the doorway, with a cooker, a sink and a long counter.', alt: 'Illustration of a shared kitchen' },
  ],
});
const FOUND = { png: Buffer.from('png'), page: 'https://lived.test/property/wasl-611-al-warsan', src: 'https://lived.test/api/media/7kq2mfx01ab.jpg', w: 1600, h: 900, fit: 'crop' as const, alt: 'Wasl 611 · photo 1' };
const REAL_URL = '/api/files/biz/hero/real.png';
let directions: () => Promise<any>;
let renders = 0;
beforeEach(() => {
  H.run.mockReset(); H.file.mockReset(); H.body.mockReset(); H.find.mockReset(); H.store.mockReset(); renders = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {});
  directions = async () => ({ json: answer() });
  H.run.mockImplementation(async (_task: string, input: any) => {
    if (input.purpose === 'article.research') throw new Error('no search in this test');
    if (input.purpose === 'article.draft') return { text: TEXT, json: null, citations: [] };
    if (input.purpose === 'article.meta') return { json: { seoTitle: 'Wasl 611 reviews', meta: 'What tenants say about Wasl 611.', alt: 'Alt text from the SEO step' } };
    if (input.purpose === 'article.imageDirections') return directions();
    throw new Error('unexpected purpose ' + input.purpose);
  });
  H.file.mockImplementation(async (r: any) => ({ url: `/api/files/biz/hero/${++renders}-${r.style}.png`, bytes: 10, type: 'image/png' }));
  H.body.mockImplementation(async (_ctx: any, _e: any, a: Article) => planArticleBodyImages(a.body, a.brief.words).map((plan, i) => ({ id: 'abi_' + i, after: plan.after, url: `/api/files/biz/article-body/${i}.png`, alt: 'alt', prompt: 'prompt', seed: 2 + i })));
  H.find.mockResolvedValue({ picture: null, searched: true });
  // Storage is replaced; the cover fields are built by the real helper, as the real storeRealCover builds them.
  H.store.mockImplementation(async (_bid: string, img: Article['img'], p: typeof FOUND, by: 'radar' | 'owner', o: { subject?: string; alt?: string }) =>
    withRealCover(img, REAL_URL, { by, page: p.page, src: p.src, at: '2026-11-13T10:00:00.000Z', w: p.w, h: p.h, fit: p.fit, ...(o.subject ? { subject: o.subject } : {}) }, o.alt));
});

const draft = (a0: Partial<Article> | null = null, p: Profile = profile) => draftArticle({ businessId: 'biz', progress: vi.fn(async () => {}) } as any, entry, a0 ? ({ ...defaultArticle(entry), ...a0 } as Article) : null, p, false, 'Lived');
/** A drafted article as it is stored, to redraft. */
const drafted = (img: Partial<Article['img']>, over: Partial<Article> = {}): Partial<Article> => ({ generated: true, body: [['p', 'Earlier text.']], seo: { title: 'Kept title', meta: 'Kept meta', slug: 'kept' }, img: { style: 'illustration', seed: 1, prompt: DEFAULT, alt: 'Earlier alt', url: '/api/files/biz/hero/old.png', urlKey: 'illustration:1', ...img }, ...over });
const record = (by: 'radar' | 'owner', url = '/api/files/biz/hero/old.png') => ({ by, url, page: by === 'owner' ? null : FOUND.page, src: FOUND.src, at: '2026-11-01T00:00:00.000Z', w: 1600, h: 900, fit: 'crop' as const, ...(by === 'radar' ? { subject: 'Wasl 611' } : {}) });

describe('a picture of the subject is found', () => {
  it('it is the cover: recorded as Radar’s find, shown under the article’s style, named by the subject, and no cover is generated', async () => {
    H.find.mockResolvedValue({ picture: FOUND, searched: true });
    const a = await draft();
    expect(H.find).toHaveBeenCalledTimes(1);
    expect(H.find).toHaveBeenCalledWith({ bid: 'biz', domain: 'lived.test', subject: { name: 'Wasl 611', kind: 'building' } });
    expect(H.store).toHaveBeenCalledWith('biz', expect.objectContaining({ prompt: COVER, promptBy: 'radar' }), FOUND, 'radar', { subject: 'Wasl 611', alt: 'Wasl 611' });
    expect(H.file).not.toHaveBeenCalled();
    expect(a.img).toEqual({ style: 'illustration', seed: 1, prompt: COVER, promptBy: 'radar', alt: 'Wasl 611', url: REAL_URL, urlKey: 'illustration:1',
      real: { by: 'radar', url: REAL_URL, page: FOUND.page, src: FOUND.src, at: '2026-11-13T10:00:00.000Z', w: 1600, h: 900, fit: 'crop', subject: 'Wasl 611' } });
    expect(realCoverOf(a.img)).toMatchObject({ by: 'radar' });
    expect(a.img.alt).not.toMatch(/^Illustration/);
    expect('realCoverMiss' in a).toBe(false);
    expect(a.generated).toBe(true); expect(a.bodyImages).toHaveLength(2);
    // Body images are still generated, in the article's style, and are handed the cover as saved.
    expect(H.body.mock.calls[0][2].img).toEqual(a.img);
  });
  it('it replaces a generated cover Radar made earlier, and a placeholder with its mark', async () => {
    H.find.mockResolvedValue({ picture: FOUND, searched: true });
    const over = await draft(drafted({ prompt: 'The entrance gate of Wasl 611 in Al Warsan in daylight.', promptBy: 'radar', alt: 'Illustration of the Wasl 611 gate' }));
    expect(over.img).toMatchObject({ url: REAL_URL, alt: 'Wasl 611', prompt: COVER, real: { by: 'radar' } });
    const placeholder = await draft(drafted({ promptBy: 'radar', placeholder: { reason: 'unavailable', at: '2026-11-01T00:00:00.000Z' } }));
    expect(placeholder.img.url).toBe(REAL_URL);
    expect('placeholder' in placeholder.img).toBe(false);
    expect(H.file).not.toHaveBeenCalled();
  });
  it('an alt the owner wrote is kept', async () => {
    H.find.mockResolvedValue({ picture: FOUND, searched: true });
    const a = await draft(drafted({ alt: 'My own alt', altBy: 'owner' }));
    expect(a.img).toMatchObject({ url: REAL_URL, alt: 'My own alt', altBy: 'owner' });
  });
  it('an earlier miss is forgotten', async () => {
    H.find.mockResolvedValue({ picture: FOUND, searched: true });
    const a = await draft(drafted({ promptBy: 'radar' }, { realCoverMiss: { key: realCoverKey('Wasl 611', 'lived.test'), at: new Date(Date.now() - REAL_COVER_RETRY_MS - 1000).toISOString() } }));
    expect(a.img.url).toBe(REAL_URL);
    expect('realCoverMiss' in a).toBe(false);
  });
  it('but it cannot be stored: the cover is generated as usual and the draft completes', async () => {
    H.find.mockResolvedValue({ picture: FOUND, searched: true });
    H.store.mockRejectedValue(new Error('storage unavailable'));
    const a = await draft();
    expect(a.generated).toBe(true);
    expect(H.file).toHaveBeenCalledTimes(1);
    expect(a.img).toMatchObject({ url: '/api/files/biz/hero/1-illustration.png', prompt: COVER, promptBy: 'radar', alt: 'Illustration of Wasl 611 in Al Warsan' });
    expect(a.img.real).toBeUndefined();
    expect('realCoverMiss' in a).toBe(false); // nothing was missed: the picture is there to find next time
  });
});

describe('no picture is found', () => {
  it('a finished search: the cover is generated as before, and the miss is remembered for this subject and site', async () => {
    const before = Date.now();
    const a = await draft();
    expect(H.find).toHaveBeenCalledTimes(1);
    expect(H.store).not.toHaveBeenCalled();
    expect(H.file).toHaveBeenCalledTimes(1);
    expect(a.img).toMatchObject({ url: '/api/files/biz/hero/1-illustration.png', urlKey: 'illustration:1', prompt: COVER, promptBy: 'radar', alt: 'Illustration of Wasl 611 in Al Warsan' });
    expect(a.img.real).toBeUndefined();
    expect(a.realCoverMiss).toEqual({ key: 'wasl 611@lived.test', at: expect.any(String) });
    expect(new Date(a.realCoverMiss!.at).getTime()).toBeGreaterThanOrEqual(before);
  });
  it('a search that could not finish: generated cover, nothing remembered, and an older miss stays as it was', async () => {
    H.find.mockResolvedValue({ picture: null, searched: false });
    const a = await draft();
    expect(a.img.url).toBe('/api/files/biz/hero/1-illustration.png');
    expect('realCoverMiss' in a).toBe(false);
    const stale = { key: realCoverKey('Wasl 611', 'lived.test'), at: new Date(Date.now() - REAL_COVER_RETRY_MS - 60_000).toISOString() };
    expect((await draft(drafted({ promptBy: 'radar' }, { realCoverMiss: stale }))).realCoverMiss).toEqual(stale);
  });
  it('the search throws: the draft completes with a generated cover', async () => {
    H.find.mockRejectedValue(new Error('unexpected'));
    const a = await draft();
    expect(a.generated).toBe(true);
    expect(a.img.url).toBe('/api/files/biz/hero/1-illustration.png');
    expect('realCoverMiss' in a).toBe(false);
  });
  it('a miss less than a week old is not searched again; an older one, or one for another subject or site, is', async () => {
    const miss = (key: string, ageMs: number) => drafted({ promptBy: 'radar', prompt: COVER }, { realCoverMiss: { key, at: new Date(Date.now() - ageMs).toISOString() } });
    const fresh = await draft(miss(realCoverKey('Wasl 611', 'lived.test'), REAL_COVER_RETRY_MS - 60_000));
    expect(H.find).not.toHaveBeenCalled();
    expect(fresh.realCoverMiss!.key).toBe('wasl 611@lived.test'); // kept, with its own date
    await draft(miss(realCoverKey('Wasl 611', 'lived.test'), REAL_COVER_RETRY_MS + 60_000));
    expect(H.find).toHaveBeenCalledTimes(1);
    await draft(miss(realCoverKey('Wasl 61', 'lived.test'), 1000));
    await draft(miss(realCoverKey('Wasl 611', 'other.test'), 1000));
    await draft(drafted({ promptBy: 'radar', prompt: COVER }, { realCoverMiss: { key: 'wasl 611@lived.test', at: 'not a date' } })); // an unreadable date is not a fresh miss
    expect(H.find).toHaveBeenCalledTimes(4);
  });
});

describe('Radar does not look', () => {
  const noSearch = async (a0: Partial<Article> | null, p: Profile = profile) => { const a = await draft(a0, p); expect(H.find).not.toHaveBeenCalled(); expect(H.store).not.toHaveBeenCalled(); expect(a.img.real ?? null).toBeNull(); return a; };
  beforeEach(() => { H.find.mockResolvedValue({ picture: FOUND, searched: true }); }); // there is a picture to find in every case below
  it.each([
    ['a cover direction the owner typed', { prompt: 'Sobha Sapphire at sunset', promptBy: 'owner' as const }],
    ['a direction typed before authorship was recorded', { prompt: 'Sobha Sapphire at sunset' }],
    ['a cover that requires the image model', { promptBy: 'radar' as const, modelRequired: true }],
    ['a person switched back from a real picture', { promptBy: 'radar' as const, noReal: true as const }],
  ])('%s', async (_name, img) => {
    const a = await noSearch(drafted(img));
    expect(a.img.url).not.toBe(REAL_URL);
    expect('realCoverMiss' in a).toBe(false);
  });
  it.each(['organisation', 'other'])('the subject is of kind %s', async kind => {
    directions = async () => ({ json: answer('Wasl 611', kind) });
    const a = await noSearch(null);
    expect(a.imageDirections!.subject).toEqual({ name: 'Wasl 611', kind });
    expect(H.file).toHaveBeenCalledTimes(1);
  });
  it.each(['place', 'product'])('…but it does for kind %s', async kind => {
    directions = async () => ({ json: answer('Wasl 611', kind) });
    expect((await draft()).img.url).toBe(REAL_URL);
    expect(H.find).toHaveBeenCalledWith(expect.objectContaining({ subject: { name: 'Wasl 611', kind } }));
  });
  it('the article has no subject', async () => {
    directions = async () => ({ json: answer('', 'none') });
    await noSearch(null);
  });
  it('the article does not itself name the subject the model gave', async () => {
    directions = async () => ({ json: answer('Princess Tower', 'building') });
    const a = await noSearch(null);
    expect(a.imageDirections!.subject).toBeNull();
  });
  it('the direction step failed, so the directions are the built-in ones', async () => {
    directions = async () => { throw Object.assign(new Error('Radar couldn’t finish this. Try again.'), { code: 'ai_failed' }); };
    const a = await noSearch(null);
    expect(a.imageDirections).toMatchObject({ source: 'fallback', subject: null });
  });
  it('the business has no domain', async () => {
    await noSearch(null, { ...profile, domain: '' } as Profile);
  });
});

describe('rewriting an article whose cover is a real picture', () => {
  it.each(['radar', 'owner'] as const)('chosen by %s: it is kept, nothing is searched or generated, and Radar’s direction for a generated cover is kept current', async by => {
    H.find.mockResolvedValue({ picture: { ...FOUND, src: 'https://lived.test/another.jpg' }, searched: true });
    const before = drafted({ promptBy: 'radar', prompt: 'An older direction.', alt: 'Wasl 611', real: record(by) });
    const a = await draft(before);
    expect(H.find).not.toHaveBeenCalled(); expect(H.store).not.toHaveBeenCalled(); expect(H.file).not.toHaveBeenCalled();
    expect(a.img).toEqual({ ...before.img, prompt: COVER, promptBy: 'radar' });
    expect(realCoverOf(a.img)).toEqual(record(by));
    expect(a.imageDirections!.cover.prompt).toBe(COVER);
    expect(a.bodyImages).toHaveLength(2);
  });
  it('a direction the owner typed is kept with it', async () => {
    const a = await draft(drafted({ promptBy: 'owner', prompt: 'Sobha Sapphire at sunset', real: record('owner') }));
    expect(a.img).toMatchObject({ prompt: 'Sobha Sapphire at sunset', promptBy: 'owner', url: '/api/files/biz/hero/old.png', real: { by: 'owner' } });
    expect(H.file).not.toHaveBeenCalled();
  });
  it('it is kept under a required model, after a switch back was followed by a new picture, and with a miss on record', async () => {
    const a = await draft(drafted({ promptBy: 'radar', modelRequired: true, noReal: true, real: record('owner') }, { realCoverMiss: { key: 'wasl 611@lived.test', at: new Date().toISOString() } }));
    expect(realCoverOf(a.img)).toMatchObject({ by: 'owner' });
    expect(H.file).not.toHaveBeenCalled(); expect(H.find).not.toHaveBeenCalled();
    expect('realCoverMiss' in a).toBe(false);
  });
  it('the picture stays on screen when the first draft moves an old template style to illustration', async () => {
    // A person chose a picture before the article was ever drafted; the entry still had the template default.
    const start = { ...defaultArticle(entry).img, url: '/api/files/biz/hero/old.png', urlKey: 'branded:1', real: record('owner') };
    const a = await draft({ img: start });
    expect(a.img).toMatchObject({ style: 'illustration', url: '/api/files/biz/hero/old.png', urlKey: 'illustration:1', real: { by: 'owner' } });
    expect(H.file).not.toHaveBeenCalled();
  });
  it('a record that describes another file is not a real cover: the cover is treated as generated', async () => {
    // Older code replaced the cover and left the record behind.
    H.find.mockResolvedValue({ picture: FOUND, searched: true });
    const a = await draft(drafted({ promptBy: 'radar', prompt: COVER, real: record('radar', '/api/files/biz/hero/replaced-long-ago.png') }));
    expect(H.find).toHaveBeenCalledTimes(1);
    expect(a.img).toMatchObject({ url: REAL_URL, real: { url: REAL_URL } });
  });
});
