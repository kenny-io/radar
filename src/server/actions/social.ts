// Actions for Social Marketing (01-screens §7, 02-system §8): generate, edit and track copies of packs stored in the library.
// Posting to connected X / LinkedIn accounts lives in ./socialPublish (behind RADAR_SOCIAL_PUBLISHING); here it only adds
// the edit lock near a post's send time and the image meta the posting checks use.
import { z } from 'zod';
import { and, eq, ne } from 'drizzle-orm';
import { action, type ActionMap, type ActCtx } from './define';
import { db, schema } from '../db';
import { enqueue } from '../jobs/queue';
import { RadarError, notFound } from '../errors';
import { getPack, renderPostImage, updatePack, writePost, type StoredPack } from '../services/social/generate';
import { suggestIdeas } from '../services/social/ideas';
import { DAYS } from '../services/social/auto';
import type { ImageStyle, Platform, Profile } from '@/lib/types';
import { COPY, canPost, packSid } from '@/lib/socialPublish';
import { socialOn } from '../flags';
import { assertEditable } from '../services/social/publish/guards';
import { randomToken } from '../crypto';
import { accountRows } from '../services/social/publish/accounts';

const PlatformZ = z.enum(['linkedin', 'x', 'facebook', 'reddit', 'quora']);
const ImageStyleZ = z.enum(['branded', 'illustration', 'photography', 'infographic']);
const PackStyleZ = z.enum(['branded', 'illustration', 'photography', 'infographic', 'custom']);
const URL_RE = /^https?:\/\/\S+\.\S+/;
const profileOf = (biz: any): Profile => ({ ...(biz.profile as Profile), domain: biz.domain });

async function packOr404(bid: string, id: string) { const p = await getPack(bid, id); if (!p) throw notFound('Pack'); return p; }
const postOr404 = (p: StoredPack, k: Platform) => { const q = p.posts[k]; if (!q) throw notFound('Post'); return q; };
/** Social channels: a post that sends within 5 minutes can't be changed (COPY.lockedEdit, 409). No-op with the flag off. */
const editable = (ctx: { biz: any }, packId: string, k: Platform) => (canPost(k) ? assertEditable(ctx.biz, packSid(packId, k)) : Promise.resolve());
const setPost = (bid: string, id: string, k: Platform, patch: Record<string, any>) =>
  updatePack(bid, id, p => ({ ...p, posts: { ...p.posts, [k]: { ...postOr404(p, k), ...patch } } })).catch(e => { if (e?.notFound) throw notFound('Pack'); throw e; });

/** Reserve a request before rendering; update only its image fields after storage succeeds. */
async function changeImage(ctx: ActCtx, i: { packId: string; platform: Platform; prompt?: string; style?: ImageStyle }) {
  await editable(ctx, i.packId, i.platform);
  await packOr404(ctx.bid, i.packId);
  const request = randomToken(16);
  const reserved = await updatePack(ctx.bid, i.packId, async p => {
    await editable(ctx, i.packId, i.platform);
    const q = postOr404(p, i.platform);
    return { ...p, posts: { ...p.posts, [i.platform]: { ...q, imageRequest: request, ...(i.prompt !== undefined ? { imagePrompt: i.prompt } : {}) } } };
  }).catch(e => { if (e?.notFound) throw notFound('Pack'); throw e; });
  const q = postOr404(reserved, i.platform); const seed = (q.seed || 1) + 11; const style = i.style || q.style;
  let result;
  try { result = await renderPostImage(ctx.bid, profileOf(ctx.biz), i.platform, { style, seed, imagePrompt: q.imagePrompt }, reserved.headline || reserved.source.label, reserved.custom); }
  catch (e: any) { console.error('[social] render failed', e?.message); if (e instanceof RadarError) throw e; throw new RadarError('Radar couldn’t generate this image. Your previous image is kept. Try again.', 502, 'image_failed'); }
  await updatePack(ctx.bid, i.packId, async p => {
    await editable(ctx, i.packId, i.platform);
    const cur = postOr404(p, i.platform);
    if (cur.imageRequest !== request || cur.seed !== q.seed || cur.style !== q.style || cur.imageUrl !== q.imageUrl || cur.imagePrompt !== q.imagePrompt) throw new RadarError('The image changed while Radar was generating it. Try again.', 409, 'image_changed');
    return { ...p, posts: { ...p.posts, [i.platform]: { ...cur, seed, style, imageUrl: result.url, photo: result.photo, imageMeta: result.meta, compressed: false } } };
  }).catch(e => { if (e?.notFound) throw notFound('Pack'); throw e; });
  return { seed, imageUrl: result.url };
}

