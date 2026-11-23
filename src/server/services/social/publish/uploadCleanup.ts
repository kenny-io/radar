// Custom posts: delete an image the user uploaded once nothing can still need it (custom-post-scheduling review leftovers).
// Only files under `<bid>/social-upload/` are ever deleted, and never one a send snapshot recorded: a provider that pulls
// media by URL (Instagram, TikTok) may still read it for a failed or unknown operation. Best effort and after commit:
// a failed delete is logged and never fails the request.
import { and, eq, sql } from 'drizzle-orm';
import { canPost, packSid } from '@/lib/socialPublish';
import type { Platform } from '@/lib/types';
import { db, schema } from '../../../db';
import { deleteStoredObject, storedKey } from '../../storage';

export const isUploadKey = (bid: string, url: string | null | undefined): url is string =>
  !!url && !!storedKey(bid, url)?.startsWith(`${bid}/social-upload/`);

/** Is the URL recorded in any send snapshot for this post? */
async function sentWith(bid: string, packId: string, k: Platform, url: string): Promise<boolean> {
  if (!canPost(k)) return false;
  const P = schema.socialPubs;
  const [row] = await db.select({ id: P.id }).from(P)
    .where(and(eq(P.businessId, bid), eq(P.sid, packSid(packId, k)), sql`${P.payload}->'media' @> ${JSON.stringify([{ url }])}::jsonb`)).limit(1);
  return !!row;
}

/** Delete an upload the pack no longer references (replaced, removed, or a refused attach). Never throws. */
export async function discardUpload(bid: string, packId: string, k: Platform, url: string | null | undefined): Promise<boolean> {
  if (!isUploadKey(bid, url)) return false;
  try {
    if (await sentWith(bid, packId, k, url)) return false;
    await deleteStoredObject(bid, url);
    return true;
  } catch (e: any) {
    console.log(`[social] upload cleanup failed: pack ${packId} ${k}: ${e?.message || e}`);
    return false;
  }
}
