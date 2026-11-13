// Actions for the Article workspace (01-screens.md §6, 02-system.md §7, CONTRACTS.md content area).
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { action, type ActionMap } from './define';
import { db, schema } from '../db';
import { RadarError, notFound } from '../errors';
import { articleV, calendarSettingsOf, entryFromRow } from '../workspace';
import { startDraft } from '../services/drafting/start';
import { startBodyImages } from '../services/drafting/bodyImages';
import { assertArticleEditable, assertNoArticleWork, assertNoDraftWork, lockArticle } from '../services/drafting/guard';
import { rewriteSelection } from '../services/drafting/rewrite';
import { suggestVideos } from '../services/drafting/youtube';
import { resolveImageDirections } from '../services/drafting/imageDirections';
import { MODEL_STYLES, renderImageFile } from '../services/images';
import { defaultArticle, statNumbers } from '@/features/article/blocks';
import { coverDirectionIsOwners, defaultCoverDirection, fallbackImageDirections, realCoverOf, withCover, withRealCover } from '@/lib/articleImages';
import { ownSiteUrl } from '@/lib/ownSite';
import type { Article, ArticleImageDirections, Profile } from '@/lib/types';
import { recordEngagement, resolveCalendarForEntries } from '../services/lifecycle/engagement';
import { SitePictureError, pictureFromAddress, storeRealCover, type FoundPicture, type SitePictureCode } from '../services/realCover';
import { fit } from '../services/drafting/draft';
import { HOUR, enforce } from '../abuse/rateLimit';

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
  const a = (await db.select().from(schema.articles).where(and(eq(schema.articles.entryId, entryId), eq(schema.articles.businessId, bid))).limit(1))[0];
  const e = entryFromRow(r);
  return { row: r, e, a: ({ ...defaultArticle(e), ...((a?.data as Article) || {}) }) as Article, v: articleV(a?.updatedAt) };
}
/** Returns the row's new `v` and the `v` it replaced, read under the article lock: a client holding `prev` knows nobody wrote in between. */
async function save(bid: string, entryId: string, change: (latest: Article) => Article, media = false) {
  return db.transaction(async tx => {
    const row = await lockArticle(tx, bid, entryId);
    if (row.status === 'published' || row.status === 'publishing') throw new RadarError('This article is locked while it’s queued or published.');
    if (media) { assertArticleEditable(row.status, row.publishRemote); await assertNoArticleWork(tx, bid, entryId); }
    else await assertNoDraftWork(tx, bid, entryId);
    const current = (await tx.select().from(schema.articles).where(and(eq(schema.articles.entryId, entryId), eq(schema.articles.businessId, bid))).limit(1))[0];
    const data = change({ ...defaultArticle(entryFromRow(row)), ...((current?.data as Article) || {}) });
    const prev = articleV(current?.updatedAt); const at = new Date(Math.max(Date.now(), prev + 1)); // strictly later, so two saves in one millisecond still differ
    await tx.insert(schema.articles).values({ entryId, businessId: bid, data, updatedAt: at }).onConflictDoUpdate({ target: schema.articles.entryId, set: { data, updatedAt: at } });
    return { v: at.getTime(), prev };
  });
}
async function checkMedia(bid: string, entryId: string) {
  await db.transaction(async tx => { const row = await lockArticle(tx, bid, entryId); assertArticleEditable(row.status, row.publishRemote); await assertNoArticleWork(tx, bid, entryId); });
}
const profileOf = (biz: any): Profile => ({ ...(biz.profile as Profile), domain: biz.domain });
/** Render the cover and return it with its url, urlKey and placeholder mark. A direction Radar wrote is drawn literally;
 *  one a person typed goes to the model as written. `strict`: a person asked for a new picture, so a model style never
 *  answers with the template (a request option; it is not stored in `img.modelRequired`). */
