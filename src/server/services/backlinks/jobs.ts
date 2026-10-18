// Job + cron definitions for "backlinks". Imported by src/server/jobs/all.ts.
//   backlinks.match   (ref = businessId) — partner matching; weekly and once right after joining. result { created }
//   backlinks.verify  (ref = businessId) — payload { scope: 'all' | 'pending' }: weekly link verification / placement checks
//   backlinks.notice  (ref = proposalId) — delayed partner notice after a decision (skipped when undone)
import { inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { env } from '../../env';
import { defineJob, enqueue, once } from '../../jobs/queue';
import { defineCron } from '../../jobs/cron';
import { todayIn, weekday, addDays } from '@/lib/format';
import { matchBusiness } from './matching';
import { checkPendingPlacements, verifyBusiness } from './verify';
import { runDecisionNotice } from './decisions';
import { metaOf } from './network';

defineJob<{ reason?: string }>({
  kind: 'backlinks.match', maxAttempts: 2, timeoutMs: 10 * 60e3,
  run: async ctx => {
    const bid = ctx.businessId!;
    await ctx.progress({ phase: 'matching' });
    const r = await matchBusiness(bid);
    await ctx.touch();
    return r;
  },
});

defineJob<{ scope?: 'all' | 'pending' }>({
  kind: 'backlinks.verify', maxAttempts: 2, timeoutMs: 15 * 60e3,
  run: async ctx => {
    const bid = ctx.businessId!;
    const r = ctx.payload.scope === 'pending' ? await checkPendingPlacements(bid) : await verifyBusiness(bid);
    await ctx.touch();
    return r;
  },
});

defineJob<{ proposalId: string; decision: 'approved' | 'rejected'; key: string }>({
  kind: 'backlinks.notice', maxAttempts: 4,
  run: async ctx => runDecisionNotice(ctx.payload),
});

/** Monday of the week containing `d` (business-local calendar date) — the weekly idempotency key. */
export const weekOf = (d: string) => addDays(d, -((weekday(d) + 6) % 7));

defineCron('backlinks', async now => {
  const pendingEvery = env.devStubs ? 5 : 60; // minutes between checks for approved-but-unplaced links
  const runPending = now.getUTCMinutes() % pendingEvery === 0;
  const linkOwners = await db.selectDistinct({ id: schema.liveLinks.businessId }).from(schema.liveLinks).where(inArray(schema.liveLinks.status, ['live', 'lost', 'removal']));
  const joined = await db.select({ id: schema.businesses.id, tz: schema.businesses.timezone, status: schema.businesses.status, backlinks: schema.businesses.backlinks }).from(schema.businesses).where(sql`(${schema.businesses.backlinks}->>'joined')::boolean is true`);
  const ids = new Set([...linkOwners.map(r => r.id), ...joined.filter(b => b.status === 'active').map(b => b.id)]);
  if (!ids.size) return;
  const tzs = new Map((await db.select({ id: schema.businesses.id, tz: schema.businesses.timezone, status: schema.businesses.status }).from(schema.businesses).where(inArray(schema.businesses.id, [...ids]))).map(b => [b.id, b]));
  for (const bid of ids) {
    const b = tzs.get(bid); if (!b || b.status !== 'active') continue;
    const wk = weekOf(todayIn(b.tz || 'America/New_York'));
    const isJoined = joined.some(j => j.id === bid && metaOf(j as any).joined);
    // Weekly matching (joined businesses only — leaving stops new proposals).
    if (isJoined && await once(`bl-match:${bid}:${wk}`)) await enqueue('backlinks.match', { reason: 'weekly' }, { businessId: bid, ref: bid, singletonKey: 'bl-match:' + bid });
    // Weekly verification of every tracked link (existing links keep being verified after leaving).
    if (await once(`bl-verify:${bid}:${wk}`)) await enqueue('backlinks.verify', { scope: 'all' }, { businessId: bid, ref: bid, singletonKey: 'bl-verify:' + bid });
    else if (runPending && isJoined) await enqueue('backlinks.verify', { scope: 'pending' }, { businessId: bid, ref: bid, singletonKey: 'bl-verify:' + bid });
  }
});
