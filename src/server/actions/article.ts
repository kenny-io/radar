// Actions for the Article workspace (01-screens.md §6, 02-system.md §7, CONTRACTS.md content area).
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { action, type ActionMap } from './define';
import { db, schema } from '../db';
import { RadarError, notFound } from '../errors';
import { calendarSettingsOf, entryFromRow } from '../workspace';
import { startDraft } from '../services/drafting/start';
import { startBodyImages } from '../services/drafting/bodyImages';
import { assertNoArticleWork, assertNoDraftWork, lockArticle } from '../services/drafting/guard';
import { rewriteSelection } from '../services/drafting/rewrite';
import { suggestVideos } from '../services/drafting/youtube';
import { renderImage } from '../services/images';
import { defaultArticle, statNumbers } from '@/features/article/blocks';
import type { Article, Profile } from '@/lib/types';

const E = schema.calendarEntries;
const BlockZ = z.union([z.tuple([z.enum(['p', 'h2', 'h3']), z.string().max(20000)]), z.tuple([z.literal('ul'), z.array(z.string().max(5000)).max(200)])]);
const Patch = z.object({
  body: z.array(BlockZ).max(400).optional(),
  brief: z.object({ angle: z.string().max(2000), outline: z.array(z.string().max(300)).max(20), words: z.union([z.literal(900), z.literal(1400), z.literal(2200)]) }).partial().optional(),
  seo: z.object({ title: z.string().max(300), meta: z.string().max(1000), slug: z.string().max(200) }).partial().optional(),
  img: z.object({ style: z.enum(['branded', 'illustration', 'photography', 'infographic']), prompt: z.string().max(1000), alt: z.string().max(500) }).partial().optional(),
  videos: z.array(z.string().max(40)).max(6).optional(),
});

async function load(bid: string, entryId: string) {
  const r = (await db.select().from(E).where(and(eq(E.id, entryId), eq(E.businessId, bid))).limit(1))[0];
  if (!r) throw notFound('That article');
  const a = (await db.select().from(schema.articles).where(eq(schema.articles.entryId, entryId)).limit(1))[0];
  const e = entryFromRow(r);
  return { row: r, e, a: ({ ...defaultArticle(e), ...((a?.data as Article) || {}) }) as Article };
}
async function save(bid: string, entryId: string, change: (latest: Article) => Article) {
  return db.transaction(async tx => {
    const row = await lockArticle(tx, bid, entryId);
    if (row.status === 'published' || row.status === 'publishing') throw new RadarError('This article is locked while it’s queued or published.');
    await assertNoDraftWork(tx, bid, entryId);
    const current = (await tx.select().from(schema.articles).where(and(eq(schema.articles.entryId, entryId), eq(schema.articles.businessId, bid))).limit(1))[0];
    const data = change({ ...defaultArticle(entryFromRow(row)), ...((current?.data as Article) || {}) });
    await tx.insert(schema.articles).values({ entryId, businessId: bid, data, updatedAt: new Date() }).onConflictDoUpdate({ target: schema.articles.entryId, set: { data, updatedAt: new Date() } });
  });
}
const profileOf = (biz: any): Profile => ({ ...(biz.profile as Profile), domain: biz.domain });
async function render(bid: string, biz: any, title: string, a: Article): Promise<Article['img']> {
  const p = profileOf(biz);
  const url = await renderImage({ bid, style: a.img.style, brand: p.brand, headline: title, name: p.business.name, seed: a.img.seed, prompt: a.img.prompt, w: 1200, h: 628, kind: 'hero' });
  return { ...a.img, url, urlKey: `${a.img.style}:${a.img.seed}` };
}

