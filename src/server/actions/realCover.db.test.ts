// "Use a picture from your site", the switch back to a generated cover, autosave on a real cover, and publishing,
// against real Postgres: tenant scope, locks, active work, rate limits and JSON persistence are real. The fetch of the
// owner's address (pictureFromAddress) and the image model are replaced; storage is the local disk in a test folder,
// with a switch to make it fail. One draft runs end to end against the stub site.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => {
  process.env.RADAR_DEV_STUBS = '1'; process.env.STORAGE_DIR = '.data/real-cover-tests';
  return { picture: vi.fn(), render: vi.fn(), put: vi.fn(), jar: new Map<string, string>(), published: [] as any[] };
});
vi.mock('../services/images', () => {
  const file = async (req: any) => { const out = await M.render(req); return typeof out === 'string' ? { url: out, bytes: 1, type: 'image/png' } : out; };
  return { renderImage: async (req: any) => (await file(req)).url, renderImageFile: file, imageModelConfigured: () => true, defaultArticleImageStyle: () => 'branded', MODEL_STYLES: ['editorial', 'flat', 'render3d', 'handdrawn', 'photography', 'illustration'] };
});
vi.mock('../services/realCover', async original => ({ ...(await original<typeof import('../services/realCover')>()), pictureFromAddress: M.picture }));
vi.mock('../services/storage', async original => { const real = await original<typeof import('../services/storage')>(); M.put.mockImplementation(real.putObject); return { ...real, putObject: M.put }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => M.jar));
vi.mock('../services/publishing/connectors', () => ({ connectorFor: () => ({ createDraft: async (_c: any, payload: any) => { M.published.push(payload); return { id: 'test-remote' }; }, publish: async () => ({ url: 'https://harbour.test/post' }) }) }));

import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createCanvas } from '@napi-rs/canvas';
import { db, schema } from '../db';
import { Fixtures, clearLimits, uniq } from '../testing/fixtures';
import { getJob, jobDefs, type JobCtx } from '../jobs/queue';
import { actions } from './article';
import { POST as ACT } from '@/app/api/b/[bid]/act/route';
import { buildPayload, publishEntry } from '../services/publishing/publisher';
import { readStored, storedKey } from '../services/storage';
import { SitePictureError, findSubjectPicture, type FoundPicture } from '../services/realCover';
import { probeImage } from '../services/realCover/picture';
import { startDraft } from '../services/drafting/start';
import '../services/drafting/jobs';
import { defaultArticle } from '@/features/article/blocks';
import { realCoverOf } from '@/lib/articleImages';
import { entryFromRow } from '../workspace';
import type { Article, Profile, RealCover } from '@/lib/types';

