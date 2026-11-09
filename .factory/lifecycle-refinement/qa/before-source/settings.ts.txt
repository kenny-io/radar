// Settings → AI models, Calendar defaults, Request a feature (01-screens.md §11, 02-system.md §2, §15).
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { action, type ActionMap } from './define';
import { db, schema } from '../db';
import { RadarError } from '../errors';
import { env } from '../env';
import { AI_DEFAULT, aiFind, MARKETS, langs } from '@/lib/constants';
import { sendMail } from '../services/mail';

export const actions: ActionMap = {
  /** Settings → AI models. The only place model ids are chosen; never echoed in copy elsewhere. */
  'settings.ai': action({
    role: 'Admin',
    input: z.object({ task: z.enum(['writing', 'research']), model: z.string() }),
    run: async (ctx, { task, model }) => {
      if (!aiFind(model)) throw new RadarError('Choose a model from the list.', 400, 'invalid_model');
      const ai = { ...AI_DEFAULT, ...(ctx.biz.ai || {}), [task]: model };
      await db.update(schema.businesses).set({ ai }).where(eq(schema.businesses.id, ctx.bid));
      return { ai };
    },
  }),

  /** Settings → Calendar defaults: market, language, frequency. Used for the next generated calendar. */
  'settings.calendarDefaults': action({
    role: 'Editor',
    input: z.object({
      market: z.string().min(1).max(80).optional(),
      language: z.string().min(1).max(80).optional(),
      cadence: z.enum(['daily', 'weekdays', 'custom']).optional(),
      perWeek: z.number().int().min(1).max(7).optional(),
    }),
    run: async (ctx, input) => {
      const cur = ctx.biz.calendarSettings || {};
      const p = ctx.biz.profile as any;
      // Accept the designed lists, plus the business's own current market/language (e.g. a profile market not in MARKETS).
      if (input.market && !MARKETS.includes(input.market) && input.market !== cur.market && !(p?.brand?.markets || []).includes(input.market)) throw new RadarError('Choose a market from the list.');
      if (input.language && !langs().includes(input.language) && input.language !== cur.language && input.language !== p?.brand?.language) throw new RadarError('Choose a language from the list.');
      const next = { ...cur, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
      await db.update(schema.businesses).set({ calendarSettings: next }).where(eq(schema.businesses.id, ctx.bid));
      return { settings: next };
    },
  }),

  /** Settings → Request a feature: stored, then forwarded to the support inbox. */
  'feature.request': action({
    role: 'Viewer',
    input: z.object({ text: z.string() }),
    run: async (ctx, { text }) => {
      const t = text.trim();
      if (t.length < 6) throw new RadarError('Add a little more detail.');
      if (t.length > 5000) throw new RadarError('Keep it under 5,000 characters.');
      const [row] = await db.insert(schema.featureRequests).values({ userId: ctx.user.id, businessId: ctx.bid, text: t }).returning({ id: schema.featureRequests.id });
      const to = env.supportInbox || (env.devStubs ? 'support@radar.local' : ''); // dev: lands in the outbox log
      if (to) {
        const body = [`From: ${ctx.user.name} <${ctx.user.email}>`, `Business: ${(ctx.biz.profile as any)?.business?.name || ''} (${ctx.biz.domain})`, `Role: ${ctx.role}`, `Request id: ${row.id}`, '', t].join('\n');
        // Stored first; a mail hiccup must not lose or fail the request (the inbox can be re-sent from feature_requests).
        await sendMail(to, `Feature request — ${ctx.biz.domain}`, body).catch(e => console.error('[feature.request] mail failed', e?.message || e));
      } else console.warn('[feature.request] SUPPORT_INBOX is not set; request stored only', row.id);
      return { id: row.id };
    },
  }),
};
