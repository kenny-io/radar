// Actions for Search Console, the Performance → Search tab and What to improve (CONTRACTS.md · performance area).
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { action, type ActionMap } from './define';
import { db, schema } from '../db';
import { enqueue } from '../jobs/queue';
import { RadarError } from '../errors';
import type { Profile } from '@/lib/types';
import { GscApiError, loadTokens, revoke, saveTokens } from '../services/gsc/client';
import { propertiesFor } from '../services/gsc/properties';
import { getConn, setConn } from '../services/gsc/sync';
import { kwMeasured, summary, topPages, topQueries } from '../services/gsc/metrics';
import { listSuggestions } from '../services/gsc/suggestions';
import { acceptSuggestion, dismissSuggestion } from '../services/gsc/refresh';

const Days = z.union([z.literal(7), z.literal(28), z.literal(90)]);
const NOT_AUTH = 'Google didn’t return permission. Connect Search Console again.';
const hasData = (s: string | undefined) => s === 'connected' || s === 'error';

export const actions: ActionMap = {
  /** Properties the connected Google account can read (after the gsc OAuth popup succeeds). */
  'gsc.properties': action({ read: true, role: 'Editor', input: z.object({}).optional(), run: async ctx => {
    try { return { properties: await propertiesFor(ctx.bid, ctx.biz.domain) }; }
    catch (e: any) {
      if (e instanceof GscApiError && !e.transient) throw new RadarError(NOT_AUTH, 403, 'gsc_denied');
      throw new RadarError('Search Console didn’t respond. Try again.', 502, 'gsc_unavailable');
    }
  } }),

  /** Save the property, start syncing (status syncing, progress 0) and queue the 16-month backfill. */
  'gsc.connect': action({ input: z.object({ property: z.string().min(3).max(300) }), run: async (ctx, { property }) => {
    const tokens = await loadTokens(ctx.bid);
    if (!tokens) throw new RadarError(NOT_AUTH, 403, 'gsc_denied');
    let props; try { props = await propertiesFor(ctx.bid, ctx.biz.domain); } catch { throw new RadarError('Search Console didn’t respond. Try again.', 502, 'gsc_unavailable'); }
    if (!props.some(p => p.v === property)) throw new RadarError('That property isn’t available on this Google account.', 400, 'gsc_property');
    const prev = await getConn(ctx.bid);
    // A different property means different data: don't mix it with rows from the old one.
    if (prev?.property && prev.property !== property) await db.delete(schema.gscRows).where(eq(schema.gscRows.businessId, ctx.bid));
    await setConn(ctx.bid, { status: 'syncing', property, progress: 0, error: null, backfillCursor: null, ...(prev?.property !== property ? { lastSyncedThrough: null } : {}) });
    const jobId = await enqueue('gsc.backfill', {}, { businessId: ctx.bid, ref: ctx.bid, singletonKey: 'gsc-backfill:' + ctx.bid });
    return { property, jobId };
  } }),

  /** Resume a paused sync from its cursor (backfill), or retry the incremental pull. */
  'gsc.resume': action({ input: z.object({}).optional(), run: async ctx => {
    const c = await getConn(ctx.bid);
    if (!c || !c.property || (c.status !== 'error' && c.status !== 'syncing')) return { ok: false };
    const cur = c.backfillCursor as any;
    if (cur && !cur.done) {
      await setConn(ctx.bid, { status: 'syncing', error: null });
      await enqueue('gsc.backfill', {}, { businessId: ctx.bid, ref: ctx.bid, singletonKey: 'gsc-backfill:' + ctx.bid });
    } else {
      await setConn(ctx.bid, { status: 'connected', error: null });
      await enqueue('gsc.incremental', {}, { businessId: ctx.bid, ref: ctx.bid, singletonKey: 'gsc-inc:' + ctx.bid });
    }
    return { ok: true };
  } }),

  /** Revoke the token, mark skipped, keep historical rows. */
  'gsc.disconnect': action({ role: 'Admin', input: z.object({}).optional(), run: async ctx => {
    await revoke(await loadTokens(ctx.bid));
    await saveTokens(ctx.bid, null);
    await setConn(ctx.bid, { status: 'skipped', progress: 0, error: null });
    await db.update(schema.jobs).set({ status: 'failed', error: 'Disconnected', finishedAt: new Date() }).where(and(eq(schema.jobs.businessId, ctx.bid), eq(schema.jobs.kind, 'gsc.backfill'), eq(schema.jobs.status, 'queued')));
    return { ok: true };
  } }),

  /** Totals for the range, the preceding range and the daily series (Dashboard + Performance). null = no measured data. */
  'gsc.summary': action({ read: true, input: z.object({ days: Days }), run: async (ctx, { days }) => {
    const c = await getConn(ctx.bid);
    if (!hasData(c?.status)) return null;
    return summary(ctx.bid, days);
  } }),

  /** Everything the Search tab renders for a range. */
  'gsc.search': action({ read: true, input: z.object({ days: Days }), run: async (ctx, { days }) => {
    const c = await getConn(ctx.bid);
    if (!hasData(c?.status)) return null;
    const s = await summary(ctx.bid, days);
    if (!s) return null;
    const kws = ((ctx.biz.profile as Profile)?.keywords?.list || []).map(k => k.kw);
    const [queries, pages, kw] = await Promise.all([topQueries(ctx.bid, days, 20), topPages(ctx.bid, days, 20), kwMeasured(ctx.bid, kws, days)]);
    return { ...s, queries, pages, kw, property: c!.property };
  } }),

  /** What to improve, sorted by expected impact (handled rows included so they stay dimmed). */
  'suggestions.list': action({ read: true, input: z.object({}).optional(), run: async ctx => listSuggestions(ctx.bid) }),

  /** Review changes → Add to calendar for review: refresh entry in review 2 days out with the generated draft. */
  'suggestions.accept': action({ input: z.object({ id: z.string().uuid() }), run: async (ctx, { id }) => acceptSuggestion(ctx.bid, id) }),

  'suggestions.dismiss': action({ input: z.object({ id: z.string().uuid() }), run: async (ctx, { id }) => dismissSuggestion(ctx.bid, id) }),
};
