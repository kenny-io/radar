// Actions for the Content Calendar (01-screens.md §5, 02-system.md §6).
import { defaultArticleImageStyle } from '@/server/services/images';
import { z } from 'zod';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { action, type ActionMap } from './define';
import { db, schema } from '../db';
import { enqueue } from '../jobs/queue';
import { RadarError, notFound } from '../errors';
import { calendarSettingsOf, entryFromRow } from '../workspace';
import { alternativesFor } from '../services/calendar/alternatives';
import { ENTRY_TYPES } from '@/lib/constants';
import { kwIntentHeuristic } from '@/lib/constants';
import { slugify } from '@/lib/format';
import type { Keyword, Profile } from '@/lib/types';

const E = schema.calendarEntries;
const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const LOCKED = ['scheduled', 'published', 'publishing'];
const Settings = z.object({ market: z.string().min(1).max(80), language: z.string().min(1).max(80), start: ISO, cadence: z.enum(['daily', 'weekdays', 'custom']), perWeek: z.number().int().min(1).max(7) });

async function entryRow(bid: string, id: string) {
  const r = (await db.select().from(E).where(and(eq(E.id, id), eq(E.businessId, bid))).limit(1))[0];
  if (!r) throw notFound('That article');
  return r;
}

export const actions: ActionMap = {
  /** Save the settings for this calendar and start research (job `calendar.generate`, ref = businessId). */
  'calendar.generate': action({ input: z.object({ settings: Settings, keep: z.boolean().optional() }), run: async (ctx, { settings, keep }) => {
    await db.update(schema.businesses).set({ calendarSettings: settings }).where(eq(schema.businesses.id, ctx.bid));
    const jobId = await enqueue('calendar.generate', { settings, keep: !!keep }, { businessId: ctx.bid, ref: ctx.bid, singletonKey: 'cal-gen:' + ctx.bid, maxAttempts: 2 });
    return { jobId };
  } }),

  'calendar.approve': action({ input: z.object({ entryId: z.string() }), run: async (ctx, { entryId }) => {
    await db.update(E).set({ status: 'approved' }).where(and(eq(E.id, entryId), eq(E.businessId, ctx.bid), eq(E.status, 'proposed')));
    return { ok: true };
  } }),

  'calendar.approveAll': action({ input: z.object({}).optional(), run: async (ctx) => {
    const r = await db.update(E).set({ status: 'approved' }).where(and(eq(E.businessId, ctx.bid), eq(E.status, 'proposed'))).returning({ id: E.id });
    return { count: r.length };
  } }),

  /** approved ("Scheduled") → proposed */
  'calendar.unschedule': action({ input: z.object({ entryId: z.string() }), run: async (ctx, { entryId }) => {
    await db.update(E).set({ status: 'proposed' }).where(and(eq(E.id, entryId), eq(E.businessId, ctx.bid), eq(E.status, 'approved')));
    return { ok: true };
  } }),

  /** Title (sheet + article h1), publish date, content type. Scheduled/published entries are locked. */
  'calendar.update': action({ input: z.object({ entryId: z.string(), title: z.string().max(300).optional(), date: ISO.optional(), type: z.enum(ENTRY_TYPES).optional() }), run: async (ctx, { entryId, ...patch }) => {
    const r = await entryRow(ctx.bid, entryId);
    // Date and type lock once queued; the title stays editable from the article until it's publishing/published.
    if ((patch.date || patch.type) && LOCKED.includes(r.status)) throw new RadarError('This article is locked while it’s queued or published.');
    if (patch.title != null && (r.status === 'published' || r.status === 'publishing')) throw new RadarError('This article is locked while it’s queued or published.');
    const set: any = {};
    if (patch.title != null) set.title = patch.title.replace(/\s+/g, ' ').trim() || r.title;
    if (patch.date) set.date = patch.date;
    if (patch.type) set.type = patch.type;
    if (Object.keys(set).length) await db.update(E).set(set).where(eq(E.id, entryId));
    return { ok: true };
  } }),

  /** Drag and drop: move to a date; an entry already there takes the dragged entry's date (swap). */
  'calendar.move': action({ input: z.object({ entryId: z.string(), date: ISO }), run: async (ctx, { entryId, date }) => {
    const me = await entryRow(ctx.bid, entryId);
    if (LOCKED.includes(me.status)) throw new RadarError('Queued and published articles can’t be moved.');
    const from = String(me.date);
    if (from === date) return { ok: true };
    const others = await db.select().from(E).where(and(eq(E.businessId, ctx.bid), eq(E.date, date), ne(E.id, entryId)));
    await db.transaction(async tx => {
      for (const o of others) if (!LOCKED.includes(o.status)) await tx.update(E).set({ date: from }).where(eq(E.id, o.id));
      await tx.update(E).set({ date }).where(eq(E.id, entryId));
    });
    return { ok: true };
  } }),

  /** KwMembership "Add it": append to the profile's keyword list (marks keywords.list edited) and estimate it. */
  'calendar.addKeyword': action({ input: z.object({ kw: z.string().min(1).max(120) }), run: async (ctx, { kw }) => {
    const b = ctx.biz; const p = b.profile as Profile;
    const list: Keyword[] = p.keywords?.list || [];
    const k = kw.trim().toLowerCase();
    if (!list.some(x => x.kw.toLowerCase() === k)) {
      const next = { ...p, keywords: { list: [...list, { kw: k, intent: kwIntentHeuristic(k), vol: null, kd: null, src: 'user', priority: false } as Keyword] } };
      await db.update(schema.businesses).set({ profile: next, edited: { ...(b.edited || {}), 'keywords.list': true } }).where(eq(schema.businesses.id, ctx.bid));
      await enqueue('keywords.estimate', {}, { businessId: ctx.bid, singletonKey: 'kw-est:' + ctx.bid });
    }
    return { ok: true };
  } }),

  /** Replace topic → 3 alternatives for the same date/slot (proposed entries only). */
  'calendar.alternatives': action({ read: true, role: 'Editor', input: z.object({ entryId: z.string() }), run: async (ctx, { entryId }) => {
    const r = await entryRow(ctx.bid, entryId);
    if (r.status !== 'proposed') throw new RadarError('Only proposed topics can be replaced.');
    const used = await db.select({ kw: E.kw }).from(E).where(eq(E.businessId, ctx.bid));
    const p = { ...(ctx.biz.profile as Profile), domain: ctx.biz.domain };
    return alternativesFor(ctx.bid, p, calendarSettingsOf(ctx.biz), entryFromRow(r), used.map(u => u.kw));
  } }),

  /** Apply an alternative (or the previous topic, for Undo). Keeps the entry's id, date and status. */
  'calendar.replace': action({ input: z.object({ entryId: z.string(), alt: z.object({
    title: z.string().min(1).max(300), kw: z.string().min(1).max(200), type: z.enum(ENTRY_TYPES), vol: z.number().nullable(), kd: z.number().nullable(),
    mode: z.enum(['new', 'refresh']).default('new'), url: z.string().nullable().optional(), measured: z.object({ impr: z.number(), clicks: z.number(), pos: z.number() }).nullable().optional(),
    audience: z.string().max(400), relevance: z.string().max(600), outline: z.array(z.string().max(200)).max(8).optional(),
  }) }), run: async (ctx, { entryId, alt }) => {
    const r = await entryRow(ctx.bid, entryId);
    if (r.status !== 'proposed') throw new RadarError('Only proposed topics can be replaced.');
    await db.update(E).set({ title: alt.title, kw: alt.kw, type: alt.type, vol: alt.vol, kd: alt.kd, mode: alt.mode, url: alt.url ?? null, measured: alt.measured ?? null, audience: alt.audience, relevance: alt.relevance }).where(eq(E.id, entryId));
    const data = { entryId, generated: false, body: [], brief: { angle: alt.relevance, outline: alt.outline || [], words: 1400 }, seo: { title: alt.title, meta: '', slug: slugify(alt.kw) }, img: { style: defaultArticleImageStyle(), seed: 1, prompt: 'Calm, editorial image about ' + alt.kw, alt: '', url: null, urlKey: null }, videos: [], videoMeta: [], sources: [], claims: [], draftedAt: null };
    await db.insert(schema.articles).values({ entryId, businessId: ctx.bid, data }).onConflictDoUpdate({ target: schema.articles.entryId, set: { data, updatedAt: new Date() } });
    return { ok: true };
  } }),
};
export { inArray };
