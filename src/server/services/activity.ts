// OPT-F0 stub, filled by E4 (review loop + activity): unread count and failed jobs for the workspace. .factory/first-five-optimizations/architecture.md §4.
import type { Workspace } from '@/lib/types';

/** Notifications for this member (user_id IS NULL OR = userId) newer than members.activity_seen_at. */
export async function activityUnread(bid: string, userId: string): Promise<number> {
  return 0;
}
/** Newest `calendar.generate` and `article.draft` job per (kind, ref), kept when it failed. */
export async function failedJobsOf(bid: string): Promise<Workspace['failed']> {
  return { calendar: null, drafts: {} };
}