const F = new Fixtures(); let seq = 0;
const png = (w: number, h: number) => { const c = createCanvas(w, h); const ctx = c.getContext('2d'); ctx.fillStyle = '#1f4d3a'; ctx.fillRect(0, 0, w, h); return c.toBuffer('image/png'); };
const COVER_PNG = png(1200, 628);
const body: Article['body'] = [['p', 'Harbour House is a short walk from the station.'], ['h2', 'Getting there'], ['p', 'Trains run every ten minutes.'], ['h2', 'What it costs'], ['p', 'Prices change with the season.']];
const TITLE = 'Living at Harbour House: what to expect';
const SUBJECT = { key: 'k', source: 'ai' as const, subject: { name: 'Harbour House', kind: 'building' as const }, cover: { prompt: 'A wide street-level view of Harbour House in daylight.', alt: 'Illustration of Harbour House' }, sections: [], at: '2026-11-01T00:00:00.000Z' };
async function fixture(o: { status?: string; img?: Partial<Article['img']>; article?: Partial<Article>; title?: string; generated?: boolean } = {}) {
  const user = await F.user(); const domain = `harbour-${uniq()}.test`;
  const profile: Profile = {
    domain, business: { name: 'Harbour Stays', description: 'Short lets by the water', offerings: ['Short lets'], industry: 'Hospitality', positioning: '', differentiators: ['Local hosts'] },
    audience: { segments: ['Travellers'], buyers: ['Guests'], needs: ['Find a place to stay'], competitors: [] }, keywords: { list: [] },
    brand: { logo: null, primary: '#123456', secondary: '#abcdef', voice: 'Clear', language: 'English', markets: [] },
  };
  const biz = await F.biz(user, { profile, domain });
  const id = `e_real_${F.tag}_${++seq}`;
  const [entry] = await db.insert(schema.calendarEntries).values({ id, businessId: biz.id, title: o.title || TITLE, kw: 'harbour house', type: 'Guide', date: '2026-11-20', status: o.status || 'review' }).returning();
  const a: Article = { ...defaultArticle(entryFromRow(entry)), generated: o.generated ?? true, body, brief: { angle: 'What a stay is like', outline: ['Getting there', 'What it costs'], words: 1400 }, seo: { title: 'Harbour House', meta: 'What to expect', slug: 'harbour-house' },
    img: { style: 'branded', seed: 1, prompt: 'A view of the harbour', promptBy: 'radar', alt: 'Cover alt', url: `/api/files/${biz.id}/hero/cover.png`, urlKey: 'branded:1', ...o.img }, ...o.article };
  await db.insert(schema.articles).values({ entryId: id, businessId: biz.id, data: a });
  const found: FoundPicture = { png: COVER_PNG, page: `https://${domain}/places/harbour-house`, src: `https://${domain}/media/harbour-house.png`, w: 1600, h: 900, fit: 'crop', alt: 'Harbour House · photo 1' };
  return { user, biz, domain, entry, a, id, found, ctx: { user, biz, bid: biz.id, role: 'Owner' } as any };
}
type Fx = Awaited<ReturnType<typeof fixture>>;
const article = async (id: string) => (await db.select().from(schema.articles).where(eq(schema.articles.entryId, id)))[0].data as Article;
const setArticle = (id: string, change: (a: Article) => Article) => article(id).then(a => db.update(schema.articles).set({ data: change(a) }).where(eq(schema.articles.entryId, id)));
const use = (f: Fx, url: string, ctx = f.ctx) => actions['article.useSitePicture'].run(ctx, actions['article.useSitePicture'].input!.parse({ entryId: f.id, url }));
/** A cover that is already a real picture, with its file on disk. */
async function withRealCover(f: Fx, by: 'radar' | 'owner' = 'owner') {
  M.picture.mockResolvedValueOnce(f.found);
  const out = await use(f, f.found.page!);
  if (by === 'radar') await setArticle(f.id, a => ({ ...a, img: { ...a.img, real: { ...a.img.real!, by: 'radar', subject: 'Harbour House' } } }));
  M.picture.mockClear();
  return out.url as string;
}
async function runDefined(id: string) {
  await db.update(schema.jobs).set({ status: 'running', lockedBy: 'real-cover-test', lockedAt: new Date() }).where(eq(schema.jobs.id, id));
  const job = (await getJob(id))!;
  const ctx: JobCtx = { job, payload: job.payload, businessId: job.businessId, attempt: job.attempts, progress: async () => {}, touch: async () => {} };
  try { const result = await jobDefs().get(job.kind)!.run(ctx); await db.update(schema.jobs).set({ status: 'done', result }).where(eq(schema.jobs.id, id)); return result; }
  catch (e) { await db.update(schema.jobs).set({ status: 'failed' }).where(eq(schema.jobs.id, id)); throw e; }
}
beforeEach(() => {
  M.picture.mockReset(); M.render.mockReset(); M.put.mockClear(); M.published = []; M.jar.clear();
  let n = 0; M.render.mockImplementation(async req => `/api/files/${req.bid}/${req.kind}/generated-${++n}.png`);
  vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(async () => {
  await clearLimits('sitepic:biz:');
  for (let attempt = 1; ; attempt++) {
    try { await F.cleanup(); break; }
    catch (e: any) { if (attempt >= 4 || (e?.cause?.code ?? e?.code) !== '40P01') throw e; await new Promise(r => setTimeout(r, 250 * attempt)); }
  }
  await fs.rm(path.join(process.cwd(), '.data/real-cover-tests'), { recursive: true, force: true });
});

describe('the action’s input', () => {
  const schema = actions['article.useSitePicture'].input!;
  it('needs an entry and an address, trims the address, and limits its length', () => {
    expect(schema.parse({ entryId: 'e', url: '  https://lived.ae/a.png  ' })).toEqual({ entryId: 'e', url: 'https://lived.ae/a.png' });
    expect(schema.safeParse({ entryId: 'e', url: '   ' }).error!.issues[0].message).toBe('Enter the address of a page or picture on your site.');
    expect(schema.safeParse({ entryId: 'e', url: 'x'.repeat(2001) }).success).toBe(false);
    expect(schema.safeParse({ entryId: '', url: 'https://lived.ae' }).success).toBe(false);
    expect(schema.safeParse({ entryId: 'e' }).success).toBe(false);
  });
  it('is a write for Editors and above, like the other media actions', () => {
    const def = actions['article.useSitePicture'];
    expect(def.read).toBeFalsy(); expect(def.role ?? 'Editor').toBe('Editor');
  });
});

describe.skipIf(!process.env.DATABASE_URL)('use a picture from your site (database)', () => {
  it('stores the picture under the business, makes it the cover and records where it came from', async () => {
    const f = await fixture({ article: { imageDirections: SUBJECT } });
    M.picture.mockResolvedValue(f.found);
    const out = await use(f, `  https://${f.domain}/places/harbour-house  `);
    expect(M.picture).toHaveBeenCalledWith({ domain: f.domain, address: `https://${f.domain}/places/harbour-house`, subject: 'Harbour House' });
    const saved = await article(f.id);
    expect(out).toEqual({ url: saved.img.url, page: f.found.page, src: f.found.src });
    // The file: a PNG in the business's hero folder, like a generated cover, readable only as this business's file.
    expect(saved.img.url).toMatch(new RegExp(`^/api/files/${f.biz.id}/hero/[\\w.-]+\\.png$`));
    expect(storedKey(f.biz.id, saved.img.url!)).not.toBeNull();
    const stored = await readStored(f.biz.id, saved.img.url!);
    expect(stored!.type).toBe('image/png'); expect(stored!.body.equals(COVER_PNG)).toBe(true);
    expect(M.put).toHaveBeenCalledTimes(1);
    // The record, and everything else about the cover as it was.
    expect(saved.img).toEqual({ ...f.a.img, url: saved.img.url, urlKey: 'branded:1', alt: 'Harbour House',
      real: { by: 'owner', url: saved.img.url, page: f.found.page, src: f.found.src, at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), w: 1600, h: 900, fit: 'crop' } });
    expect(realCoverOf(saved.img)).toMatchObject({ by: 'owner' });
    expect(saved.img.alt).not.toMatch(/^Illustration/);
    expect({ ...saved, img: f.a.img }).toEqual({ ...f.a, imageDirections: SUBJECT }); // nothing else on the article changed
    expect(M.render).not.toHaveBeenCalled();
  });
  it('the alt text: the article’s subject, else the picture’s own alt on the page, else the title; an alt a person wrote is kept', async () => {
    const noSubject = await fixture(); M.picture.mockResolvedValue(noSubject.found);
    await use(noSubject, noSubject.found.page!);
    expect(M.picture.mock.calls[0][0].subject).toBeNull();
    expect((await article(noSubject.id)).img.alt).toBe('Harbour House · photo 1');
    const bare = await fixture(); M.picture.mockResolvedValue({ ...bare.found, page: null, alt: ' x ' });
    await use(bare, bare.found.src);
    expect((await article(bare.id)).img).toMatchObject({ alt: TITLE, real: { page: null } });
    const mine = await fixture({ img: { alt: 'My own words', altBy: 'owner' }, article: { imageDirections: SUBJECT } }); M.picture.mockResolvedValue(mine.found);
    await use(mine, mine.found.page!);
    expect((await article(mine.id)).img).toMatchObject({ alt: 'My own words', altBy: 'owner', real: { by: 'owner' } });
  });
  it('works on an article that has not been drafted, and replaces one real picture with another', async () => {
    const f = await fixture({ generated: false, img: { url: null, urlKey: null } });
    M.picture.mockResolvedValue(f.found);
    const first = (await use(f, f.found.src)).url;
    M.picture.mockResolvedValue({ ...f.found, src: `https://${f.domain}/media/portrait.png`, page: null, w: 800, h: 1200, fit: 'backdrop' });
    const second = (await use(f, `/media/portrait.png`)).url;
    expect(second).not.toBe(first);
    expect((await article(f.id)).img.real).toMatchObject({ url: second, src: `https://${f.domain}/media/portrait.png`, fit: 'backdrop', w: 800, h: 1200 });
  });

  describe('refused before anything is fetched', () => {
    const untouched = async (f: Fx) => { expect(M.picture).not.toHaveBeenCalled(); expect(M.put).not.toHaveBeenCalled(); expect(await article(f.id)).toEqual(f.a); };
    it('a Viewer, at the route', async () => {
      const f = await fixture(); const viewer = await F.user(); await F.member(f.biz.id, viewer, 'Viewer'); await F.signIn(viewer, M.jar);
      const response = await ACT(new Request('http://t/act', { method: 'POST', body: JSON.stringify({ action: 'article.useSitePicture', input: { entryId: f.id, url: f.found.page } }) }), { params: Promise.resolve({ bid: f.biz.id }) });
      expect(response.status).toBe(403);
      await untouched(f);
    });
    it('someone who is not a member of the business, at the route', async () => {
      const f = await fixture(); const stranger = await F.user(); await F.signIn(stranger, M.jar);
      const response = await ACT(new Request('http://t/act', { method: 'POST', body: JSON.stringify({ action: 'article.useSitePicture', input: { entryId: f.id, url: f.found.page } }) }), { params: Promise.resolve({ bid: f.biz.id }) });
      expect([403, 404]).toContain(response.status);
      await untouched(f);
    });
    it('an Editor is allowed, through the route', async () => {
      const f = await fixture(); const editor = await F.user(); await F.member(f.biz.id, editor, 'Editor'); await F.signIn(editor, M.jar);
      M.picture.mockResolvedValue(f.found);
      const response = await ACT(new Request('http://t/act', { method: 'POST', headers: { 'x-radar-client': '1' }, body: JSON.stringify({ action: 'article.useSitePicture', input: { entryId: f.id, url: f.found.page }, reply: 'rev' }) }), { params: Promise.resolve({ bid: f.biz.id }) });
      expect(response.status).toBe(200);
      expect((await response.json()).data).toMatchObject({ page: f.found.page, src: f.found.src });
      expect(realCoverOf((await article(f.id)).img)).toMatchObject({ by: 'owner' });
    });
    it('another business’s article', async () => {
      const f = await fixture(); const other = await fixture();
      await expect(use(f, `https://${other.domain}/places/harbour-house`, other.ctx)).rejects.toMatchObject({ status: 404, code: 'not_found' });
      await untouched(f);
    });
    it.each(['scheduled', 'publishing', 'published'])('a %s article', async status => {
      const f = await fixture({ status });
      await expect(use(f, f.found.page!)).rejects.toMatchObject({ status: 409, code: 'article_locked' });
      await untouched(f);
    });
    it('an article whose publication failed with a draft left on the blog', async () => {
      const f = await fixture({ status: 'failed' });
      await db.update(schema.calendarEntries).set({ publishRemote: { id: 'remote-1' } as any }).where(eq(schema.calendarEntries.id, f.id));
      await expect(use(f, f.found.page!)).rejects.toMatchObject({ status: 409, code: 'publication_pending' });
      await untouched(f);
    });
    it.each(['article.draft', 'article.bodyImages'])('an article with a running %s job', async kind => {
      const f = await fixture();
      await db.insert(schema.jobs).values({ kind, payload: { entryId: f.id }, businessId: f.biz.id, ref: f.id, status: 'queued', maxAttempts: 1 });
      await expect(use(f, f.found.page!)).rejects.toMatchObject({ status: 409, code: 'article_busy' });
      await untouched(f);
    });
    it.each([
      ['https://example.org/a.png', 400, 'not_your_site', (d: string) => `That address isn’t on ${d}. Radar only uses pictures from your own site.`],
      ['https://DOMAIN.evil.com/a.png', 400, 'not_your_site', (d: string) => `That address isn’t on ${d}. Radar only uses pictures from your own site.`],
      ['https://notDOMAIN/a.png', 400, 'not_your_site', (d: string) => `That address isn’t on ${d}. Radar only uses pictures from your own site.`],
      ['https://127.0.0.1/a.png', 400, 'not_your_site', (d: string) => `That address isn’t on ${d}. Radar only uses pictures from your own site.`],
      ['https://DOMAIN@evil.com/a.png', 400, 'invalid_address', (d: string) => `Enter the address of a page or picture on ${d}.`],
      ['https://DOMAIN:8443/a.png', 400, 'invalid_address', (d: string) => `Enter the address of a page or picture on ${d}.`],
      ['file:///etc/passwd', 400, 'invalid_address', (d: string) => `Enter the address of a page or picture on ${d}.`],
      ['not an address', 400, 'invalid_address', (d: string) => `Enter the address of a page or picture on ${d}.`],
    ])('the address %s', async (address, status, code, message) => {
      const f = await fixture();
      const error = await use(f, address.replace('DOMAIN', f.domain)).catch(e => e);
      expect(error).toMatchObject({ status, code, userMessage: message(f.domain) });
      await untouched(f);
      // A refused address is not counted against the hourly limit either.
      expect((await db.execute(`SELECT count(*)::int AS n FROM rate_limits WHERE key LIKE 'sitepic:biz:${f.biz.id}%'`)).rows[0]).toEqual({ n: 0 });
    });
    it('the 31st attempt in an hour for one business, whoever makes it', async () => {
      const f = await fixture(); const editor = await F.user(); await F.member(f.biz.id, editor, 'Editor');
      M.picture.mockRejectedValue(new SitePictureError('unreachable'));
      for (let i = 0; i < 30; i++) await expect(use(f, f.found.page!, i % 2 ? { ...f.ctx, user: editor, role: 'Editor' } : f.ctx)).rejects.toMatchObject({ code: 'unreachable' });
      expect(M.picture).toHaveBeenCalledTimes(30);
      await expect(use(f, f.found.page!)).rejects.toMatchObject({ status: 429, code: 'rate_limited', userMessage: 'You’ve tried a lot of pictures in a short time. Try again in an hour.' });
      expect(M.picture).toHaveBeenCalledTimes(30);
      // Another business is not affected.
      const other = await fixture(); M.picture.mockResolvedValue(other.found);
      await expect(use(other, other.found.page!)).resolves.toMatchObject({ page: other.found.page });
    });
  });

  describe('what a person is told when the picture cannot be used', () => {
    it.each([
      ['left_site', undefined, 422, (d: string) => `That address redirects away from ${d}, so Radar didn’t follow it.`],
      ['unreachable', undefined, 422, () => 'Radar couldn’t reach that address. Check it and try again.'],
      ['no_picture', undefined, 422, () => 'Radar couldn’t find a picture it can use on that page. Try the address of the picture itself.'],
      ['off_site_picture', 'images.cdn-host.net', 422, (d: string) => `The pictures on that page are stored on another site (images.cdn-host.net). Radar only uses pictures from ${d}.`],
      ['too_large', undefined, 422, () => 'That picture is too large. Radar accepts pictures up to 8 MB and 25 megapixels.'],
      ['too_small', undefined, 422, () => 'That picture is too small for a cover. It needs to be at least 600 by 314 pixels.'],
      ['not_a_picture', undefined, 422, () => 'That address isn’t a picture Radar can use. Radar accepts JPEG, PNG and WebP.'],
      ['not_your_site', 'example.org', 400, (d: string) => `That address isn’t on ${d}. Radar only uses pictures from your own site.`],
      ['invalid_address', undefined, 400, (d: string) => `Enter the address of a page or picture on ${d}.`],
    ] as const)('%s', async (code, host, status, message) => {
      const f = await fixture();
      M.picture.mockRejectedValue(new SitePictureError(code, host));
      const error = await use(f, f.found.page!).catch(e => e);
      expect(error).toMatchObject({ status, code, userMessage: message(f.domain) });
      expect(error.userMessage).not.toMatch(/10\.|127\.|internal|private|DNS/i);
      expect(M.put).not.toHaveBeenCalled();
      expect(await article(f.id)).toEqual(f.a);
    });
    it('a fault of Radar’s own (the decoder could not run) is not dressed up as a bad picture: it surfaces as a fault, and the cover is unchanged', async () => {
      const f = await fixture(); const fault = new Error('The picture decoder could not run: spawn ENOENT');
      M.picture.mockRejectedValue(fault);
      const error = await use(f, f.found.page!).catch(e => e);
      expect(error).toBe(fault); expect(error.userMessage).toBeUndefined();
      expect(await article(f.id)).toEqual(f.a);
    });
    it('the picture could not be stored', async () => {
      const f = await fixture(); M.picture.mockResolvedValue(f.found);
      M.put.mockRejectedValueOnce(new Error('bucket unavailable: AccessDenied for key secret'));
      await expect(use(f, f.found.page!)).rejects.toMatchObject({ status: 502, code: 'image_failed', userMessage: 'Radar couldn’t save that picture. Your cover is unchanged. Try again.' });
      expect(await article(f.id)).toEqual(f.a);
    });
  });

  describe('the article changes while the picture is fetched', () => {
    it.each([
      ['another cover was stored', (a: Article): Article => ({ ...a, img: { ...a.img, url: '/api/files/x/hero/other.png' } })],
      ['a new variation was asked for', (a: Article): Article => ({ ...a, img: { ...a.img, seed: 2 } })],
      ['the style was changed', (a: Article): Article => ({ ...a, img: { ...a.img, style: 'illustration' } })],
    ])('%s: the action fails and the newer cover stays', async (_name, change) => {
      const f = await fixture();
      M.picture.mockImplementation(async () => { await setArticle(f.id, change); return f.found; });
      await expect(use(f, f.found.page!)).rejects.toMatchObject({ status: 409, code: 'article_changed', userMessage: 'The cover changed while Radar was fetching the picture. Try again.' });
      expect(await article(f.id)).toEqual(change(f.a));
    });
    it('a direction, an alt and other fields typed meanwhile are kept, and are not a conflict', async () => {
      const f = await fixture();
      M.picture.mockImplementation(async () => { await setArticle(f.id, a => ({ ...a, img: { ...a.img, prompt: 'A lighthouse at dusk', promptBy: 'owner', alt: 'Typed meanwhile', altBy: 'owner' }, seo: { ...a.seo, meta: 'Edited meanwhile' } })); return f.found; });
      await expect(use(f, f.found.page!)).resolves.toMatchObject({ page: f.found.page });
      const saved = await article(f.id);
      expect(saved.img).toMatchObject({ prompt: 'A lighthouse at dusk', promptBy: 'owner', alt: 'Typed meanwhile', altBy: 'owner', real: { by: 'owner' } });
      expect(saved.seo.meta).toBe('Edited meanwhile');
    });
    it('it was queued for publishing: checked again under the row lock, and the queued cover stays', async () => {
      const f = await fixture();
      M.picture.mockImplementation(async () => { await db.update(schema.calendarEntries).set({ status: 'scheduled' }).where(eq(schema.calendarEntries.id, f.id)); return f.found; });
      await expect(use(f, f.found.page!)).rejects.toMatchObject({ code: 'article_locked' });
      expect(await article(f.id)).toEqual(f.a);
    });
    it('a rewrite started: checked again under the row lock', async () => {
      const f = await fixture();
      M.picture.mockImplementation(async () => { await startDraft(f.biz.id, f.id, 'user'); return f.found; });
      await expect(use(f, f.found.page!)).rejects.toMatchObject({ code: 'article_busy' });
      expect(await article(f.id)).toEqual(f.a);
    });
  });
});

describe.skipIf(!process.env.DATABASE_URL)('autosave on a real cover (database)', () => {
  it('cannot set the record, the switch-back mark or the remembered miss', async () => {
    const forged = { real: { by: 'owner', url: 'https://evil.example/x.png', page: null, src: 'https://evil.example/x.png', at: 'x', w: 1, h: 1, fit: 'crop' }, noReal: true, url: 'https://evil.example/x.png', urlKey: 'branded:1' };
    const parsed = actions['article.save'].input!.parse({ entryId: 'e', patch: { img: { alt: 'ok', ...forged }, realCoverMiss: { key: 'k', at: 'x' } } }) as any;
    expect(parsed.patch).toEqual({ img: { alt: 'ok' } });
    const f = await fixture();
    await actions['article.save'].run(f.ctx, actions['article.save'].input!.parse({ entryId: f.id, patch: { img: { alt: 'New alt', ...forged }, realCoverMiss: { key: 'k', at: 'x' } } }));
    expect(await article(f.id)).toEqual({ ...f.a, img: { ...f.a.img, alt: 'New alt', altBy: 'owner' } });
  });
  it('a style change makes no render: the picture stays, under the new style', async () => {
    const f = await fixture(); const url = await withRealCover(f);
    const before = await article(f.id);
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { img: { style: 'illustration' } } });
    const saved = await article(f.id);
    expect(M.render).not.toHaveBeenCalled();
    expect(saved.img).toEqual({ ...before.img, style: 'illustration', urlKey: 'illustration:1' });
    expect(saved.img.urlKey).toBe(`${saved.img.style}:${saved.img.seed}`); // what the editor checks before showing a stored cover
    expect(realCoverOf(saved.img)).toMatchObject({ url, by: 'owner' });
    // An older client sends style, direction and alt together on every image edit: still no render, still the picture.
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { img: { style: 'photography', prompt: saved.img.prompt, alt: saved.img.alt } } });
    expect(M.render).not.toHaveBeenCalled();
    expect((await article(f.id)).img).toMatchObject({ style: 'photography', urlKey: 'photography:1', url, real: { url } });
  });
  it('a direction and an alt typed on a real cover are saved as the owner’s, and the picture stays', async () => {
    const f = await fixture(); const url = await withRealCover(f);
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { img: { prompt: 'A lighthouse at dusk', alt: 'The harbour front' } } });
    expect((await article(f.id)).img).toMatchObject({ prompt: 'A lighthouse at dusk', promptBy: 'owner', alt: 'The harbour front', altBy: 'owner', url, real: { url } });
    expect(M.render).not.toHaveBeenCalled();
  });
  it('a record that describes another file is ignored: the cover is restyled like any generated cover, and the record goes', async () => {
    const stale: RealCover = { by: 'owner', url: '/api/files/x/hero/replaced-long-ago.png', page: null, src: 'https://harbour.test/old.png', at: '2026-11-01T00:00:00.000Z', w: 1600, h: 900, fit: 'crop' };
    const f = await fixture({ img: { real: stale } });
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { img: { style: 'illustration' } } });
    expect(M.render).toHaveBeenCalledTimes(1);
    const saved = await article(f.id);
    expect(saved.img).toMatchObject({ style: 'illustration', url: `/api/files/${f.biz.id}/hero/generated-1.png`, urlKey: 'illustration:1' });
    expect('real' in saved.img).toBe(false);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('use a generated cover instead (database)', () => {
  it('Branded graphic selected: the template replaces the picture, the record goes, and Radar will not put the picture back', async () => {
    const f = await fixture({ article: { imageDirections: SUBJECT } }); await withRealCover(f);
    const out = await actions['article.regenerateImage'].run(f.ctx, { entryId: f.id });
    expect(M.render).toHaveBeenCalledTimes(1);
    expect(M.render.mock.calls[0][0]).toMatchObject({ kind: 'hero', style: 'branded', modelRequired: false, seed: 2 });
    const saved = await article(f.id);
    expect(out).toEqual({ url: saved.img.url, seed: 2 });
    expect(saved.img).toEqual({ ...f.a.img, seed: 2, url: `/api/files/${f.biz.id}/hero/generated-1.png`, urlKey: 'branded:2', alt: `Illustration for ${TITLE}`, noReal: true });
    expect(realCoverOf(saved.img)).toBeNull(); expect('real' in saved.img).toBe(false);
  });
  it('a model style: a contextual cover is generated strictly, with its own alt', async () => {
    const f = await fixture({ img: { style: 'illustration', urlKey: 'illustration:1' } }); await withRealCover(f, 'radar');
    await actions['article.regenerateImage'].run(f.ctx, { entryId: f.id });
    expect(M.render.mock.calls[0][0]).toMatchObject({ style: 'illustration', modelRequired: true, literal: true });
    const saved = await article(f.id);
    expect(saved.img).toMatchObject({ url: `/api/files/${f.biz.id}/hero/generated-1.png`, promptBy: 'radar', noReal: true, alt: saved.imageDirections!.cover.alt });
    expect(saved.img.alt).toMatch(/^Illustration of /);
    expect(saved.img.prompt).toBe(saved.imageDirections!.cover.prompt);
    expect('real' in saved.img).toBe(false);
  });
  it('a model style that cannot generate: the existing error, and the picture is kept exactly', async () => {
    const f = await fixture({ img: { style: 'illustration', urlKey: 'illustration:1' } }); await withRealCover(f);
    const before = await article(f.id);
    M.render.mockRejectedValue(new Error('provider 503'));
    await expect(actions['article.regenerateImage'].run(f.ctx, { entryId: f.id })).rejects.toMatchObject({ status: 502, code: 'image_failed', userMessage: 'Radar couldn’t generate this image. Your previous cover is kept. Try again.' });
    expect(M.render.mock.calls[0][0]).toMatchObject({ modelRequired: true });
    expect(await article(f.id)).toEqual(before);
    expect(realCoverOf((await article(f.id)).img)).not.toBeNull();
  });
  it('the owner’s own direction is used as written, and an alt they wrote is kept', async () => {
    const f = await fixture({ img: { prompt: 'A lighthouse at dusk', promptBy: 'owner', alt: 'The harbour front', altBy: 'owner' } }); await withRealCover(f);
    await actions['article.regenerateImage'].run(f.ctx, { entryId: f.id, prompt: 'A lighthouse at dusk' });
    expect(M.render.mock.calls[0][0]).toMatchObject({ prompt: 'A lighthouse at dusk', literal: false, modelRequired: true });
    expect((await article(f.id)).img).toMatchObject({ prompt: 'A lighthouse at dusk', promptBy: 'owner', alt: 'The harbour front', altBy: 'owner', noReal: true });
  });
  it('on a generated cover it is Regenerate as before: no mark is set, even with a stale record on the article', async () => {
    const stale: RealCover = { by: 'radar', url: '/api/files/x/hero/replaced-long-ago.png', page: null, src: 'https://harbour.test/old.png', at: '2026-11-01T00:00:00.000Z', w: 1600, h: 900, fit: 'crop' };
    const plain = await fixture(); const leftover = await fixture({ img: { real: stale } });
    for (const f of [plain, leftover]) {
      await actions['article.regenerateImage'].run(f.ctx, { entryId: f.id });
      const saved = await article(f.id);
      expect('noReal' in saved.img).toBe(false); expect('real' in saved.img).toBe(false);
      expect(saved.img.alt).toBe('Cover alt'); // the alt of a generated cover is not reset by a plain Regenerate
    }
  });
  it('after the switch back, a picture a person chooses again is a real cover again', async () => {
    const f = await fixture(); await withRealCover(f);
    await actions['article.regenerateImage'].run(f.ctx, { entryId: f.id });
    M.picture.mockResolvedValue(f.found);
    await use(f, f.found.page!);
    expect(realCoverOf((await article(f.id)).img)).toMatchObject({ by: 'owner' });
  });
});

