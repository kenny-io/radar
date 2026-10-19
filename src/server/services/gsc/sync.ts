// Search Console sync (02-system.md §4): 16-month backfill month by month (newest first, with a resumable cursor),
// daily incremental pulls, query+page aggregate for suggestions, and error/resume handling that keeps existing data.
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { getBiz, bizToday, bump } from '../../workspace';
import { notify } from '../../notify';
import { enqueue } from '../../jobs/queue';
import { addDays } from '@/lib/format';
import type { Profile } from '@/lib/types';
import { accessToken, GscApiError, queryAll, type SaRow } from './client';
import { ensureStubCrawl, stubModel, stubQueryPage, stubRows } from './stub';

const R = schema.gscRows; const C = schema.gscConnections;
type Kind = 'date' | 'query' | 'page' | 'qpage';

export async function getConn(bid: string) {
  return (await db.select().from(C).where(eq(C.businessId, bid)).limit(1))[0] || null;
}
export async function setConn(bid: string, v: Partial<typeof C.$inferInsert>) {
  await db.insert(C).values({ businessId: bid, status: 'none', ...v }).onConflictDoUpdate({ target: C.businessId, set: { ...v, updatedAt: new Date() } });
}

async function upsert(bid: string, kind: Kind, input: { date: string; key: string; clicks: number; impressions: number; ctr: number; position: number }[]) {
  // De-duplicate on the primary key (a batch must not touch the same row twice in one ON CONFLICT statement).
  const m = new Map<string, (typeof input)[number]>(); for (const r of input) m.set(r.date + '\u0000' + r.key, r);
  const rows = [...m.values()];
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000).map(r => ({ businessId: bid, kind, ...r }));
    await db.insert(R).values(batch).onConflictDoUpdate({ target: [R.businessId, R.kind, R.date, R.key], set: { clicks: sql`excluded.clicks`, impressions: sql`excluded.impressions`, ctr: sql`excluded.ctr`, position: sql`excluded.position` } });
  }
}
const toRows = (rs: SaRow[], dateIdx: number, keyIdx: number | null) => rs.map(r => ({ date: r.keys[dateIdx], key: keyIdx == null ? '' : r.keys[keyIdx], clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), ctr: r.ctr, position: r.position }));

/** A data source for one property: the real API, or the dev stub when the tokens came from the stub OAuth. */
async function source(bid: string, property: string) {
  const { tokens, token } = await accessToken(bid);
  if (tokens.stub) {
    const biz = await getBiz(bid); const p = { ...(biz.profile as Profile), domain: biz.domain };
    await ensureStubCrawl(bid, p);
    const model = await stubModel(bid, p, property);
    const anchor = addDays(bizToday(biz), -2);
    return {
      stub: true, latest: anchor,
      async range(from: string, to: string) { const end = to > anchor ? anchor : to; if (from > end) return { date: [], query: [], page: [] }; await new Promise(r => setTimeout(r, 220)); return stubRows(bid, model, from, end, anchor); },
      async queryPage(from: string, to: string) { return stubQueryPage(bid, model, from, to > anchor ? anchor : to, anchor); },
    };
  }
  return {
    stub: false, latest: null as string | null,
    async range(from: string, to: string) {
      const q = (dimensions: string[]) => queryAll(token!, property, { startDate: from, endDate: to, dimensions });
      const date = await q(['date']); const query = await q(['query', 'date']); const page = await q(['page', 'date']);
      return { date, query, page };
    },
    async queryPage(from: string, to: string) { return queryAll(token!, property, { startDate: from, endDate: to, dimensions: ['query', 'page'] }); },
  };
}
type Source = Awaited<ReturnType<typeof source>>;

async function writeRange(bid: string, src: Source, from: string, to: string): Promise<string | null> {
  const { date, query, page } = await src.range(from, to);
  await upsert(bid, 'date', toRows(date, 0, null));
  await upsert(bid, 'query', toRows(query, 1, 0));
  await upsert(bid, 'page', toRows(page, 1, 0));
  return date.reduce<string | null>((m, r) => (!m || r.keys[0] > m ? r.keys[0] : m), null);
}

/** Refresh the query+page aggregate (last 28 days with data) used to relate queries to pages. */
async function refreshQueryPage(bid: string, src: Source) {
  const last = (await db.select({ d: sql<string>`max(${R.date})` }).from(R).where(and(eq(R.businessId, bid), eq(R.kind, 'date'))))[0]?.d;
  if (!last) return;
  const end = String(last); const from = addDays(end, -27);
  const rows = await src.queryPage(from, end);
  await db.delete(R).where(and(eq(R.businessId, bid), eq(R.kind, 'qpage')));
  await upsert(bid, 'qpage', rows.map(r => ({ date: end, key: r.keys[1] + '\t' + r.keys[0], clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), ctr: r.ctr, position: r.position })));
}

