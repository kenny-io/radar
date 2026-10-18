// Actions for Performance → AI Visibility.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { action, type ActionMap } from './define';
import { db, schema } from '../db';
import { enqueue } from '../jobs/queue';
import { notFound } from '../errors';
import { addPrompt, ensurePrompts, listVisibility } from '../services/visibility/collect';

export const actions: ActionMap = {
  /** Prompts × engines grid. Generates the keyword prompts on first view (and queues their first collection). */
  'visibility.list': action({ read: true, input: z.object({}).optional(), run: async ctx => {
    if (ctx.role !== 'Viewer') {
      const created = await ensurePrompts(ctx.bid).catch(e => { console.error('[visibility] prompts', e?.message || e); return []; });
      if (created.length) await enqueue('visibility.run', { promptIds: created }, { businessId: ctx.bid, ref: ctx.bid, singletonKey: 'vis-first:' + ctx.bid });
    }
    return listVisibility(ctx.bid);
  } }),

  /** Track a new prompt (≥6 chars). First collection runs with tonight's batch. */
  'visibility.addPrompt': action({ input: z.object({ prompt: z.string().trim().min(6).max(300) }), run: async (ctx, { prompt }) => {
    const id = await addPrompt(ctx.bid, prompt);
    return { id, ...(await listVisibility(ctx.bid)) };
  } }),

  /** Collect now: one prompt × engine, as a job (ref = resultId). */
  'visibility.collect': action({ input: z.object({ id: z.string().uuid() }), run: async (ctx, { id }) => {
    const r = (await db.select({ id: schema.aiResults.id }).from(schema.aiResults).where(and(eq(schema.aiResults.id, id), eq(schema.aiResults.businessId, ctx.bid))).limit(1))[0];
    if (!r) throw notFound('That result');
    const jobId = await enqueue('visibility.collect', { resultId: id }, { businessId: ctx.bid, ref: id, singletonKey: 'vis-collect:' + id });
    return { jobId };
  } }),
};
