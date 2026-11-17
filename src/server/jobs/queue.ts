// Durable Postgres-backed job queue (FOR UPDATE SKIP LOCKED) with retries + backoff and progress.
// Implementation divergence (logged): a small in-repo queue instead of Inngest/Trigger.dev/BullMQ — no extra infrastructure.
import { JOB_OUTCOME, jobProducedOutcome, trackSoon } from '@/server/events';
import os from 'node:os';
import { holdAlerts, reportFailure, sanitizeDiagnostic, withFailureContext } from '../observability/failures';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { db, pool, schema } from '../db';
import { RadarError } from '../errors';
import { bump } from '../workspace';
import { bizAccess } from '../billing/access';
import { billingFlag, billingFlagNeedsEmail } from '../flags';
import { SKIPPED_DELETED, businessDeleted, isBusinessDeleted } from '../deletion/state';

export type JobRow = typeof schema.jobs.$inferSelect;
export interface JobCtx<P = any> {
  job: JobRow; payload: P; businessId: string | null; attempt: number;
  /** Persist progress for the UI (streamed over SSE). Throttled internally. */
  progress: (p: any) => Promise<void>;
  /** Bump the business revision so clients refetch the workspace. */
  touch: () => Promise<void>;
}
export interface JobDef<P = any> { kind: string; run: (ctx: JobCtx<P>) => Promise<any>; maxAttempts?: number; backoffMs?: (attempt: number) => number; timeoutMs?: number }

const g = globalThis as unknown as { __radarJobs?: Map<string, JobDef> };
const registry = (g.__radarJobs ??= new Map());
export function defineJob<P = any>(def: JobDef<P>) { registry.set(def.kind, def as JobDef); return def; }
export const jobDefs = () => registry;

/** Errors that should not be retried. */
export class PermanentJobError extends RadarError { constructor(msg: string) { super(msg, 400, 'permanent'); } }

/** `progress` = the job's progress while it is still queued (e.g. `{ quiet: true }`, so the UI ignores a background job
 *  before the worker picks it up). */
export async function enqueue(kind: string, payload: any = {}, opts: { businessId?: string | null; ref?: string | null; runAt?: Date; singletonKey?: string; maxAttempts?: number; progress?: any } = {}): Promise<string> {
  const values = { kind, payload, businessId: opts.businessId ?? null, ref: opts.ref ?? null, runAt: opts.runAt ?? new Date(), singletonKey: opts.singletonKey ?? null, maxAttempts: opts.maxAttempts ?? registry.get(kind)?.maxAttempts ?? 3, progress: opts.progress ?? null };
  if (opts.singletonKey) {
    const existing = await db.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.singletonKey, opts.singletonKey), inArray(schema.jobs.status, ['queued', 'running']))).limit(1);
    if (existing[0]) return existing[0].id;
    try { const r = await db.insert(schema.jobs).values(values).returning({ id: schema.jobs.id }); return r[0].id; }
    catch { const again = await db.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.singletonKey, opts.singletonKey), inArray(schema.jobs.status, ['queued', 'running']))).limit(1); if (again[0]) return again[0].id; throw new Error('enqueue failed'); }
  }
  const r = await db.insert(schema.jobs).values(values).returning({ id: schema.jobs.id });
  if (opts.businessId) await bump(opts.businessId).catch(() => {});
  return r[0].id;
}

export async function getJob(id: string) { const r = await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).limit(1); return r[0] || null; }

/** Run a job inline (used by tests and by the dev "worker in web" fallback). */
export async function runJobNow(id: string) { const j = await getJob(id); if (j) await execute(j, 'inline'); }

async function claim(workerId: string): Promise<JobRow | null> {
  const { rows } = await pool.query(
    `UPDATE jobs SET status='running', locked_at=now(), locked_by=$1, attempts=attempts+1
     WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_at <= now() AND kind = ANY($2) ORDER BY run_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id`, [workerId, [...registry.keys()]]);
  if (!rows[0]) return null;
  return getJob(rows[0].id);
}

/** Final writes only land if this worker still owns the job (it may have been handed back on shutdown or recovered). */
const owned = (id: string, workerId: string) => workerId === 'inline' ? eq(schema.jobs.id, id) : and(eq(schema.jobs.id, id), eq(schema.jobs.lockedBy, workerId), eq(schema.jobs.status, 'running'));

const STALE_MS = 90_000; // a running job whose lock isn't refreshed for this long belongs to a dead worker
async function recoverStale() {
  await db.update(schema.jobs).set({ status: 'queued', lockedAt: null, lockedBy: null }).where(and(eq(schema.jobs.status, 'running'), lte(schema.jobs.lockedAt, new Date(Date.now() - STALE_MS))));
}

/** Jobs that still run for a lapsed business: sending a post the user already scheduled is theirs to finish. */
const RUNS_WITHOUT_ACCESS = new Set(['social.send']);
/** Architecture §21.5: an active business whose owner has no access does no background work (crawls, AI queries,
 *  drafts). No database read while billing is off; drafts (onboarding) always run, so guests can be analyzed. */
