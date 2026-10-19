// Backlinks network actions (02-system.md §13). Joining, preferences and leaving are business settings (Admin);
// approving/declining placements and link maintenance are editorial decisions (Editor).
import { z } from 'zod';
import { and, eq, isNull, or } from 'drizzle-orm';
import { action, type ActionMap } from './define';
import { db, schema } from '../db';
import { RadarError, notFound } from '../errors';
import { enqueue, once } from '../jobs/queue';
import { todayIn } from '@/lib/format';
import { metaOf, patchMeta } from '../services/backlinks/network';
import { applyAutoApprove } from '../services/backlinks/matching';
import { scheduleDecisionNotice } from '../services/backlinks/decisions';
import { recheck, requestRemoval } from '../services/backlinks/verify';
import { weekOf } from '../services/backlinks/jobs';

const Prefs = z.object({
  topics: z.array(z.string().min(1).max(120)).min(1).max(30),
  max: z.union([z.literal(2), z.literal(4), z.literal(8)]),
  excludeCompetitors: z.boolean(), outbound: z.boolean(), qualify: z.boolean(), autoApprove: z.boolean(),
  minAuth: z.union([z.literal(30), z.literal(50), z.literal(70)]),
});

async function proposalOf(bid: string, id: string) {
  const r = (await db.select().from(schema.proposals).where(and(eq(schema.proposals.id, id), eq(schema.proposals.businessId, bid))).limit(1))[0];
  if (!r) throw notFound('That proposal');
  return r;
}

export const actions: ActionMap = {
  /** Join with preferences + consent. Matching runs right away; the client waits for the job to report the real count. */
  'backlinks.join': action({
    role: 'Admin',
    input: z.object({ prefs: Prefs, consent: z.literal(true) }),
    run: async (ctx, { prefs }) => {
      if (ctx.biz.status !== 'active') throw new RadarError('Finish setting up your business first.');
      await patchMeta(ctx.bid, { joined: true, prefs, joinedAt: new Date().toISOString(), leftAt: null });
      // This week's scheduled run is the one we start now.
      await once(`bl-match:${ctx.bid}:${weekOf(todayIn(ctx.biz.timezone))}`);
      const jobId = await enqueue('backlinks.match', { reason: 'join' }, { businessId: ctx.bid, ref: ctx.bid, singletonKey: 'bl-match:' + ctx.bid });
      return { jobId };
    },
  }),

  'backlinks.prefs': action({
    role: 'Admin',
    input: z.object({ prefs: Prefs }),
    run: async (ctx, { prefs }) => {
      if (!metaOf(ctx.biz).joined) throw new RadarError('Join the network first.');
      await patchMeta(ctx.bid, { prefs });
      await applyAutoApprove(ctx.bid);
      return { ok: true };
    },
  }),

  /** Leaving stops new proposals. Existing links stay (and keep being verified) until removal is requested. */
  'backlinks.leave': action({
    role: 'Admin',
    run: async ctx => {
      await patchMeta(ctx.bid, { joined: false, leftAt: new Date().toISOString() });
      // Undecided proposals involving this business are withdrawn on both sides.
      await db.delete(schema.proposals).where(and(isNull(schema.proposals.decision), or(eq(schema.proposals.businessId, ctx.bid), eq(schema.proposals.partnerBusinessId, ctx.bid))));
      return { ok: true };
    },
  }),

  /** Approve or decline (with an optional note to the partner). Notices go out after the Undo window. */
  'backlinks.decide': action({
    role: 'Editor',
    input: z.object({ id: z.string().uuid(), decision: z.enum(['approved', 'rejected']), note: z.string().max(1000).optional() }),
    run: async (ctx, { id, decision, note }) => {
      const r = await proposalOf(ctx.bid, id);
      if (r.data?.placedAt && decision === 'rejected') throw new RadarError('This link is already live. Request removal from Live links instead.');
      const now = new Date(); const key = now.toISOString();
      const n = note?.trim() || null;
      await db.update(schema.proposals).set({ decision, decidedAt: now, note: decision === 'rejected' ? n : null, data: { ...r.data, noticeKey: key, prevDecision: r.decision || null } }).where(eq(schema.proposals.id, id));
      await scheduleDecisionNotice(id, decision, key);
      return { ok: true };
    },
  }),

  /** Undo from the toast: restores the previous state (pending, or auto-approved) and cancels the pending notice. */
  'backlinks.undo': action({
    role: 'Editor',
    input: z.object({ id: z.string().uuid() }),
    run: async (ctx, { id }) => {
      const r = await proposalOf(ctx.bid, id);
      const prev = (r.data?.prevDecision || null) as 'approved' | 'auto' | 'rejected' | null;
      // Back to an approval whose notice never went out (it was cancelled by this decision) → send it after a fresh delay.
      const resend = (prev === 'auto' || prev === 'approved') && !r.data?.approvedNoticeSent;
      const key = resend ? new Date().toISOString() : null;
      await db.update(schema.proposals).set({ decision: prev, decidedAt: prev ? new Date() : null, note: null, data: { ...r.data, noticeKey: key, prevDecision: null } }).where(eq(schema.proposals.id, id));
      if (resend && key) await scheduleDecisionNotice(id, 'approved', key);
      return { ok: true };
    },
  }),

  'backlinks.recheck': action({
    role: 'Editor',
    input: z.object({ id: z.string().uuid() }),
    run: async (ctx, { id }) => {
      const r = await recheck(ctx.bid, id);
      if (!r) throw notFound('That link');
      return r;
    },
  }),

  'backlinks.removal': action({
    role: 'Editor',
    input: z.object({ id: z.string().uuid() }),
    run: async (ctx, { id }) => {
      const r = await requestRemoval(ctx.biz, id);
      if (!r) throw notFound('That link');
      return r;
    },
  }),
};
