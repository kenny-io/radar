// Integration coverage: real Postgres locks, JSON persistence and queue state; only image rendering is replaced.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => {
  process.env.RADAR_DEV_STUBS = '1';
  return { render: vi.fn(), jar: new Map<string, string>(), published: [] as any[], directions: [] as string[] };
});
// M.render answers every image request: a URL, or a whole file result when a test needs the placeholder mark.
vi.mock('../images', () => {
  const file = async (req: any) => { const out = await M.render(req); return typeof out === 'string' ? { url: out, bytes: 1, type: 'image/png' } : out; };
  return { renderImage: async (req: any) => (await file(req)).url, renderImageFile: file, defaultArticleImageStyle: () => 'branded', MODEL_STYLES: ['editorial', 'flat', 'render3d', 'handdrawn', 'photography', 'illustration'] };
});
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => M.jar));
vi.mock('../publishing/connectors', () => ({ connectorFor: () => ({ createDraft: async (_c: any, payload: any) => { M.published.push(payload); return { id: 'test-remote' }; }, publish: async () => ({ url: 'https://fieldnote.test/post' }) }) }));

import { eq } from 'drizzle-orm';
import { db, pool, schema } from '@/server/db';
import { Fixtures } from '@/server/testing/fixtures';
import { getJob, jobDefs, runJobNow, type JobCtx } from '@/server/jobs/queue';
import { actions } from '@/server/actions/article';
import { actions as publishActions } from '@/server/actions/publishing';
import { POST as ACT } from '@/app/api/b/[bid]/act/route';
import { buildPayload, publishEntry } from '../publishing/publisher';
import { defaultArticle } from '@/features/article/blocks';
import { entryFromRow } from '@/server/workspace';
import type { Article, ArticleBodyImage, Profile } from '@/lib/types';
import { RadarError } from '@/server/errors';
import { startBodyImages } from './bodyImages';
import { startDraft } from './start';
import './jobs';
import { registerStub } from '@/server/ai/adapters/stub';
import { directionsKey } from './imageDirections';

// Count the direction step: the dev stub answers it (RADAR_DEV_STUBS), through the real ai.run.
const stubbedDirections = ((globalThis as any).__radarStubs as Map<string, (input: any, ctx: any) => any>).get('article.imageDirections')!;
registerStub('article.imageDirections', (input, ctx) => { M.directions.push(ctx.title); return stubbedDirections(input, ctx); });

const F = new Fixtures();
const profile: Profile = {
  domain: 'fieldnote.test', business: { name: 'Fieldnote', description: 'Documentation tools', offerings: ['Docs'], industry: 'Software', positioning: '', differentiators: ['Keeps docs current'] },
  audience: { segments: ['Developers'], buyers: ['Team leads'], needs: ['Keep docs current'], competitors: [] }, keywords: { list: [] },
  brand: { logo: null, primary: '#123456', secondary: '#abcdef', voice: 'Clear', language: 'English', markets: [] },
};
let seq = 0;
const body: Article['body'] = [['p', 'Intro'], ['h2', 'Measure drift'], ['p', 'Compare docs and code.'], ['h2', 'Review changes'], ['p', 'Review with the pull request.'], ['h2', 'Ship safely'], ['p', 'Publish checked docs.']];
const oldImage = (bid: string): ArticleBodyImage => ({ id: 'old', after: { heading: 'measure drift', occurrence: 0, block: 1 }, url: `/api/files/${bid}/article-body/old.png`, alt: 'Old illustration', prompt: '', seed: 1 });
async function fixture(o: { status?: string; generated?: boolean; words?: 900 | 1400 | 2200; legacy?: boolean; img?: Partial<Article['img']> } = {}) {
  const user = await F.user(); const biz = await F.biz(user, { profile, domain: profile.domain });
  const id = `e_images_${F.tag}_${++seq}`;
  const [entry] = await db.insert(schema.calendarEntries).values({ id, businessId: biz.id, title: 'Keep docs current', kw: 'docs updates', type: 'Guide', date: '2026-10-29', status: o.status || 'review' }).returning();
  const a: Article = { ...defaultArticle(entryFromRow(entry)), generated: o.generated ?? true, body, brief: { angle: 'Stay current', outline: ['Measure drift', 'Review changes', 'Ship safely'], words: o.words || 1400 }, seo: { title: 'Custom SEO', meta: 'Keep my description', slug: 'custom-slug' }, img: { style: 'branded', seed: 1, prompt: 'Custom cover', alt: 'Cover alt', url: `/api/files/${biz.id}/hero/cover.png`, urlKey: 'branded:1', ...o.img }, sources: [{ title: 'Source', url: 'https://example.org/source', use: 'Context' }], ...(o.legacy ? {} : { bodyImages: [oldImage(biz.id)], bodyImagesGeneratedAt: '2026-10-01T00:00:00.000Z' }) };
  await db.insert(schema.articles).values({ entryId: id, businessId: biz.id, data: a });
  return { user, biz, entry, a, id, ctx: { user, biz, bid: biz.id, role: 'Owner' } as any };
}
const article = async (id: string) => (await db.select().from(schema.articles).where(eq(schema.articles.entryId, id)))[0].data as Article;
const entry = async (id: string) => (await db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.id, id)))[0];
async function runDefined(id: string) {
  // Own the attempt just as the real queue worker does, so an unrelated dev worker cannot claim it mid-test.
  await db.update(schema.jobs).set({ status: 'running', lockedBy: 'body-image-test', lockedAt: new Date() }).where(eq(schema.jobs.id, id));
  const job = (await getJob(id))!;
  const ctx: JobCtx = { job, payload: job.payload, businessId: job.businessId, attempt: job.attempts, progress: async progress => { await db.update(schema.jobs).set({ progress }).where(eq(schema.jobs.id, id)); }, touch: async () => {} };
  try {
    const result = await jobDefs().get(job.kind)!.run(ctx);
    await db.update(schema.jobs).set({ status: 'done', result }).where(eq(schema.jobs.id, id));
    return result;
  } catch (e) {
    await db.update(schema.jobs).set({ status: 'failed' }).where(eq(schema.jobs.id, id));
    throw e;
  }
}
beforeEach(() => {
  M.render.mockReset();
  M.published = []; M.directions = [];
  let render = 0;
  M.render.mockImplementation(async req => `/api/files/${req.bid}/${req.kind}/${++render}.png`);
});
// Another test file's lifecycle cron can be queuing mail for these users while they are deleted, and Postgres then ends
// one side as a deadlock victim. The deletes are by id and safe to repeat, so the cleanup is tried again instead of
// leaving this file's users behind for every later run.
afterAll(async () => {
  for (let attempt = 1; ; attempt++) {
    try { return await F.cleanup(); }
    catch (e: any) { if (attempt >= 4 || (e?.cause?.code ?? e?.code) !== '40P01') throw e; await new Promise(r => setTimeout(r, 250 * attempt)); }
  }
});

