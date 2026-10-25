// Onboarding actions. Called against the ONBOARDING business id (POST /api/b creates or reuses it).
//   onboarding.analyze { keepEdits? } → { jobId }  — job analysis.site (ref = businessId); rate-limited without own access
//   onboarding.step    { step }                    — remembers the step for resume and Back links
//   onboarding.save    { tz }                      → { committed, next } — commits only when the actor has access
//   onboarding.finish  { tz? }                     — deprecated alias of save (open tabs)
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { action, type ActCtx, type ActionMap } from './define';
import { db, schema } from '../db';
import { startAnalysis } from './profile';
import { ownAccess } from '../billing/access';
import { commitDraft, validTz } from '../billing/draft';
import { limitAnalysis } from '../abuse/rateLimit';

/** The act route sets ctx.actor; direct callers (tests, scripts) get it computed. */
const actorOf = async (ctx: ActCtx) => ctx.actor ?? { guest: !!(ctx.user as any).guest, ownAccess: await ownAccess(ctx.user as any) };
const B = schema.businesses;
const setOnboarding = (bid: string, patch: Record<string, unknown>) =>
  db.update(B).set({ onboarding: sql`${B.onboarding} || ${JSON.stringify(patch)}::jsonb` }).where(and(eq(B.id, bid), eq(B.status, 'onboarding')));

async function save(ctx: ActCtx, tz?: string) {
  const actor = await actorOf(ctx);
  if (ctx.biz.status !== 'onboarding') return { committed: false, next: '/dashboard' as const, id: ctx.bid };
  await setOnboarding(ctx.bid, { step: 'save', savedAt: new Date().toISOString(), ...(validTz(tz) ? { tz } : {}) });
  const committed = actor.ownAccess && !actor.guest ? !!(await commitDraft(ctx.bid)) : false;
  const next = committed ? '/dashboard' as const : actor.guest ? '/signup' as const : '/start-trial' as const;
  return { committed, next, id: ctx.bid };
}

export const actions: ActionMap = {
  'onboarding.analyze': action({
    role: 'Editor', input: z.object({ keepEdits: z.boolean().optional() }),
    run: async (ctx, { keepEdits }) => {
      if (!(await actorOf(ctx)).ownAccess) await limitAnalysis(ctx.ip || 'unknown', ctx.biz.domain);
      return startAnalysis(ctx.bid, !!keepEdits);
    },
  }),
  'onboarding.step': action({
    role: 'Owner', input: z.object({ step: z.enum(['review', 'gsc', 'save']) }),
    run: async (ctx, { step }) => { await setOnboarding(ctx.bid, { step }); return {}; },
  }),
  'onboarding.save': action({
    role: 'Owner', input: z.object({ tz: z.string().max(64).optional() }),
    run: async (ctx, { tz }) => save(ctx, tz),
  }),
  /** Deprecated alias of onboarding.save, kept for tabs opened before this release. */
  'onboarding.finish': action({
    role: 'Owner', input: z.object({ tz: z.string().max(64).optional() }),
    run: async (ctx, { tz }) => save(ctx, tz),
  }),
};
