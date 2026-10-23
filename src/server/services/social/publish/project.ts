// Projection of publishing state into the Workspace (architecture.md §4). Runs only when RADAR_SOCIAL_PUBLISHING is on for the
// business; with it off the workspace is exactly as before this feature (no fields, and the jsonb additions are stripped).
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { canPost, packSid, parseSid } from '@/lib/socialPublish';
import type { BriefDay, BriefItem, Pub, SocialAccount, SocialAuto, SocialChannel, SocialPack } from '@/lib/types';
import { accountRows, acctPublic, channelsAvailable } from './accounts';
import { pubOf, pubRows } from './pubs';

export interface SocialProjection { accounts: SocialAccount[]; channels: SocialChannel[]; pubs: Map<string, Pub> }
export async function socialProjection(bid: string): Promise<SocialProjection> {
  const [rows, pubs] = await Promise.all([accountRows(bid), pubRows(bid)]);
  const accounts = rows.map(acctPublic);
  return { accounts, channels: channelsAvailable(), pubs: new Map(pubs.map(r => [r.sid, pubOf(r, accounts)])) };
}
/** Brief days outside the 30-day window that still have pubs (a post rescheduled far ahead), so they stay visible. */
export async function extraBriefDays(bid: string, proj: SocialProjection, have: Record<string, BriefDay>) {
  const days = [...new Set([...proj.pubs.keys()].map(parseSid).filter(s => s?.src === 'brief').map(s => (s as { day: string }).day))].filter(d => !have[d]);
  if (!days.length) return [];
  return db.select().from(schema.briefDays).where(and(eq(schema.briefDays.businessId, bid), inArray(schema.briefDays.date, days)));
}
/** pack.posts[k].pub and Brief item.pub / st='scheduled' (applied after the past-day expiry mapping). */
export function applySocial(packs: SocialPack[], days: Record<string, BriefDay>, proj: SocialProjection) {
  for (const p of packs) for (const k of Object.keys(p.posts || {})) {
    if (!canPost(k)) continue;
    p.posts[k] = { ...p.posts[k]!, pub: proj.pubs.get(packSid(p.id, k)) ?? null };
  }
  for (const [date, d] of Object.entries(days)) d.items = d.items.map((it: BriefItem) => {
    const pub = proj.pubs.get(`b:${date}:${it.id}`);
    if (!pub) return it;
    return { ...it, pub, st: pub.status === 'scheduled' || pub.status === 'sending' ? 'scheduled' : it.st };
  });
}
/** Flag off: hide what this feature added to the jsonb (image meta, compressed, auto.post). */
export function stripSocial(packs: SocialPack[], days: Record<string, BriefDay>, auto: SocialAuto) {
  for (const p of packs) for (const k of Object.keys(p.posts || {})) {
    const q = p.posts[k as keyof typeof p.posts]; if (!q || (!('imageMeta' in q) && !('compressed' in q) && !('pub' in q))) continue;
    const { imageMeta: _m, compressed: _c, pub: _p, ...rest } = q; p.posts[k as keyof typeof p.posts] = rest as any;
  }
  for (const d of Object.values(days)) d.items = d.items.map(it => { if (!it.img || !('meta' in it.img)) return it; const { meta: _m, ...img } = it.img; return { ...it, img }; });
  delete auto.post; // absent = Save to library, as before this feature
}
