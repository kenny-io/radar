// Actions for the Daily Brief area. 01-screens §4, 02-system §9.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { action, type ActionMap } from './define';
import { db, schema } from '../db';
import { RadarError } from '../errors';
import { bizToday, briefSettingsOf } from '../workspace';
import { getJob } from '../jobs/queue';
import { enqueueScan } from '../services/brief/jobs';
import { withDay } from '../services/brief/store';
import { rewriteItem } from '../services/brief/draft';
import '../services/brief/stubs';
import { isLive, variantOf } from '@/features/brief/model';
import type { BriefItem, Profile } from '@/lib/types';

const Plat = z.enum(['reddit', 'x', 'linkedin', 'hn', 'quora']);
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Date_ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SettingsIn = z.object({ platforms: z.array(Plat).min(1).max(5), time: Time, mention: z.enum(['asked', 'relevant', 'never']) });

export const REWRITE_ERROR = 'Radar couldn’t rewrite this. Try again.';
const PAST_ERROR = 'Past briefs are read-only.';

async function saveSettings(bid: string, cur: any, next: Partial<z.infer<typeof SettingsIn>>) {
  const s = { ...briefSettingsOf({ briefSettings: cur } as any), ...next };
  s.platforms = [...new Set(s.platforms)];
  await db.update(schema.businesses).set({ briefSettings: s }).where(eq(schema.businesses.id, bid));
  return s;
}

async function markDismissed(bid: string, jobId: string) {
  const j = await getJob(jobId);
  if (!j || j.businessId !== bid || j.kind !== 'brief.scan') return null;
  await db.update(schema.jobs).set({ result: { ...(j.result || {}), dismissed: true } }).where(eq(schema.jobs.id, jobId));
  return j;
}

export const actions: ActionMap = {
  /** Brief settings sheet → Save. "Saved. Applies from tomorrow’s brief." */
  'brief.settings': action({ input: SettingsIn, run: async (ctx, input) => ({ settings: await saveSettings(ctx.bid, ctx.biz.briefSettings, input) }) }),

  /** Run first scan (with the setup choices) / Scan again / Try again. → job brief.scan (ref = today). */
  'brief.scan': action({
    input: z.object({ settings: z.object({ platforms: z.array(Plat).min(1).max(5), time: Time }).optional(), retryOf: z.string().uuid().optional() }),
    run: async (ctx, input) => {
      if (input.settings) await saveSettings(ctx.bid, ctx.biz.briefSettings, input.settings);
      if (input.retryOf) await markDismissed(ctx.bid, input.retryOf);
      const today = bizToday(ctx.biz);
      const jobId = await enqueueScan(ctx.bid, today, 'again');
      return { jobId, date: today };
    },
  }),

  /** "Keep this morning’s brief" after a failed scan: keeps today's brief, and adds what was read before the failure. */
  'brief.keep': action({
    input: z.object({ jobId: z.string().uuid() }),
    run: async (ctx, { jobId }) => {
      const j = await markDismissed(ctx.bid, jobId);
      if (!j) return { queued: false };
      const r: any = j.result || {};
      if (r.failed && r.partial > 0 && !r.dismissed) { await enqueueScan(ctx.bid, String(j.ref), 'keep', jobId); return { queued: true }; }
      return { queued: false };
    },
  }),

  /** Item updates: status transitions, mention toggle, platform switch, per-variant edits (text: null = Restore draft). */
  'brief.item': action({
    input: z.object({
      date: Date_, id: z.string().min(1).max(40),
      st: z.enum(['open', 'copied', 'posted', 'skipped']).optional(),
      mention: z.boolean().optional(),
      pl: Plat.optional(),
      edit: z.object({ v: z.string().min(1).max(20), text: z.string().max(20000).nullable() }).optional(),
    }),
    run: async (ctx, input) => {
      if (input.date < bizToday(ctx.biz)) throw new RadarError(PAST_ERROR, 400, 'read_only');
      const ok = await withDay(ctx.bid, input.date, row => {
        const items = row.items as BriefItem[];
        const i = items.findIndex(x => x.id === input.id);
        if (i < 0 || items[i].st === 'expired') return null;
        const it: BriefItem = { ...items[i], edits: { ...(items[i].edits || {}) } };
        if (input.mention != null && it.kind === 'reply') it.mention = input.mention;
        if (input.pl && it.kind === 'post' && (it.plats || []).includes(input.pl)) it.pl = input.pl;
        if (input.edit) {
          if (input.edit.text == null) delete it.edits[input.edit.v];
          else it.edits[input.edit.v] = input.edit.text;
        }
        if (input.st) it.st = input.st;
        const next = [...items]; next[i] = it;
        return { items: next, ret: true };
      });
      if (!ok) throw new RadarError('That conversation wasn’t found.', 404, 'not_found');
      return { ok: true };
    },
  }),

  /** Rewrite → ai.run('writing') with the thread context, current text, instruction, mention flag and platform rules. */
  'brief.rewrite': action({
    input: z.object({ date: Date_, id: z.string().min(1).max(40), v: z.string().min(1).max(20), text: z.string().max(20000), instruction: z.string().min(1).max(500) }),
    run: async (ctx, input) => {
      if (input.date < bizToday(ctx.biz)) throw new RadarError(PAST_ERROR, 400, 'read_only');
      const row = (await db.select().from(schema.briefDays).where(and(eq(schema.briefDays.businessId, ctx.bid), eq(schema.briefDays.date, input.date))).limit(1))[0];
      const it = (row?.items as BriefItem[] | undefined)?.find(x => x.id === input.id);
      if (!it || !isLive(it)) throw new RadarError(REWRITE_ERROR, 400, 'rewrite_failed');
      // Rewrite the variant the user was looking at when they asked.
      const view: BriefItem = it.kind === 'reply' ? { ...it, mention: input.v === 'mention' } : { ...it, pl: input.v as any };
      let text: string;
      try { text = await rewriteItem({ ...(ctx.biz.profile as Profile), domain: ctx.biz.domain }, view, input.text, input.instruction, ctx.bid); }
      catch (e: any) { console.error('[brief.rewrite]', e?.message || e); throw new RadarError(REWRITE_ERROR, 502, 'rewrite_failed'); }
      await withDay(ctx.bid, input.date, r => {
        const items = r.items as BriefItem[]; const i = items.findIndex(x => x.id === input.id);
        if (i < 0) return null;
        const next = [...items]; const cur = items[i];
        next[i] = { ...cur, edits: { ...(cur.edits || {}), [input.v]: text }, st: cur.st === 'copied' ? 'open' : cur.st };
        return { items: next, ret: true };
      });
      return { text, v: variantOf(view) };
    },
  }),
};
