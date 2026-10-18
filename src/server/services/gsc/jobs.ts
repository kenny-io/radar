// Job + cron definitions for Search Console and "What to improve". Imported by src/server/jobs/all.ts.
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { defineJob, enqueue, once } from '../../jobs/queue';
import { defineCron } from '../../jobs/cron';
import { nowHMIn, todayIn } from '@/lib/format';
import { runBackfill, runIncremental } from './sync';
import { generateSuggestions } from './suggestions';

/** 16-month backfill (ref = businessId). Progress { pct }. Errors pause the sync (status 'error') instead of retrying. */
defineJob({ kind: 'gsc.backfill', maxAttempts: 1, run: async ctx => runBackfill(ctx.businessId!, pct => ctx.progress({ pct })) });

/** Daily incremental pull (ref = businessId). */
defineJob({ kind: 'gsc.incremental', maxAttempts: 1, run: async ctx => runIncremental(ctx.businessId!) });

/** Regenerate What to improve suggestions (ref = businessId). */
defineJob({ kind: 'suggestions.generate', maxAttempts: 3, run: async ctx => { const s = await generateSuggestions(ctx.businessId!); await ctx.touch(); return { count: s.length }; } });

// Daily incremental per business, at 05:00 business time (Search Console data lags 2–3 days).
defineCron('gsc.daily', async now => {
  const rows = await db.select({ bid: schema.gscConnections.businessId, tz: schema.businesses.timezone }).from(schema.gscConnections)
    .innerJoin(schema.businesses, eq(schema.businesses.id, schema.gscConnections.businessId)).where(eq(schema.gscConnections.status, 'connected'));
  for (const r of rows) {
    if (nowHMIn(r.tz, now) < '05:00') continue;
    if (await once(`gsc-inc:${r.bid}:${todayIn(r.tz, now)}`)) await enqueue('gsc.incremental', {}, { businessId: r.bid, ref: r.bid, singletonKey: 'gsc-inc:' + r.bid });
  }
});
