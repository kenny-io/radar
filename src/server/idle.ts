// Idle spend: when a member last used the app, the activity tier that follows from it, and the cadence each tier gets.
// Every threshold lives here. .factory/first-five-optimizations/architecture.md §2.1-§2.3.
import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { enqueue } from './jobs/queue';
import { reportFailure } from './observability/failures';
import { autopilotOf } from './services/autopilot/policy';
import type { BizRow } from './workspace';

export const IDLE_AFTER_DAYS = 7, DORMANT_AFTER_DAYS = 30, IDLE_EVERY_DAYS = 7;
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
/** Pure. active: true · idle: no run yet, or the last one is 7 or more days old · dormant: false. */
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
/** Mark the business as used by a signed-in member: at most one write an hour, never for a guest, never touches `rev` or `updated_at`.
 *  `biz` is the row the gate just loaded, so the usual call costs no query. When the write brings an idle or dormant business
 *  back, it queues one AI visibility run (the nightly window is fixed, so nothing else would catch up before 02:00).
 *  Never throws: callers await it after their own work has already succeeded. */
export async function touchActive(biz: Pick<BizRow, 'id' | 'lastActiveAt' | 'autopilot' | 'onboarding'>, actor: { guest: boolean }, now: Date = new Date()): Promise<void> {
  if (actor.guest || now.getTime() - biz.lastActiveAt.getTime() < TOUCH_EVERY_MS) return;
  try {
    const B = schema.businesses; const J = schema.jobs;
    // Conditional, so concurrent requests holding the same stale row write once between them.
    const wrote = await db.update(B).set({ lastActiveAt: now }).where(and(eq(B.id, biz.id), lte(B.lastActiveAt, new Date(now.getTime() - TOUCH_EVERY_MS)))).returning({ status: B.status });
    if (!wrote.length || wrote[0].status !== 'active' || activityTier(biz, now) === 'active') return;
    const recent = await db.select({ id: J.id }).from(J).where(and(eq(J.businessId, biz.id), eq(J.kind, 'visibility.run'), gt(J.createdAt, new Date(now.getTime() - CATCH_UP_AFTER_MS)))).limit(1);
    if (!recent.length) await enqueue('visibility.run', {}, { businessId: biz.id, ref: biz.id, singletonKey: 'vis-run:' + biz.id });
  } catch (e: any) {
    console.error('[idle] touchActive failed', biz.id, e?.message || e);
    await reportFailure(e, { source: 'system', operation: 'idle.touchActive', businessId: biz.id, degraded: true, incidentKey: 'idle.touchActive' }).catch(() => {});
  }
}
