// The first-week run (.factory/first-five-optimizations/architecture.md §1). commitDraft writes `onboarding.firstRun =
// { at }` in the UPDATE that makes a business active, then calls startFirstRun after its transaction. That marker is the
// once-per-business claim: a business committed before this shipped has none and gets nothing (FS-4).
// The queue, the brief jobs and workspace.ts are loaded inside the functions: workspace.ts imports this module, and all
// three import workspace.ts.
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { RadarError } from '../errors';
import { reportFailure } from '../observability/failures';
import { BPLAT } from '@/lib/constants';
import type { BizRow } from '../workspace';
import type { FirstRunItem, FirstRunKey, Workspace } from '@/lib/types';

export const FIRST_RUN_KEYS: readonly FirstRunKey[] = ['calendar', 'brief', 'visibility'];
/** The Dashboard shows the first-week rows for this long after the commit; a failed row leaves with it. */
export const FIRST_RUN_DAYS = 7;
/** A commit whose jobs were never stored (a crash between the commit and startFirstRun) reads as "couldn’t start" after this. */
export const START_GRACE_MS = 60_000;
export const START_ERROR = 'Radar couldn’t start this.';
const JOB_ERROR = 'Radar couldn’t finish this. Try again.';
/** The job kind behind each row. */
export const FIRST_RUN_KIND: Record<FirstRunKey, string> = { calendar: 'calendar.generate', brief: 'brief.scan', visibility: 'visibility.run' };

const B = schema.businesses, J = schema.jobs;

/** The three existing jobs, enqueued exactly as their own screens do (singleton keys: a click there joins this run). */
async function enqueueFirst(biz: BizRow, key: FirstRunKey): Promise<string> {
  const { enqueue } = await import('../jobs/queue');
  if (key === 'calendar') {
    const { calendarSettingsOf } = await import('../workspace');
    return enqueue('calendar.generate', { settings: calendarSettingsOf(biz), keep: false }, { businessId: biz.id, ref: biz.id, singletonKey: 'cal-gen:' + biz.id, maxAttempts: 2 });
  }
  if (key === 'brief') {
    // Default settings. `briefSetup` is left alone: a successful first scan sets it in its own commit, which starts the morning cron.
    const [{ enqueueScan }, { bizToday }] = await Promise.all([import('./brief/jobs'), import('../workspace')]);
    return enqueueScan(biz.id, bizToday(biz), 'first');
  }
  // No promptIds: the job generates the prompts itself. `vis-first:` makes a first visit to Performance join this run.
  return enqueue('visibility.run', {}, { businessId: biz.id, ref: biz.id, singletonKey: 'vis-first:' + biz.id });
}

const setJobs = (jobs: Partial<Record<FirstRunKey, string | null>>) =>
  sql`jsonb_set(${B.onboarding}, '{firstRun,jobs}', coalesce(${B.onboarding}->'firstRun'->'jobs', '{}'::jsonb) || ${JSON.stringify(jobs)}::jsonb)`;

/** Enqueue the calendar, brief and visibility jobs for a business that was just committed, then store their ids. Call after
 *  the commit's transaction. Each job is independent: one that can't be queued is stored as null (a failed row with
 *  Retry) and never stops the others. Does nothing without the marker, or once ids are stored. */
export async function startFirstRun(bid: string): Promise<void> {
  const [biz] = await db.select().from(B).where(eq(B.id, bid)).limit(1);
  const run = biz?.onboarding?.firstRun;
  if (!biz || biz.status !== 'active' || !run || run.jobs) return;
  const jobs: Partial<Record<FirstRunKey, string | null>> = {};
  for (const key of FIRST_RUN_KEYS) {
    try { jobs[key] = await enqueueFirst(biz, key); }
    catch (e) { jobs[key] = null; await reportFailure(e, { source: 'system', operation: `firstRun.start.${key}`, businessId: bid, degraded: true }); }
  }
  await db.update(B).set({ onboarding: setJobs(jobs), rev: sql`${B.rev} + 1`, updatedAt: new Date() })
    .where(and(eq(B.id, bid), sql`${B.onboarding}->'firstRun' IS NOT NULL`, sql`${B.onboarding}->'firstRun'->'jobs' IS NULL`));
}

type JobLite = Pick<typeof J.$inferSelect, 'id' | 'kind' | 'status' | 'progress' | 'result' | 'createdAt'>;
/** A job that ended `done` and did its work: not skipped (no access, or a background rescan with nothing to do) and, for
 *  a brief scan, without a failed source. */
const finishedWell = (j: JobLite) => j.status === 'done' && !j.result?.skipped && !j.result?.failed;

/** A failed row must not outlive a later success somewhere else (the calendar regenerated from its own screen, "Scan
 *  again" in the Daily Brief, a later visibility run). For each failed row, among the business's jobs of that kind
 *  that are newer than the failure: one that finished well makes the row done; otherwise one that is queued or running
 *  becomes the row's job, so the row shows that work instead of a stale failure. One query, only when a row failed. */
async function supersede(bid: string, items: FirstRunItem[], failedAt: Map<FirstRunKey, number>): Promise<FirstRunItem[]> {
  const failed = items.filter(i => i.status === 'failed');
  if (!failed.length) return items;
  const since = Math.min(...failed.map(i => failedAt.get(i.key)!));
  const later: JobLite[] = await db.select({ id: J.id, kind: J.kind, status: J.status, progress: J.progress, result: J.result, createdAt: J.createdAt }).from(J)
    .where(and(eq(J.businessId, bid), inArray(J.kind, failed.map(i => FIRST_RUN_KIND[i.key])), inArray(J.status, ['queued', 'running', 'done']), gt(J.createdAt, new Date(since))))
    .orderBy(desc(J.createdAt)).limit(200);
  return items.map(i => {
    if (i.status !== 'failed') return i;
    const mine = later.filter(j => j.kind === FIRST_RUN_KIND[i.key] && j.id !== i.jobId && j.createdAt.getTime() > failedAt.get(i.key)!);
    const good = mine.find(finishedWell);
    if (good) return { key: i.key, jobId: good.id, status: 'done', progress: null, error: null };
    const live = mine.find(j => j.status === 'queued' || j.status === 'running');
    return live ? { key: i.key, jobId: live.id, status: live.status as 'queued' | 'running', progress: live.progress, error: null } : i;
  });
}

