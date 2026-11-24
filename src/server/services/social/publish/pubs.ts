// Pubs (social_pubs rows) as the client sees them, and the content a sid points at (architecture.md §3–§4, §9.2).
// Pack and brief jsonb hold content only; publishing state lives in the row and is projected on read.
import { YOUTUBE_LABEL, YOUTUBE_NO_RESEND, YOUTUBE_APPROVAL, youtubeReceiptStale } from '@/lib/youtubeLifecycle';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { getPack, renderPostImage, updatePack, type StoredPack } from '../generate';
import { getDay, withDay } from '../../brief/store';
import { LIMITS, canPost, canReply, mediaGenerationPending, parseSid, zonedTimeToUtc, type PostPlatform, type PreflightInput } from '@/lib/socialPublish';
import { textOf } from '@/features/brief/model';
import type { BriefItem, MediaMeta, Profile, Pub, PubErrCode, SocialAccount, SocialVideo, SocialPublishOptions } from '@/lib/types';
import type { BizRow } from '../../../workspace';
import { readImage, videoMeta, videoDuration } from './media';
import { readStored, storedKey } from '../../storage';
import { RadarError } from '../../../errors';
import { MODEL_STYLES, imageModelConfigured } from '../../images';
import { loadImage } from '@napi-rs/canvas';

export type PubRow = typeof schema.socialPubs.$inferSelect;
export const P = schema.socialPubs;
/** Rows whose pack or brief item was deleted: dropped from the projection (they can never send). */
export const CONTENT_MISSING = 'content missing';

export function pubOf(r: PubRow, accts: Pick<SocialAccount, 'id' | 'expired'>[]): Pub {
  const removed = r.ch === 'youtube' && youtubeReceiptStale(r);
  const marker = r.payload?.youtubeRetention;
  const noResend = r.ch === 'youtube' && (!!marker?.noResend || r.status === 'failed' && (r.errCode === 'unknown' || !!r.payload?.providerRef || !!r.remoteId) || removed && (r.status === 'posted' || r.errCode === 'unknown' || !!r.payload?.providerRef || !!r.remoteId || r.status === 'sending' && r.stage === 'create'));
  const a = r.acctId ? accts.find(x => x.id === r.acctId) : null;
  return {
    status: r.status, platform: r.platform, date: String(r.date), time: r.time, dueAt: r.dueAt.toISOString(),
    acct: r.acctId, acctLabel: removed ? YOUTUBE_LABEL : r.acctLabel, err: removed && r.status !== 'posted' ? noResend ? YOUTUBE_NO_RESEND : YOUTUBE_APPROVAL : r.err, code: (r.errCode as PubErrCode) || null,
    at: r.postedAt ? r.postedAt.getTime() : null, url: removed ? null : r.remoteUrl, ...(r.ch === 'youtube' ? { noResend, needsApproval: !!marker?.needsApproval, historyExpired: removed } : {}),
    direct: r.src === 'brief' || undefined,
    held: r.status === 'scheduled' && !!a?.expired,
  };
}
export async function pubRows(bid: string): Promise<PubRow[]> {
  return (await db.select().from(P).where(eq(P.businessId, bid))).filter(r => !(r.status === 'failed' && r.errDetail === CONTENT_MISSING));
}
export async function pubRow(bid: string, sid: string): Promise<PubRow | null> {
  return (await db.select().from(P).where(and(eq(P.businessId, bid), eq(P.sid, sid))).limit(1))[0] || null;
}
/** Business time zone changed: wall-clock date+time is the intent, so recompute due_at for every scheduled row. */
export async function retimePubs(bid: string, tz: string) {
  const rows = await db.select({ id: P.id, date: P.date, time: P.time }).from(P).where(and(eq(P.businessId, bid), eq(P.status, 'scheduled')));
  for (const r of rows) await db.update(P).set({ dueAt: new Date(zonedTimeToUtc(String(r.date), r.time, tz)), updatedAt: new Date() }).where(and(eq(P.id, r.id), eq(P.status, 'scheduled')));
  return rows.length;
}
export async function scheduledCountFor(acctId: string, sinceMs?: number): Promise<number> {
  const conds = [eq(P.acctId, acctId), eq(P.status, 'scheduled')];
  if (sinceMs != null) conds.push(sql`${P.dueAt} > ${new Date(sinceMs).toISOString()}::timestamptz`);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(P).where(and(...conds));
  return n;
}
export const pubsByIds = (ids: string[]) => (ids.length ? db.select().from(P).where(inArray(P.id, ids)) : Promise.resolve([] as PubRow[]));

