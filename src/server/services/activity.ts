// Review loop + activity (.factory/first-five-optimizations/architecture.md §4): the member's unread count and the
// failed jobs the workspace carries. Activity rows are the stored notifications; read state is one cursor per member.
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import type { FailedJob, Workspace } from '@/lib/types';

const N = schema.notifications; const J = schema.jobs;
/** The rows a member may see: the business's shared rows and the member's own private ones. Always tenant-scoped. */
export const visibleTo = (bid: string, userId: string) => and(eq(N.businessId, bid), or(isNull(N.userId), eq(N.userId, userId)));
/** The member's read cursor as a subquery. No member row gives NULL, and a comparison with NULL counts nothing. */
const cursorOf = (bid: string, userId: string) => sql`(select activity_seen_at from members where business_id = ${bid} and user_id = ${userId} limit 1)`;

/** Notifications for this member (user_id IS NULL OR = userId) newer than members.activity_seen_at. */
export async function activityUnread(bid: string, userId: string): Promise<number> {
  const r = await db.select({ n: sql<number>`count(*)::int` }).from(N).where(and(visibleTo(bid, userId), gt(N.createdAt, cursorOf(bid, userId))));
  return r[0]?.n ?? 0;
}

/** Newest `calendar.generate` and `article.draft` job per (kind, ref), kept when it failed. A later run for the same
 *  item (queued, running or done) is newer, so it replaces the failure; the row itself lives 14 days (jobs/maintenance.ts). */
export async function failedJobsOf(bid: string): Promise<Workspace['failed']> {
  const rows = await db.selectDistinctOn([J.kind, J.ref], { id: J.id, kind: J.kind, ref: J.ref, status: J.status, error: J.error, keep: sql<string | null>`${J.payload}->>'keep'`, createdAt: J.createdAt })
    .from(J).where(and(eq(J.businessId, bid), inArray(J.kind, ['article.draft', 'calendar.generate']))).orderBy(J.kind, J.ref, desc(J.createdAt));
  const out: Workspace['failed'] = { calendar: null, drafts: {} };
  // `at` is when the failed run was created: the client orders it against the jobs it sees live by the same column
  // (`failedNow`, features/shell/activity.ts), so both sides of that comparison come from the database clock.
  const failed = (r: typeof rows[number]): FailedJob => ({ jobId: r.id, error: r.error, at: r.createdAt.toISOString() });
  // One calendar per business: whatever ref a run was started with, only the newest run counts.
  const cal = rows.filter(r => r.kind === 'calendar.generate').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (cal?.status === 'failed') out.calendar = { ...failed(cal), keep: cal.keep === 'true' };
  for (const r of rows) if (r.kind === 'article.draft' && r.ref && r.status === 'failed') out.drafts[r.ref] = failed(r);
  return out;
}
