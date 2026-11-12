// Job + cron definitions for "publishing". Register with defineJob()/defineCron(); imported by src/server/jobs/all.ts.
//  - job  publish.entry {entryId, manual?}  (ref = entryId) — publish one scheduled entry; up to 3 retries with backoff.
//    The queue's timeout is a race that does not cancel the handler, so it must stay above the longest attempt deadline
//    (the sandbox publisher's, plus its teardown): the attempt's own deadline always ends the work first.
//  - cron publishing.scheduler (every minute) — at blog.time (business timezone) on entry.date, enqueue scheduled entries
import { canRun } from '../autopilot/guard';
import { and, eq, inArray, lte } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { defineJob, enqueue } from '@/server/jobs/queue';
import { defineCron } from '@/server/jobs/cron';
import { addDays, nowHMIn, todayIn } from '@/lib/format';
import { publishEntry } from './publisher';
import { SANDBOX_BUDGET } from './sandbox/types';

export const PUBLISH_MAX_ATTEMPTS = 4; // first try + 3 retries
const BACKOFF = env.devStubs ? [3e3, 6e3, 12e3] : [30e3, 120e3, 480e3];

defineJob<{ entryId: string; manual?: boolean }>({
  kind: 'publish.entry',
  maxAttempts: PUBLISH_MAX_ATTEMPTS,
  backoffMs: attempt => BACKOFF[Math.min(attempt - 1, BACKOFF.length - 1)],
  timeoutMs: SANDBOX_BUDGET.jobTimeoutMs,
  run: async ctx => {
    await ctx.progress({ attempt: ctx.attempt });
    return publishEntry(ctx.payload.entryId, { attempt: ctx.attempt, maxAttempts: ctx.job.maxAttempts, manual: ctx.payload.manual });
  },
});

export const enqueuePublish = (businessId: string, entryId: string, manual = false) =>
  enqueue('publish.entry', { entryId, manual }, { businessId, ref: entryId, singletonKey: 'publish:' + entryId, maxAttempts: PUBLISH_MAX_ATTEMPTS });

/** Idempotent: only `scheduled` entries are picked, and the singleton key prevents a second job while one is queued/running. */
export async function runScheduler(now: Date) {
  const horizon = addDays(todayIn('UTC', now), 1); // no timezone is more than a day ahead of UTC
  const rows = await db.select({ id: schema.calendarEntries.id, date: schema.calendarEntries.date, bid: schema.calendarEntries.businessId, tz: schema.businesses.timezone, blog: schema.businesses.blog, activation: schema.calendarEntries.autopilotActivationId })
    .from(schema.calendarEntries).innerJoin(schema.businesses, eq(schema.businesses.id, schema.calendarEntries.businessId))
    .where(and(eq(schema.calendarEntries.status, 'scheduled'), lte(schema.calendarEntries.date, horizon), eq(schema.businesses.status, 'active')));
  if (!rows.length) return 0;
  const bids = [...new Set(rows.map(r => r.bid))];
  const withConn = new Set((await db.selectDistinct({ bid: schema.connections.businessId }).from(schema.connections).where(inArray(schema.connections.businessId, bids))).map(r => r.bid));
  let n = 0;
  for (const r of rows) {
    const blog = r.blog || {};
    if (r.activation && !(await canRun(r.bid, r.activation))) continue;
    if (blog.paused || !withConn.has(r.bid)) continue; // held; the UI shows "Paused · …"
    const tz = r.tz || 'America/New_York';
    const today = todayIn(tz, now); const date = String(r.date);
    const due = date < today || (date === today && nowHMIn(tz, now) >= (blog.time || '09:00'));
    if (!due) continue;
    await enqueuePublish(r.bid, r.id); n++;
  }
  return n;
}
defineCron('publishing.scheduler', async now => { await runScheduler(now); });