describe.skipIf(!process.env.DATABASE_URL)('article body images (database)', () => {
  it('repairs a legacy article, reloads the complete image set, and preserves all other fields', async () => {
    const f = await fixture({ legacy: true });
    const id = await startBodyImages(f.biz.id, f.id);
    expect(await startBodyImages(f.biz.id, f.id)).toBe(id);
    const result = await runDefined(id);
    const saved = await article(f.id);
    expect(saved.bodyImages).toHaveLength(2);
    expect(saved.bodyImagesGeneratedAt).toBe(result.bodyImagesGeneratedAt);
    const { bodyImages, bodyImagesGeneratedAt, imageDirections, ...unchanged } = saved;
    expect(unchanged).toEqual(f.a);
    expect((await getJob(id))!.progress).toEqual({ stage: 'images', completed: 2, total: 2 });
    expect((await entry(f.id)).status).toBe('review');
  });
  it('the body-image job on an older article reads its text once: section-specific pictures, directions cached for the next run', async () => {
    const f = await fixture({ legacy: true });
    await runDefined(await startBodyImages(f.biz.id, f.id));
    const saved = await article(f.id);
    expect(M.directions).toEqual(['Keep docs current']);
    expect(saved.imageDirections).toMatchObject({ source: 'ai', key: directionsKey('Keep docs current', body, 1400), subject: null });
    expect(saved.imageDirections!.sections).toHaveLength(2);
    // Each stored image carries its own section's direction and alt; no two are the same, and none is the old generic prompt.
    expect(saved.bodyImages!.map(i => ({ prompt: i.prompt, alt: i.alt }))).toEqual(saved.imageDirections!.sections);
    expect(saved.bodyImages![0].prompt).toContain('Measure drift'); expect(saved.bodyImages![1].prompt).toContain('Ship safely');
    expect(saved.bodyImages![0].prompt).not.toBe(saved.bodyImages![1].prompt);
    const requests = M.render.mock.calls.map(c => c[0]);
    expect(requests).toHaveLength(2);
    for (const [i, r] of requests.entries()) {
      expect(r).toMatchObject({ kind: 'article-body', modelRequired: true, literal: true, style: 'branded' });
      // The cover direction on this older article was typed by a person, so it still guides the body images.
      expect(r.prompt).toBe(`${saved.imageDirections!.sections[i].prompt} Overall look the owner asked for: Custom cover`);
    }
    // The job never changes the cover.
    expect(saved.img).toEqual(f.a.img);
    // A second run costs no text call.
    await runDefined(await startBodyImages(f.biz.id, f.id));
    expect(M.directions).toHaveLength(1);
    expect((await article(f.id)).imageDirections).toEqual(saved.imageDirections);
    // An edit to the text makes them stale: the next run reads the article again.
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { body: [...body, ['p', 'A new closing paragraph.']] } });
    await runDefined(await startBodyImages(f.biz.id, f.id));
    expect(M.directions).toHaveLength(2);
  });
  it('a body-image job that succeeds clears the note that a draft had to leave them out', async () => {
    const f = await fixture({ legacy: true });
    await db.update(schema.articles).set({ data: { ...f.a, bodyImages: [], bodyImagesIssue: { reason: 'unavailable', at: '2026-11-01T00:00:00.000Z' } } }).where(eq(schema.articles.entryId, f.id));
    await runDefined(await startBodyImages(f.biz.id, f.id));
    const saved = await article(f.id);
    expect(saved.bodyImages).toHaveLength(2);
    expect('bodyImagesIssue' in saved).toBe(false);
  });
  it('a body-image job that fails keeps the note and the empty set, and makes no partial write', async () => {
    const f = await fixture({ legacy: true });
    const before = { ...f.a, bodyImages: [], bodyImagesIssue: { reason: 'unavailable' as const, at: '2026-11-01T00:00:00.000Z' } };
    await db.update(schema.articles).set({ data: before }).where(eq(schema.articles.entryId, f.id));
    M.render.mockRejectedValue(Object.assign(new Error('Image generation is unavailable right now.'), { code: 'image_unavailable' }));
    await expect(runDefined(await startBodyImages(f.biz.id, f.id))).rejects.toMatchObject({ code: 'image_unavailable' });
    expect(await article(f.id)).toEqual(before);
  });
  it('new drafts and long rewrites get a body image for every planned section', async () => {
    for (const words of [900, 2200] as const) {
      const f = await fixture({ generated: false, words });
      const id = await startDraft(f.biz.id, f.id, 'user');
      expect((await entry(f.id)).status).toBe('drafting');
      await expect(actions['article.save'].run(f.ctx, { entryId: f.id, patch: { body: [['p', 'Other tab']] } })).rejects.toMatchObject({ code: 'article_busy' });
      await runDefined(id);
      const saved = await article(f.id);
      expect(saved.generated).toBe(true);
      expect(saved.bodyImages).toHaveLength(words === 2200 ? 3 : 2);
      expect(saved.bodyImagesIssue).toBeUndefined();
      expect(saved.imageDirections!.sections.map(s => s.prompt)).toEqual(saved.bodyImages!.map(i => i.prompt));
      expect(M.render.mock.calls.filter(c => c[0].kind === 'article-body').every(c => c[0].modelRequired === true && c[0].literal === true)).toBe(true);
      expect(saved.draftedAt).toBeTruthy();
      expect((await entry(f.id)).status).toBe('review');
    }
  }, 15_000);
  it('a draft whose body images cannot be stored still completes: no body images, the reason recorded, ready for review', async () => {
    const f = await fixture();
    M.render.mockRejectedValue(new Error('storage unavailable'));
    const id = await startDraft(f.biz.id, f.id, 'user');
    await db.update(schema.jobs).set({ attempts: 1, maxAttempts: 1 }).where(eq(schema.jobs.id, id));
    await runJobNow(id);
    expect((await getJob(id))!.status).toBe('done');
    expect((await entry(f.id)).status).toBe('review');
    const saved = await article(f.id);
    expect(saved.generated).toBe(true);
    expect(saved.body).not.toEqual(f.a.body); expect(saved.body.length).toBeGreaterThan(3);
    expect(saved.bodyImages).toEqual([]);
    expect(saved.bodyImagesIssue).toEqual({ reason: 'failed', at: saved.bodyImagesGeneratedAt });
    // The cover the owner already had is untouched, and no template was written anywhere.
    expect(saved.img).toEqual({ ...f.a.img, promptBy: 'owner' });
    expect(M.render.mock.calls.every(c => c[0].kind === 'article-body' && c[0].modelRequired === true)).toBe(true);
  }, 15_000);
  it('a stub-mode draft (no image model) completes with no body images and says image generation is unavailable', async () => {
    const f = await fixture({ generated: false, img: { prompt: 'Calm, editorial image about docs updates', url: null, urlKey: null } });
    // What the real image service does without a model: a strict request is refused, a cover falls back to the template.
    M.render.mockImplementation(async req => {
      if (req.modelRequired) throw Object.assign(new Error('Image generation is unavailable right now. Please contact support to enable it.'), { code: 'image_unavailable', status: 503 });
      return `/api/files/${req.bid}/${req.kind}/template.png`;
    });
    await runDefined(await startDraft(f.biz.id, f.id, 'user'));
    const saved = await article(f.id);
    expect((await entry(f.id)).status).toBe('review');
    expect(saved.bodyImages).toEqual([]);
    expect(saved.bodyImagesIssue).toMatchObject({ reason: 'unavailable' });
    // The default style offline is the branded title card, which is the owner's style and not a placeholder.
    expect(saved.img).toMatchObject({ style: 'branded', url: `/api/files/${f.biz.id}/hero/template.png`, urlKey: 'branded:1', promptBy: 'radar', prompt: saved.imageDirections!.cover.prompt });
    expect('placeholder' in saved.img).toBe(false);
  }, 15_000);
  it('rewriting an article never downgrades a missing custom cover to a template on generation failure', async () => {
    const f = await fixture();
    const custom = { ...f.a, img: { ...f.a.img, prompt: 'Sobha Sapphire at sunset', modelRequired: true, url: null, urlKey: null } };
    await db.update(schema.articles).set({ data: custom }).where(eq(schema.articles.entryId, f.id));
    M.render.mockRejectedValue(new Error('custom generation unavailable'));
    const id = await startDraft(f.biz.id, f.id, 'user');
    await db.update(schema.jobs).set({ attempts: 1, maxAttempts: 1 }).where(eq(schema.jobs.id, id));
    await runJobNow(id);
    expect(M.render.mock.calls[0][0]).toMatchObject({ kind: 'hero', modelRequired: true, prompt: 'Sobha Sapphire at sunset' });
    expect((await getJob(id))!.status).toBe('failed');
    expect(await article(f.id)).toEqual(custom);
  });
  it('one failed storage operation fails the queue job and keeps the previous images and content', async () => {
    const f = await fixture();
    M.render.mockResolvedValueOnce(`/api/files/${f.biz.id}/article-body/first.png`).mockRejectedValueOnce(new Error('storage unavailable'));
    const id = await startBodyImages(f.biz.id, f.id);
    await db.update(schema.jobs).set({ attempts: 1, maxAttempts: 1 }).where(eq(schema.jobs.id, id));
    await runJobNow(id);
    expect((await getJob(id))!.status).toBe('failed');
    expect(await article(f.id)).toEqual(f.a);
  });
  it('detects body edits while rendering and leaves old images intact for retry', async () => {
    const f = await fixture(); let edited = false;
    M.render.mockImplementation(async req => {
      if (!edited) { edited = true; await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { body: [['p', 'Latest text']] } }); }
      return `/api/files/${req.bid}/article-body/new.png`;
    });
    await expect(runDefined(await startBodyImages(f.biz.id, f.id))).rejects.toMatchObject({ code: 'article_changed' });
    expect((await article(f.id)).body).toEqual([['p', 'Latest text']]);
    expect((await article(f.id)).bodyImages).toEqual(f.a.bodyImages);
  });
  it('safe SEO/source changes survive body image completion while concurrent cover generation is blocked', async () => {
    const f = await fixture(); let edited = false;
    M.render.mockImplementation(async req => {
      if (req.kind === 'article-body' && !edited) {
        edited = true;
        await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { seo: { meta: 'Updated metadata' } } });
        await actions['article.source'].run(f.ctx, { entryId: f.id, index: 0, removed: true });
        await expect(actions['article.regenerateImage'].run(f.ctx, { entryId: f.id })).rejects.toMatchObject({ code: 'article_busy' });
      }
      return `/api/files/${req.bid}/${req.kind}/new-${req.seed}.png`;
    });
    await runDefined(await startBodyImages(f.biz.id, f.id));
    const saved = await article(f.id);
    expect(saved.seo.meta).toBe('Updated metadata');
    expect(saved.sources[0].removed).toBe(true);
    expect(saved.img.seed).toBe(1);
    expect(saved.bodyImages).toHaveLength(2);
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { seo: { title: 'Later title' } } });
    expect((await article(f.id)).bodyImages).toEqual(saved.bodyImages);
  });
  it('generates a custom cover from an older template style, persists direction and reuses strict mode on normal regenerate', async () => {
    const f = await fixture();
    const input = actions['article.regenerateImage'].input!.parse({ entryId: f.id, prompt: '  Sobha Sapphire at sunset  ' });
    await actions['article.regenerateImage'].run(f.ctx, input);
    expect(M.render.mock.calls[0][0]).toMatchObject({ prompt: 'Sobha Sapphire at sunset', modelRequired: true, style: 'branded', w: 1200, h: 628 });
    const saved = await article(f.id);
    expect(saved.img).toMatchObject({ prompt: 'Sobha Sapphire at sunset', promptBy: 'owner', modelRequired: true, seed: 2, urlKey: 'branded:2' });
    expect(M.render.mock.calls[0][0].literal).toBe(false);
    expect(M.directions).toEqual([]);
    expect(saved.body).toEqual(f.a.body); expect(saved.bodyImages).toEqual(f.a.bodyImages);
    await actions['article.regenerateImage'].run(f.ctx, { entryId: f.id });
    expect(M.render.mock.calls[1][0]).toMatchObject({ prompt: 'Sobha Sapphire at sunset', modelRequired: true, seed: 3 });
  });
  /* ── contextual directions on Regenerate (AC8), strict regeneration (D7) ── */
  const older = { style: 'illustration' as const, prompt: 'Calm, editorial image about docs updates', urlKey: 'illustration:1' };
  it('Regenerate on an older article in a model style saves a direction read from its text, and asks strictly for a literal picture', async () => {
    const f = await fixture({ img: older });
    const out = await actions['article.regenerateImage'].run(f.ctx, { entryId: f.id });
    const saved = await article(f.id);
    expect(M.directions).toEqual(['Keep docs current']);
    expect(saved.imageDirections).toMatchObject({ source: 'ai', key: directionsKey('Keep docs current', body, 1400) });
    expect(saved.img).toMatchObject({ prompt: saved.imageDirections!.cover.prompt, promptBy: 'radar', alt: saved.imageDirections!.cover.alt, seed: 2, urlKey: 'illustration:2', url: out.url });
    expect(saved.img.prompt).toContain('Keep docs current'); expect(saved.img.prompt).not.toBe(older.prompt);
    expect(saved.img.modelRequired).toBeUndefined(); // strict for this request only; not stored
    expect(M.render.mock.calls).toHaveLength(1);
    expect(M.render.mock.calls[0][0]).toMatchObject({ kind: 'hero', style: 'illustration', seed: 2, prompt: saved.img.prompt, literal: true, modelRequired: true, w: 1200, h: 628 });
    // Everything else on the article is as it was.
    const { img, imageDirections, ...rest } = saved; const { img: _img, ...restBefore } = f.a;
    expect(rest).toEqual(restBefore);
    // Again: the direction is Radar's and the text has not changed, so no text call is made.
    await actions['article.regenerateImage'].run(f.ctx, { entryId: f.id });
    expect(M.directions).toHaveLength(1);
    expect(M.render.mock.calls[1][0]).toMatchObject({ seed: 3, prompt: saved.img.prompt, literal: true, modelRequired: true });
    // The body-image job reuses the same cached set.
    await runDefined(await startBodyImages(f.biz.id, f.id));
    expect(M.directions).toHaveLength(1);
  });
  it('Regenerate keeps an alt the owner edited, and never rewrites a direction the owner typed', async () => {
    const f = await fixture({ img: older });
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { img: { style: 'illustration', prompt: older.prompt, alt: 'My own alt text' } } });
    expect((await article(f.id)).img).toMatchObject({ alt: 'My own alt text', altBy: 'owner', prompt: older.prompt });
    expect((await article(f.id)).img.promptBy).toBeUndefined();
    await actions['article.regenerateImage'].run(f.ctx, { entryId: f.id });
    expect((await article(f.id)).img).toMatchObject({ promptBy: 'radar', alt: 'My own alt text', altBy: 'owner' });

    const typed = await fixture({ img: { ...older, prompt: 'A lighthouse above a calm harbour' } });
    await actions['article.regenerateImage'].run(typed.ctx, { entryId: typed.id });
    expect(M.directions).toHaveLength(1); // only the first article's
    expect(M.render.mock.calls.at(-1)![0]).toMatchObject({ prompt: 'A lighthouse above a calm harbour', literal: false, modelRequired: true, seed: 2 });
    const saved = await article(typed.id);
    expect(saved.img).toMatchObject({ prompt: 'A lighthouse above a calm harbour', alt: 'Cover alt', seed: 2 });
    expect(saved.imageDirections).toBeUndefined();
  });
  it('Regenerate on a template style draws a new template variation from the title and runs no direction step', async () => {
    const f = await fixture({ img: { prompt: 'Calm, editorial image about docs updates' } });
    await actions['article.regenerateImage'].run(f.ctx, { entryId: f.id });
    expect(M.directions).toEqual([]);
    expect(M.render.mock.calls[0][0]).toMatchObject({ style: 'branded', seed: 2, modelRequired: false, literal: false, prompt: 'Calm, editorial image about docs updates' });
    expect((await article(f.id)).img).toEqual({ ...f.a.img, seed: 2, urlKey: 'branded:2', url: `/api/files/${f.biz.id}/hero/1.png` });
  });
  it('Regenerate on a model style never answers with the template: the error is shown and the whole article is kept', async () => {
    const f = await fixture({ img: older });
    const unavailable = Object.assign(new RadarError('Image generation is temporarily unavailable. Your previous image is kept. Please contact support.', 503, 'image_unavailable'));
    M.render.mockRejectedValue(unavailable);
    await expect(actions['article.regenerateImage'].run(f.ctx, { entryId: f.id })).rejects.toMatchObject({ code: 'image_unavailable', status: 503 });
    expect(M.render.mock.calls[0][0].modelRequired).toBe(true);
    expect(await article(f.id)).toEqual(f.a);
    M.render.mockRejectedValue(new Error('openai image 503'));
    await expect(actions['article.regenerateImage'].run(f.ctx, { entryId: f.id })).rejects.toMatchObject({ code: 'image_failed', status: 502 });
    expect(await article(f.id)).toEqual(f.a);
  });
  it('a locked, foreign or Viewer request never reaches the direction step or the image model', async () => {
    const f = await fixture({ img: older }); const other = await fixture();
    await expect(actions['article.regenerateImage'].run(other.ctx, { entryId: f.id })).rejects.toMatchObject({ status: 404 });
    for (const status of ['scheduled', 'publishing', 'published']) {
      await db.update(schema.calendarEntries).set({ status }).where(eq(schema.calendarEntries.id, f.id));
      await expect(actions['article.regenerateImage'].run(f.ctx, { entryId: f.id })).rejects.toMatchObject({ code: 'article_locked' });
    }
    await db.update(schema.calendarEntries).set({ status: 'review' }).where(eq(schema.calendarEntries.id, f.id));
    const viewer = await F.user(); await F.member(f.biz.id, viewer, 'Viewer'); await F.signIn(viewer, M.jar);
    for (const action of ['article.regenerateImage', 'article.regenerateBodyImages']) {
      const response = await ACT(new Request('http://t/act', { method: 'POST', body: JSON.stringify({ action, input: { entryId: f.id } }) }), { params: Promise.resolve({ bid: f.biz.id }) });
      expect(response.status, action).toBe(403);
    }
    // Other work on the article (a running body-image job) blocks it too, before any provider time.
    await startBodyImages(f.biz.id, f.id);
    await expect(actions['article.regenerateImage'].run(f.ctx, { entryId: f.id })).rejects.toMatchObject({ code: 'article_busy' });
    expect(M.directions).toEqual([]); expect(M.render).not.toHaveBeenCalled();
    expect(await article(f.id)).toEqual(f.a);
  });

  /* ── autosave: what a client can and cannot set (AC5, AC10) ── */
  it('autosave cannot set the placeholder mark, the direction’s author, the cached directions or the body-image note', async () => {
    const f = await fixture();
    const forged = { style: 'branded', prompt: 'Custom cover', alt: 'Cover alt', promptBy: 'radar', altBy: 'owner', placeholder: { reason: 'failed', at: 'x' }, url: 'https://evil.test/x.png', urlKey: 'branded:1', modelRequired: true };
    const input = actions['article.save'].input!.parse({ entryId: f.id, patch: { img: forged, imageDirections: { key: 'x', source: 'ai', subject: null, cover: { prompt: 'p', alt: 'a' }, sections: [], at: 'x' }, bodyImagesIssue: { reason: 'failed', at: 'x' }, bodyImages: [] } }) as any;
    expect(Object.keys(input.patch)).toEqual(['img']);
    expect(Object.keys(input.patch.img).sort()).toEqual(['alt', 'prompt', 'style']);
    await actions['article.save'].run(f.ctx, input);
    // The same style, direction and alt the article already had: nothing is marked, nothing is added.
    expect(await article(f.id)).toEqual(f.a);
  });
  it('a direction or alt a person edits is marked theirs; the fields sent along unchanged are not', async () => {
    const f = await fixture({ img: { prompt: 'The exterior of a gated community', promptBy: 'radar', alt: 'Illustration of a gated community' } });
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { img: { style: 'branded', prompt: 'The exterior of a gated community', alt: 'A calmer alt' } } });
    expect((await article(f.id)).img).toMatchObject({ promptBy: 'radar', alt: 'A calmer alt', altBy: 'owner' });
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { img: { style: 'branded', prompt: 'The same community at dusk', alt: 'A calmer alt' } } });
    expect((await article(f.id)).img).toMatchObject({ prompt: 'The same community at dusk', promptBy: 'owner', alt: 'A calmer alt', altBy: 'owner' });
    // From here Radar leaves both alone: a rewrite keeps them, and body images are guided by the owner's wording.
    await runDefined(await startBodyImages(f.biz.id, f.id));
    expect(M.render.mock.calls.every(c => c[0].prompt.endsWith(' Overall look the owner asked for: The same community at dusk'))).toBe(true);
  });
  it('choosing a model style with no usable image model stores the title card and marks it; choosing a template clears the mark', async () => {
    const f = await fixture({ img: { prompt: 'The exterior of a gated community', promptBy: 'radar' } });
    M.render.mockImplementation(async req => ({ url: `/api/files/${req.bid}/hero/${req.style}.png`, bytes: 1, type: 'image/png', ...(req.style === 'illustration' ? { placeholder: 'unavailable' } : {}) }));
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { img: { style: 'illustration' } } });
    let saved = await article(f.id);
    expect(M.render.mock.calls[0][0]).toMatchObject({ style: 'illustration', literal: true, modelRequired: false, prompt: 'The exterior of a gated community' });
    expect(saved.img).toMatchObject({ style: 'illustration', url: `/api/files/${f.biz.id}/hero/illustration.png`, urlKey: 'illustration:1', promptBy: 'radar' });
    expect(saved.img.placeholder).toEqual({ reason: 'unavailable', at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });
    // An unrelated autosave leaves the mark alone.
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { seo: { meta: 'Another description' } } });
    expect((await article(f.id)).img.placeholder).toEqual(saved.img.placeholder);
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { img: { style: 'branded' } } });
    saved = await article(f.id);
    expect(saved.img).toMatchObject({ style: 'branded', url: `/api/files/${f.biz.id}/hero/branded.png`, urlKey: 'branded:1' });
    expect('placeholder' in saved.img).toBe(false);
  });
  it('a successful Regenerate clears the placeholder mark', async () => {
    const f = await fixture({ img: { ...older, promptBy: 'radar', placeholder: { reason: 'unavailable', at: '2026-11-01T00:00:00.000Z' } } });
    await actions['article.regenerateImage'].run(f.ctx, { entryId: f.id });
    const saved = await article(f.id);
    expect(saved.img.url).toBe(`/api/files/${f.biz.id}/hero/1.png`);
    expect('placeholder' in saved.img).toBe(false);
  });

  /* ── publishing (AC6, AC7) and articles from before this change (AC9) ── */
  it('publishes an article with a placeholder cover and no body images as it is: no body figure anywhere in the output', async () => {
    const f = await fixture({ status: 'scheduled' });
    const flagged: Article = { ...f.a, img: { ...f.a.img, style: 'illustration', urlKey: 'illustration:1', placeholder: { reason: 'unavailable', at: '2026-11-12T00:00:00.000Z' } }, bodyImages: [], bodyImagesIssue: { reason: 'unavailable', at: '2026-11-12T00:00:00.000Z' } };
    await db.update(schema.articles).set({ data: flagged }).where(eq(schema.articles.entryId, f.id));
    await db.insert(schema.connections).values({ businessId: f.biz.id, type: 'wordpress', url: 'https://fieldnote.test', fields: {} });
    expect(await publishEntry(f.id, { attempt: 1, maxAttempts: 1 })).toMatchObject({ status: 'published' });
    const sent = M.published[0];
    expect(sent.bodyImages).toEqual([]);
    expect(sent.html).not.toContain('radar-body-image'); expect(sent.html).not.toContain('<img'); expect(sent.markdown).not.toContain('![');
    expect(sent.html).toContain('<h2>Measure drift</h2>');
    expect(sent.image.url).toContain(`/api/files/${f.biz.id}/hero/cover.png`);
    expect(M.render).not.toHaveBeenCalled();
    expect(await article(f.id)).toEqual(flagged);
  });
  it('a cover drawn at publish time that falls back to the title card is marked on the article in the same write', async () => {
    const f = await fixture({ img: { ...older, promptBy: 'radar', url: null, urlKey: null } });
    M.render.mockImplementation(async req => ({ url: `/api/files/${req.bid}/hero/late.png`, bytes: 1, type: 'image/png', placeholder: 'failed' }));
    const payload = await buildPayload(f.biz, entryFromRow(f.entry), f.a);
    expect(M.render.mock.calls[0][0]).toMatchObject({ kind: 'hero', style: 'illustration', literal: true, prompt: older.prompt });
    expect(payload.image!.url).toContain('/hero/late.png');
    let saved = await article(f.id);
    expect(saved.img).toEqual({ ...f.a.img, url: `/api/files/${f.biz.id}/hero/late.png`, placeholder: { reason: 'failed', at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) } });
    // A real picture at publish time writes the url and no mark.
    const g = await fixture({ img: { ...older, url: null, urlKey: null } });
    M.render.mockImplementation(async req => `/api/files/${req.bid}/hero/real.png`);
    await buildPayload(g.biz, entryFromRow(g.entry), g.a);
    saved = await article(g.id);
    expect(saved.img).toEqual({ ...g.a.img, url: `/api/files/${g.biz.id}/hero/real.png` });
  });
  it('an article saved before this change loads, autosaves and builds its payload with none of the new fields appearing', async () => {
    const f = await fixture(); const e = entryFromRow(f.entry);
    const NEW = ['imageDirections', 'bodyImagesIssue']; const NEW_IMG = ['promptBy', 'altBy', 'placeholder'];
    const loaded = await actions['article.get'].run(f.ctx, { entryId: f.id });
    expect(loaded.article).toEqual(f.a);
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { seo: { meta: 'Edited description' }, brief: { angle: 'A sharper angle' } } });
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { img: { style: f.a.img.style, prompt: f.a.img.prompt, alt: f.a.img.alt } } });
    const saved = await article(f.id);
    expect(saved).toEqual({ ...f.a, seo: { ...f.a.seo, meta: 'Edited description' }, brief: { ...f.a.brief, angle: 'A sharper angle' } });
    for (const key of NEW) expect(key in saved, key).toBe(false);
    for (const key of NEW_IMG) expect(key in saved.img, key).toBe(false);
    // Its payload is the one the stored fields describe, and the new fields change nothing in it.
    const payload = await buildPayload(f.biz, e, saved);
    expect(payload.html).toContain('<figure class="radar-body-image"><img src="'); expect(payload.bodyImages).toHaveLength(1);
    expect(payload.image).toMatchObject({ alt: 'Cover alt' }); expect(payload.image!.url).toContain('/hero/cover.png');
    const withNew = await buildPayload(f.biz, e, { ...saved, img: { ...saved.img, promptBy: 'radar', altBy: 'owner', placeholder: { reason: 'failed', at: 'x' } }, bodyImagesIssue: { reason: 'failed', at: 'x' }, imageDirections: { key: 'k', source: 'ai', subject: null, cover: { prompt: 'p', alt: 'a' }, sections: [], at: 'x' } });
    const comparable = ({ image, ...rest }: any) => ({ ...rest, image: { url: image.url, alt: image.alt } });
    expect(comparable(withNew)).toEqual(comparable(payload));
    expect(M.render).not.toHaveBeenCalled(); expect(M.directions).toEqual([]);
  });
  it('cover provider/storage failures preserve the full prior article, and locked or foreign covers never render', async () => {
    const f = await fixture(); const other = await fixture();
    M.render.mockRejectedValue(new Error('storage unavailable'));
    await expect(actions['article.regenerateImage'].run(f.ctx, { entryId: f.id, prompt: 'A custom subject' })).rejects.toMatchObject({ code: 'image_failed' });
    expect(await article(f.id)).toEqual(f.a);
    M.render.mockClear();
    await expect(actions['article.regenerateImage'].run(other.ctx, { entryId: f.id, prompt: 'Other tenant' })).rejects.toMatchObject({ status: 404 });
    for (const status of ['scheduled', 'publishing', 'published']) {
      await db.update(schema.calendarEntries).set({ status }).where(eq(schema.calendarEntries.id, f.id));
      await expect(actions['article.regenerateImage'].run(f.ctx, { entryId: f.id, prompt: 'Blocked' })).rejects.toMatchObject({ code: 'article_locked' });
    }
    expect(M.render).not.toHaveBeenCalled();
  });
  it('rechecks publication locks after cover generation and preserves the queued image', async () => {
    const f = await fixture();
    M.render.mockImplementation(async () => { await db.update(schema.calendarEntries).set({ status: 'scheduled' }).where(eq(schema.calendarEntries.id, f.id)); return '/api/files/new.png'; });
    await expect(actions['article.regenerateImage'].run(f.ctx, { entryId: f.id, prompt: 'Custom scene' })).rejects.toMatchObject({ code: 'article_locked' });
    expect(await article(f.id)).toEqual(f.a);
  });
  it('rejects a stale style render if a newer custom cover finishes first', async () => {
    const f = await fixture(); let replaced = false;
    M.render.mockImplementation(async req => {
      if (req.style === 'photography' && !replaced) { replaced = true; await actions['article.regenerateImage'].run(f.ctx, { entryId: f.id, prompt: 'Latest custom subject' }); }
      return `/api/files/${req.bid}/hero/${req.style}-${req.seed}.png`;
    });
    await expect(actions['article.save'].run(f.ctx, { entryId: f.id, patch: { img: { style: 'photography' } } })).rejects.toMatchObject({ code: 'article_changed' });
    expect((await article(f.id)).img).toMatchObject({ style: 'branded', seed: 2, prompt: 'Latest custom subject', modelRequired: true, urlKey: 'branded:2' });
  });
  it('serializes approval, draft admission and manual/cron publishing against active body jobs', async () => {
    const f = await fixture();
    const [conn] = await db.insert(schema.connections).values({ businessId: f.biz.id, type: 'wordpress', url: 'https://fieldnote.test', fields: {} }).returning();
    f.ctx.biz.blog = { defaultId: conn.id };
    await startBodyImages(f.biz.id, f.id);
    await expect(startDraft(f.biz.id, f.id, 'user')).rejects.toMatchObject({ code: 'article_busy' });
    await expect(actions['article.approve'].run(f.ctx, { entryId: f.id, withoutPublishing: true })).rejects.toMatchObject({ code: 'article_busy' });
    await db.update(schema.calendarEntries).set({ status: 'failed' }).where(eq(schema.calendarEntries.id, f.id));
    await expect(publishActions['publish.retry'].run(f.ctx, { entryId: f.id })).rejects.toMatchObject({ code: 'article_busy' });
    await db.update(schema.calendarEntries).set({ status: 'scheduled' }).where(eq(schema.calendarEntries.id, f.id));
    await expect(publishActions['publish.now'].run(f.ctx, { entryId: f.id })).rejects.toMatchObject({ code: 'article_busy' });
    await expect(publishEntry(f.id, { attempt: 1, maxAttempts: 1 })).rejects.toMatchObject({ code: 'article_busy' });
  });
  it('rejects tenant mismatches, absent generated text, locked states and pending remote publications', async () => {
    const f = await fixture(); const other = await fixture();
    await expect(startBodyImages(other.biz.id, f.id)).rejects.toMatchObject({ status: 404 });
    for (const status of ['scheduled', 'publishing', 'published']) {
      await db.update(schema.calendarEntries).set({ status }).where(eq(schema.calendarEntries.id, f.id));
      await expect(startBodyImages(f.biz.id, f.id)).rejects.toMatchObject({ code: 'article_locked' });
      await expect(startDraft(f.biz.id, f.id, 'user')).rejects.toMatchObject({ code: 'article_locked' });
    }
    await db.update(schema.calendarEntries).set({ status: 'failed', publishRemote: { id: 'remote' } }).where(eq(schema.calendarEntries.id, f.id));
    await expect(startBodyImages(f.biz.id, f.id)).rejects.toMatchObject({ code: 'publication_pending' });
    await expect(startDraft(f.biz.id, f.id, 'user')).rejects.toMatchObject({ code: 'publication_pending' });
    const unwritten = await fixture({ generated: false });
    await expect(startBodyImages(unwritten.biz.id, unwritten.id)).rejects.toMatchObject({ code: 'not_generated' });
  });
  it('an expired worker cannot replace old media after a newer attempt has taken over', async () => {
    const f = await fixture(); const id = await startBodyImages(f.biz.id, f.id); let expired = false;
    M.render.mockImplementation(async req => {
      if (!expired) { expired = true; await db.update(schema.jobs).set({ attempts: 1, lockedBy: 'new-worker', status: 'running' }).where(eq(schema.jobs.id, id)); }
      return `/api/files/${req.bid}/article-body/stale.png`;
    });
    await expect(runDefined(id)).rejects.toMatchObject({ code: 'stale_job' });
    expect(await article(f.id)).toEqual(f.a);
  });
  it('a late final draft attempt cannot demote the newer draft during failure cleanup', async () => {
    const f = await fixture(); const id = await startDraft(f.biz.id, f.id, 'user'); let replacement = '';
    await db.update(schema.jobs).set({ attempts: 2 }).where(eq(schema.jobs.id, id));
    M.render.mockImplementation(async req => {
      if (req.kind === 'article-body' && !replacement) {
        await db.update(schema.jobs).set({ status: 'failed' }).where(eq(schema.jobs.id, id));
        replacement = await startDraft(f.biz.id, f.id, 'user');
      }
      return `/api/files/${req.bid}/article-body/stale.png`;
    });
    await expect(runDefined(id)).rejects.toMatchObject({ code: 'stale_job' });
    expect(replacement).not.toBe(id);
    expect((await entry(f.id)).status).toBe('drafting');
    expect((await getJob(replacement))!.status).toBe('queued');
    expect(await article(f.id)).toEqual(f.a);
  }, 15_000);
  it('builds absolute tenant-owned inline URLs while keeping the cover separate, and rejects foreign media', async () => {
    const f = await fixture(); const e = entryFromRow(f.entry);
    const payload = await buildPayload(f.biz, e, f.a);
    expect(payload.bodyImages![0].url).toMatch(/^https?:\/\//);
    expect(payload.html).toContain(payload.bodyImages![0].url);
    expect(payload.markdown).toContain(payload.bodyImages![0].url);
    expect(payload.image!.url).toContain('/hero/cover.png');
    await expect(buildPayload(f.biz, e, { ...f.a, bodyImages: [{ ...f.a.bodyImages![0], url: '/api/files/another-business/article-body/image.png' }] })).rejects.toThrow('not stored for this business');
  });
  it('publishes the latest text, title and images after waiting for another article transaction', async () => {
    const f = await fixture({ status: 'scheduled' });
    await db.insert(schema.connections).values({ businessId: f.biz.id, type: 'wordpress', url: 'https://fieldnote.test', fields: {} });
    const client = await pool.connect(); let pending: ReturnType<typeof publishEntry> | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM calendar_entries WHERE id=$1 FOR UPDATE', [f.id]);
      pending = publishEntry(f.id, { attempt: 1, maxAttempts: 1 });
      let blocked = false;
      for (let tries = 0; tries < 100 && !blocked; tries++) {
        blocked = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%calendar_entries%') AS blocked")).rows[0].blocked;
        if (!blocked) await new Promise(r => setTimeout(r, 10));
      }
      expect(blocked).toBe(true);
      const latest = { ...f.a, body: [['h2', 'Latest section'], ['p', 'Latest text']], bodyImages: [{ ...oldImage(f.biz.id), after: { heading: 'latest section', occurrence: 0, block: 0 }, url: `/api/files/${f.biz.id}/article-body/latest.png` }] };
      await client.query('UPDATE articles SET data=$1::jsonb WHERE entry_id=$2', [JSON.stringify(latest), f.id]);
      await client.query('UPDATE calendar_entries SET title=$1 WHERE id=$2', ['Latest title', f.id]);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK'); client.release(); }
    expect(await pending).toMatchObject({ status: 'published' });
    expect(M.published[0].title).toBe('Latest title');
    expect(M.published[0].html).toContain('Latest text');
    expect(M.published[0].html).toContain('/article-body/latest.png');
  });
  it('the RPC requires Editor and does not allow a client to replace image URLs in autosave', async () => {
    const f = await fixture(); const viewer = await F.user(); await F.member(f.biz.id, viewer, 'Viewer');
    await F.signIn(viewer, M.jar);
    const req = new Request('http://t/act', { method: 'POST', body: JSON.stringify({ action: 'article.regenerateBodyImages', input: { entryId: f.id } }) });
    const response = await ACT(req, { params: Promise.resolve({ bid: f.biz.id }) });
    expect(response.status).toBe(403);
    const parsed = actions['article.save'].input!.parse({ entryId: f.id, patch: { bodyImages: [{ url: 'https://evil.test' }] } }) as any;
    expect(parsed.patch.bodyImages).toBeUndefined();
  });
});
