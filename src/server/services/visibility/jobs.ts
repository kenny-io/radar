// Job + cron definitions for AI Visibility. Imported by src/server/jobs/all.ts.
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { defineJob, enqueue, once } from '../../jobs/queue';
import { defineCron } from '../../jobs/cron';
import { nowHMIn } from '@/lib/format';
import { collectAll, collectOne, ensurePrompts } from './collect';
import { activityTier, cadenceDue, lastRuns, visNightKey } from '../../idle';

/** "Collect now" — one prompt × engine (ref = resultId). */
defineJob<{ resultId: string }>({ kind: 'visibility.collect', maxAttempts: 1, run: async ctx => collectOne(ctx.payload.resultId, { manual: true }) });

/** Collect every cell for a business (nightly), or only the given prompts (first run after prompts are generated). ref = businessId. */
defineJob<{ promptIds?: string[] }>({ kind: 'visibility.run', maxAttempts: 1, run: async ctx => {
  const bid = ctx.businessId!;
  if (!ctx.payload.promptIds) await ensurePrompts(bid).catch(e => console.error('[visibility] prompts', e?.message || e));
  return collectAll(bid, { promptIds: ctx.payload.promptIds, onProgress: (done, total) => ctx.progress({ done, total }) });
} });

// Nightly collection at ~02:00 in each business's timezone (window 02:00–05:59 so a late worker still runs it once).
// By activity tier (idle.ts): active every night; idle at most once per 7 days, counted from the business's newest
// visibility.run job of any origin; dormant not at all. A skipped night writes no cron mark, so nothing queues up for the
// owner's return (touchActive starts the one catch-up run, which takes that night's mark).
export async function nightlyTick(now: Date) {
  const rows = await db.select({ id: schema.businesses.id, tz: schema.businesses.timezone, lastActiveAt: schema.businesses.lastActiveAt, autopilot: schema.businesses.autopilot, onboarding: schema.businesses.onboarding })
    .from(schema.businesses).where(eq(schema.businesses.status, 'active'));
  const due = rows.filter(b => { const hm = nowHMIn(b.tz, now); return hm >= '02:00' && hm < '06:00'; }).map(b => ({ ...b, tier: activityTier(b, now) })).filter(b => b.tier !== 'dormant');
  const runs = await lastRuns('visibility.run', due.filter(b => b.tier === 'idle').map(b => b.id));
  for (const b of due) {
    if (!cadenceDue(b.tier, runs.get(b.id) ?? null, now)) continue;
    if (await once(visNightKey(b.id, b.tz, now))) await enqueue('visibility.run', {}, { businessId: b.id, ref: b.id, singletonKey: 'vis-run:' + b.id });
  }
}
defineCron('visibility.nightly', nightlyTick);
