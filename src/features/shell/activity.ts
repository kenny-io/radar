// Activity bell and failed states (first-five RL-4, RL-5): the React-free parts.
import type { FailedJob, JobSummary } from '@/lib/types';

/** The number on the bell. */
export const badgeText = (n: number): string => (n > 99 ? '99+' : String(n));
/** The bell's accessible name carries the count. */
export const bellLabel = (n: number): string => (n > 0 ? `Activity, ${n} unread` : 'Activity');

/** "just now", "5m ago", "3h ago", "2d ago" (Activity keeps 30 days). */
export function agoLabel(iso: string, now: number): string {
  const t = new Date(iso).getTime(); if (!Number.isFinite(t)) return '';
  const m = Math.floor(Math.max(0, now - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.floor(m / 60) + 'h ago' : Math.floor(m / 1440) + 'd ago';
}

/** A notification's link, only when it stays inside the app (a path, not `//host` or another origin). */
export const internalHref = (href: string | null | undefined): string | null => (typeof href === 'string' && /^\/(?!\/)/.test(href) && !href.includes('\\') ? href : null);

/** An item is new when it was written after the member's read cursor as it stood when the list was loaded. */
export const isNew = (at: string, seenAt: string | null): boolean => !!seenAt && new Date(at).getTime() > new Date(seenAt).getTime();

type LiveJob = Pick<JobSummary, 'id' | 'status' | 'error' | 'createdAt' | 'progress'>;
/** Is this item's newest run a failure? `live` is the tab's latest job for the item (`app.jobFor`), `snap` the
 *  workspace's `B.failed…` entry (`at` = when that run was created). Whichever is the later run decides:
 *  - the workspace's record wins when it is about the same run as `live` or a later one (the tab can hold a stale job);
 *  - otherwise `live` is the newest run: failed shows at once, before the workspace catches up; queued, running or
 *    done means a retry is under way or has succeeded, so nothing is shown. */
export function failedNow(live: LiveJob | null | undefined, snap: FailedJob | null | undefined): FailedJob | null {
  if (!live) return snap || null;
  if (snap && (snap.jobId === live.id || snap.at > live.createdAt)) return snap;
  return live.status === 'failed' ? { jobId: live.id, error: live.error, at: live.createdAt, ...(typeof live.progress?.keep === 'boolean' ? { keep: live.progress.keep } : {}) } : null;
}