async function render(bid: string, biz: any, title: string, a: Article, o: { strict?: boolean } = {}): Promise<Article['img']> {
  const p = profileOf(biz);
  const file = await renderImageFile({ bid, style: a.img.style, brand: p.brand, headline: title, name: p.business.name, seed: a.img.seed, prompt: a.img.prompt, literal: a.img.promptBy === 'radar', modelRequired: !!a.img.modelRequired || !!o.strict, w: 1200, h: 628, kind: 'hero' });
  return withCover(a.img, file);
}
/** The stored cover fields with an autosave patch applied. A direction or alt text a person changed is marked theirs,
 *  so Radar never rewrites it. The creation default (`Calm, editorial image about <keyword>`) is nobody's: a tab or an
 *  older browser bundle that missed the draft still sends it with every image edit, so it never replaces a direction
 *  Radar wrote and is never marked the owner's; over a direction a person typed it is stored with no author. */
function patchedCover(before: Article['img'], patch: Partial<Pick<Article['img'], 'style' | 'prompt' | 'alt'>> | undefined, kw: string): Article['img'] {
  let img: Article['img'] = { ...before, ...patch };
  if (patch?.prompt !== undefined && patch.prompt !== before.prompt) {
    if (patch.prompt.trim() !== defaultCoverDirection(kw)) img.promptBy = 'owner';
    else if (before.promptBy === 'radar') img.prompt = before.prompt;
    else { const { promptBy: _author, ...rest } = img; img = rest; }
  }
  if (patch?.alt !== undefined && patch.alt !== before.alt) img.altBy = 'owner';
  return img;
}
/** The stored cover fields before a generated or template cover is written over them: no placeholder mark, and no real-picture record. */
const withoutPlaceholder = ({ placeholder: _mark, real: _picture, ...img }: Article['img']): Article['img'] => img;

/** What a person is told when a picture from their site cannot be used. 4xx on purpose: a mistyped address is not an incident. */
const SITE_PICTURE: Record<SitePictureCode, [status: number, message: (domain: string, host: string) => string]> = {
  invalid_address: [400, d => `Enter the address of a page or picture on ${d}.`],
  not_your_site: [400, d => `That address isn’t on ${d}. Radar only uses pictures from your own site.`],
  left_site: [422, d => `That address redirects away from ${d}, so Radar didn’t follow it.`],
  unreachable: [422, () => 'Radar couldn’t reach that address. Check it and try again.'],
  no_picture: [422, () => 'Radar couldn’t find a picture it can use on that page. Try the address of the picture itself.'],
  off_site_picture: [422, (d, host) => `The pictures on that page are stored on another site (${host}). Radar only uses pictures from ${d}.`],
  too_large: [422, () => 'That picture is too large. Radar accepts pictures up to 8 MB and 25 megapixels.'],
  too_small: [422, () => 'That picture is too small for a cover. It needs to be at least 600 by 314 pixels.'],
  not_a_picture: [422, () => 'That address isn’t a picture Radar can use. Radar accepts JPEG, PNG and WebP.'],
  blank_picture: [422, () => 'That picture looks blank, so Radar didn’t use it. Try another one.'],
};
function sitePictureError(error: SitePictureError, domain: string): RadarError {
  const [status, message] = SITE_PICTURE[error.code] || SITE_PICTURE.unreachable;
  return new RadarError(message(domain, error.host || 'another site'), status, error.code);
}

