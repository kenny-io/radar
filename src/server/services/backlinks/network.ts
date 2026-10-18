// Backlinks network — shared helpers: preferences, network membership, relevance, competitors, URLs. 02-system.md §13.
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import type { BacklinkPrefs, Profile } from '@/lib/types';

export type BizRow = typeof schema.businesses.$inferSelect;

/** Backlinks JSON on businesses.backlinks */
export interface BacklinksMeta {
  joined?: boolean; prefs?: Partial<BacklinkPrefs>; joinedAt?: string | null; leftAt?: string | null;
  /** cached authority of this business's domain (0–100, null = unavailable) */
  auth?: { v: number | null; at: string } | null;
  /** dev stubs only */
  synthetic?: boolean; stubSeeded?: boolean;
}
export const metaOf = (b: Pick<BizRow, 'backlinks'>): BacklinksMeta => (b.backlinks || {}) as BacklinksMeta;
/** Merge keys into businesses.backlinks atomically (jsonb ||), so concurrent writers don't clobber each other. */
export async function patchMeta(bid: string, patch: Partial<BacklinksMeta>) {
  await db.update(schema.businesses).set({ backlinks: sql`coalesce(${schema.businesses.backlinks}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb` }).where(eq(schema.businesses.id, bid));
}

/** Same defaults as PrefsForm (prototype radar-backlinks.jsx). */
export function prefsOf(b: Pick<BizRow, 'backlinks' | 'profile'>): BacklinkPrefs {
  const p = metaOf(b).prefs || {};
  const prof = b.profile as Profile;
  return {
    topics: p.topics && p.topics.length ? p.topics : (prof?.business?.offerings || []).slice(0, 3),
    max: (p.max as any) || 4,
    excludeCompetitors: p.excludeCompetitors !== false,
    outbound: p.outbound !== false,
    qualify: p.qualify !== false,
    autoApprove: !!p.autoApprove,
    minAuth: (p.minAuth as any) || 50,
  };
}

/** Businesses currently in the network (joined). Synthetic dev partners are included only in stub mode by the caller. */
export async function networkBusinesses(includeSynthetic: boolean): Promise<BizRow[]> {
  const rows = await db.select().from(schema.businesses).where(sql`(${schema.businesses.backlinks}->>'joined')::boolean is true`);
  return rows.filter(b => b.status === 'active' || (includeSynthetic && metaOf(b).synthetic));
}

/** Email of the business's editor (its Owner) — who places links and receives partner notices. */
export async function editorEmail(businessId: string): Promise<{ email: string; name: string } | null> {
  const r = await db.select({ email: schema.members.email, name: schema.users.name }).from(schema.members)
    .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(and(eq(schema.members.businessId, businessId), eq(schema.members.role, 'Owner'), eq(schema.members.status, 'active'))).limit(1);
  return r[0] ? { email: r[0].email, name: r[0].name || r[0].email } : null;
}

/* ── text relevance ── */
const STOP = new Set('a an and are as at be but by for from has have how i if in into is it its of on or our so than that the their them then there these they this to too up us was we what when where which who why will with you your yours can do does not no more most just about over out all any very also get got make made use using via per new one two'.split(' '));
export function stem(w: string) {
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) w = w.slice(0, -1);
  return w.endsWith('e') && w.length > 3 ? w.slice(0, -1) : w;
}
export function tokens(s: string): string[] {
  return (s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/[\s-]+/).filter(w => w.length > 2 && !STOP.has(w)).map(stem));
}
export const tokenSet = (parts: (string | undefined | null)[]) => new Set(parts.filter(Boolean).flatMap(p => tokens(String(p))));
export function overlap(a: Set<string>, b: Set<string>): number { let n = 0; for (const x of a) if (b.has(x)) n++; return n; }

/** What a business is about, for matching (topics from prefs + offerings + audience). */
export function topicTokens(b: BizRow): Set<string> {
  const p = b.profile as Profile; const pr = prefsOf(b);
  return tokenSet([...pr.topics, ...(p.business?.offerings || []), p.business?.industry, ...(p.audience?.needs || [])]);
}
export function audienceTokens(b: BizRow): Set<string> {
  const p = b.profile as Profile;
  return tokenSet([...(p.audience?.segments || []), ...(p.audience?.buyers || [])]);
}

/** Topic or audience overlap between two businesses (0..1). */
export function relevance(a: BizRow, b: BizRow): { score: number; topic: number; audience: number } {
  const ta = topicTokens(a), tb = topicTokens(b), aa = audienceTokens(a), ab = audienceTokens(b);
  const topic = overlap(ta, tb) / Math.max(1, Math.min(ta.size, tb.size));
  const audience = overlap(aa, ab) / Math.max(1, Math.min(aa.size, ab.size));
  return { score: Math.max(topic, audience), topic, audience };
}

const norm = (s: string) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[^a-z0-9]/g, '');
/** true when `b` appears in `a`'s competitor list (by name or domain). */
export function listsAsCompetitor(a: BizRow, b: BizRow): boolean {
  const comps = ((a.profile as Profile)?.audience?.competitors || []).map(norm).filter(Boolean);
  if (!comps.length) return false;
  const name = norm((b.profile as Profile)?.business?.name || '');
  const dom = norm(b.domain); const label = norm(b.domain.split('.')[0]);
  return comps.some(c => c === name || c === dom || c === label || (c.length > 4 && (name.includes(c) || dom.includes(c))));
}
/** Competitor exclusion as configured by either side. */
export function competitorsBlocked(a: BizRow, b: BizRow): boolean {
  return (prefsOf(a).excludeCompetitors && listsAsCompetitor(a, b)) || (prefsOf(b).excludeCompetitors && listsAsCompetitor(b, a));
}
export function languageOf(b: BizRow) { return String((b.profile as Profile)?.brand?.language || 'English').split(/[ (]/)[0].toLowerCase(); }

/* ── URLs ── */
/** "paperandpixel.co/notes/x" (display form: no scheme, no www, no trailing slash) */
export function displayUrl(u: string): string { return u.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[?#].*$/, '').replace(/\/$/, ''); }
export function absUrl(u: string): string { return /^https?:\/\//i.test(u) ? u : 'https://' + u.replace(/^\/+/, ''); }
export function sameUrl(a: string, b: string): boolean { return displayUrl(a).toLowerCase() === displayUrl(b).toLowerCase(); }
export const hostOf = (u: string) => displayUrl(u).split('/')[0].toLowerCase();
export const pathOf = (u: string) => '/' + displayUrl(u).split('/').slice(1).join('/');

/** "rel" shown on proposals: network links are qualified when either side asks (the host's editor otherwise chooses nofollow). */
export function relFor(host: BizRow, target: BizRow) { return prefsOf(host).qualify || prefsOf(target).qualify ? 'rel="sponsored"' : 'rel="nofollow"'; }
export const relShort = (rel: string) => (/sponsored/.test(rel) ? 'sponsored' : /nofollow/.test(rel) ? 'nofollow' : 'Editorial');

/** "YYYY-MM" for the per-month proposal cap. */
export const monthKey = (today: string) => today.slice(0, 7);
