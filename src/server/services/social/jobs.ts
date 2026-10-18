// Job + cron definitions for "social". Imported by src/server/jobs/all.ts.
import { defineJob, PermanentJobError } from '../../jobs/queue';
import { defineCron } from '../../jobs/cron';
import { RadarError } from '../../errors';
import { createPack, type PackInput } from './generate';
import { autoRun, autoTick } from './auto';

/** social.generate (ref = client token) — progress { done }, result { packId }. */
defineJob<PackInput>({
  kind: 'social.generate', maxAttempts: 2, timeoutMs: 10 * 60e3,
  run: async ctx => {
    await ctx.progress({ done: 0 });
    try {
      const packId = await createPack(ctx.businessId!, ctx.payload, done => ctx.progress({ done }));
      await ctx.touch();
      return { packId };
    } catch (e: any) {
      // A page Radar can't read won't succeed on retry.
      if (e instanceof RadarError && e.code !== 'ai_failed') throw new PermanentJobError(e.userMessage);
      throw e;
    }
  },
});

/** Automatic generation for one business (enqueued by the cron, once per day). Never posts. */
defineJob<{ date: string }>({
  kind: 'social.autoRun', maxAttempts: 3, timeoutMs: 10 * 60e3,
  run: async ctx => { const packId = await autoRun(ctx.businessId!); if (packId) await ctx.touch(); return { packId }; },
});

defineCron('social.auto', autoTick);
