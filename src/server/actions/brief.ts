// Actions for the Daily Brief area. 01-screens §4, 02-system §9.
import { trackSoon } from '@/server/events';
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
import { enqueueVisuals } from '../services/brief/visuals';
import { imgN, type ImageSettings } from '@/lib/imageOptions';
import '../services/brief/stubs';
import { acctOf, isLive, variantOf } from '@/features/brief/model';
import type { BriefItem, Profile } from '@/lib/types';
import { COPY, briefSid } from '@/lib/socialPublish';
import { lockedError, pubState } from '../services/social/publish/guards';

const Plat = z.enum(['reddit', 'x', 'linkedin', 'hn', 'quora']);
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Date_ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Acct = z.enum(['founder', 'company']);
const SettingsIn = z.object({ platforms: z.array(Plat).min(1).max(5), time: Time, mention: z.enum(['asked', 'relevant', 'never']), accounts: z.array(Acct).min(1).max(2).optional() });

export const REWRITE_ERROR = 'Radar couldn’t rewrite this. Try again.';
const PAST_ERROR = 'Past briefs are read-only.';

async function saveSettings(bid: string, cur: any, next: Partial<z.infer<typeof SettingsIn>>) {
  const s = { ...briefSettingsOf({ briefSettings: cur } as any), ...next };
  s.platforms = [...new Set(s.platforms)];
  if (s.accounts) s.accounts = (['founder', 'company'] as const).filter(a => s.accounts!.includes(a));
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
      // Social channels: a scheduled post keeps its state and platform until it's unscheduled; a direct post stays posted.
      const ps = await pubState(ctx.biz, briefSid(input.date, input.id));
      if (ps) {
        const live = ps.pub.status === 'scheduled' || ps.pub.status === 'sending';
        if (live && (input.st || input.pl)) throw new RadarError(COPY.unscheduleFirst, 409, 'scheduled');
        if (ps.pub.status === 'posted' && input.st) throw new RadarError(COPY.alreadyPosted, 409, 'posted');
        if (ps.locked && (input.edit || input.mention != null)) throw lockedError();
      }
      const ok = await withDay(ctx.bid, input.date, row => {
        const items = row.items as BriefItem[];
        const i = items.findIndex(x => x.id === input.id);
        if (i < 0 || items[i].st === 'expired') return null;
        const it: BriefItem = { ...items[i], edits: { ...(items[i].edits || {}) } };
        if (input.mention != null && it.kind === 'reply' && acctOf(it) === 'founder') it.mention = input.mention;
        if (input.pl && it.kind === 'post' && (it.plats || []).includes(input.pl)) it.pl = input.pl;
        if (input.edit) {
          if (input.edit.text == null) delete it.edits[input.edit.v];
          else it.edits[input.edit.v] = input.edit.text;
        }
        const before = items[i].st;
        if (input.st) it.st = input.st;
        const next = [...items]; next[i] = it;
        return { items: next, ret: { it, before } };
      });
      if (!ok) throw new RadarError('That conversation wasn’t found.', 404, 'not_found');
      const { it, before } = ok;
      if (input.st && input.st !== before) {
        const kind = input.st === 'posted' ? (it.kind === 'post' ? 'brief.post_posted' : 'brief.reply_posted') : input.st === 'copied' ? 'brief.reply_copied' : input.st === 'skipped' ? 'brief.skipped' : null;
        if (kind) trackSoon(kind, { bid: ctx.bid, uid: ctx.user.id, ref: it.id, props: { date: input.date, kind: it.kind, acct: acctOf(it), plat: it.kind === 'post' ? it.pl : it.plat, plugged: it.kind === 'reply' ? (acctOf(it) === 'company' || !!it.mention) : undefined, edited: Object.keys(it.edits || {}).length > 0, where: it.where, url: it.url, title: it.title } });
      }
      return { ok: true };
    },
  }),

  /** Add visuals / Change (UPDATE-2026-10-21-image-options §5): set the post's images and make them (job brief.visuals,
   *  ref = date:id). style null = Remove. The choice also becomes the social default (businesses.social_img). */
  'brief.visuals': action({
    input: z.object({ date: Date_, id: z.string().min(1).max(40), style: z.enum(['editorial', 'flat', 'render3d', 'handdrawn', 'photography']).nullable(), range: z.enum(['few', 'many']).optional() }),
    run: async (ctx, input) => {
      if (input.date < bizToday(ctx.biz)) throw new RadarError(PAST_ERROR, 400, 'read_only');
      // New images would change a scheduled post.
      const ps = await pubState(ctx.biz, briefSid(input.date, input.id));
      if (ps?.locked) throw lockedError();
      if (ps && ps.pub.status === 'scheduled') throw new RadarError(COPY.unscheduleFirst, 409, 'scheduled');
      const seed = Math.floor(Math.random() * 500) + 1; const range = input.range || 'few';
      const ok = await withDay(ctx.bid, input.date, row => {
        const items = row.items as BriefItem[]; const i = items.findIndex(x => x.id === input.id);
        if (i < 0 || items[i].kind !== 'post' || !isLive(items[i])) return null;
        // Up to 5 (LinkedIn); the X version shows the first 4, X's limit.
        const n = input.style ? imgN(range, 'linkedin', seed) : 0;
        const next = [...items];
        next[i] = { ...items[i], img: input.style ? { style: input.style, range, seed, n, urls: Array(n).fill(null), status: 'generating' } : null };
        return { items: next, ret: next[i] };
      });
      if (!ok) throw new RadarError('That post wasn’t found.', 404, 'not_found');
      if (!input.style) return { ok: true };
      const img: ImageSettings = { on: true, style: input.style, range };
      await db.update(schema.businesses).set({ socialImg: img }).where(eq(schema.businesses.id, ctx.bid));
      const jobId = await enqueueVisuals(ctx.bid, input.date, input.id, seed);
      trackSoon('brief.visuals_added', { bid: ctx.bid, uid: ctx.user.id, ref: input.id, props: { date: input.date, style: input.style, n: ok.img?.n } });
      return { ok: true, jobId, img: ok.img };
    },
  }),

  /** Rewrite → ai.run('writing') with the thread context, current text, instruction, mention flag and platform rules. */
  'brief.rewrite': action({
    input: z.object({ date: Date_, id: z.string().min(1).max(40), v: z.string().min(1).max(20), text: z.string().max(20000), instruction: z.string().min(1).max(500) }),
    run: async (ctx, input) => {
      if (input.date < bizToday(ctx.biz)) throw new RadarError(PAST_ERROR, 400, 'read_only');
      if ((await pubState(ctx.biz, briefSid(input.date, input.id)))?.locked) throw lockedError();
      const row = (await db.select().from(schema.briefDays).where(and(eq(schema.briefDays.businessId, ctx.bid), eq(schema.briefDays.date, input.date))).limit(1))[0];
      const it = (row?.items as BriefItem[] | undefined)?.find(x => x.id === input.id);
      if (!it || !isLive(it)) throw new RadarError(REWRITE_ERROR, 400, 'rewrite_failed');
      // Rewrite the variant the user was looking at when they asked.
      const view: BriefItem = it.kind === 'reply' ? (acctOf(it) === 'company' ? it : { ...it, mention: input.v === 'mention' }) : { ...it, pl: input.v as any };
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