/** One row per job from the tracked ids. Job `failed` → failed; a brief scan that ended `done` with `result.failed` (a
 *  source failed, scan.ts) and wasn't dismissed in the Daily Brief → failed; no id → failed; a job row that is gone → done.
 *  Then `supersede`: a later success of the same kind clears a failed row. */
async function itemsOf(biz: Pick<BizRow, 'id' | 'onboarding'>): Promise<FirstRunItem[]> {
  const run = biz.onboarding!.firstRun!;
  const startedAt = Date.parse(run.at);
  const failedAt = new Map<FirstRunKey, number>();
  if (!run.jobs) {
    // The commit is so recent that startFirstRun may still be enqueueing: nothing to look up yet.
    if (Date.now() - startedAt <= START_GRACE_MS) return FIRST_RUN_KEYS.map(key => ({ key, jobId: null, status: 'queued', progress: null, error: null }));
    for (const key of FIRST_RUN_KEYS) failedAt.set(key, startedAt);
    return supersede(biz.id, FIRST_RUN_KEYS.map(key => ({ key, jobId: null, status: 'failed', progress: null, error: START_ERROR })), failedAt);
  }
  const ids = FIRST_RUN_KEYS.map(k => run.jobs![k]).filter((x): x is string => !!x);
  const rows = ids.length ? await db.select({ id: J.id, status: J.status, progress: J.progress, error: J.error, result: J.result, createdAt: J.createdAt }).from(J).where(and(eq(J.businessId, biz.id), inArray(J.id, ids))) : [];
  const byId = new Map(rows.map(r => [r.id, r]));
  const items = FIRST_RUN_KEYS.map((key): FirstRunItem => {
    const jobId = run.jobs![key] || null;
    if (!jobId) { failedAt.set(key, startedAt); return { key, jobId: null, status: 'failed', progress: null, error: START_ERROR }; }
    const j = byId.get(jobId);
    if (!j) return { key, jobId, status: 'done', progress: null, error: null };
    failedAt.set(key, j.createdAt.getTime());
    if (j.status === 'failed') return { key, jobId, status: 'failed', progress: j.progress, error: j.error || JOB_ERROR };
    const r = (j.result || {}) as { failed?: string; dismissed?: boolean };
    if (key === 'brief' && j.status === 'done' && r.failed && !r.dismissed)
      return { key, jobId, status: 'failed', progress: j.progress, error: `${BPLAT[r.failed as keyof typeof BPLAT] || 'A source'} didn’t respond, so today’s brief isn’t ready.` };
    return { key, jobId, status: j.status, progress: j.progress, error: null };
  });
  return supersede(biz.id, items, failedAt);
}

const shown = (biz: Pick<BizRow, 'onboarding'>) => {
  const run = biz.onboarding?.firstRun;
  if (!run || run.dismissedAt) return false;
  const at = Date.parse(run.at);
  return Number.isFinite(at) && Date.now() - at < FIRST_RUN_DAYS * 86400e3;
};

/** The first-week rows for the Dashboard, or undefined once nothing is queued, running or failed (also when dismissed or
 *  older than 7 days). No query for a business without the marker; one query (the three job rows by id) otherwise, and a
 *  second only while a row is failed. */
export async function firstRunOf(biz: Pick<BizRow, 'id' | 'onboarding'>): Promise<Workspace['firstRun']> {
  if (!shown(biz)) return undefined;
  const items = await itemsOf(biz);
  return items.some(i => i.status !== 'done') ? { at: biz.onboarding!.firstRun!.at, items } : undefined;
}

/** Retry one failed row: enqueue that job again and track the new id. A row that isn't failed (a double click, another
 *  member got there first, a later run already fixed it, or the commit is still starting its jobs) answers with the job
 *  the row shows (null while starting) and starts nothing. */
export async function retryFirstRun(bid: string, key: FirstRunKey): Promise<string | null> {
  const [biz] = await db.select().from(B).where(eq(B.id, bid)).limit(1);
  if (!biz || biz.status !== 'active' || !shown(biz)) throw new RadarError('There’s nothing to retry here.', 409, 'no_first_run');
  const item = (await itemsOf(biz)).find(i => i.key === key)!;
  if (item.status !== 'failed') return item.jobId;
  let jobId: string;
  try { jobId = await enqueueFirst(biz, key); }
  catch (e) { await reportFailure(e, { source: 'system', operation: `firstRun.retry.${key}`, businessId: bid }); throw new RadarError('Radar couldn’t start this. Try again.', 503, 'first_run_start'); }
  await db.update(B).set({ onboarding: setJobs({ [key]: jobId }) }).where(and(eq(B.id, bid), sql`${B.onboarding}->'firstRun' IS NOT NULL`));
  return jobId;
}

/** Hide the first-week rows for good (every member). Jobs that are still running carry on. */
export async function dismissFirstRun(bid: string): Promise<void> {
  await db.update(B).set({ onboarding: sql`jsonb_set(${B.onboarding}, '{firstRun,dismissedAt}', ${JSON.stringify(new Date().toISOString())}::jsonb)` })
    .where(and(eq(B.id, bid), sql`${B.onboarding}->'firstRun' IS NOT NULL`));
}
