// Job + cron definitions for AI Visibility. Imported by src/server/jobs/all.ts.
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { clearOnce, defineJob, enqueue, once } from '../../jobs/queue';
import { defineCron } from '../../jobs/cron';
import { nowHMIn } from '@/lib/format';
import { collectAll, collectOne, ensurePrompts } from './collect';
import { activityTier, cadenceDue, lastFullVisibilityRuns, lastRuns, visNightKey, visibilityCadence, visibilityDue } from '../../idle';

/** "Collect now" — one prompt × engine (ref = resultId). Its result stays `{ status }`. */
defineJob<{ resultId: string }>({ kind: 'visibility.collect', maxAttempts: 1, run: async ctx => ({ status: (await collectOne(ctx.payload.resultId, { manual: true })).status }) });

/** Collect every cell for a business (the weekly scheduled run, the first run, the catch-up on return), or only the given
 *  prompts (generated prompts' first collection, a prompt the user just added). ref = businessId.
 *  Result `{ total, collected }`: cells in scope, and how many got a new measurement. A full run with cells and none
 *  collected does not count as the business's run (idle.ts `lastFullVisibilityRuns`), so it is tried again. */
defineJob<{ promptIds?: string[] }>({ kind: 'visibility.run', maxAttempts: 1, run: async ctx => {
  const bid = ctx.businessId!;
  if (!ctx.payload.promptIds) await ensurePrompts(bid).catch(e => console.error('[visibility] prompts', e?.message || e));
  return collectAll(bid, { promptIds: ctx.payload.promptIds, onProgress: (done, total) => ctx.progress({ done, total }) });
} });

// Scheduled collection at ~02:00 in each business's timezone (window 02:00–05:59 so a late worker still runs it once).
// Weekly (idle.ts `visibilityDue`, thresholds there), for active, idle and Autopilot businesses alike; dormant not at all.
// (a) On the business's Sunday night, unless a full visibility.run that counts started under 2 local days ago (that
//     Saturday, or earlier that Sunday).
// (b) On any night, when its newest such run started 8 or more local days ago, or it has none: a Sunday that was missed,
//     or whose run failed or collected nothing, is caught up the next night, and the Sunday after runs as usual.
// A full run of any origin counts (first run, catch-up on return); a run for a few prompts, a failed run and a run in
// which every assistant failed for every cell do not.
// At most one enqueue per business per local day (the day's mark), so a business whose runs keep failing or coming back
// empty is tried once a night. A night with nothing due writes no mark, so nothing queues up for the owner's return (touchActive starts the
// one catch-up run, which takes that day's mark).
// RADAR_VISIBILITY_CADENCE=nightly restores the schedule this replaced, by activity tier: active every night; idle at most
// once per 7 days, counted from the business's newest visibility.run job of any origin; dormant not at all.
// The function and the cron keep the name `nightly`: the cron still ticks every night, and alerting keys on its name.
export async function nightlyTick(now: Date) {
  const rows = await db.select({ id: schema.businesses.id, tz: schema.businesses.timezone, lastActiveAt: schema.businesses.lastActiveAt, autopilot: schema.businesses.autopilot, onboarding: schema.businesses.onboarding })
    .from(schema.businesses).where(eq(schema.businesses.status, 'active'));
  const due = rows.filter(b => { const hm = nowHMIn(b.tz, now); return hm >= '02:00' && hm < '06:00'; }).map(b => ({ ...b, tier: activityTier(b, now) })).filter(b => b.tier !== 'dormant');
  if (visibilityCadence() === 'nightly') {
    const runs = await lastRuns('visibility.run', due.filter(b => b.tier === 'idle').map(b => b.id));
    for (const b of due) {
      if (!cadenceDue(b.tier, runs.get(b.id) ?? null, now)) continue;
      if (await once(visNightKey(b.id, b.tz, now))) await enqueue('visibility.run', {}, { businessId: b.id, ref: b.id, singletonKey: 'vis-run:' + b.id });
    }
    return;
  }
  const full = await lastFullVisibilityRuns(due.map(b => b.id), now);
  for (const b of due) {
    if (!visibilityDue(b.tier, b.tz, full.get(b.id) ?? null, now)) continue;
    const night = visNightKey(b.id, b.tz, now);
    if (!await once(night)) continue;
    // A run lost here would cost the business a week, not a night: give the mark back so the next tick tries again.
    try { await enqueue('visibility.run', {}, { businessId: b.id, ref: b.id, singletonKey: 'vis-run:' + b.id }); }
    catch (e) { await clearOnce(night).catch(() => {}); throw e; }
  }
}
defineCron('visibility.nightly', nightlyTick);
