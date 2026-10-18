// Onboarding actions. Called against the ONBOARDING business id (POST /api/b creates/reuses it).
//   onboarding.analyze { keepEdits? } → { jobId }  — job analysis.site (ref = businessId)
//   onboarding.finish  { tz? }                      — status active; Search Console marked skipped if never connected
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { action, type ActionMap } from './define';
import { db, schema } from '../db';
import { startAnalysis } from './profile';

const validTz = (tz?: string) => { if (!tz) return false; try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

export const actions: ActionMap = {
  'onboarding.analyze': action({
    role: 'Editor', input: z.object({ keepEdits: z.boolean().optional() }),
    run: async (ctx, { keepEdits }) => startAnalysis(ctx.bid, !!keepEdits),
  }),
  'onboarding.finish': action({
    role: 'Owner', input: z.object({ tz: z.string().max(64).optional() }),
    run: async (ctx, { tz }) => {
      const set: any = { status: 'active' };
      if (ctx.biz.status === 'onboarding' && validTz(tz)) set.timezone = tz;
      await db.update(schema.businesses).set(set).where(eq(schema.businesses.id, ctx.bid));
      const g = (await db.select().from(schema.gscConnections).where(eq(schema.gscConnections.businessId, ctx.bid)).limit(1))[0];
      if (!g) await db.insert(schema.gscConnections).values({ businessId: ctx.bid, status: 'skipped' }).onConflictDoNothing();
      else if (g.status === 'none') await db.update(schema.gscConnections).set({ status: 'skipped' }).where(eq(schema.gscConnections.businessId, ctx.bid));
      return { id: ctx.bid };
    },
  }),
};
