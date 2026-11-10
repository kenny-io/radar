// Settings → AI models, Calendar defaults, Request a feature (01-screens.md §11, 02-system.md §2, §15).
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { action, type ActionMap } from './define';
import { db, schema } from '../db';
import { RadarError } from '../errors';
import { env } from '../env';
import { aiFind, MARKETS, langs, INSTRUCTION_KEYS, INSTRUCTION_MAX, cleanInstruction } from '@/lib/constants';
import { sendMail } from '../services/mail';
import { setAutopilot, requestAutopilotRun } from '../services/autopilot/control';
import { aiPrefsOf } from '../workspace';

export const actions: ActionMap = {
  'settings.autopilot': action({ role: 'Owner', input: z.object({ enabled: z.boolean() }), run: (ctx, { enabled }) => setAutopilot(ctx, enabled) }),
  'settings.autopilotRun': action({ role: 'Owner', input: z.object({}), run: ctx => requestAutopilotRun(ctx) }),
  /** Settings → AI models. The only place model ids are chosen; never echoed in copy elsewhere. */
  'settings.ai': action({
    role: 'Admin',
    input: z.object({ task: z.enum(['writing', 'research']), model: z.string() }),
    run: async (ctx, { task, model }) => {
      if (!aiFind(model)) throw new RadarError('Choose a model from the list.', 400, 'invalid_model');
      // Merge one key in SQL (re-evaluated under the row lock) so a writing instruction saved meanwhile is never erased.
      const B = schema.businesses;
      await db.update(B).set({ ai: sql`${B.ai} || jsonb_build_object(${task}::text, ${model}::text)` }).where(eq(B.id, ctx.bid));
      return { ai: { ...aiPrefsOf(ctx.biz), [task]: model } };
    },
  }),
  /** Settings → Writing instructions: one set per call. Empty text removes the set. The result never carries the text
   *  (action results are recorded in events; `text` is dropped from the recorded input, `set` is kept). */
  'settings.instructions': action({
    role: 'Editor',
    input: z.strictObject({ set: z.enum(INSTRUCTION_KEYS), text: z.string().max(20000) }),
    run: async (ctx, { set, text }) => {
      const t = cleanInstruction(text);
      if (t.length > INSTRUCTION_MAX) throw new RadarError('Keep each instruction to 1,500 characters or fewer.', 400, 'too_long');
      // One statement, so two members saving different sets (or a model change) never clobber each other.
      const B = schema.businesses;
      const cur = sql`(CASE WHEN jsonb_typeof(${B.ai}->'instructions') = 'object' THEN ${B.ai}->'instructions' ELSE '{}'::jsonb END)`;
      const next = t ? sql`${cur} || jsonb_build_object(${set}::text, ${t}::text)` : sql`${cur} - ${set}::text`;
      await db.update(B).set({ ai: sql`jsonb_set(${B.ai}, '{instructions}', ${next})` }).where(eq(B.id, ctx.bid));
      return { ok: true };
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
        await sendMail(to, `Feature request — ${ctx.biz.domain}`, body, undefined, { identity: 'service' }).catch(e => console.error('[feature.request] mail failed', e?.message || e));
      } else console.warn('[feature.request] SUPPORT_INBOX is not set; request stored only', row.id);
      return { id: row.id };
    },
  }),
};