async function lapsed(job: JobRow): Promise<boolean> {
  if (!job.businessId || RUNS_WITHOUT_ACCESS.has(job.kind)) return false;
  if (!billingFlagNeedsEmail() && !billingFlag(null)) return false;
  const b = (await db.select({ status: schema.businesses.status, ownerId: schema.businesses.ownerId }).from(schema.businesses).where(eq(schema.businesses.id, job.businessId)).limit(1))[0];
  return !!b && b.status === 'active' && !(await bizAccess(b));
}

/** A job that reports progress re-reads its business's deleted state at most this often (delete-business §2.2). */
export const DELETED_RECHECK_MS = 5000;
/** A deleted business does no background work: the job is closed as skipped, never failed, and nobody is alerted. */
async function skipDeleted(job: JobRow, workerId: string) {
  await db.update(schema.jobs).set({ status: 'done', result: SKIPPED_DELETED, finishedAt: new Date(), lockedAt: null }).where(owned(job.id, workerId));
  console.info(`[job ${job.kind} ${job.id}] skipped: the business was deleted`);
}
/** How a failed attempt ends: back in the queue with a delay while attempts remain, else `failed`. */
async function endFailedAttempt(job: JobRow, def: JobDef, workerId: string, e: any, started: number) {
  const permanent = e instanceof PermanentJobError || e?.code === 'permanent';
  const msg = e instanceof RadarError ? e.userMessage : 'Radar couldn’t finish this. Try again.';
  if (job.kind !== 'observability.alert') await reportFailure(e, { source: 'job', operation: job.kind, retrying: !permanent && job.attempts < job.maxAttempts });
  else console.error('[radar.alert.retry_failed]', sanitizeDiagnostic(e?.message || 'Alert delivery failed'));
  if (!permanent && job.attempts < job.maxAttempts) {
    const delay = def.backoffMs ? def.backoffMs(job.attempts) : Math.min(15 * 60e3, 5000 * Math.pow(3, job.attempts - 1));
    await db.update(schema.jobs).set({ status: 'queued', runAt: new Date(Date.now() + delay), lockedAt: null, error: msg }).where(owned(job.id, workerId));
  } else {
    await db.update(schema.jobs).set({ status: 'failed', error: msg, finishedAt: new Date(), lockedAt: null, result: { detail: String(e?.message || e).slice(0, 500) } }).where(owned(job.id, workerId));
    trackSoon(`job.${job.kind}`, { bid: job.businessId, ref: job.ref, props: { status: 'failed', attempt: job.attempts, ms: Date.now() - started, error: String(e?.message || e).slice(0, 200) } });
  }
}

