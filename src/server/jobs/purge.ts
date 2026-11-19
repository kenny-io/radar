// The wipe of deleted businesses (.factory/delete-business/architecture.md §4). It is the one place Radar removes a
// customer's data on a timer, so it fails closed: when anything is in doubt, nothing is removed and the next hourly run
// tries again.
//  - cron business.purge: once an hour, from minute 23, enqueue the job. Cron hooks run one after another under one
//    lock, and emptying a storage prefix there would hold up the social publisher.
//  - job  business.purge: wipe every business whose window has ended (`purgeDue`), one transaction each (`purgeOne`).
// What decides: `status = 'deleted'`, `purge_at` passed and `deleted_at` at least 168 hours ago, all on the database
// clock, read in the selector, again under the row lock, and again in the DELETE itself. `businesses_deleted_check`
// makes a wipe time earlier than that impossible to store.
import { scrubYouTubeData, attemptYouTubeRevokes } from '../services/social/publish/youtubeRetention';
import { and, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { decrypt } from '../crypto';
import { purgeEnabled } from '../flags';
import { reportFailure } from '../observability/failures';
import { publishedImageKeys } from '../deletion/keep';
import { RETENTION_INTERVAL } from '../deletion/state';
import { deletePrefix } from '../services/storage';
import { revoke as revokeGoogle, type GscTokens } from '../services/gsc/client';
import { adapterFor, tokensOf, type AcctRow } from '../services/social/publish/accounts';
import { defineCron } from './cron';
import { defineJob, enqueue, once } from './queue';

const B = schema.businesses;
/** A business may be wiped only while all of this holds. */
const DUE = sql`${B.status} = 'deleted' AND ${B.purgeAt} <= now() AND ${B.deletedAt} <= now() - ${RETENTION_INTERVAL}`;
/** At most this many businesses per run, oldest wipe time first. */
export const PURGE_BATCH = 25;
/** More than this many due at once is not a normal hour (a clock jump, a mis-dating bug): nothing is wiped and a person is told. */
export const PURGE_BREAKER = 50;
/** The queue's timeout does not cancel a handler, so the run carries its own budget: no new business is started after it. */
export const PURGE_BUDGET_MS = 5 * 60e3;
const BUSINESS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PurgeOne = 'skipped' | { deleted: number; kept: number };
export type PurgeResult = { skipped: 'off' } | { blocked: 'too_many_due'; due: number } | { due: number; wiped: number; failed: number; filesDeleted: number; filesKept: number };

/** Wipe one business, in one transaction. `'skipped'` when it is not due under the row lock: restored, already wiped,
 *  never deleted, still inside its window, or held by a restore or another worker right now. */
export async function purgeOne(bid: string): Promise<PurgeOne> {
  if (typeof bid !== 'string' || !BUSINESS_ID.test(bid)) throw new Error('purgeOne needs a business id');
  let google: GscTokens | null = null; const social: AcctRow[] = []; const youtubeRevokeIds: string[] = [];
  const files = await db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '120s'`);
    // 1. The lock, with the whole predicate again. SKIP LOCKED: a restore or another worker has it; leave it to them.
    const [locked] = await tx.select({ id: B.id, ownerId: B.ownerId }).from(B).where(and(eq(B.id, bid), DUE)).for('update', { skipLocked: true });
    if (!locked) return null;

    const youtube = await scrubYouTubeData(tx, { bid, reason: 'delete', now: new Date(), bumpRevision: false }); youtubeRevokeIds.push(...youtube.revokeJobIds);

    // 2. Everything the later steps need is read now, before anything is removed.
    //    Tokens to revoke after commit. Google's revoke removes the whole grant, so it is only called when no other
    //    business of this owner holds Search Console tokens (decision B); a social account only when no other row
    //    shares the same channel and remote account.
    const G = schema.gscConnections; const A = schema.socialAccounts;
    const [gsc] = await tx.select({ tokensEnc: G.tokensEnc }).from(G).where(eq(G.businessId, bid)).limit(1);
    if (gsc?.tokensEnc) {
      const others = await tx.select({ id: B.id }).from(G).innerJoin(B, eq(B.id, G.businessId)).where(and(eq(B.ownerId, locked.ownerId), ne(B.id, bid), isNotNull(G.tokensEnc))).limit(1);
      if (!others.length) { try { google = decrypt<GscTokens>(gsc.tokensEnc); } catch { /* unreadable: nothing to revoke */ } }
    }
    for (const acct of await tx.select().from(A).where(eq(A.businessId, bid))) {
      const shared = await tx.select({ id: A.id }).from(A).where(and(eq(A.ch, acct.ch), eq(A.remoteId, acct.remoteId), ne(A.businessId, bid))).limit(1);
      if (!shared.length) social.push(acct);
    }
    //    The keep set (decision A, K): images inside articles Radar already wrote to the business's site. It is read
    //    here because step 4 deletes the articles it is read from. If it cannot be computed, this throws, the
    //    transaction rolls back, and the business is not wiped.
    const E = schema.calendarEntries; const AR = schema.articles;
    const published = await tx.select({ data: AR.data }).from(AR).innerJoin(E, eq(E.id, AR.entryId))
      .where(and(eq(AR.businessId, bid), eq(E.businessId, bid), or(eq(E.status, 'published'), isNotNull(E.publishedUrl), isNotNull(E.publishRemote))));
    const keep = publishedImageKeys(bid, published);

    // 3. Rows that carry the id without a foreign key, and rows in other accounts.
    await tx.execute(sql`DELETE FROM feature_requests WHERE business_id = ${bid}`);
    await tx.execute(sql`DELETE FROM oauth_states WHERE business_id = ${bid}`);
    await tx.execute(sql`DELETE FROM cron_marks WHERE position(${bid}::text in key) > 0`);
    await tx.execute(sql`UPDATE ai_calls SET business_id = NULL, error = NULL WHERE business_id = ${bid}`);
    await tx.execute(sql`UPDATE events SET props = '{}'::jsonb, ref = NULL, user_id = NULL WHERE business_id = ${bid}`);
    await tx.execute(sql`DELETE FROM proposals WHERE partner_business_id = ${bid} AND decision IS NULL`);

    // 4. The business, with the predicate once more. Everything keyed to it goes by cascade.
    const gone = await tx.delete(B).where(and(eq(B.id, bid), DUE)).returning({ id: B.id });
    if (gone.length !== 1) throw new Error('The wipe did not remove exactly one business');

    // 5. Its files, while the transaction is still open: if storage fails, the rows come back and the next run
    //    computes the same keep set from the same articles.
    return deletePrefix(bid, keep);
  });
  if (!files) return 'skipped';

  // 7. After commit, best effort: a failed revoke is reported and never fails the wipe.
  await attemptYouTubeRevokes(youtubeRevokeIds);
  if (google) await revokeGoogle(google);                      // reports its own failures and never throws
  for (const acct of social) {
    const t = tokensOf(acct);
    if (!t) continue;
    try { await adapterFor(acct.ch, t).revoke(t); }
    catch (e) { await reportFailure(e, { source: 'social', operation: 'social.revoke', provider: acct.ch, degraded: true }); }
  }
  return files;
}

/** One run: every business that is due, oldest first. Counts only, in the result and in the log. `ownerIds` narrows the
 *  run to those owners' businesses (tests on a shared database, as `userIds` does for the mail dispatcher); the job
 *  passes nothing. */
export async function purgeDue(options: { ownerIds?: string[] } = {}): Promise<PurgeResult> {
  if (!purgeEnabled()) return { skipped: 'off' };
  const started = Date.now();
  const scope = options.ownerIds ? and(DUE, inArray(B.ownerId, options.ownerIds)) : DUE;
  const [{ n: due }] = await db.select({ n: sql<number>`count(*)::int` }).from(B).where(scope);
  if (due > PURGE_BREAKER) {
    await reportFailure(new Error('Too many businesses are due to be wiped; none was wiped'), { source: 'cron', operation: 'business.purge', code: 'too_many_due' });
    console.error(`[purge] due ${due}: more than ${PURGE_BREAKER}, wiped none`);
    return { blocked: 'too_many_due', due };
  }
  const rows = await db.select({ id: B.id }).from(B).where(scope).orderBy(B.purgeAt).limit(PURGE_BATCH);
  let wiped = 0, failed = 0, filesDeleted = 0, filesKept = 0;
  for (const { id } of rows) {
    if (Date.now() - started > PURGE_BUDGET_MS) break;
    try {
      const r = await purgeOne(id);
      if (r !== 'skipped') { wiped++; filesDeleted += r.deleted; filesKept += r.kept; }
    } catch (e) {
      // The business still exists (the transaction rolled back), so its id names nothing that was wiped.
      failed++;
      await reportFailure(e, { source: 'cron', operation: 'business.purge', businessId: id });
    }
  }
  if (due) console.info(`[purge] due ${due}, wiped ${wiped}, failed ${failed}, files deleted ${filesDeleted}, kept ${filesKept}`);
  return { due, wiped, failed, filesDeleted, filesKept };
}

defineJob({ kind: 'business.purge', maxAttempts: 1, run: async () => purgeDue() });

defineCron('business.purge', async now => {
  if (!purgeEnabled() || now.getUTCMinutes() < 23) return;
  if (!(await once('biz-purge:' + now.toISOString().slice(0, 13)))) return;
  await enqueue('business.purge', {}, { singletonKey: 'business.purge', maxAttempts: 1 });
});
