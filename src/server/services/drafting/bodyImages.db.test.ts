// Integration coverage: real Postgres locks, JSON persistence and queue state; only image rendering is replaced.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => {
  process.env.RADAR_DEV_STUBS = '1';
  return { render: vi.fn(), jar: new Map<string, string>(), published: [] as any[] };
});
vi.mock('../images', () => ({ renderImage: M.render, defaultArticleImageStyle: () => 'branded' }));
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
import { startBodyImages } from './bodyImages';
import { startDraft } from './start';
import './jobs';

const F = new Fixtures();
const profile: Profile = {
  domain: 'fieldnote.test', business: { name: 'Fieldnote', description: 'Documentation tools', offerings: ['Docs'], industry: 'Software', positioning: '', differentiators: ['Keeps docs current'] },
  audience: { segments: ['Developers'], buyers: ['Team leads'], needs: ['Keep docs current'], competitors: [] }, keywords: { list: [] },
  brand: { logo: null, primary: '#123456', secondary: '#abcdef', voice: 'Clear', language: 'English', markets: [] },
};
let seq = 0;
const body: Article['body'] = [['p', 'Intro'], ['h2', 'Measure drift'], ['p', 'Compare docs and code.'], ['h2', 'Review changes'], ['p', 'Review with the pull request.'], ['h2', 'Ship safely'], ['p', 'Publish checked docs.']];
const oldImage = (bid: string): ArticleBodyImage => ({ id: 'old', after: { heading: 'measure drift', occurrence: 0, block: 1 }, url: `/api/files/${bid}/article-body/old.png`, alt: 'Old illustration', prompt: '', seed: 1 });
async function fixture(o: { status?: string; generated?: boolean; words?: 900 | 1400 | 2200; legacy?: boolean } = {}) {
  const user = await F.user(); const biz = await F.biz(user, { profile, domain: profile.domain });
  const id = `e_images_${F.tag}_${++seq}`;
  const [entry] = await db.insert(schema.calendarEntries).values({ id, businessId: biz.id, title: 'Keep docs current', kw: 'docs updates', type: 'Guide', date: '2026-10-29', status: o.status || 'review' }).returning();
  const a: Article = { ...defaultArticle(entryFromRow(entry)), generated: o.generated ?? true, body, brief: { angle: 'Stay current', outline: ['Measure drift', 'Review changes', 'Ship safely'], words: o.words || 1400 }, seo: { title: 'Custom SEO', meta: 'Keep my description', slug: 'custom-slug' }, img: { style: 'branded', seed: 1, prompt: 'Custom cover', alt: 'Cover alt', url: `/api/files/${biz.id}/hero/cover.png`, urlKey: 'branded:1' }, sources: [{ title: 'Source', url: 'https://example.org/source', use: 'Context' }], ...(o.legacy ? {} : { bodyImages: [oldImage(biz.id)], bodyImagesGeneratedAt: '2026-10-01T00:00:00.000Z' }) };
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
  M.published = [];
  let render = 0;
  M.render.mockImplementation(async req => `/api/files/${req.bid}/${req.kind}/${++render}.png`);
});
afterAll(() => F.cleanup());

describe.skipIf(!process.env.DATABASE_URL)('article body images (database)', () => {
  it('repairs a legacy article, reloads the complete image set, and preserves all other fields', async () => {
    const f = await fixture({ legacy: true });
    const id = await startBodyImages(f.biz.id, f.id);
    expect(await startBodyImages(f.biz.id, f.id)).toBe(id);
    const result = await runDefined(id);
    const saved = await article(f.id);
    expect(saved.bodyImages).toHaveLength(2);
    expect(saved.bodyImagesGeneratedAt).toBe(result.bodyImagesGeneratedAt);
    const { bodyImages, bodyImagesGeneratedAt, ...unchanged } = saved;
    expect(unchanged).toEqual(f.a);
    expect((await getJob(id))!.progress).toEqual({ stage: 'images', completed: 2, total: 2 });
    expect((await entry(f.id)).status).toBe('review');
  });
  it('new drafts and long rewrites cannot complete without their body images', async () => {
    for (const words of [900, 2200] as const) {
      const f = await fixture({ generated: false, words });
      const id = await startDraft(f.biz.id, f.id, 'user');
      expect((await entry(f.id)).status).toBe('drafting');
      await expect(actions['article.save'].run(f.ctx, { entryId: f.id, patch: { body: [['p', 'Other tab']] } })).rejects.toMatchObject({ code: 'article_busy' });
      await runDefined(id);
      const saved = await article(f.id);
      expect(saved.generated).toBe(true);
      expect(saved.bodyImages).toHaveLength(words === 2200 ? 3 : 2);
      expect(saved.draftedAt).toBeTruthy();
      expect((await entry(f.id)).status).toBe('review');
    }
  }, 15_000);
  it('a full draft image-storage failure never marks the article ready or replaces its previous content', async () => {
    const f = await fixture();
    M.render.mockRejectedValue(new Error('storage unavailable'));
    const id = await startDraft(f.biz.id, f.id, 'user');
    await db.update(schema.jobs).set({ attempts: 1, maxAttempts: 1 }).where(eq(schema.jobs.id, id));
    await runJobNow(id);
    expect((await getJob(id))!.status).toBe('failed');
    expect((await entry(f.id)).status).toBe('approved');
    expect(await article(f.id)).toEqual(f.a);
  }, 15_000);
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
  it('concurrent SEO/source/cover changes survive image completion, and later saves preserve new images', async () => {
    const f = await fixture(); let edited = false;
    M.render.mockImplementation(async req => {
      if (req.kind === 'article-body' && !edited) {
        edited = true;
        await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { seo: { meta: 'Updated metadata' } } });
        await actions['article.source'].run(f.ctx, { entryId: f.id, index: 0, removed: true });
        await actions['article.regenerateImage'].run(f.ctx, { entryId: f.id });
      }
      return `/api/files/${req.bid}/${req.kind}/new-${req.seed}.png`;
    });
    await runDefined(await startBodyImages(f.biz.id, f.id));
    const saved = await article(f.id);
    expect(saved.seo.meta).toBe('Updated metadata');
    expect(saved.sources[0].removed).toBe(true);
    expect(saved.img.seed).toBe(2);
    expect(saved.bodyImages).toHaveLength(2);
    await actions['article.save'].run(f.ctx, { entryId: f.id, patch: { seo: { title: 'Later title' } } });
    expect((await article(f.id)).bodyImages).toEqual(saved.bodyImages);
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