async function execute(job: JobRow, workerId: string) {
  return withFailureContext({ source: 'job', operation: job.kind, jobId: job.id, businessId: job.businessId, ref: job.ref, attempt: job.attempts, maxAttempts: job.maxAttempts }, () => executeInContext(job, workerId));
}
async function executeInContext(job: JobRow, workerId: string) {
  const def = registry.get(job.kind);
  if (!def) { if (job.kind !== 'observability.alert') await reportFailure(new Error(`Unknown job kind ${job.kind}`), { source: 'job', operation: job.kind }); await db.update(schema.jobs).set({ status: 'failed', error: `Unknown job kind ${job.kind}`, finishedAt: new Date() }).where(eq(schema.jobs.id, job.id)); return; }
  // Before anything else, for every kind and with billing on or off (`lapsed` below skips social.send and reads nothing
  // when billing is off). A check that cannot be made fails the attempt: the job is retried and never runs unchecked.
  if (job.businessId) {
    let deleted: boolean;
    try { deleted = await isBusinessDeleted(job.businessId); }
    catch (e) { await endFailedAttempt(job, def, workerId, e, Date.now()); return; }
    if (deleted) { await skipDeleted(job, workerId); return; }
  }
  if (await lapsed(job).catch(async (e: any) => { await reportFailure(e, { source: 'job', operation: `${job.kind}.accessCheck`, degraded: true }); return false; })) {
    await db.update(schema.jobs).set({ status: 'done', result: { skipped: 'no_access' }, finishedAt: new Date(), lockedAt: null }).where(owned(job.id, workerId));
    console.info(`[job ${job.kind} ${job.id}] skipped: the owner has no active subscription`);
    return;
  }
  let last = 0; let pending: any = undefined; let timer: NodeJS.Timeout | null = null; const started = Date.now();
  let checkedAt = started; let stopped = false;
  // A running job stops at its next progress report once its business is deleted (DEL-5): nothing it does after that
  // report is started. A read that fails throws too, so the job cannot go on unchecked.
  const stillThere = async () => {
    if (!job.businessId || Date.now() - checkedAt < DELETED_RECHECK_MS) return;
    checkedAt = Date.now();
    if (await isBusinessDeleted(job.businessId)) throw businessDeleted();
  };
  const flush = async () => { if (pending === undefined) return; const p = pending; pending = undefined; last = Date.now(); await db.update(schema.jobs).set({ progress: p }).where(eq(schema.jobs.id, job.id)); };
  const ctx: JobCtx = {
    job, payload: job.payload, businessId: job.businessId, attempt: job.attempts,
    progress: async (p) => { await stillThere(); pending = p; if (Date.now() - last > 250) await flush(); else if (!timer) timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, 260); },
    touch: async () => { if (job.businessId) await bump(job.businessId); },
  };
  // While attempts remain, whether a failure inside this one matters to an operator depends on how the attempt ends.
  const settle = job.kind !== 'observability.alert' && job.attempts < job.maxAttempts ? holdAlerts() : null;
  try {
    const result = await (def.timeoutMs ? Promise.race([def.run(ctx), new Promise((_, rej) => setTimeout(() => rej(new Error('Job timed out')), def.timeoutMs))]) : def.run(ctx));
    await settle?.(true); // finished, so anything reported on the way was not retried: email it
    if (timer) clearTimeout(timer); await flush();
    await db.update(schema.jobs).set({ status: 'done', result: result ?? null, finishedAt: new Date(), lockedAt: null }).where(owned(job.id, workerId));
    trackSoon(`job.${job.kind}`, { bid: job.businessId, ref: job.ref, props: { status: 'done', attempt: job.attempts, ms: Date.now() - started, result } });
    if (jobProducedOutcome(job.kind, result)) trackSoon(JOB_OUTCOME[job.kind], { bid: job.businessId, ref: job.ref, props: { ...(result && typeof result === 'object' ? result : {}), auto: job.kind === 'social.autoRun' || undefined } });
  } catch (e: any) {
    if (timer) clearTimeout(timer); await flush().catch(() => {});
    // Whatever a job of a deleted business ran into is not an incident: it is closed as skipped, the alerts it held
    // are dropped unsent, and nothing is reported. If the state cannot be read, the failure is handled as any other.
    stopped = !!job.businessId && await isBusinessDeleted(job.businessId).catch(() => false);
    if (stopped) { await skipDeleted(job, workerId); return; }   // `settle` is never called: what it held is never sent
    const permanent = e instanceof PermanentJobError || e?.code === 'permanent';
    await settle?.(permanent, e); // ended for good: email what was held; retried: drop only the alerts for the failure being retried
    await endFailedAttempt(job, def, workerId, e, started);
  } finally {
    if (job.businessId && !stopped) await bump(job.businessId).catch(() => {});
  }
}

/** Long-running worker loop. Heartbeats its jobs' locks; recovers jobs of dead workers within ~90s; on stop, hands its
 *  running jobs straight back to the queue (without using up an attempt) so a deploy never strands a job. */
export async function startWorker({ concurrency = Number(process.env.WORKER_CONCURRENCY || 4) } = {}) {
  const workerId = `${os.hostname()}:${process.pid}`;
  let active = 0; let stopping = false;
  await recoverStale();
  const beat = setInterval(() => {
    db.update(schema.jobs).set({ lockedAt: new Date() }).where(and(eq(schema.jobs.status, 'running'), eq(schema.jobs.lockedBy, workerId))).catch(e => reportFailure(e, { source: 'system', operation: 'worker.heartbeat', incidentKey: 'worker.heartbeat' }));
    recoverStale().catch(e => reportFailure(e, { source: 'system', operation: 'worker.recoverStale', incidentKey: 'worker.recoverStale' }));
  }, 20_000);
  const loop = async () => {
    while (!stopping) {
      if (active >= concurrency) { await new Promise(r => setTimeout(r, 100)); continue; }
      const job = await claim(workerId).catch(async e => { await reportFailure(e, { source: 'system', operation: 'worker.claim', incidentKey: 'worker.claim' }); return null; });
      if (!job) { await new Promise(r => setTimeout(r, 400)); continue; }
      active++;
      execute(job, workerId).catch(e => job.kind === 'observability.alert' ? undefined : reportFailure(e, { source: 'system', operation: 'worker.execute', jobId: job.id, businessId: job.businessId })).finally(() => { active--; });
    }
  };
  loop().catch(e => reportFailure(e, { source: 'system', operation: 'worker.loop' }));
  return {
    stop: async () => {
      stopping = true; clearInterval(beat);
      await pool.query(`UPDATE jobs SET status='queued', locked_at=NULL, locked_by=NULL, attempts=GREATEST(attempts-1,0), run_at=now() WHERE status='running' AND locked_by=$1`, [workerId]).catch(() => {});
    },
  };
}

/** Run a callback once per key (idempotent scheduling). Returns true the first time. */
export async function once(key: string): Promise<boolean> {
  const r = await db.insert(schema.cronMarks).values({ key }).onConflictDoNothing().returning({ key: schema.cronMarks.key });
  return r.length > 0;
}
export async function clearOnce(key: string) { await db.delete(schema.cronMarks).where(eq(schema.cronMarks.key, key)); }
export { sql };
