// Starting drafts: "Draft now", "Rewrite from brief", the D-1 cron and autopilot all go through here.
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { enqueue } from '../../jobs/queue';
import type { DraftPayload } from './draft';

/** Move approved/proposed entries to drafting and enqueue `article.draft` (ref = entryId). Idempotent per entry. */
export async function startDraft(bid: string, entryId: string, source: DraftPayload['source'], batch?: { id: string; ids: string[] }): Promise<string> {
  await db.update(schema.calendarEntries).set({ status: 'drafting' })
    .where(and(eq(schema.calendarEntries.id, entryId), eq(schema.calendarEntries.businessId, bid), inArray(schema.calendarEntries.status, ['approved', 'proposed'])));
  const payload: DraftPayload = { entryId, source, ...(batch ? { batchId: batch.id, batch: batch.ids } : {}) };
  return enqueue('article.draft', payload, { businessId: bid, ref: entryId, singletonKey: 'draft:' + entryId });
}
