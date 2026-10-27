// Serialize article operations on the calendar row. Job rows are the durable busy marker across web/worker processes.
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { RadarError, notFound } from '@/server/errors';

export type ArticleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function lockArticle(tx: ArticleTx, bid: string, entryId: string) {
  const row = (await tx.select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.id, entryId), eq(schema.calendarEntries.businessId, bid))).for('update').limit(1))[0];
  if (!row) throw notFound('That article');
  return row;
}
export async function assertNoArticleWork(tx: ArticleTx, bid: string, entryId: string, exceptJobId?: string) {
  const busy = (await tx.select({ id: schema.jobs.id }).from(schema.jobs).where(and(
    eq(schema.jobs.businessId, bid), eq(schema.jobs.ref, entryId),
    inArray(schema.jobs.kind, ['article.draft', 'article.bodyImages']), inArray(schema.jobs.status, ['queued', 'running']),
    exceptJobId ? ne(schema.jobs.id, exceptJobId) : undefined,
  )).limit(1))[0];
  if (busy) throw new RadarError('Wait for Radar to finish this article before making changes.', 409, 'article_busy');
}
export function assertArticleEditable(status: string, publishRemote?: unknown) {
  if (['scheduled', 'publishing', 'published'].includes(status)) throw new RadarError('Unqueue this article before changing its images or draft.', 409, 'article_locked');
  if (status === 'failed' && publishRemote) throw new RadarError('Retry the pending publication before changing this article’s images or draft.', 409, 'publication_pending');
}
export async function assertNoDraftWork(tx: ArticleTx, bid: string, entryId: string) {
  const busy = (await tx.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.businessId, bid), eq(schema.jobs.ref, entryId), eq(schema.jobs.kind, 'article.draft'), inArray(schema.jobs.status, ['queued', 'running']))).limit(1))[0];
  if (busy) throw new RadarError('Wait for Radar to finish writing this article before making changes.', 409, 'article_busy');
}
/** A timeout does not cancel provider promises. Only the still-current worker attempt may commit its output. */
export async function assertArticleJobOwned(tx: ArticleTx, snapshot: typeof schema.jobs.$inferSelect) {
  const current = (await tx.select().from(schema.jobs).where(eq(schema.jobs.id, snapshot.id)).for('update').limit(1))[0];
  if (!current || !['queued', 'running'].includes(current.status) || current.attempts !== snapshot.attempts || current.lockedBy !== snapshot.lockedBy || (snapshot.status === 'running' && current.status !== 'running')) {
    throw new RadarError('This article task has expired. Retry to generate fresh images.', 409, 'stale_job');
  }
}
