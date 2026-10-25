// The onboarding draft (architecture §4.2): the owner's `status = 'onboarding'` business. commitDraft is the only path to active.
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { track } from '../events';
import type { DraftSummary, OnboardingState } from '@/lib/types';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Q = typeof db | Tx;
/** Side effects deferred until a transaction commits (track, bump, provider calls): never write through `db` inside a tx. */
export type Later = (() => Promise<unknown>)[];
export async function runLater(later: Later) { for (const f of later) { try { await f(); } catch (e: any) { console.error('[billing] deferred step failed', e?.message || e); } } }

type BizRow = typeof schema.businesses.$inferSelect;
export const validTz = (tz?: string | null): tz is string => { if (!tz) return false; try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

export function toDraftSummary(b: Pick<BizRow, 'id' | 'domain' | 'profile' | 'onboarding' | 'site'>): DraftSummary {
  const p: any = b.profile || {}; const o: OnboardingState = b.onboarding || {};
  return {
    id: b.id, domain: b.domain, name: p.business?.name || b.domain,
    brand: { logo: p.brand?.logo ?? null, primary: p.brand?.primary || '#17181C', secondary: p.brand?.secondary || '#EF6A2E' },
    step: o.step || null, savedAt: o.savedAt || null, analyzed: !!(b.site as any)?.analyzedAt,
  };
}

/** The owner's draft row (one per owner; newest wins if an old bug left two). */
export async function draftOf(ownerId: string, q: Q = db): Promise<BizRow | null> {
  return (await q.select().from(schema.businesses).where(and(eq(schema.businesses.ownerId, ownerId), eq(schema.businesses.status, 'onboarding'))).orderBy(desc(schema.businesses.createdAt)).limit(1))[0] || null;
}

/** Commit a draft: status active, timezone from onboarding.tz, committedAt; Search Console marked skipped if never connected;
 *  `business.onboarded` tracked once. Idempotent (only the call that flips the status does anything). Bumps the revision in
 *  the same UPDATE. Returns the bid when this call committed it, else null. Pass `q` + `later` inside a transaction. */
export async function commitDraft(bid: string, q: Q = db, later?: Later): Promise<string | null> {
  const B = schema.businesses;
  const cur = (await q.select({ onboarding: B.onboarding, timezone: B.timezone }).from(B).where(and(eq(B.id, bid), eq(B.status, 'onboarding'))).limit(1))[0];
  if (!cur) return null;
  const tz = validTz(cur.onboarding?.tz) ? cur.onboarding.tz : cur.timezone;
  const committedAt = new Date().toISOString();
  const r = await q.update(B).set({ status: 'active', timezone: tz, onboarding: sql`${B.onboarding} || ${JSON.stringify({ committedAt })}::jsonb`, rev: sql`${B.rev} + 1`, updatedAt: new Date() })
    .where(and(eq(B.id, bid), eq(B.status, 'onboarding'))).returning({ id: B.id, ownerId: B.ownerId });
  if (!r[0]) return null;
  const G = schema.gscConnections;
  const g = (await q.select({ status: G.status }).from(G).where(eq(G.businessId, bid)).limit(1))[0];
  if (!g) await q.insert(G).values({ businessId: bid, status: 'skipped' }).onConflictDoNothing();
  else if (g.status === 'none') await q.update(G).set({ status: 'skipped' }).where(eq(G.businessId, bid));
  const t = () => track('business.onboarded', { bid, uid: r[0].ownerId });
  if (later) later.push(t); else await t();
  return bid;
}
