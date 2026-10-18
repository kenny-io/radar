// Derived Search Console metrics (02-system.md §4). Shared by Performance, Dashboard, Profile, Calendar, Social and Brief.
// "Last N days" = the last N days that have data (GSC lags 2–3 days).
import { and, desc, eq, gte, lte, max, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { addDays } from '@/lib/format';

export interface DayPoint { d: string; clicks: number; impr: number; ctr: number; pos: number }
export interface QueryRow { q: string; clicks: number; impr: number; ctr: number; pos: number }
export interface PageRow { path: string; url: string; title: string; clicks: number; impr: number; ctr: number; pos: number }
export interface Totals { clicks: number; impr: number; ctr: number; pos: number }

const R = schema.gscRows;

/** Latest date with data for this business, or null when nothing is synced. */
export async function lastDataDate(bid: string): Promise<string | null> {
  const r = await db.select({ d: max(R.date) }).from(R).where(and(eq(R.businessId, bid), eq(R.kind, 'date')));
  return r[0]?.d ? String(r[0].d) : null;
}
export async function windowFor(bid: string, days: number, offset = 0): Promise<{ from: string; to: string } | null> {
  const last = await lastDataDate(bid); if (!last) return null;
  const to = addDays(last, -offset * days); const from = addDays(to, -(days - 1));
  return { from, to };
}

/** Daily series for the chart. */
export async function series(bid: string, days: number): Promise<DayPoint[]> {
  const w = await windowFor(bid, days); if (!w) return [];
  const rows = await db.select().from(R).where(and(eq(R.businessId, bid), eq(R.kind, 'date'), gte(R.date, w.from), lte(R.date, w.to))).orderBy(R.date);
  return rows.map(r => ({ d: String(r.date), clicks: r.clicks, impr: r.impressions, ctr: r.impressions ? r.clicks / r.impressions : 0, pos: r.position }));
}

/** Sum clicks/impressions; CTR = clicks/impressions; position impression-weighted. */
export function totals(points: { clicks: number; impr: number; pos: number }[]): Totals {
  const clicks = points.reduce((s, p) => s + p.clicks, 0), impr = points.reduce((s, p) => s + p.impr, 0);
  const pos = impr ? points.reduce((s, p) => s + p.pos * p.impr, 0) / impr : 0;
  return { clicks, impr, ctr: impr ? clicks / impr : 0, pos };
}

/** Current range totals plus the immediately preceding range of the same length. */
export async function summary(bid: string, days: number): Promise<{ cur: Totals; prev: Totals | null; series: DayPoint[] } | null> {
  const w = await windowFor(bid, days); if (!w) return null;
  const pw = { from: addDays(w.from, -days), to: addDays(w.from, -1) };
  const all = await db.select().from(R).where(and(eq(R.businessId, bid), eq(R.kind, 'date'), gte(R.date, pw.from), lte(R.date, w.to))).orderBy(R.date);
  const pts = all.map(r => ({ d: String(r.date), clicks: r.clicks, impr: r.impressions, ctr: r.impressions ? r.clicks / r.impressions : 0, pos: r.position }));
  const cur = pts.filter(p => p.d >= w.from), prev = pts.filter(p => p.d < w.from);
  return { cur: totals(cur), prev: prev.length ? totals(prev) : null, series: cur };
}

async function grouped(bid: string, kind: 'query' | 'page', days: number, limit: number) {
  const w = await windowFor(bid, days); if (!w) return [];
  const rows = await db.select({
    key: R.key, clicks: sql<number>`sum(${R.clicks})::int`, impr: sql<number>`sum(${R.impressions})::int`,
    pos: sql<number>`(sum(${R.position} * ${R.impressions}) / nullif(sum(${R.impressions}),0))::float`,
  }).from(R).where(and(eq(R.businessId, bid), eq(R.kind, kind), gte(R.date, w.from), lte(R.date, w.to)))
    .groupBy(R.key).orderBy(desc(sql`sum(${R.clicks})`), desc(sql`sum(${R.impressions})`)).limit(limit);
  return rows.map(r => ({ key: r.key, clicks: Number(r.clicks), impr: Number(r.impr), ctr: r.impr ? r.clicks / r.impr : 0, pos: Number(r.pos || 0) }));
}
export async function topQueries(bid: string, days = 28, limit = 200): Promise<QueryRow[]> {
  return (await grouped(bid, 'query', days, limit)).map(r => ({ q: r.key, clicks: r.clicks, impr: r.impr, ctr: r.ctr, pos: r.pos }));
}
export async function topPages(bid: string, days = 28, limit = 200): Promise<PageRow[]> {
  const rows = await grouped(bid, 'page', days, limit);
  const titles = await db.select({ url: schema.crawlPages.url, path: schema.crawlPages.path, title: schema.crawlPages.title }).from(schema.crawlPages).where(eq(schema.crawlPages.businessId, bid));
  const byUrl = new Map(titles.map(t => [t.url.replace(/\/$/, ''), t]));
  return rows.map(r => { let path = r.key; try { path = new URL(r.key).pathname || '/'; } catch { /* */ } const t = byUrl.get(r.key.replace(/\/$/, '')); return { path, url: r.key, title: t?.title || path, clicks: r.clicks, impr: r.impr, ctr: r.ctr, pos: r.pos }; });
}

export const normKw = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
/** kwMeasured: the query-level row for each keyword — exact match first, then normalized. */
export async function kwMeasured(bid: string, kws: string[], days = 28): Promise<Record<string, QueryRow | null>> {
  const qs = await topQueries(bid, days, 5000);
  const exact = new Map(qs.map(q => [q.q, q])); const norm = new Map(qs.map(q => [normKw(q.q), q]));
  const out: Record<string, QueryRow | null> = {};
  for (const k of kws) out[k] = exact.get(k) || norm.get(normKw(k)) || null;
  return out;
}

/** The best ranking page for a query (most impressions), if the page dimension has it. Requires query+page data. */
export async function hasData(bid: string) { return (await lastDataDate(bid)) != null; }

/** Queries per page (query+page over the last 28 days with data; stored as kind 'qpage', key = page url + '\t' + query). */
export async function pageQueries(bid: string): Promise<Map<string, QueryRow[]>> {
  const rows = await db.select().from(R).where(and(eq(R.businessId, bid), eq(R.kind, 'qpage')));
  const out = new Map<string, QueryRow[]>();
  for (const r of rows) {
    const i = r.key.indexOf('\t'); if (i < 0) continue;
    const page = r.key.slice(0, i), q = r.key.slice(i + 1);
    const a = out.get(page) || []; a.push({ q, clicks: r.clicks, impr: r.impressions, ctr: r.impressions ? r.clicks / r.impressions : 0, pos: r.position }); out.set(page, a);
  }
  for (const a of out.values()) a.sort((x, y) => y.impr - x.impr);
  return out;
}

/** Expected CTR at a position (02-system.md §10): max(0.02, 0.30/pos). */
export const expCtr = (pos: number) => Math.max(0.02, 0.3 / Math.max(1, pos));