export const actions: ActionMap = {
  /** Autosave: brief, SEO, image fields, videos, edited blocks. */
  'article.save': action({ input: z.object({ entryId: z.string(), patch: Patch }), run: async (ctx, { entryId, patch }) => {
    const { e, a, row } = await load(ctx.bid, entryId);
    if (row.status === 'published' || row.status === 'publishing') throw new RadarError('This article is locked while it’s queued or published.');
    const next: Article = { ...a, ...(patch.body ? { body: patch.body as any } : {}), brief: { ...a.brief, ...(patch.brief || {}) }, seo: { ...a.seo, ...(patch.seo || {}) }, img: { ...a.img, ...(patch.img || {}) }, ...(patch.videos ? { videos: patch.videos } : {}) };
    if (patch.seo?.slug != null) next.seo.slug = patch.seo.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    // A new style needs a new hero render (template styles are instant; photo styles use the image model when configured).
    if (patch.img?.style && patch.img.style !== a.img.style && next.generated) {
      try { next.img = await render(ctx.bid, ctx.biz, e.title, next); } catch { next.img = { ...next.img, url: null, urlKey: null }; }
    }
    await save(ctx.bid, entryId, latest => ({
      ...latest,
      ...(patch.body ? { body: patch.body as Article['body'] } : {}),
      brief: { ...latest.brief, ...patch.brief }, seo: { ...latest.seo, ...patch.seo, ...(patch.seo?.slug != null ? { slug: next.seo.slug } : {}) },
      img: { ...latest.img, ...patch.img, ...(patch.img?.style && patch.img.style !== a.img.style ? { url: next.img.url, urlKey: next.img.urlKey } : {}) },
      ...(patch.videos ? { videos: patch.videos } : {}),
    }));
    return { ok: true };
  } }),

  /** Regenerate image → new seed + server render. */
  'article.regenerateImage': action({ input: z.object({ entryId: z.string() }), run: async (ctx, { entryId }) => {
    const { e, a } = await load(ctx.bid, entryId);
    const next = { ...a, img: { ...a.img, seed: (a.img.seed || 1) + 1 } };
    next.img = await render(ctx.bid, ctx.biz, e.title, next);
    await save(ctx.bid, entryId, latest => {
      if (latest.img.seed !== a.img.seed || latest.img.style !== a.img.style || latest.img.prompt !== a.img.prompt) throw new RadarError('The cover changed while Radar was rendering it. Try again.', 409, 'article_changed');
      return { ...latest, img: { ...latest.img, url: next.img.url, urlKey: next.img.urlKey, seed: next.img.seed } };
    });
    return { url: next.img.url, seed: next.img.seed };
  } }),

  'article.regenerateBodyImages': action({ input: z.object({ entryId: z.string().min(1).max(100) }), run: async (ctx, { entryId }) => ({ jobId: await startBodyImages(ctx.bid, entryId) }) }),

  /** "Draft now" (calendar sheet + article) and "Rewrite from brief" → job `article.draft` (ref = entryId). */
  'article.draft': action({ input: z.object({ entryId: z.string() }), run: async (ctx, { entryId }) => {
    const { row } = await load(ctx.bid, entryId);
    if (['published', 'publishing'].includes(row.status)) throw new RadarError('This article is already published.');
    const jobId = await startDraft(ctx.bid, entryId, 'user');
    return { jobId };
  } }),

  /** Selection RewriteBar: Rewrite · Shorter · Simpler · Expand. Returns the replacement for the selection only. */
  'article.rewrite': action({ read: true, role: 'Editor', input: z.object({ entryId: z.string(), mode: z.enum(['rewrite', 'shorter', 'simpler', 'expand']), selection: z.string().min(1).max(4000), before: z.string().max(2000).default(''), after: z.string().max(2000).default('') }), run: async (ctx, i) => {
    const { e, a } = await load(ctx.bid, i.entryId);
    const allowedNumbers = a.sources.filter(s => !s.removed).flatMap(s => (s.notes || []).flatMap(statNumbers));
    const text = await rewriteSelection(ctx.bid, profileOf(ctx.biz), { ...i, title: e.title, allowedNumbers });
    return { text };
  } }),

  /** Relevant YouTube videos (cached on the article for a week). */
  'article.videos': action({ input: z.object({ entryId: z.string(), refresh: z.boolean().optional() }), run: async (ctx, { entryId, refresh }) => {
    const { e, a } = await load(ctx.bid, entryId);
    const fresh = a.videoFetchedAt && Date.now() - new Date(a.videoFetchedAt).getTime() < 7 * 864e5;
    if (a.videoMeta?.length && fresh && !refresh) return { videos: a.videoMeta };
    const p = profileOf(ctx.biz); const s = calendarSettingsOf(ctx.biz);
    const vids = await suggestVideos(ctx.bid, { kw: e.kw, title: e.title, outline: a.brief.outline, market: s.market, language: s.language, competitors: p.audience.competitors });
    // Keep metadata for videos already embedded so their credit line survives a refresh.
    await save(ctx.bid, entryId, latest => {
      const retained = (latest.videoMeta || []).filter(v => latest.videos.includes(v.id) && !vids.some(x => x.id === v.id));
      return { ...latest, videoMeta: [...vids, ...retained], videoFetchedAt: new Date().toISOString() };
    });
    return { videos: vids };
  } }),

  /** Remove (or restore) a source; claims tied to it are flagged inline in the draft. */
  'article.source': action({ input: z.object({ entryId: z.string(), index: z.number().int().min(0), removed: z.boolean() }), run: async (ctx, { entryId, index, removed }) => {
    const { a } = await load(ctx.bid, entryId);
    if (!a.sources[index]) throw notFound('That source');
    await save(ctx.bid, entryId, latest => ({ ...latest, sources: latest.sources.map((s, i) => i === index ? { ...s, removed } : s) }));
    return { ok: true };
  } }),

  /** "Publish to" select (several connections). */
  'article.dest': action({ input: z.object({ entryId: z.string(), dest: z.string().uuid() }), run: async (ctx, { entryId, dest }) => {
    const c = (await db.select({ id: schema.connections.id }).from(schema.connections).where(and(eq(schema.connections.id, dest), eq(schema.connections.businessId, ctx.bid))).limit(1))[0];
    if (!c) throw notFound('That connection');
    await db.update(E).set({ dest }).where(and(eq(E.id, entryId), eq(E.businessId, ctx.bid)));
    return { ok: true };
  } }),

  /** CONTRACT: review/draft/approved (generated) → scheduled; withoutPublishing → approved. Needs a connection unless withoutPublishing. */
  'article.approve': action({ input: z.object({ entryId: z.string(), withoutPublishing: z.boolean().optional() }), run: async (ctx, { entryId, withoutPublishing }) => {
    return db.transaction(async tx => {
      const row = await lockArticle(tx, ctx.bid, entryId);
      await assertNoArticleWork(tx, ctx.bid, entryId);
      const a = (await tx.select().from(schema.articles).where(and(eq(schema.articles.entryId, entryId), eq(schema.articles.businessId, ctx.bid))).limit(1))[0]?.data as Article | undefined;
      if (!a?.generated) throw new RadarError('Radar hasn’t drafted this article yet.');
      if (!['review', 'draft', 'approved'].includes(row.status)) throw new RadarError('This article can’t be approved right now.');
      if (withoutPublishing) { await tx.update(E).set({ status: 'approved' }).where(eq(E.id, entryId)); return { status: 'approved' }; }
      const conns = await tx.select({ id: schema.connections.id }).from(schema.connections).where(eq(schema.connections.businessId, ctx.bid));
      if (!conns.length) throw new RadarError('Connect your blog to schedule this article.');
      await tx.update(E).set({ status: 'scheduled', publishError: null }).where(eq(E.id, entryId));
      return { status: 'scheduled' };
    });
  } }),

  /** CONTRACT: scheduled → review ("Unscheduled. The draft is kept.") */
  'article.unschedule': action({ input: z.object({ entryId: z.string() }), run: async (ctx, { entryId }) => {
    const r = await db.update(E).set({ status: 'review' }).where(and(eq(E.id, entryId), eq(E.businessId, ctx.bid), eq(E.status, 'scheduled'))).returning({ id: E.id });
    if (!r.length) throw new RadarError('This article isn’t queued.');
    return { status: 'review' };
  } }),
};