describe.skipIf(!process.env.DATABASE_URL)('publishing an article with a real cover (database)', () => {
  it('the payload carries the stored picture, its bytes as a PNG, and the new alt', async () => {
    const f = await fixture({ article: { imageDirections: SUBJECT } }); const url = await withRealCover(f);
    const saved = await article(f.id);
    const payload = await buildPayload(f.biz, entryFromRow(f.entry), saved);
    expect(payload.image!.url.endsWith(url)).toBe(true); expect(payload.image!.url).toMatch(/^https?:\/\//);
    expect(payload.image!.alt).toBe('Harbour House');
    const bytes = await payload.image!.bytes();
    expect(bytes.type).toBe('image/png'); expect(bytes.name).toBe('harbour-house.png');
    expect(probeImage(bytes.buf)).toEqual({ type: 'image/png', width: 1200, height: 628, complete: true });
    expect(M.render).not.toHaveBeenCalled(); // a real cover is never drawn late
    expect(await article(f.id)).toEqual(saved);
  });
  it('it publishes through the same path as a generated cover', async () => {
    const f = await fixture(); const url = await withRealCover(f);
    await db.insert(schema.connections).values({ businessId: f.biz.id, type: 'wordpress', url: 'https://harbour.test', fields: {} });
    await db.update(schema.calendarEntries).set({ status: 'scheduled' }).where(eq(schema.calendarEntries.id, f.id));
    expect(await publishEntry(f.id, { attempt: 1, maxAttempts: 1 })).toMatchObject({ status: 'published' });
    expect(M.published).toHaveLength(1);
    expect(M.published[0].image.url.endsWith(url)).toBe(true);
    expect(M.published[0].image.alt).toBe('Harbour House · photo 1');
    expect(realCoverOf((await article(f.id)).img)).toMatchObject({ url }); // the record survives publishing
    // And a published article is locked for this action like any other.
    await expect(use(f, f.found.page!)).rejects.toMatchObject({ code: 'article_locked' });
  });
  it('an article saved before this change loads, saves and builds the same payload, with none of the new fields appearing', async () => {
    const f = await fixture(); const e = entryFromRow(f.entry);
    expect((await actions['article.get'].run(f.ctx, { entryId: f.id })).article).toEqual(f.a);
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { seo: { meta: 'Edited description' } } });
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { img: { style: f.a.img.style, prompt: f.a.img.prompt, alt: f.a.img.alt } } });
    const saved = await article(f.id);
    expect(saved).toEqual({ ...f.a, seo: { ...f.a.seo, meta: 'Edited description' } });
    for (const key of ['real', 'noReal']) expect(key in saved.img, key).toBe(false);
    expect('realCoverMiss' in saved).toBe(false);
    const payload = await buildPayload(f.biz, e, saved);
    expect(payload.image).toMatchObject({ alt: 'Cover alt' }); expect(payload.image!.url).toContain('/hero/cover.png');
    // The new fields change nothing in the payload: a record for another file, the switch-back mark, a remembered miss.
    const withNew = await buildPayload(f.biz, e, { ...saved, img: { ...saved.img, noReal: true, real: { by: 'radar', url: '/api/files/x/hero/else.png', page: null, src: 'https://harbour.test/x.png', at: 'x', w: 1, h: 1, fit: 'crop' } }, realCoverMiss: { key: 'k', at: 'x' } });
    const comparable = ({ image, ...rest }: any) => ({ ...rest, image: { url: image.url, alt: image.alt } });
    expect(comparable(withNew)).toEqual(comparable(payload));
    expect(M.render).not.toHaveBeenCalled();
  });
});

