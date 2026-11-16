// Delete and restore a business (.factory/delete-business/architecture.md §3). A delete marks the row and stops its
// queued work; nothing is removed until the wipe, 168 hours later, so a restore brings back exactly the same business.
// The database clock decides every time here: `deleted_at`, `purge_at`, and whether a restore is still allowed.
import { and, desc, eq, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { RadarError, forbidden, notFound } from '../errors';
import { accessSummary, bizAccess } from '../billing/access';
import { track } from '../events';
import { reportFailure } from '../observability/failures';
import { lastDueDate } from '../services/publishing/due';
import { errCopy } from '@/lib/socialPublish';
import { domainMatches } from '@/lib/deletion';
import type { DeleteBusinessResult, DeletedBusiness, RestoreBusinessResult } from '@/lib/types';
import { RETENTION_INTERVAL, SKIPPED_DELETED } from './state';

export { businessDeleted, isBusinessDeleted } from './state';

const B = schema.businesses;
const E = schema.calendarEntries;
const P = schema.socialPubs;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type BizRow = typeof B.$inferSelect;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const domainMismatch = () => new RadarError('That doesn’t match. Type the business’s domain to confirm.', 400, 'domain_mismatch');
const notActive = () => new RadarError('Only a business that is set up can be deleted here.', 409, 'not_active');
const restoreExpired = () => new RadarError('This business can’t be restored. Its 7 days have passed.', 410, 'restore_expired');
const restoreNotFound = () => new RadarError('This business can’t be restored. It may already be wiped.', 404, 'restore_not_found');

const nameOf = (b: Pick<BizRow, 'profile' | 'domain'>): string => (b.profile as any)?.business?.name || b.domain;

/** Queued jobs of the business never run: they are closed as skipped. Running jobs are left to the queue's own checks. */
const cancelQueuedJobs = (tx: Tx, bid: string) =>
  tx.update(schema.jobs).set({ status: 'done', result: SKIPPED_DELETED, finishedAt: sql`now()`, lockedAt: null })
    .where(and(eq(schema.jobs.businessId, bid), eq(schema.jobs.status, 'queued')));

/** DEL-7 (architecture §6): the one confirmation email to the owner. This is the only call site and it does nothing
 *  yet: the next task queues it through the lifecycle queue (type `business_deleted`). Do not add another mail path. */
async function queueDeletedEmail(_deleted: { ownerId: string; id: string; name: string; domain: string; deletedAt: string; purgeAt: string }): Promise<void> {
  /* filled by the lifecycle task */
}

/** The business the app should open next: the first one getMe would call usable (active, a member, and not locked). */
async function nextUsable(userId: string): Promise<string | null> {
  return (await accessSummary(userId)).accessible[0] ?? null;
}

/** Delete `bid` for its owner. The caller has already checked the session, the Owner role and the business gate; the
 *  ownership check is repeated here under the row lock. Idempotent: a business that is already deleted answers with the
 *  timestamps it already has. */
export async function deleteBusiness(userId: string, bid: string, input: { domain: string }): Promise<DeleteBusinessResult> {
  const out = await db.transaction(async tx => {
    const biz = (await tx.select().from(B).where(eq(B.id, bid)).for('update'))[0];
    if (!biz) throw notFound('Business');
    if (biz.ownerId !== userId) throw forbidden();
    if (biz.status === 'deleted' && biz.deletedAt && biz.purgeAt) return { biz, deletedAt: biz.deletedAt, purgeAt: biz.purgeAt, fresh: false };
    if (biz.status !== 'active') throw notActive();
    if (!domainMatches(input.domain, biz.domain)) throw domainMismatch();
    const [marked] = await tx.update(B)
      .set({ status: 'deleted', deletedAt: sql`now()`, purgeAt: sql`now() + ${RETENTION_INTERVAL}`, rev: sql`${B.rev} + 1`, updatedAt: sql`now()` })
      .where(and(eq(B.id, bid), eq(B.status, 'active'))).returning({ deletedAt: B.deletedAt, purgeAt: B.purgeAt });
    if (!marked?.deletedAt || !marked.purgeAt) throw new Error('Business delete did not mark the row');
    await cancelQueuedJobs(tx, bid);
    // An OAuth flow started before the delete must not save tokens into it afterwards.
    await tx.delete(schema.oauthStates).where(eq(schema.oauthStates.businessId, bid));
    return { biz, deletedAt: marked.deletedAt, purgeAt: marked.purgeAt, fresh: true };
  });
  const result: DeleteBusinessResult = { id: bid, name: nameOf(out.biz), domain: out.biz.domain, deletedAt: out.deletedAt.toISOString(), purgeAt: out.purgeAt.toISOString(), nextId: null };
  // The delete is committed. Nothing below may fail it.
  if (out.fresh) {
    try { await queueDeletedEmail({ ownerId: userId, id: bid, name: result.name, domain: result.domain, deletedAt: result.deletedAt, purgeAt: result.purgeAt }); }
    catch (e) { await reportFailure(e, { source: 'system', operation: 'business.delete.email', businessId: bid, userId }); }
    await track('action.business.delete', { bid, uid: userId });
  }
  try { result.nextId = await nextUsable(userId); }
  catch (e) { await reportFailure(e, { source: 'system', operation: 'business.delete.next', businessId: bid, userId }); }
  return result;
}

/** Nothing fires late (RES-2, architecture §3.5): what came due while the business was deleted moves to a state the
 *  product already has, and nothing dated in the future is touched. Runs inside the restore transaction. */
async function settleOverdue(tx: Tx, biz: BizRow, now: Date) {
  const bid = biz.id;
  const overdue = lte(E.date, lastDueDate({ tz: biz.timezone, time: (biz.blog || {}).time }, now));
  // A queued article whose time passed goes back to review, as Unschedule does.
  await tx.update(E).set({ status: 'review', autopilotActivationId: null }).where(and(eq(E.businessId, bid), eq(E.status, 'scheduled'), overdue));
  // No job owns a publish or a draft any more. A remote draft kept in publish_remote is reused on the next approval.
  await tx.update(E).set({ status: 'review' }).where(and(eq(E.businessId, bid), eq(E.status, 'publishing')));
  await tx.update(E).set({ status: 'approved' }).where(and(eq(E.businessId, bid), eq(E.status, 'drafting')));
  // An approved topic that was never written would be drafted and, on an auto-publishing blog, published late.
  await tx.update(E).set({ status: 'proposed', autopilotActivationId: null }).where(and(eq(E.businessId, bid), eq(E.status, 'approved'), overdue,
    sql`NOT EXISTS (SELECT 1 FROM ${schema.articles} a WHERE a.entry_id = ${E.id} AND a.data->>'generated' = 'true')`));
  // A post that came due, or was claimed but never reached the platform, is held back exactly like a stale send.
  // A send at stage `create` has an unknown outcome: the publisher verifies or fails it and never resends.
  for (const platform of ['x', 'linkedin'] as const) {
    await tx.update(P).set({ status: 'failed', errCode: 'stale', err: errCopy('stale', platform), errDetail: 'came due while the business was deleted', stage: null, retryAt: null, updatedAt: sql`now()` })
      .where(and(eq(P.businessId, bid), eq(P.platform, platform), or(
        and(eq(P.status, 'scheduled'), sql`${P.dueAt} <= now()`),
        and(eq(P.status, 'sending'), or(isNull(P.stage), ne(P.stage, 'create'))))));
  }
}

/** Restore `id` for its owner. Never goes through requireRole (which refuses a deleted business): the checks are made
 *  under the row lock, and everyone but the owner gets the same answer as for a business that does not exist. */
export async function restoreBusiness(userId: string, id: string): Promise<RestoreBusinessResult> {
  if (!UUID.test(id)) throw restoreNotFound();
  const { biz, fresh } = await db.transaction(async tx => {
    const row = (await tx.select({ b: B, nowMs: sql<number>`(extract(epoch from now()) * 1000)::float8`, inWindow: sql<boolean>`coalesce(${B.purgeAt} > now(), false)` }).from(B).where(eq(B.id, id)).for('update'))[0];
    if (!row || row.b.ownerId !== userId) throw restoreNotFound();
    const owner = await tx.select({ id: schema.members.id }).from(schema.members)
      .where(and(eq(schema.members.businessId, id), eq(schema.members.userId, userId), eq(schema.members.role, 'Owner'), eq(schema.members.status, 'active'))).limit(1);
    if (!owner.length) throw restoreNotFound();
    if (row.b.status === 'active') return { biz: row.b, fresh: false };   // two clicks: already restored
    if (row.b.status !== 'deleted') throw restoreNotFound();
    if (!row.inWindow) throw restoreExpired();          // time decides, whether or not the wipe has run
    await settleOverdue(tx, row.b, new Date(Number(row.nowMs)));
    await cancelQueuedJobs(tx, id);
    const done = await tx.update(B).set({ status: 'active', deletedAt: null, purgeAt: null, rev: sql`${B.rev} + 1`, updatedAt: sql`now()` })
      .where(and(eq(B.id, id), eq(B.status, 'deleted'), sql`${B.purgeAt} > now()`)).returning({ id: B.id });
    if (!done.length) throw restoreExpired();
    return { biz: row.b, fresh: true };
  });
  // The restore is committed. Nothing below may fail it.
  if (fresh) await track('action.business.restore', { bid: id, uid: userId });
  let open = false;
  try { open = await bizAccess(biz); }
  catch (e) { await reportFailure(e, { source: 'system', operation: 'business.restore.access', businessId: id, userId }); }
  return { id, name: nameOf(biz), open };
}

/** The user's own deleted businesses that can still be restored, newest delete first. Nobody but the owner gets these. */
export async function listDeleted(userId: string): Promise<DeletedBusiness[]> {
  const rows = await db.select({ id: B.id, domain: B.domain, profile: B.profile, deletedAt: B.deletedAt, purgeAt: B.purgeAt }).from(B)
    .where(and(eq(B.ownerId, userId), eq(B.status, 'deleted'), sql`${B.purgeAt} > now()`)).orderBy(desc(B.deletedAt));
  return rows.flatMap(r => r.deletedAt && r.purgeAt ? [{
    id: r.id, name: nameOf(r), domain: r.domain,
    brand: { logo: r.profile?.brand?.logo ?? null, primary: r.profile?.brand?.primary || '#17181C', secondary: r.profile?.brand?.secondary || '#EF6A2E' },
    deletedAt: r.deletedAt.toISOString(), purgeAt: r.purgeAt.toISOString(),
  }] : []);
}
