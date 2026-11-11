// Idle spend: when a member last used the app, the activity tier that follows from it, and the cadence each tier gets.
// Every threshold lives here. .factory/first-five-optimizations/architecture.md §2.1-§2.3.
import { and, eq, gt, inArray, lte, ne, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { clearOnce, enqueue, once } from './jobs/queue';
import { todayIn } from '@/lib/format';
import { reportFailure } from './observability/failures';
import { autopilotOf } from './services/autopilot/policy';
import type { BizRow } from './workspace';

export const IDLE_AFTER_DAYS = 7, DORMANT_AFTER_DAYS = 30, IDLE_EVERY_DAYS = 7;
// Scheduled AI visibility is weekly, for every tier that is not dormant (`visibilityDue`). Days are business-local calendar days.
/** Business-local weekday of the scheduled run. 0 = Sunday: the night before the Monday 08:00 UTC report. */
export const VIS_WEEKDAY = 0;
/** The Sunday run goes ahead when the newest full run started this many days ago or more. It is skipped only after a
 *  full run more recent than that: one on that Saturday (the first run, a catch-up on return), or earlier that Sunday.
 *  So every scheduled run is on Sunday unless it is catching up a miss. */
export const VIS_SKIP_WITHIN_DAYS = 2;
/** A business whose newest full run started this many days ago or more (a Sunday that was missed, failed or collected
 *  nothing), or that has none, is collected on the next night whatever the weekday. With Sunday at 7, this is the
 *  longest the schedule lets a business go between full runs. */
export const VIS_OVERDUE_DAYS = 8;
/** How far back `lastFullVisibilityRuns` looks. "No run found" is read as overdue, so every run that is 7 or fewer local
 *  days old must be inside it. Such a run is at most 7 days plus one whole local day old (it started at 00:00, it is now
 *  23:59), plus an hour when the clocks went back: just over 8 × 24 hours, in every timezone (the offset itself cancels
 *  out, both instants are read in the same zone). Two days more than the threshold leaves room to spare. */
export const VIS_LOOKBACK_DAYS = VIS_OVERDUE_DAYS + 2;
/** A member's use is written at most this often. */
export const TOUCH_EVERY_MS = 3600e3;
/** A returning business gets one AI visibility catch-up run unless one was started within this window. */
export const CATCH_UP_AFTER_MS = 24 * 3600e3;
export type Tier = 'active' | 'idle' | 'dormant';
const DAY_MS = 864e5;

/** Pure. `active` when autopilot is on, or committed under 7 days ago, or used under 7 days ago; `idle` under 30 days; else `dormant`. */
export function activityTier(b: { lastActiveAt: Date; autopilot?: unknown; onboarding?: { committedAt?: string } | null }, now: Date): Tier {
  if (autopilotOf(b).enabled) return 'active';
  const committed = Date.parse(b.onboarding?.committedAt || '');
  if (Number.isFinite(committed) && now.getTime() - committed < IDLE_AFTER_DAYS * DAY_MS) return 'active';
  const quiet = now.getTime() - b.lastActiveAt.getTime();
  return quiet < IDLE_AFTER_DAYS * DAY_MS ? 'active' : quiet < DORMANT_AFTER_DAYS * DAY_MS ? 'idle' : 'dormant';
}
/** Pure. active: true · idle: no run yet, or the last one is 7 or more days old · dormant: false.
 *  Automatic social packs, and AI visibility only under RADAR_VISIBILITY_CADENCE=nightly (otherwise `visibilityDue`). */
export function cadenceDue(tier: Tier, lastRunAt: Date | null, now: Date): boolean {
  if (tier !== 'idle') return tier === 'active';
  return !lastRunAt || now.getTime() - lastRunAt.getTime() >= IDLE_EVERY_DAYS * DAY_MS;
}
/** Newest job of `kind` per business (max(jobs.created_at), last 8 days), whatever its status. Businesses without one are absent. */
export async function lastRuns(kind: string, bids: string[]): Promise<Map<string, Date>> {
  if (!bids.length) return new Map();
  const J = schema.jobs;
  const rows = await db.select({ bid: J.businessId, at: sql`max(${J.createdAt})`.mapWith(J.createdAt) }).from(J)
    .where(and(inArray(J.businessId, bids), eq(J.kind, kind), gt(J.createdAt, sql`now() - make_interval(days => ${IDLE_EVERY_DAYS + 1})`))).groupBy(J.businessId);
  return new Map(rows.filter(r => r.bid && r.at).map(r => [r.bid!, r.at]));
}
/** `weekly` unless RADAR_VISIBILITY_CADENCE=nightly, which restores the schedule from before the weekly one: active
 *  businesses every night, idle ones once per 7 days (`cadenceDue`). Read on every tick, so it needs no new code. */
export const visibilityCadence = (): 'weekly' | 'nightly' =>
  ((process.env.RADAR_VISIBILITY_CADENCE || '').trim().toLowerCase() === 'nightly' ? 'nightly' : 'weekly');
const localDay = (tz: string, at: Date) => Date.parse(todayIn(tz, at) + 'T00:00:00Z');
/** Pure. The weekly rule for scheduled AI visibility. The business is not dormant, and either
 *  (a) today in `tz` is VIS_WEEKDAY and its newest full run started VIS_SKIP_WITHIN_DAYS or more local days ago; or
 *  (b) its newest full run started VIS_OVERDUE_DAYS or more local days ago, or it has none: any weekday.
 *  (a) is the weekly run, kept even after an off-cycle full run earlier in the week. (b) catches up a Sunday that was
 *  missed (the scheduler was down) or whose run failed or collected nothing, on the next night; the Sunday after is
 *  then 6 days on, so the schedule returns to Sunday. A run on Saturday skips the Sunday after it and the next Sunday,
 *  8 days on, satisfies both. Days are compared as calendar dates in `tz`, not as elapsed hours, so Sunday to Sunday is
 *  always 7 whatever the time of night and the run cannot slip later each week. */
export function visibilityDue(tier: Tier, tz: string, lastFullRunAt: Date | null, now: Date): boolean {
  if (tier === 'dormant') return false;
  if (!lastFullRunAt) return true;
  const today = localDay(tz, now), days = (today - localDay(tz, lastFullRunAt)) / DAY_MS;
  return days >= VIS_OVERDUE_DAYS || (new Date(today).getUTCDay() === VIS_WEEKDAY && days >= VIS_SKIP_WITHIN_DAYS);
}
/** Newest full `visibility.run` that counts, per business: every prompt (a payload without `promptIds`), not failed (one
 *  that is queued or running counts, so nothing doubles), created in the VIS_LOOKBACK_DAYS before `now`, and not one
 *  that finished having collected nothing: a result with `total > 0` and `collected = 0`, which is what a run leaves
 *  when every assistant failed for every cell (the provider account is out of credit). A run with no cells to collect,
 *  and a result from before `collected` was recorded, count. A run for a few new prompts, one that crashed and one that
 *  came back empty do not use up the week. Businesses without a counted run are absent, and are overdue. */
export async function lastFullVisibilityRuns(bids: string[], now: Date = new Date()): Promise<Map<string, Date>> {
  if (!bids.length) return new Map();
  const J = schema.jobs;
  const rows = await db.select({ bid: J.businessId, at: sql`max(${J.createdAt})`.mapWith(J.createdAt) }).from(J)
    .where(and(inArray(J.businessId, bids), eq(J.kind, 'visibility.run'), ne(J.status, 'failed'), sql`${J.payload}->'promptIds' IS NULL`,
      sql`NOT coalesce(${J.status} = 'done' AND ${J.result}->'collected' = '0'::jsonb AND ${J.result}->'total' > '0'::jsonb, false)`,
      gt(J.createdAt, new Date(now.getTime() - VIS_LOOKBACK_DAYS * DAY_MS)))).groupBy(J.businessId);
  return new Map(rows.filter(r => r.bid && r.at).map(r => [r.bid!, r.at]));
}
/** The once-a-day mark of a business's scheduled AI visibility run: the cron and the catch-up on return share it. */
export const visNightKey = (bid: string, tz: string, now: Date) => `vis:${bid}:${todayIn(tz, now)}`;
/** Mark the business as used by a signed-in member: at most one write an hour, never for a guest, never touches `rev` or `updated_at`.
 *  `biz` is the row the gate just loaded, so the usual call costs no query. When the write brings an idle or dormant business
 *  back, it queues one AI visibility run at once rather than at the next scheduled night. That run takes the business's
 *  mark for today, so a return inside the 02:00-05:59 window is not followed by a second run from the next scheduler
 *  tick. It is a full run, so `visibilityDue` counts it: the coming Sunday is skipped only if it is the next day.
 *  Never throws: callers await it after their own work has already succeeded. */
export async function touchActive(biz: Pick<BizRow, 'id' | 'lastActiveAt' | 'autopilot' | 'onboarding'>, actor: { guest: boolean }, now: Date = new Date()): Promise<void> {
  if (actor.guest || now.getTime() - biz.lastActiveAt.getTime() < TOUCH_EVERY_MS) return;
  try {
    const B = schema.businesses; const J = schema.jobs;
    // Conditional, so concurrent requests holding the same stale row write once between them.
    const wrote = await db.update(B).set({ lastActiveAt: now }).where(and(eq(B.id, biz.id), lte(B.lastActiveAt, new Date(now.getTime() - TOUCH_EVERY_MS)))).returning({ status: B.status, tz: B.timezone });
    if (!wrote.length || wrote[0].status !== 'active' || activityTier(biz, now) === 'active') return;
    const recent = await db.select({ id: J.id }).from(J).where(and(eq(J.businessId, biz.id), eq(J.kind, 'visibility.run'), gt(J.createdAt, new Date(now.getTime() - CATCH_UP_AFTER_MS)))).limit(1);
    if (recent.length) return;
    const night = visNightKey(biz.id, wrote[0].tz, now); const marked = await once(night);
    try { await enqueue('visibility.run', {}, { businessId: biz.id, ref: biz.id, singletonKey: 'vis-run:' + biz.id }); }
    catch (e) { if (marked) await clearOnce(night).catch(() => {}); throw e; }
  } catch (e: any) {
    console.error('[idle] touchActive failed', biz.id, e?.message || e);
    await reportFailure(e, { source: 'system', operation: 'idle.touchActive', businessId: biz.id, degraded: true, incidentKey: 'idle.touchActive' }).catch(() => {});
  }
}
