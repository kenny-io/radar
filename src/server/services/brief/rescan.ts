// Automatic background rescans of today's brief (owner request 2026-10-26: "a rescan every 2 hours … until that day is
// done"). Pure decision only; the cron that acts on it is `brief.rescan` in jobs.ts.

/** Time between scans of a day, whatever started the last one (morning scan, Scan again, Keep, an earlier rescan). */
export const RESCAN_EVERY_MS = 2 * 3600e3;

export interface LastScan { createdAt: Date; status: 'queued' | 'running' | 'done' | 'failed' | string }

/** Is a background rescan of today due? Only when today's brief exists (so never before the morning scan, nor after local
 *  midnight), today's latest `brief.scan` job has finished, and it was created ≥ 2 h ago. Elapsed time comes from the job's
 *  `createdAt`, so DST doesn't matter, a click on Scan again restarts the clock, and a failed run is retried after 2 h
 *  (not every minute). A day without any job of its own (seeded or imported; real days are made by a job) is due. */
export function rescanDue(o: { hasDay: boolean; last: LastScan | null; now: Date }): boolean {
  if (!o.hasDay) return false;
  if (!o.last) return true;
  if (o.last.status === 'queued' || o.last.status === 'running') return false;
  return o.now.getTime() - o.last.createdAt.getTime() >= RESCAN_EVERY_MS;
}

/** Margin before the previous scan when a background rescan asks a real-time source only for new threads. */
export const NEW_SINCE_MARGIN_MS = 10 * 60e3;
export interface EarlierScan { createdAt: Date; status: string; payload: any; result: any }
/** Where a background rescan's real-time sources start reading (epoch ms): the newest earlier scan of the day that really
 *  read `plat` (finished; not failed, skipped or a Keep run; the platform not skipped), minus 10 minutes. Undefined when
 *  there is none, so the source reads its usual window. `earlier` = the day's scans created before this one, newest first. */
export function newSinceFor(earlier: EarlierScan[], plat: string): number | undefined {
  const s = earlier.find(j => j.status === 'done' && j.payload?.mode !== 'keep' && !j.result?.failed && !j.result?.skipped && !(j.result?.skippedPlats || []).includes(plat));
  return s ? s.createdAt.getTime() - NEW_SINCE_MARGIN_MS : undefined;
}
