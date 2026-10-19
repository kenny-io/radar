// BriefDay persistence. Items live in brief_days.items (jsonb); every read-modify-write takes a row lock so concurrent
// item updates and "Scan again" merges never lose each other's changes.
import { and, eq, lt } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import type { BriefItem } from '@/lib/types';

export type DayRow = typeof schema.briefDays.$inferSelect;
export type DayStats = Record<string, { read: number }>;
export interface CandMark { id: string; plat: string; score?: number; theme?: string; reject?: string; at: string }

export async function getDay(bid: string, date: string): Promise<DayRow | null> {
  const r = await db.select().from(schema.briefDays).where(and(eq(schema.briefDays.businessId, bid), eq(schema.briefDays.date, date))).limit(1);
  return r[0] || null;
}

/** Lock the day row, let `fn` compute the change, write it. Returns fn's value (null → no write). */
export async function withDay<T>(bid: string, date: string, fn: (row: DayRow) => { items?: BriefItem[]; candidates?: CandMark[]; scannedAt?: string; stats?: DayStats; ret: T } | null): Promise<T | null> {
  return db.transaction(async tx => {
    const r = await tx.select().from(schema.briefDays).where(and(eq(schema.briefDays.businessId, bid), eq(schema.briefDays.date, date))).for('update').limit(1);
    if (!r[0]) return null;
    const out = fn(r[0]);
    if (!out) return null;
    const set: Partial<DayRow> = {};
    if (out.items) set.items = out.items;
    if (out.candidates) set.candidates = out.candidates;
    if (out.scannedAt) set.scannedAt = out.scannedAt;
    if (out.stats) set.stats = out.stats;
    if (Object.keys(set).length) await tx.update(schema.briefDays).set(set).where(and(eq(schema.briefDays.businessId, bid), eq(schema.briefDays.date, date)));
    return out.ret;
  });
}

/** Sum two days' per-platform read counts. */
export function mergeStats(a: DayStats | null | undefined, b: DayStats): DayStats {
  const out: DayStats = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) out[k] = { read: (out[k]?.read || 0) + v.read };
  return out;
}

/** Insert a new day, or (if one appeared meanwhile) merge into it. */
export async function createDay(bid: string, date: string, items: BriefItem[], candidates: CandMark[], scannedAt: string, stats: DayStats = {}) {
  await db.insert(schema.briefDays).values({ businessId: bid, date, items, candidates, scannedAt, stats })
    .onConflictDoNothing({ target: [schema.briefDays.businessId, schema.briefDays.date] });
}

/** Persist expiry: open/copied items of past days become 'expired' (the workspace also maps it on read). */
export async function expirePastDays(bid: string, today: string): Promise<number> {
  const rows = await db.select().from(schema.briefDays).where(and(eq(schema.briefDays.businessId, bid), lt(schema.briefDays.date, today)));
  let n = 0;
  for (const r of rows) {
    if (!(r.items || []).some((i: any) => i.st === 'open' || i.st === 'copied')) continue;
    await withDay(bid, String(r.date), row => ({ items: (row.items as BriefItem[]).map(i => (i.st === 'open' || i.st === 'copied' ? { ...i, st: 'expired' as const } : i)), ret: true }));
    n++;
  }
  return n;
}
