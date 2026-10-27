// Starting drafts: "Draft now", "Rewrite from brief", the D-1 cron and autopilot all go through here.
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { assertArticleEditable, assertNoArticleWork, lockArticle } from './guard';
import type { DraftPayload } from './draft';

/** Move approved/proposed entries to drafting and enqueue `article.draft` (ref = entryId). Idempotent per entry. */
export async function startDraft(bid: string, entryId: string, source: DraftPayload['source'], batch?: { id: string; ids: string[] }): Promise<string> {
  const payload: DraftPayload = { entryId, source, ...(batch ? { batchId: batch.id, batch: batch.ids } : {}) };
  return db.transaction(async tx => {
    const row = await lockArticle(tx, bid, entryId);
    assertArticleEditable(row.status, row.publishRemote);
    // Repeated starts of the same draft are idempotent; an image job still blocks a rewrite.
    const existing = (await tx.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.businessId, bid), eq(schema.jobs.ref, entryId), eq(schema.jobs.kind, 'article.draft'), inArray(schema.jobs.status, ['queued', 'running']))).limit(1))[0];
    if (existing) return existing.id;
    await assertNoArticleWork(tx, bid, entryId);
    await tx.update(schema.calendarEntries).set({ status: 'drafting' }).where(eq(schema.calendarEntries.id, entryId));
    return (await tx.insert(schema.jobs).values({ kind: 'article.draft', payload, businessId: bid, ref: entryId, singletonKey: 'draft:' + entryId, maxAttempts: 2 }).returning({ id: schema.jobs.id }))[0].id;
  });
}
