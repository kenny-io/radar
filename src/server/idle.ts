// OPT-F0 stub, filled by E1 (idle spend): activity signal and tiers. .factory/first-five-optimizations/architecture.md §2.1-§2.3.
import type { BizRow } from './workspace';

export const IDLE_AFTER_DAYS = 7, DORMANT_AFTER_DAYS = 30, IDLE_EVERY_DAYS = 7;
export type Tier = 'active' | 'idle' | 'dormant';

/** Pure. `active` when autopilot is on, or committed under 7 days ago, or used under 7 days ago; `idle` under 30 days; else `dormant`. */
export function activityTier(b: { lastActiveAt: Date; autopilot?: unknown; onboarding?: { committedAt?: string } | null }, now: Date): Tier {
  return 'active';
}
/** Pure. active: true · idle: no run yet, or the last one is 7 or more days old · dormant: false. */
export function cadenceDue(tier: Tier, lastRunAt: Date | null, now: Date): boolean {
  return true;
}
/** Newest job of `kind` per business (max(jobs.created_at), last 8 days). */
export async function lastRuns(kind: string, bids: string[]): Promise<Map<string, Date>> {
  return new Map();
}
/** Mark the business as used by a signed-in member: at most one write an hour, never for a guest, never touches `rev` or `updated_at`. */
export async function touchActive(biz: Pick<BizRow, 'id' | 'lastActiveAt' | 'autopilot' | 'onboarding'>, actor: { guest: boolean }, now: Date = new Date()): Promise<void> {}
