import { and, eq } from 'drizzle-orm';
import { schema } from '@/server/db';
import { automaticMediaReady, parseSid } from '@/lib/socialPublish';
import type { SocialPack } from '@/lib/types';
import type { RetentionTx } from './youtubeRetention';
/** Fresh automatic-only boundary. Business-first locking follows generation/deletion lock order. No network under locks. */
export async function automaticMediaReadyAtBoundary(q: RetentionTx, bid: string, sid: string): Promise<boolean> {
  const s = parseSid(sid);
  if (!s || s.src !== 'pack') return false;
  const [b] = await q.select({ status: schema.businesses.status }).from(schema.businesses).where(eq(schema.businesses.id, bid)).for('update');
  if (b?.status !== 'active') return false;
  const [row] = await q.select({ data: schema.socialPacks.data }).from(schema.socialPacks).where(and(eq(schema.socialPacks.businessId, bid), eq(schema.socialPacks.id, s.packId))).for('update');
  const pack = row?.data as SocialPack | undefined;
  return automaticMediaReady(pack?.posts[s.platform]);
}
