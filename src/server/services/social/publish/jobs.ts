// Job + cron definitions for posting from Radar (architecture.md §9.1). Imported by src/server/jobs/all.ts.
// Retry state lives on the row (retry_at, attempts), so `social.send` has maxAttempts 1 and every run is idempotent from the row.
import { and, eq, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { defineJob, enqueue } from '../../../jobs/queue';
import { defineCron } from '../../../jobs/cron';
import { socialOn } from '../../../flags';
import { STALE_MS } from '@/lib/socialPublish';
import { tokensTick } from './accounts';
import { P } from './pubs';
import { STUCK_MS, claimScheduled, failStale, recoverStuck, runSend } from './send';

/** social.send (ref = sid, payload { pubId }). Scheduled and due → claim + send; stuck `sending` → verify or retry; else skip. */
defineJob<{ pubId: string }>({
  kind: 'social.send', maxAttempts: 1, timeoutMs: 120_000,
  run: async ctx => {
    const r = (await db.select().from(P).where(eq(P.id, ctx.payload.pubId)).limit(1))[0];
    if (!r) return { skipped: 'gone' };
    const b = (await db.select({ id: schema.businesses.id, ownerId: schema.businesses.ownerId, status: schema.businesses.status }).from(schema.businesses).where(eq(schema.businesses.id, r.businessId)).limit(1))[0];
    // Rollback switch: with the flag off nothing is sent; the row stays as it is.
    if (!b || b.status !== 'active' || !(await socialOn(b))) return { skipped: 'not_enabled' };
    if (r.status === 'sending') { const u = await recoverStuck(r.id); return { recovered: !!u, status: u?.status }; }
    if (r.status !== 'scheduled') return { skipped: r.status };
    if (Date.now() - r.dueAt.getTime() > STALE_MS) { await failStale(r); return { status: 'failed', code: 'stale' }; }
    const c = await claimScheduled(r.id);
    if (!c) return { skipped: 'not_due' };
    const u = await runSend(c, { manual: false });
    return { status: u?.status || 'lost', code: u?.errCode || undefined };
  },
});

/** Every minute: enqueue due rows (fail the ones more than 24 h late) and re-check stuck sends. Held rows (expired account)
 *  and unflagged or inactive businesses are skipped. */
export async function publisherTick(now: Date) {
  const A = schema.socialAccounts; const B = schema.businesses;
  const rows = await db.select({ p: P, ownerId: B.ownerId }).from(P)
    .innerJoin(B, eq(B.id, P.businessId))
    .leftJoin(A, eq(A.id, P.acctId))
    .where(and(eq(B.status, 'active'), or(
      and(eq(P.status, 'scheduled'), lte(P.dueAt, now), sql`(${P.retryAt} IS NULL OR ${P.retryAt} <= ${now.toISOString()}::timestamptz)`, eq(A.expired, false)),
      and(eq(P.status, 'sending'), lte(P.claimedAt, new Date(now.getTime() - STUCK_MS))),
    )));
  const flag = new Map<string, boolean>();
  for (const { p, ownerId } of rows) {
    if (!flag.has(p.businessId)) flag.set(p.businessId, await socialOn({ id: p.businessId, ownerId }));
    if (!flag.get(p.businessId)) continue;
    if (p.status === 'scheduled' && now.getTime() - p.dueAt.getTime() > STALE_MS) { await failStale(p); continue; }
    await enqueue('social.send', { pubId: p.id }, { businessId: p.businessId, ref: p.sid, singletonKey: 'social.send:' + p.id, maxAttempts: 1 });
  }
}

defineCron('social.publisher', publisherTick);
defineCron('social.tokens', tokensTick);