export const actions: ActionMap = {
  /** One whole article for the Article workspace; the workspace itself carries only `ArticleSummary` (first-five architecture §3.3). */
  'article.get': action({ read: true, input: z.object({ entryId: z.string().min(1).max(100) }), run: async (ctx, { entryId }) => {
    const { a, v } = await load(ctx.bid, entryId);
    return { article: a, v };
  } }),

  /** Autosave: brief, SEO, image fields, videos, edited blocks. */
  'article.save': action({ input: z.object({ entryId: z.string(), patch: Patch }), run: async (ctx, { entryId, patch }) => {
    const { e, a, row } = await load(ctx.bid, entryId);
    if (row.status === 'published' || row.status === 'publishing') throw new RadarError('This article is locked while it’s queued or published.');
    if (patch.img) await checkMedia(ctx.bid, entryId);
    const next: Article = { ...a, ...(patch.body ? { body: patch.body as any } : {}), brief: { ...a.brief, ...(patch.brief || {}) }, seo: { ...a.seo, ...(patch.seo || {}) }, img: patchedCover(a.img, patch.img, e.kw), ...(patch.videos ? { videos: patch.videos } : {}) };
    if (patch.seo?.slug != null) next.seo.slug = patch.seo.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    // A new style needs a new hero render (template styles are instant; photo styles use the image model when configured).
    // Not strict: a model style with no usable model stores the template with the placeholder mark, and the panel says so.
    // A real picture from the business's site is not a render of any style: the style changes, the cover stays.
    const restyled = !!patch.img?.style && patch.img.style !== a.img.style && next.generated && !realCoverOf(a.img);
    if (restyled) {
      try { next.img = await render(ctx.bid, ctx.biz, e.title, next); } catch (error) { if (next.img.modelRequired) { if (error instanceof RadarError) throw error; throw new RadarError('Radar couldn’t generate this image. Your previous cover is kept. Try again.', 502, 'image_failed'); } next.img = { ...withoutPlaceholder(next.img), url: null, urlKey: null }; }
    }
    const at = await save(ctx.bid, entryId, latest => {
      if (patch.img?.style && patch.img.style !== a.img.style && (latest.img.seed !== a.img.seed || latest.img.style !== a.img.style || latest.img.prompt !== a.img.prompt || latest.img.url !== a.img.url)) throw new RadarError('The cover changed while Radar was rendering it. Try again.', 409, 'article_changed');
      return {
      ...latest,
      ...(patch.body ? { body: patch.body as Article['body'] } : {}),
      brief: { ...latest.brief, ...patch.brief }, seo: { ...latest.seo, ...patch.seo, ...(patch.seo?.slug != null ? { slug: next.seo.slug } : {}) },
      // An older client sends style, prompt and alt together on any image edit, so ownership is decided against the latest copy.
      // After a restyle the placeholder mark follows the new render: set when it fell back, removed otherwise.
      // A real cover keeps its file under a new style; `urlKey` follows the style so the picture stays on screen.
      img: (img => (restyled ? { ...withoutPlaceholder(img), url: next.img.url, urlKey: next.img.urlKey, ...(next.img.placeholder ? { placeholder: next.img.placeholder } : {}) }
        : patch.img?.style && realCoverOf(latest.img) ? { ...img, urlKey: `${img.style}:${img.seed}` } : img))(patchedCover(latest.img, patch.img, e.kw)),
      ...(patch.videos ? { videos: patch.videos } : {}),
    }; }, !!patch.img);
    return { ok: true, ...at };
  } }),

  /** A supplied prompt explicitly requires the image model, even for an older template style. It is a person's wording
   *  only when it differs from the stored direction or that direction is already theirs: the Media field is prefilled,
   *  so "Generate from prompt" often sends back text nobody typed. Otherwise (and with no prompt, in a model style) a
   *  drafted article gets a direction read from its current text.
   *  On a cover that is a real picture from the business's site this is "Use a generated cover instead": the generated
   *  cover replaces the picture, and `noReal` is set so later rewrites do not put the picture back. */
  'article.regenerateImage': action({ input: z.object({ entryId: z.string(), prompt: z.string().trim().min(1, 'Describe the image you want.').max(1000).optional() }), run: async (ctx, { entryId, prompt }) => {
    await checkMedia(ctx.bid, entryId); // role, tenant, locks and active work, before any provider time is spent
    const { e, a } = await load(ctx.bid, entryId);
    let img: Article['img'] = { ...a.img, seed: (a.img.seed || 1) + 1 };
    let directions: ArticleImageDirections | undefined;
    const modelStyle = MODEL_STYLES.includes(img.style);
    const owners = coverDirectionIsOwners(a.img, e.kw);
    const sameText = (x: string, y: string) => x.trim().replace(/\s+/g, ' ') === y.trim().replace(/\s+/g, ' ');
    const typed = prompt !== undefined && (owners || !sameText(prompt, a.img.prompt || ''));
    // "Generate from prompt" on a direction nobody typed: a generated picture is asked for, and the direction stays as it is.
    const pressed = prompt !== undefined && !typed;
    // A typed direction replaces Radar's scene, so the alt Radar wrote for that scene no longer describes the cover: it
    // becomes the neutral built-in alt. An alt a person typed is theirs and stays.
    // The alt of a real picture is the subject's bare name, which does not describe a generated cover either.
    const wasReal = !!realCoverOf(a.img);
    const neutralAlt = (typed || wasReal) && a.img.altBy !== 'owner' ? fallbackImageDirections(e.title, a.body, []).cover.alt : undefined;
    if (typed) img = { ...img, prompt: prompt!, promptBy: 'owner', modelRequired: true, ...(neutralAlt !== undefined ? { alt: neutralAlt } : {}) };
    else if (a.generated && a.body.length && (modelStyle || pressed) && !owners) {
      // Cached on the article when the text has not changed since the last draft; otherwise one small text call.
      directions = await resolveImageDirections(ctx.bid, profileOf(ctx.biz), e, a, { budgetMs: 20_000 });
      img = { ...img, prompt: directions.cover.prompt, promptBy: 'radar', ...(a.img.altBy === 'owner' ? {} : { alt: directions.cover.alt }) };
    } else if (neutralAlt !== undefined) img = { ...img, alt: neutralAlt };
    // A person asked for a new picture: a model style, and "Generate from prompt" in any style, never answers with the
    // template. Strict for this request only; nothing is stored that makes later renders strict. On failure the cover is kept.
    try { img = await render(ctx.bid, ctx.biz, e.title, { ...a, img }, { strict: modelStyle || pressed }); }
    catch (error: any) { console.error('[article] cover generation failed', error?.message); if (error instanceof RadarError) throw error; throw new RadarError('Radar couldn’t generate this image. Your previous cover is kept. Try again.', 502, 'image_failed'); }
    await save(ctx.bid, entryId, latest => {
      if (latest.img.seed !== a.img.seed || latest.img.style !== a.img.style || latest.img.prompt !== a.img.prompt || latest.img.url !== a.img.url) throw new RadarError('The cover changed while Radar was rendering it. Try again.', 409, 'article_changed');
      return {
        ...latest,
        img: {
          ...withoutPlaceholder(latest.img), url: img.url, urlKey: img.urlKey, seed: img.seed, prompt: img.prompt, modelRequired: img.modelRequired,
          ...(img.promptBy ? { promptBy: img.promptBy } : {}),
          ...((directions || neutralAlt !== undefined) && latest.img.altBy !== 'owner' ? { alt: img.alt } : {}),
          ...(img.placeholder ? { placeholder: img.placeholder } : {}),
          ...(wasReal ? { noReal: true as const } : {}),
        },
        ...(directions ? { imageDirections: directions } : {}),
      };
    }, true);
    return { url: img.url, seed: img.seed };
  } }),

  /** "Use a picture from your site": the address of a page or a picture on the business's own domain becomes the cover,
   *  cropped to 1200×628 and stored under the business. Role, tenant, locks and active work are checked before anything
   *  is fetched, and again under the row lock when the cover is saved. Nothing is fetched from another host. */
  'article.useSitePicture': action({
    input: z.object({ entryId: z.string().min(1).max(100), url: z.string().trim().min(1, 'Enter the address of a page or picture on your site.').max(2000) }),
    run: async (ctx, { entryId, url }) => {
      await checkMedia(ctx.bid, entryId);
      const { e, a } = await load(ctx.bid, entryId);
      const domain: string = ctx.biz.domain;
      const own = ownSiteUrl(url, domain);
      if (!own.ok) throw sitePictureError(new SitePictureError(own.why === 'off_site' ? 'not_your_site' : 'invalid_address', own.host), domain);
      // Radar fetches from a domain nobody has verified, so the action is not left open to a loop.
      await enforce([{ key: 'sitepic:biz:' + ctx.bid, limit: 30, windowSec: HOUR, error: () => new RadarError('You’ve tried a lot of pictures in a short time. Try again in an hour.', 429, 'rate_limited') }]);
      const subject = a.imageDirections?.subject?.name || null;
      let picture: FoundPicture;
      try { picture = await pictureFromAddress({ domain, address: url, subject }); }
      catch (error) { if (error instanceof SitePictureError) throw sitePictureError(error, domain); throw error; }
      // The alt names what the picture shows without claiming what kind of picture it is: the article's subject, else
      // the picture's own alt text on the page, else the title. An alt a person wrote is kept (withRealCover).
      const alt = fit(subject || (picture.alt.trim().length >= 3 ? picture.alt : '') || e.title, 200);
      let stored: Article['img'];
      try { stored = await storeRealCover(ctx.bid, a.img, picture, 'owner', { alt }); }
      catch (error: any) { console.error('[article] site picture not stored', error?.message); throw new RadarError('Radar couldn’t save that picture. Your cover is unchanged. Try again.', 502, 'image_failed'); }
      const { url: file, ...record } = stored.real!;
      // The direction is deliberately not compared: typing in "Describe your image" while the picture is fetched must not fail the action.
      await save(ctx.bid, entryId, latest => {
        if (latest.img.url !== a.img.url || latest.img.seed !== a.img.seed || latest.img.style !== a.img.style) throw new RadarError('The cover changed while Radar was fetching the picture. Try again.', 409, 'article_changed');
        return { ...latest, img: withRealCover(latest.img, file, record, alt) };
      }, true);
      return { url: file, page: record.page, src: record.src };
    },
  }),

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
    const at = await save(ctx.bid, entryId, latest => ({ ...latest, sources: latest.sources.map((s, i) => i === index ? { ...s, removed } : s) }));
    return { ok: true, ...at };
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
      if (withoutPublishing) {
        await tx.update(E).set({ status: 'approved', autopilotActivationId: null }).where(eq(E.id, entryId));
        await resolveCalendarForEntries(tx, ctx.bid, [entryId]);
        await recordEngagement(tx, { businessId: ctx.bid, kind: 'article_social', ref: entryId });
        return { status: 'approved' };
      }
      const conns = await tx.select({ id: schema.connections.id }).from(schema.connections).where(eq(schema.connections.businessId, ctx.bid));
      if (!conns.length) throw new RadarError('Connect your blog to schedule this article.');
      await tx.update(E).set({ status: 'scheduled', publishError: null, autopilotActivationId: null }).where(eq(E.id, entryId));
      await resolveCalendarForEntries(tx, ctx.bid, [entryId]);
      await recordEngagement(tx, { businessId: ctx.bid, kind: 'article_social', ref: entryId });

      return { status: 'scheduled' };
    });
  } }),

  /** CONTRACT: scheduled → review ("Unscheduled. The draft is kept.") */
  'article.unschedule': action({ input: z.object({ entryId: z.string() }), run: async (ctx, { entryId }) => {
    const r = await db.update(E).set({ status: 'review', autopilotActivationId: null }).where(and(eq(E.id, entryId), eq(E.businessId, ctx.bid), eq(E.status, 'scheduled'))).returning({ id: E.id });
    if (!r.length) throw new RadarError('This article isn’t queued.');
    return { status: 'review' };
  } }),
};
