// Job + cron definitions for AI Visibility. Imported by src/server/jobs/all.ts.
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { defineJob, enqueue, once } from '../../jobs/queue';
import { defineCron } from '../../jobs/cron';
import { nowHMIn, todayIn } from '@/lib/format';
import { collectAll, collectOne, ensurePrompts } from './collect';

/** "Collect now" — one prompt × engine (ref = resultId). */
defineJob<{ resultId: string }>({ kind: 'visibility.collect', maxAttempts: 1, run: async ctx => collectOne(ctx.payload.resultId, { manual: true }) });

/** Collect every cell for a business (nightly), or only the given prompts (first run after prompts are generated). ref = businessId. */
defineJob<{ promptIds?: string[] }>({ kind: 'visibility.run', maxAttempts: 1, run: async ctx => {
  const bid = ctx.businessId!;
  if (!ctx.payload.promptIds) await ensurePrompts(bid).catch(e => console.error('[visibility] prompts', e?.message || e));
  return collectAll(bid, { promptIds: ctx.payload.promptIds, onProgress: (done, total) => ctx.progress({ done, total }) });
} });

// Nightly collection at ~02:00 in each business's timezone (window 02:00–05:59 so a late worker still runs it once).
defineCron('visibility.nightly', async now => {
  const rows = await db.select({ id: schema.businesses.id, tz: schema.businesses.timezone }).from(schema.businesses).where(eq(schema.businesses.status, 'active'));
  for (const b of rows) {
    const hm = nowHMIn(b.tz, now);
    if (hm < '02:00' || hm >= '06:00') continue;
    if (await once(`vis:${b.id}:${todayIn(b.tz, now)}`)) await enqueue('visibility.run', {}, { businessId: b.id, ref: b.id, singletonKey: 'vis-run:' + b.id });
  }
});
