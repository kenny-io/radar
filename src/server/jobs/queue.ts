// Durable Postgres-backed job queue (FOR UPDATE SKIP LOCKED) with retries + backoff and progress.
// Implementation divergence (logged): a small in-repo queue instead of Inngest/Trigger.dev/BullMQ — no extra infrastructure.
import { JOB_OUTCOME, jobProducedOutcome, trackSoon } from '@/server/events';
import os from 'node:os';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { db, pool, schema } from '../db';
import { RadarError } from '../errors';
import { bump } from '../workspace';
import { bizAccess } from '../billing/access';
import { billingFlag, billingFlagNeedsEmail } from '../flags';

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

export async function enqueue(kind: string, payload: any = {}, opts: { businessId?: string | null; ref?: string | null; runAt?: Date; singletonKey?: string; maxAttempts?: number } = {}): Promise<string> {
  const values = { kind, payload, businessId: opts.businessId ?? null, ref: opts.ref ?? null, runAt: opts.runAt ?? new Date(), singletonKey: opts.singletonKey ?? null, maxAttempts: opts.maxAttempts ?? registry.get(kind)?.maxAttempts ?? 3, progress: null };
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

async function execute(job: JobRow, workerId: string) {
  const def = registry.get(job.kind);
  if (!def) { await db.update(schema.jobs).set({ status: 'failed', error: `Unknown job kind ${job.kind}`, finishedAt: new Date() }).where(eq(schema.jobs.id, job.id)); return; }
  if (await lapsed(job).catch((e: any) => { console.error(`[job ${job.kind} ${job.id}] access check failed; running`, e?.message || e); return false; })) {
    await db.update(schema.jobs).set({ status: 'done', result: { skipped: 'no_access' }, finishedAt: new Date(), lockedAt: null }).where(owned(job.id, workerId));
    console.info(`[job ${job.kind} ${job.id}] skipped: the owner has no active subscription`);
    return;
  }
  let last = 0; let pending: any = undefined; let timer: NodeJS.Timeout | null = null; const started = Date.now();
  const flush = async () => { if (pending === undefined) return; const p = pending; pending = undefined; last = Date.now(); await db.update(schema.jobs).set({ progress: p }).where(eq(schema.jobs.id, job.id)); };
  const ctx: JobCtx = {
    job, payload: job.payload, businessId: job.businessId, attempt: job.attempts,
    progress: async (p) => { pending = p; if (Date.now() - last > 250) await flush(); else if (!timer) timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, 260); },
    touch: async () => { if (job.businessId) await bump(job.businessId); },
  };
  try {
    const result = await (def.timeoutMs ? Promise.race([def.run(ctx), new Promise((_, rej) => setTimeout(() => rej(new Error('Job timed out')), def.timeoutMs))]) : def.run(ctx));
    if (timer) clearTimeout(timer); await flush();
    await db.update(schema.jobs).set({ status: 'done', result: result ?? null, finishedAt: new Date(), lockedAt: null }).where(owned(job.id, workerId));
    trackSoon(`job.${job.kind}`, { bid: job.businessId, ref: job.ref, props: { status: 'done', attempt: job.attempts, ms: Date.now() - started, result } });
    if (jobProducedOutcome(job.kind, result)) trackSoon(JOB_OUTCOME[job.kind], { bid: job.businessId, ref: job.ref, props: { ...(result && typeof result === 'object' ? result : {}), auto: job.kind === 'social.autoRun' || undefined } });
  } catch (e: any) {
    if (timer) clearTimeout(timer); await flush().catch(() => {});
    const permanent = e instanceof PermanentJobError || e?.code === 'permanent';
    const msg = e instanceof RadarError ? e.userMessage : 'Radar couldn’t finish this. Try again.';
    console.error(`[job ${job.kind} ${job.id}] attempt ${job.attempts} failed:`, e?.message || e);
    if (!permanent && job.attempts < job.maxAttempts) {
      const delay = def.backoffMs ? def.backoffMs(job.attempts) : Math.min(15 * 60e3, 5000 * Math.pow(3, job.attempts - 1));
      await db.update(schema.jobs).set({ status: 'queued', runAt: new Date(Date.now() + delay), lockedAt: null, error: msg }).where(owned(job.id, workerId));
    } else {
      await db.update(schema.jobs).set({ status: 'failed', error: msg, finishedAt: new Date(), lockedAt: null, result: { detail: String(e?.message || e).slice(0, 500) } }).where(owned(job.id, workerId));
      trackSoon(`job.${job.kind}`, { bid: job.businessId, ref: job.ref, props: { status: 'failed', attempt: job.attempts, ms: Date.now() - started, error: String(e?.message || e).slice(0, 200) } });
    }
  } finally {
    if (job.businessId) await bump(job.businessId).catch(() => {});
  }
}

/** Long-running worker loop. Heartbeats its jobs' locks; recovers jobs of dead workers within ~90s; on stop, hands its
 *  running jobs straight back to the queue (without using up an attempt) so a deploy never strands a job. */
export async function startWorker({ concurrency = Number(process.env.WORKER_CONCURRENCY || 4) } = {}) {
  const workerId = `${os.hostname()}:${process.pid}`;
  let active = 0; let stopping = false;
  await recoverStale();
  const beat = setInterval(() => {
    db.update(schema.jobs).set({ lockedAt: new Date() }).where(and(eq(schema.jobs.status, 'running'), eq(schema.jobs.lockedBy, workerId))).catch(() => {});
    recoverStale().catch(() => {});
  }, 20_000);
  const loop = async () => {
    while (!stopping) {
      if (active >= concurrency) { await new Promise(r => setTimeout(r, 100)); continue; }
      const job = await claim(workerId).catch(e => { console.error('[worker] claim failed', e.message); return null; });
      if (!job) { await new Promise(r => setTimeout(r, 400)); continue; }
      active++;
      execute(job, workerId).finally(() => { active--; });
    }
  };
  loop();
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