/* ── What a sid points at ── */
export interface Img { url: string; meta: MediaMeta | null; /** brief: index in img.urls */ i?: number }
export interface Target {
  sid: string; src: 'pack' | 'brief'; platform: PostPlatform; kind: 'post' | 'reply';
  video?: SocialVideo | null; options?: SocialPublishOptions;
  text: string; images: Img[]; imagesPending: boolean;
  mediaPending?: boolean;
  pack?: StoredPack; packId?: string;
  day?: string; item?: BriefItem; company?: boolean;
  /** The images came from the image model (X `made_with_ai`), not a canvas template. */
  aiMedia?: boolean;
  /** Pack post with no rendered file yet (imageUrl null): rendered on the server before it's checked or sent. */
  needsRender?: boolean;
  /** The user wrote this post and owns its media (`author: 'user'`): never rendered, never labelled AI. */
  own?: boolean;
}
/** Resolve a sid inside this business. null when the pack/post or the brief day/item doesn't exist, or can't be posted. */
export async function loadTarget(bid: string, sid: string): Promise<Target | null> {
  const s = parseSid(sid); if (!s) return null;
  if (s.src === 'pack') {
    const pack = await getPack(bid, s.packId); const post = pack?.posts[s.platform];
    if (!pack || !post) return null;
    const own = post.author === 'user';
    return { sid, src: 'pack', platform: s.platform, kind: 'post', text: post.text || '', video: post.video, options: post.publishOptions,
      images: post.video || s.platform === 'youtube' ? [] : post.slides?.length ? post.slides.map(slide => ({ url: slide.url, meta: slide.meta })) : post.imageUrl ? [{ url: post.imageUrl, meta: post.imageMeta ?? null }] : [],
      imagesPending: false, mediaPending: mediaGenerationPending(post), pack, packId: pack.id,
      needsRender: !own && !post.video && !post.slides?.length && !post.mediaGeneration && s.platform !== 'youtube' && !post.imageUrl,
      aiMedia: !own && (!!post.generatedMedia?.aiGenerated || (!post.video && !!(post as { photo?: boolean }).photo)), ...(own ? { own } : {}) };
  }
  const day = await getDay(bid, s.day);
  const item = (day?.items as BriefItem[] | undefined)?.find(i => i.id === s.itemId);
  if (!item) return null;
  const k = item.kind === 'post' ? item.pl : item.plat;
  if (item.kind === 'post' ? !canPost(k) : !canReply(k)) return null;
  const imgs: Img[] = [];
  if (item.kind === 'post' && item.img) item.img.urls.forEach((u, i) => { if (u) imgs.push({ url: u, meta: item.img!.meta?.[i] ?? null, i }); });
  return { sid, src: 'brief', platform: k as PostPlatform, kind: item.kind, text: textOf(item), images: k === 'x' ? imgs.slice(0, LIMITS.x.imgs) : imgs, imagesPending: item.kind === 'post' && item.img?.status === 'generating', day: s.day, item, company: (item.acct || 'founder') === 'company', aiMedia: !!item.img && MODEL_STYLES.includes(item.img.style) && imageModelConfigured() };
}
export const preflightInput = (t: Target): PreflightInput => ({ text: t.text, images: t.images.map(i => i.meta), imagesPending: t.imagesPending, mediaPending: t.mediaPending, video: t.video, options: t.options, ...(t.own ? { own: true } : {}) });

