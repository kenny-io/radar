// Minute-tick scheduler. Feature modules register hooks with defineCron(); the worker calls every hook each minute
// under a Postgres advisory lock so only one worker schedules. Hooks must be idempotent (use once()).
import { reportFailure, withFailureContext } from '../observability/failures';
import { pool } from '../db';

type CronHook = { name: string; run: (now: Date) => Promise<void> };
const g = globalThis as unknown as { __radarCron?: CronHook[] };
const hooks = (g.__radarCron ??= []);
export function defineCron(name: string, run: (now: Date) => Promise<void>) { if (!hooks.find(h => h.name === name)) hooks.push({ name, run }); }

export async function tick(now = new Date()) {
  const c = await pool.connect();
  try {
    const { rows } = await c.query('SELECT pg_try_advisory_lock(424242) AS ok');
    if (!rows[0].ok) return;
    try {
      for (const h of hooks) await withFailureContext({ source: 'cron', operation: h.name }, async () => { try { await h.run(now); } catch (e) { await reportFailure(e, { source: 'cron', operation: h.name }); } });
    } finally { await c.query('SELECT pg_advisory_unlock(424242)'); }
  } finally { c.release(); }
}
export function startScheduler() {
  const run = () => tick().catch(e => reportFailure(e, { source: 'cron', operation: 'scheduler.tick', incidentKey: 'scheduler.tick' }));
  setTimeout(run, 3000);
  const iv = setInterval(run, 60_000);
  return { stop: () => clearInterval(iv) };
}
