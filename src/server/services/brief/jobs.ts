// Job + cron definitions for "brief". Imported by src/server/jobs/all.ts.
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { defineJob, enqueue, once } from '@/server/jobs/queue';
import { defineCron } from '@/server/jobs/cron';
import { briefSettingsOf } from '@/server/workspace';
import { nowHMIn, todayIn } from '@/lib/format';
import { runScan, type ScanPayload } from './scan';
import { expirePastDays, getDay } from './store';

/** brief.scan (ref = date). Progress { step, threadsRead, failed?, steps, mode }. A platform failure is a handled
 *  outcome (result.failed) so the user decides: Try again, or keep this morning's brief. */
defineJob<ScanPayload>({ kind: 'brief.scan', maxAttempts: 1, timeoutMs: 20 * 60e3, run: runScan });

export async function enqueueScan(bid: string, date: string, mode: ScanPayload['mode'], fromJob?: string) {
  return enqueue('brief.scan', { mode, date, fromJob }, { businessId: bid, ref: date, singletonKey: `brief-scan:${bid}:${date}` });
}

const minutes = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

/** Daily scan at settings.time in the business timezone (idempotent per day), with two automatic retries 15 minutes
 *  apart if the morning scan didn't produce a brief. Also persists expiry of past days once a day. */
defineCron('brief.daily', async (now) => {
  const rows = await db.select({ id: schema.businesses.id, tz: schema.businesses.timezone, briefSettings: schema.businesses.briefSettings, setup: schema.businesses.briefSetup })
    .from(schema.businesses).where(and(eq(schema.businesses.status, 'active'), eq(schema.businesses.briefSetup, true)));
  for (const b of rows) {
    const tz = b.tz || 'America/New_York';
    const today = todayIn(tz, now);
    if (await once(`brief-expire:${b.id}:${today}`)) await expirePastDays(b.id, today).catch(e => console.error('[brief.expire]', e?.message));
    const s = briefSettingsOf(b as any);
    const late = minutes(nowHMIn(tz, now)) - minutes(s.time || '06:00');
    if (late < 0) continue;
    const attempt = late < 15 ? 0 : late < 30 ? 1 : late < 45 ? 2 : -1;
    if (attempt < 0) continue;
    if (await getDay(b.id, today)) continue;
    if (attempt > 0) {
      // Only retry when the last scan for today finished without a brief.
      const last = (await db.select().from(schema.jobs).where(and(eq(schema.jobs.businessId, b.id), eq(schema.jobs.kind, 'brief.scan'), eq(schema.jobs.ref, today))).orderBy(desc(schema.jobs.createdAt)).limit(1))[0];
      if (!last || last.status === 'queued' || last.status === 'running') continue;
    }
    if (await once(`brief:${b.id}:${today}:${attempt}`)) await enqueueScan(b.id, today, 'first');
  }
});