/** Calendar-month chunks of [start, end], newest first. */
export function monthChunks(start: string, end: string): [string, string][] {
  const out: [string, string][] = []; let a = start;
  while (a <= end) {
    const d = new Date(a + 'T12:00'); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);
    const b = [last.getFullYear(), String(last.getMonth() + 1).padStart(2, '0'), String(last.getDate()).padStart(2, '0')].join('-');
    out.push([a, b < end ? b : end]); a = addDays(b, 1);
  }
  return out.reverse();
}
const sixteenMonthsBefore = (end: string) => { const d = new Date(end + 'T12:00'); d.setMonth(d.getMonth() - 16); return addDays([d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'), 1); };

async function fail(bid: string, e: any) {
  const msg = e instanceof GscApiError ? e.message : String(e?.cause?.message || e?.message || e);
  console.error('[gsc] sync paused', bid, msg);
  await setConn(bid, { status: 'error', error: msg.slice(0, 500) });
  await bump(bid).catch(() => {});
}

interface Cursor { property: string; start: string; end: string; months: [string, string][]; i: number; done: boolean }

export async function runBackfill(bid: string, onProgress: (pct: number) => Promise<void>) {
  const conn = await getConn(bid);
  if (!conn || conn.status !== 'syncing' || !conn.property) return { skipped: true };
  const property = conn.property;
  try {
    const src = await source(bid, property);
    const biz = await getBiz(bid);
    let cur = conn.backfillCursor as Cursor | null;
    if (!cur || cur.done || cur.property !== property) {
      const end = src.latest || addDays(bizToday(biz), -1);
      const start = sixteenMonthsBefore(end);
      cur = { property, start, end, months: monthChunks(start, end), i: 0, done: false };
      await setConn(bid, { backfillCursor: cur, progress: 0 });
    }
    let through = conn.lastSyncedThrough ? String(conn.lastSyncedThrough) : null;
    for (; cur.i < cur.months.length; cur.i++) {
      const live = await getConn(bid);
      if (!live || live.status !== 'syncing' || live.property !== property) return { cancelled: true };
      const [from, to] = cur.months[cur.i];
      const max = await writeRange(bid, src, from, to);
      if (max && (!through || max > through)) through = max;
      const pct = Math.min(99, Math.round(((cur.i + 1) / cur.months.length) * 100));
      await setConn(bid, { progress: pct, backfillCursor: { ...cur, i: cur.i + 1 }, lastSyncedThrough: through });
      await onProgress(pct);
      await bump(bid);
    }
    await refreshQueryPage(bid, src);
    try { const { generateSuggestions } = await import('./suggestions'); await generateSuggestions(bid); }
    catch (e: any) { console.error('[gsc] suggestions failed after backfill', e?.message || e); await enqueue('suggestions.generate', {}, { businessId: bid, ref: bid, singletonKey: 'sugg:' + bid, runAt: new Date(Date.now() + 60_000) }); }
    await setConn(bid, { status: 'connected', progress: 100, error: null, backfillCursor: { ...cur, i: cur.months.length, done: true }, lastSyncedThrough: through });
    await onProgress(100);
    await notify(bid, 'Search Console synced. Recommendations updated.', { tone: 'ok' });
    return { through };
  } catch (e) { await fail(bid, e); return { paused: true }; }
}

export async function runIncremental(bid: string) {
  const conn = await getConn(bid);
  if (!conn || conn.status !== 'connected' || !conn.property) return { skipped: true };
  try {
    const src = await source(bid, conn.property);
    const biz = await getBiz(bid);
    const end = src.latest || addDays(bizToday(biz), -1);
    const last = conn.lastSyncedThrough ? String(conn.lastSyncedThrough) : addDays(end, -7);
    // Re-pull the last 3 days we have: Search Console finalizes recent days late.
    const from = addDays(last, -2);
    if (from > end) return { upToDate: true };
    const max = await writeRange(bid, src, from, end);
    await refreshQueryPage(bid, src);
    const through = max && max > last ? max : last;
    await setConn(bid, { lastSyncedThrough: through, error: null });
    // Recommendations are refreshed weekly from the new data.
    const latest = (await db.select({ at: sql<Date>`max(${schema.suggestions.createdAt})` }).from(schema.suggestions).where(eq(schema.suggestions.businessId, bid)))[0]?.at;
    if (!latest || Date.now() - new Date(latest).getTime() > 7 * 864e5) await enqueue('suggestions.generate', {}, { businessId: bid, ref: bid, singletonKey: 'sugg:' + bid });
    await bump(bid);
    return { through };
  } catch (e) { await fail(bid, e); return { paused: true }; }
}