export const actions: ActionMap = {
  /** Start a pack: job social.generate (ref = client token) → progress { done }, result { packId }. */
  'social.generate': action({
    input: z.object({
      token: z.string().min(6).max(64),
      source: z.object({ kind: z.enum(['idea', 'url', 'article', 'suggest']), label: z.string().max(2000), ref: z.string().max(200).nullish() }),
      platforms: z.array(PlatformZ).max(5), style: PackStyleZ, custom: z.string().max(600).optional(), voice: z.string().max(600).optional(),
      idea: z.object({ metric: z.string().max(400).optional(), why: z.string().max(400).optional(), tie: z.string().max(400).nullish(), page: z.string().max(400).nullish(), q: z.string().max(400).optional() }).nullish(),
    }),
    run: async (ctx, i) => {
      const label = i.source.label.trim(); const k = i.source.kind;
      // Same validation (and copy) as the flow.
      if (k === 'suggest' && !label) throw new RadarError('Pick an idea to continue.');
      if (k === 'idea' && label.length < 8) throw new RadarError('Describe the idea in a few words.');
      if (k === 'url' && !URL_RE.test(label)) throw new RadarError('Paste a full URL, starting with https://');
      let ref: string | null = null;
      if (k === 'article') {
        const e = i.source.ref ? (await db.select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.businessId, ctx.bid), eq(schema.calendarEntries.id, i.source.ref), ne(schema.calendarEntries.status, 'proposed'))).limit(1))[0] : null;
        if (!e) throw new RadarError('Choose an article.');
        ref = e.id;
      }
      const platforms = [...new Set(i.platforms)];
      if (!platforms.length) throw new RadarError('Pick at least one platform.');
      if (i.style === 'custom' && !(i.custom || '').trim()) throw new RadarError('Describe the look you want.');
      const label2 = k === 'article' ? (await db.select({ t: schema.calendarEntries.title }).from(schema.calendarEntries).where(eq(schema.calendarEntries.id, ref!)).limit(1))[0].t : label;
      const jobId = await enqueue('social.generate', { source: { kind: k, label: label2, ref }, platforms, style: i.style, custom: i.custom?.trim() || '', voice: i.voice?.trim() || '', idea: k === 'suggest' ? i.idea || null : null }, { businessId: ctx.bid, ref: i.token, maxAttempts: 2 });
      return { jobId };
    },
  }),

  /** Suggest ideas (02-system §8.3). Ranked, substantiated; footer state from `gsc`. */
  'social.ideas': action({
    read: true, role: 'Editor', input: z.object({ fresh: z.boolean().optional() }),
    run: async (ctx, i) => {
      const r = await suggestIdeas(ctx.bid, { fresh: i.fresh });
      return { gsc: r.gsc, ideas: r.ideas.map(x => ({ t: x.t, metric: x.metric, why: x.why, tie: x.tie, page: x.page, q: x.q })) };
    },
  }),

  /** Autosave edited post text. */
  'social.text': action({
    input: z.object({ packId: z.string().max(64), platform: PlatformZ, text: z.string().max(20000) }),
    run: async (ctx, i) => { await editable(ctx, i.packId, i.platform); await setPost(ctx.bid, i.packId, i.platform, { text: i.text }); return null; },
  }),

  /** Copy text: tracked as copied only — "not tracked as published". Viewers can copy too. */
  'social.copied': action({
    role: 'Viewer', input: z.object({ packId: z.string().max(64), platform: PlatformZ }),
    run: async (ctx, i) => { const at = Date.now(); await setPost(ctx.bid, i.packId, i.platform, { copiedAt: at }); return { copiedAt: at }; },
  }),

  /** Regenerate text → v + 1 (the writing model runs outside the row lock). */
  'social.regenText': action({
    input: z.object({ packId: z.string().max(64), platform: PlatformZ }),
    run: async (ctx, i) => {
      await editable(ctx, i.packId, i.platform);
      const p = await packOr404(ctx.bid, i.packId); const q = postOr404(p, i.platform); const v = (q.v || 0) + 1;
      const g = { headline: p.headline || p.source.label, brief: p.grounding?.brief || `Idea from the user: ${p.source.label}`, link: p.grounding?.link ?? null };
      const text = await writePost(ctx.bid, profileOf(ctx.biz), i.platform, { kind: p.source.kind, label: p.source.label, g, voice: p.voice, v: v + (q.seed || 0), previous: q.text });
      await setPost(ctx.bid, i.packId, i.platform, { text, v });
      return { text, v };
    },
  }),

  /** Regenerate the selected platform, reusing its saved custom direction unless one is supplied. */
  'social.regenImage': action({
    input: z.object({ packId: z.string().max(64), platform: PlatformZ, prompt: z.string().trim().min(1, 'Describe the image you want.').max(1000).optional() }),
    run: changeImage,
  }),

  /** Render the new style before replacing the previous complete image. */
  'social.style': action({
    input: z.object({ packId: z.string().max(64), platform: PlatformZ, style: ImageStyleZ }),
    run: changeImage,
  }),

  /** Automatic generation settings (AutoModal). */
  'social.auto': action({
    role: 'Editor',
    input: z.object({ auto: z.object({ on: z.boolean(), freq: z.enum(['daily', 'custom']), days: z.array(z.enum(DAYS as [string, ...string[]])).max(7), platforms: z.array(PlatformZ).max(5), style: ImageStyleZ, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), post: z.enum(['library', 'schedule']).optional() }) }),
    run: async (ctx, { auto }) => {
      if (auto.on && !auto.platforms.length) throw new RadarError('Pick at least one platform.');
      // When a pack is ready → Schedule posts needs a live account; with publishing off it is always Save to library.
      const publishing = await socialOn(ctx.biz);
      const post = !publishing ? (auto.post ? 'library' as const : undefined) : auto.post;
      if (publishing && auto.on && post === 'schedule' && !(await accountRows(ctx.bid)).some(r => !r.expired)) throw new RadarError(COPY.noAccountForAuto, 400, 'no_account');
      const a = { ...auto, ...(post ? { post } : {}), days: DAYS.filter(d => auto.days.includes(d)), platforms: (['linkedin', 'x', 'facebook', 'reddit', 'quora'] as Platform[]).filter(k => auto.platforms.includes(k)) };
      await db.update(schema.businesses).set({ socialAuto: a }).where(eq(schema.businesses.id, ctx.bid));
      return a;
    },
  }),
};
