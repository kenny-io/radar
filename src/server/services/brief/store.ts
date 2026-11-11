// BriefDay persistence. Items live in brief_days.items (jsonb); every read-modify-write takes a row lock so concurrent
// item updates and "Scan again" merges never lose each other's changes.
import { and, eq, lt, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import type { BriefItem } from '@/lib/types';
import type { Q } from '@/server/billing/draft';
import { resolveEngagement } from '../lifecycle/engagement';
import { reportFailure } from '@/server/observability/failures';

export type DayRow = typeof schema.briefDays.$inferSelect;
export type DayStats = Record<string, { read: number }>;
/** `tk` = the thread key (plan.threadKey), so a later scan skips the same post found under another id. */
export interface CandMark { id: string; plat: string; tk?: string; score?: number; theme?: string; reject?: string; at: string }

export async function getDay(bid: string, date: string): Promise<DayRow | null> {
  const r = await db.select().from(schema.briefDays).where(and(eq(schema.briefDays.businessId, bid), eq(schema.briefDays.date, date))).limit(1);
  return r[0] || null;
}

/** What the rescan cron needs to know about a day: when a member last acted on it, or null when the day doesn't exist.
 *  (Primary-key read, no JSON columns: the cron asks this every minute.) */
export async function dayMark(bid: string, date: string): Promise<{ actedAt: Date | null } | null> {
  const r = await db.select({ actedAt: schema.briefDays.actedAt }).from(schema.briefDays).where(and(eq(schema.briefDays.businessId, bid), eq(schema.briefDays.date, date))).limit(1);
  return r[0] || null;
}

/** Item states a member puts an item into that earn the day's next background rescan (IS-7). Undo to `open` does not. */
export const ACTED_STATES: readonly BriefItem['st'][] = ['copied', 'posted', 'skipped'];

/** A member acted on one of the day's items outside `withDay` (Post now, Schedule from Radar). Best effort and never
 *  throws: the post has already gone out or been scheduled when this runs. */
export async function markActed(bid: string, date: string): Promise<void> {
  try { await db.update(schema.briefDays).set({ actedAt: sql`now()` }).where(and(eq(schema.briefDays.businessId, bid), eq(schema.briefDays.date, date))); }
  catch (e: any) { console.error('[brief] markActed failed', bid, date, e?.message || e); await reportFailure(e, { source: 'brief', operation: 'brief.markActed', businessId: bid, ref: date, degraded: true }).catch(() => {}); }
}

/** Lock the day row, let `fn` compute the change, write it. Returns fn's value (null → no write). `acted: true` records
 *  that a member copied, posted or skipped an item just now (`acted_at`, the database clock, like `jobs.created_at`). */
export async function withDay<T>(bid: string, date: string, fn: (row: DayRow) => { items?: BriefItem[]; candidates?: CandMark[]; scannedAt?: string; stats?: DayStats; acted?: boolean; ret: T } | null): Promise<T | null> {
  return db.transaction(async tx => {
    const r = await tx.select().from(schema.briefDays).where(and(eq(schema.briefDays.businessId, bid), eq(schema.briefDays.date, date))).for('update').limit(1);
    if (!r[0]) return null;
    const out = fn(r[0]);
    if (!out) return null;
    const set: Partial<Omit<DayRow, 'actedAt'>> & { actedAt?: SQL } = {};
    if (out.items) set.items = out.items;
    if (out.candidates) set.candidates = out.candidates;
    if (out.scannedAt) set.scannedAt = out.scannedAt;
    if (out.stats) set.stats = out.stats;
    if (out.acted) set.actedAt = sql`now()`;
    if (Object.keys(set).length) await tx.update(schema.briefDays).set(set).where(and(eq(schema.briefDays.businessId, bid), eq(schema.briefDays.date, date)));
    if ([...(r[0].items as BriefItem[]), ...(out.items || [])].some(i => i.kind === 'reply' && ['copied', 'posted', 'scheduled', 'skipped'].includes(i.st))) await resolveEngagement(tx, bid, 'brief_reply', date);
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
export async function createDay(bid: string, date: string, items: BriefItem[], candidates: CandMark[], scannedAt: string, stats: DayStats = {}, q: Q = db) {
  const inserted = await q.insert(schema.briefDays).values({ businessId: bid, date, items, candidates, scannedAt, stats })
    .onConflictDoNothing({ target: [schema.briefDays.businessId, schema.briefDays.date] }).returning({ date: schema.briefDays.date });
  return inserted.length > 0;
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
