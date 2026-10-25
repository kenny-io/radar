// Postgres fixed-window rate limits (architecture §8, B15). A rejected attempt still counts; when several limits apply,
// all are counted first, then the first one over its limit is reported.
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { RadarError } from '../errors';

export const HOUR = 3600, DAY = 86400;
/** Circuit breaker: analyses per hour across all actors without own access (RADAR_ANALYSIS_GLOBAL_PER_HOUR, default 300). */
export const analysisGlobalPerHour = () => Math.max(1, Number(process.env.RADAR_ANALYSIS_GLOBAL_PER_HOUR) || 300);
export interface Limit { key: string; limit: number; windowSec: number; error: () => RadarError }

/** Count one hit in the current window. The window length is part of the stored key, so an hour and a day window that
 *  start at the same instant never share a row. */
export async function hit(key: string, windowSec: number): Promise<number> {
  const r = await db.execute(sql`INSERT INTO rate_limits (key, window_start, count)
    VALUES (${`${key}@${windowSec}`}, to_timestamp(floor(extract(epoch from now()) / ${windowSec}) * ${windowSec}), 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count`);
  return Number((r.rows[0] as any).count);
}

export async function enforce(limits: Limit[]) {
  const counts = await Promise.all(limits.map(l => hit(l.key, l.windowSec)));
  const over = limits.findIndex((l, i) => counts[i] > l.limit);
  if (over >= 0) { console.info(`[abuse] limit hit: ${limits[over].key.split(':').slice(0, 2).join(':')}`); throw limits[over].error(); }
}

const rl = (msg: string) => () => new RadarError(msg, 429, 'rate_limited');
export const COPY = {
  ipHour: 'You’ve started several analyses in a short time. Try again in an hour.',
  ipDay: 'You’ve started several analyses in a short time. Try again tomorrow.',
  domain: (d: string) => `Radar has analyzed ${d} several times today. Try again tomorrow.`,
  busy: 'Radar is busy right now. Try again in a few minutes.',
  guest: 'You’ve started several analyses in a short time. Try again in an hour.',
  billing: 'Too many attempts. Try again in an hour.',
};

/** onboarding.analyze by any actor without own access (guests in every flag state, and users without access). */
export async function limitAnalysis(ip: string, domain: string) {
  await enforce([
    { key: 'analysis:global', limit: analysisGlobalPerHour(), windowSec: HOUR, error: () => new RadarError(COPY.busy, 503, 'busy') },
    { key: `analysis:ip:${ip}`, limit: 5, windowSec: HOUR, error: rl(COPY.ipHour) },
    { key: `analysis:ip:${ip}`, limit: 20, windowSec: DAY, error: rl(COPY.ipDay) },
    { key: `analysis:domain:${domain}`, limit: 10, windowSec: DAY, error: rl(COPY.domain(domain)) },
  ]);
}
/** Creating a guest in POST /api/b. */
export const limitGuestCreation = (ip: string) => enforce([{ key: `guest:ip:${ip}`, limit: 10, windowSec: HOUR, error: rl(COPY.guest) }]);
/** billing/start and billing/restart. */
export const limitBilling = (uid: string, ip: string) => enforce([
  { key: `billing:user:${uid}`, limit: 5, windowSec: HOUR, error: rl(COPY.billing) },
  { key: `billing:ip:${ip}`, limit: 10, windowSec: HOUR, error: rl(COPY.billing) },
]);
