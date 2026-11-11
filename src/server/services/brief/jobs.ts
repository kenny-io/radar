import { reportFailure } from '@/server/observability/failures';
// Job + cron definitions for "brief". Imported by src/server/jobs/all.ts.
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { defineJob, enqueue, once } from '@/server/jobs/queue';
import { defineCron } from '@/server/jobs/cron';
import { briefSettingsOf } from '@/server/workspace';
import { nowHMIn, todayIn } from '@/lib/format';
import { runScan, type ScanPayload } from './scan';
import { expirePastDays, getDay, dayMark } from './store';
import { rescanDue } from './rescan';
import { activityTier } from '@/server/idle';

/** brief.scan (ref = date). Progress { step, threadsRead, failed?, steps, mode, quiet? }. A platform failure is a handled
 *  outcome (result.failed) so the user decides: Try again, or keep this morning's brief. Background rescans skip a
 *  failing platform instead (scan.ts). */
defineJob<ScanPayload>({ kind: 'brief.scan', maxAttempts: 1, timeoutMs: 20 * 60e3, run: runScan });

/** A business's brief.scan jobs for one date, newest first. */
const scansOf = (bid: string, date: string) => db.select({ createdAt: schema.jobs.createdAt, status: schema.jobs.status }).from(schema.jobs)
  .where(and(eq(schema.jobs.businessId, bid), eq(schema.jobs.kind, 'brief.scan'), eq(schema.jobs.ref, date))).orderBy(desc(schema.jobs.createdAt));

/** One scan job per business and day at a time: a Scan again click while a scan (or a background rescan) runs joins it.
 *  Later scans carry their round of the day (earlier jobs for the date) so they rotate through the search queries. Keep
 *  runs and background rescans are quiet from the moment they are queued, so the Daily Brief never switches to the scan
 *  view for them on its own. */
export async function enqueueScan(bid: string, date: string, mode: ScanPayload['mode'], fromJob?: string, opts: { background?: boolean; round?: number } = {}) {
  const round = mode === 'again' ? opts.round ?? (await scansOf(bid, date)).length : 0;
  const payload: ScanPayload = { mode, date, fromJob, ...(round ? { round } : {}), ...(opts.background ? { background: true } : {}) };
  const quiet = opts.background || mode === 'keep';
  return enqueue('brief.scan', payload, { businessId: bid, ref: date, singletonKey: `brief-scan:${bid}:${date}`, ...(quiet ? { progress: { threadsRead: 0, mode, quiet } } : {}) });
}

/** Enqueue a background rescan of today for one business when one is due (`rescanDue`). Returns the job id, or null.
 *  A day nobody has acted on costs one primary-key read: the jobs query is skipped. */
export async function maybeRescan(b: { id: string; tz: string | null }, now = new Date()): Promise<string | null> {
  const today = todayIn(b.tz || 'America/New_York', now);
  const mark = await dayMark(b.id, today);
  if (!mark?.actedAt) return null;
  const scans = await scansOf(b.id, today);
  if (!rescanDue({ hasDay: true, last: scans[0] || null, now, actedAt: mark.actedAt })) return null;
  return enqueueScan(b.id, today, 'again', undefined, { background: true, round: scans.length });
}

const minutes = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

/** Daily scan at settings.time in the business timezone (idempotent per day), with two automatic retries 15 minutes
 *  apart if the morning scan didn't produce a brief. Also persists expiry of past days once a day. */
defineCron('brief.daily', async (now) => {
  const rows = await db.select({ id: schema.businesses.id, tz: schema.businesses.timezone, briefSettings: schema.businesses.briefSettings, setup: schema.businesses.briefSetup })
    .from(schema.businesses).where(and(eq(schema.businesses.status, 'active'), eq(schema.businesses.briefSetup, true)));
  for (const b of rows) {
    const tz = b.tz || 'America/New_York';
    const today = todayIn(tz, now);
    if (await once(`brief-expire:${b.id}:${today}`)) await expirePastDays(b.id, today).catch(async e => { await reportFailure(e, { source: 'brief', operation: 'brief.expire', businessId: b.id, ref: today }); console.error('[brief.expire]', e?.message); });
    const s = briefSettingsOf(b as any);
    const late = minutes(nowHMIn(tz, now)) - minutes(s.time || '06:00');
    if (late < 0) continue;
    const attempt = late < 15 ? 0 : late < 30 ? 1 : late < 45 ? 2 : -1;
    if (attempt < 0) continue;
    if (await getDay(b.id, today)) continue;
    if (attempt > 0) {
      // Only retry when the last scan for today finished without a brief.
      const last = (await db.select().from(schema.jobs).where(and(eq(schema.jobs.businessId, b.id), eq(schema.jobs.kind, 'brief.scan'), eq(schema.jobs.ref, today))).orderBy(desc(schema.jobs.createdAt)).limit(1))[0];
      if (!last || last.status === 'queued' || last.status === 'running') continue;
    }
    if (await once(`brief:${b.id}:${today}:${attempt}`)) await enqueueScan(b.id, today, 'first');
  }
});

/** Background rescans: 2 h after today's last scan, until the business day ends (DIVERGENCES, Daily Brief), and only when
 *  earned: the business is in the active tier (idle.ts) and a member has acted on today's brief since that scan (rescan.ts).
 *  Idempotent across minute ticks and workers: the cron runs under one advisory lock, a queued or running scan is never
 *  joined by a second, and the new job itself restarts the 2 h clock. */
export async function rescanTick(now: Date) {
  const rows = await db.select({ id: schema.businesses.id, tz: schema.businesses.timezone, lastActiveAt: schema.businesses.lastActiveAt, autopilot: schema.businesses.autopilot, onboarding: schema.businesses.onboarding })
    .from(schema.businesses).where(and(eq(schema.businesses.status, 'active'), eq(schema.businesses.briefSetup, true)));
  for (const b of rows) {
    if (activityTier(b, now) !== 'active') continue;
    await maybeRescan(b, now).catch(async e => { await reportFailure(e, { source: 'brief', operation: 'brief.rescan', businessId: b.id }); console.error('[brief.rescan]', b.id, e?.message || e); });
  }
}
defineCron('brief.rescan', rescanTick);