describe.skipIf(!process.env.DATABASE_URL)('a draft against the stub site, end to end (database)', () => {
  it('an article about Harbour House gets its picture from the business’s own site as the cover; a rewrite keeps it; after a switch back it does not return', async () => {
    const f = await fixture({ generated: false, img: { url: null, urlKey: null, prompt: 'Calm, editorial image about harbour house' } });
    await db.update(schema.articles).set({ data: { ...f.a, img: { ...f.a.img, promptBy: undefined } as any } }).where(eq(schema.articles.entryId, f.id));
    await runDefined(await startDraft(f.biz.id, f.id, 'user'));
    let saved = await article(f.id);
    expect(saved.generated).toBe(true);
    expect(saved.imageDirections!.subject).toEqual({ name: 'Harbour House', kind: 'building' });
    expect(saved.img.real).toEqual({ by: 'radar', url: saved.img.url, page: `https://${f.domain}/places/harbour-house`, src: `https://${f.domain}/media/harbour-house.png`, at: expect.any(String), w: 1600, h: 900, fit: 'crop', subject: 'Harbour House' });
    expect(saved.img).toMatchObject({ alt: 'Harbour House', urlKey: `${saved.img.style}:${saved.img.seed}`, promptBy: 'radar' });
    expect('realCoverMiss' in saved).toBe(false);
    expect(storedKey(f.biz.id, saved.img.url!)).not.toBeNull();
    expect(probeImage((await readStored(f.biz.id, saved.img.url!))!.body)).toEqual({ type: 'image/png', width: 1200, height: 628, complete: true });
    expect(M.render.mock.calls.filter(c => c[0].kind === 'hero')).toEqual([]); // no cover was generated
    const url = saved.img.url;

    await runDefined(await startDraft(f.biz.id, f.id, 'user')); // Rewrite from brief
    saved = await article(f.id);
    expect(saved.img.url).toBe(url); expect(realCoverOf(saved.img)).toMatchObject({ by: 'radar' });
    expect(M.put).toHaveBeenCalledTimes(1); // nothing new was stored

    await actions['article.regenerateImage'].run(f.ctx, { entryId: f.id }); // Use a generated cover instead
    await runDefined(await startDraft(f.biz.id, f.id, 'user'));
    saved = await article(f.id);
    expect(realCoverOf(saved.img)).toBeNull(); expect(saved.img.noReal).toBe(true);
    expect(saved.img.url).not.toBe(url);
    expect(M.put).toHaveBeenCalledTimes(1);
  }, 60_000);
  it('an article about Mill Lane Studios, whose page has no picture of its own, gets a generated cover and the miss is remembered', async () => {
    const f = await fixture({ generated: false, title: 'Is Mill Lane Studios right for you?', img: { url: null, urlKey: null } });
    expect(await findSubjectPicture({ bid: f.biz.id, domain: f.domain, subject: { name: 'Mill Lane Studios', kind: 'building' } })).toEqual({ picture: null, searched: true });
    await runDefined(await startDraft(f.biz.id, f.id, 'user'));
    const saved = await article(f.id);
    expect(saved.img.real).toBeUndefined();
    expect(saved.img.url).toContain('/hero/generated-');
    expect(saved.realCoverMiss).toEqual({ key: `mill lane studios@${f.domain}`, at: expect.any(String) });
    expect(M.put).not.toHaveBeenCalled();
  }, 60_000);
});
