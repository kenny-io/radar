// Pubs (social_pubs rows) as the client sees them, and the content a sid points at (architecture.md §3–§4, §9.2).
// Pack and brief jsonb hold content only; publishing state lives in the row and is projected on read.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { getPack, renderPostImage, updatePack, type StoredPack } from '../generate';
import { getDay, withDay } from '../../brief/store';
import { LIMITS, canPost, canReply, parseSid, zonedTimeToUtc, type PostPlatform, type PreflightInput } from '@/lib/socialPublish';
import { textOf } from '@/features/brief/model';
import type { BriefItem, MediaMeta, Profile, Pub, PubErrCode, SocialAccount } from '@/lib/types';
import type { BizRow } from '../../../workspace';
import { metaOf } from './media';

export type PubRow = typeof schema.socialPubs.$inferSelect;
export const P = schema.socialPubs;
/** Rows whose pack or brief item was deleted: dropped from the projection (they can never send). */
export const CONTENT_MISSING = 'content missing';

export function pubOf(r: PubRow, accts: Pick<SocialAccount, 'id' | 'expired'>[]): Pub {
  const a = r.acctId ? accts.find(x => x.id === r.acctId) : null;
  return {
    status: r.status, platform: r.platform, date: String(r.date), time: r.time, dueAt: r.dueAt.toISOString(),
    acct: r.acctId, acctLabel: r.acctLabel, err: r.err, code: (r.errCode as PubErrCode) || null,
    at: r.postedAt ? r.postedAt.getTime() : null, url: r.remoteUrl,
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
  text: string; images: Img[]; imagesPending: boolean;
  pack?: StoredPack; packId?: string;
  day?: string; item?: BriefItem; company?: boolean;
  /** Pack post with no rendered file yet (imageUrl null): rendered on the server before it's checked or sent. */
  needsRender?: boolean;
}
/** Resolve a sid inside this business. null when the pack/post or the brief day/item doesn't exist, or can't be posted. */
export async function loadTarget(bid: string, sid: string): Promise<Target | null> {
  const s = parseSid(sid); if (!s) return null;
  if (s.src === 'pack') {
    const pack = await getPack(bid, s.packId); const post = pack?.posts[s.platform];
    if (!pack || !post) return null;
    return { sid, src: 'pack', platform: s.platform, kind: 'post', text: post.text || '', images: post.imageUrl ? [{ url: post.imageUrl, meta: post.imageMeta ?? null }] : [], imagesPending: false, pack, packId: pack.id, needsRender: !post.imageUrl };
  }
  const day = await getDay(bid, s.day);
  const item = (day?.items as BriefItem[] | undefined)?.find(i => i.id === s.itemId);
  if (!item) return null;
  const k = item.kind === 'post' ? item.pl : item.plat;
  if (item.kind === 'post' ? !canPost(k) : !canReply(k)) return null;
  const imgs: Img[] = [];
  if (item.kind === 'post' && item.img) item.img.urls.forEach((u, i) => { if (u) imgs.push({ url: u, meta: item.img!.meta?.[i] ?? null, i }); });
  return { sid, src: 'brief', platform: k as PostPlatform, kind: item.kind, text: textOf(item), images: k === 'x' ? imgs.slice(0, LIMITS.x.imgs) : imgs, imagesPending: item.kind === 'post' && item.img?.status === 'generating', day: s.day, item, company: (item.acct || 'founder') === 'company' };
}
export const preflightInput = (t: Target): PreflightInput => ({ text: t.text, images: t.images.map(i => i.meta), imagesPending: t.imagesPending });

/** Give every image a real file and known meta: render a pack post's missing visual, read unknown sizes from the file, and
 *  persist both (A21). Mutates and returns the target. */
export async function ensureImages(biz: BizRow, t: Target): Promise<Target> {
  const bid = biz.id;
  if (t.src === 'pack' && t.needsRender && t.pack) {
    const post = t.pack.posts[t.platform]!; const p = { ...(biz.profile as Profile), domain: biz.domain };
    const r = await renderPostImage(bid, p, t.platform, post, t.pack.headline || t.pack.source.label, t.pack.custom);
    await updatePack(bid, t.pack.id, x => { const cur = x.posts[t.platform]; return cur && !cur.imageUrl ? { ...x, posts: { ...x.posts, [t.platform]: { ...cur, imageUrl: r.url, imageMeta: r.meta, photo: r.photo } } } : x; });
    t.images = [{ url: r.url, meta: r.meta }]; t.needsRender = false;
  }
  const unknown = t.images.filter(i => !i.meta);
  if (!unknown.length) return t;
  for (const i of unknown) i.meta = await metaOf(i.url);
  if (t.src === 'pack' && t.pack) {
    const i = t.images[0];
    if (i?.meta) await updatePack(bid, t.pack.id, x => { const cur = x.posts[t.platform]; return cur && cur.imageUrl === i.url ? { ...x, posts: { ...x.posts, [t.platform]: { ...cur, imageMeta: i.meta } } } : x; });
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