/** Give every image a real file and known meta: render a pack post's missing visual, read unknown sizes from the file, and
 *  persist both (A21). Mutates and returns the target. */
export async function ensureImages(biz: BizRow, t: Target): Promise<Target> {
  const bid = biz.id;
  if (t.mediaPending) throw new RadarError('Finish or cancel the explainer media generation before posting.', 409, 'media_pending');
  const slides = t.pack?.posts[t.platform]?.slides;
  if (slides?.length && (t.platform !== 'instagram' || slides.length < 2 || slides.length > 10 || !!t.video)) throw new RadarError('Choose an Instagram carousel of 2–10 slides, or a video.', 400, 'media');
  if (t.src === 'pack' && t.needsRender && t.pack) {
    const post = t.pack.posts[t.platform]!; const p = { ...(biz.profile as Profile), domain: biz.domain };
    const r = await renderPostImage(bid, p, t.platform, post, t.pack.headline || t.pack.source.label, t.pack.custom);
    await updatePack(bid, t.pack.id, x => { const cur = x.posts[t.platform]; return cur && !cur.imageUrl ? { ...x, posts: { ...x.posts, [t.platform]: { ...cur, imageUrl: r.url, imageMeta: r.meta, photo: r.photo } } } : x; });
    t.images = [{ url: r.url, meta: r.meta }]; t.needsRender = false; t.aiMedia = r.photo;
  }
  if (t.video) {
    const f = await readStored(bid, t.video.url);
    const meta = f && videoMeta(f.body);
    if (!meta) throw new RadarError('That video is missing or invalid. Upload it again.', 400, 'media');
    t.video = { ...t.video, meta, durationSec: videoDuration(f!.body) };
  }
  for (const i of t.images) {
    if (!storedKey(bid, i.url)) throw new RadarError('That image does not belong to this business.', 400, 'media');
    const file = await readImage(i.url, bid);
    if (!file) throw new RadarError(t.own ? 'That image is missing. Upload it again.' : 'That image is missing. Generate it again.', 400, 'media');
    if (slides?.length) {
      if (file.type !== 'image/jpeg' || file.bytes.length > 5 * 1024 * 1024) throw new RadarError('Each Instagram slide must be a JPEG smaller than 5 MB.', 400, 'media');
      let dimensions;
      try { dimensions = await loadImage(file.bytes); } catch { throw new RadarError('An Instagram slide is invalid. Generate the slides again.', 400, 'media'); }
      const ratio = dimensions.width / dimensions.height;
      if (ratio < 0.8 || ratio > 1.91) throw new RadarError('Instagram slide proportions must be between 4:5 and 1.91:1.', 400, 'media');
    }
    i.meta = file.meta;
  }
  if (!t.images.length) return t;
  if (t.src === 'pack' && t.pack) {
    const i = t.images[0];
    if (i?.meta) await updatePack(bid, t.pack.id, x => { const cur = x.posts[t.platform];
      if (!cur) return x;
      if (cur.slides?.length) return { ...x, posts: { ...x.posts, [t.platform]: { ...cur, slides: cur.slides.map(slide => ({ ...slide, meta: t.images.find(img => img.url === slide.url)?.meta || slide.meta })) } } };
      return cur.imageUrl === i.url ? { ...x, posts: { ...x.posts, [t.platform]: { ...cur, imageMeta: i.meta } } } : x;
    });
  } else if (t.day && t.item) {
    await withDay(bid, t.day, row => {
      const items = row.items as BriefItem[]; const k = items.findIndex(x => x.id === t.item!.id); const cur = items[k];
      if (!cur?.img) return null;
      const meta = cur.img.urls.map((u, j) => cur.img!.meta?.[j] ?? t.images.find(x => x.i === j && x.url === u)?.meta ?? null);
      const next = [...items]; next[k] = { ...cur, img: { ...cur.img, meta } };
      return { items: next, ret: true };
    });
  }
  return t;
}
