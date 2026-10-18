// Link verification (02-system.md §13): the weekly crawler confirms each live link exists with the right rel (else lost,
// reported to both sides); approved placements become live once the link is found; removal requests become removed once
// the link is gone. Re-check runs the same check on demand.
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { env } from '../../env';
import { todayIn } from '@/lib/format';
import { checkLink } from './linkcheck';
import { sendLostNotice, sendRemovalRequest } from './decisions';
import { displayUrl, hostOf, metaOf, relShort, type BizRow } from './network';
import type { Profile } from '@/lib/types';

type LiveRow = typeof schema.liveLinks.$inferSelect;
type PropRow = typeof schema.proposals.$inferSelect;

async function bizRow(id: string) { return (await db.select().from(schema.businesses).where(eq(schema.businesses.id, id)).limit(1))[0] || null; }

async function setLinkStatus(from: string, to: string, patch: Partial<LiveRow>) {
  await db.update(schema.liveLinks).set(patch).where(and(eq(schema.liveLinks.fromUrl, from), eq(schema.liveLinks.toUrl, to)));
}

/** A placement was found on the host page: create the live link for both sides and mark both proposals placed. */
async function markPlaced(row: PropRow, rel: string | null) {
  const d = row.data || {};
  const rows = d.pairId ? (await db.select().from(schema.proposals).where(inArray(schema.proposals.businessId, [row.businessId, row.partnerBusinessId].filter(Boolean) as string[]))).filter(r => r.data?.pairId === d.pairId) : [row];
  const owners = new Set(rows.map(r => r.businessId)); owners.add(row.businessId);
  for (const bid of owners) {
    const b = await bizRow(bid); if (!b) continue;
    const exists = await db.select({ id: schema.liveLinks.id }).from(schema.liveLinks).where(and(eq(schema.liveLinks.businessId, bid), eq(schema.liveLinks.fromUrl, d.page), eq(schema.liveLinks.toUrl, d.target))).limit(1);
    if (!exists[0]) await db.insert(schema.liveLinks).values({ businessId: bid, proposalId: rows.find(r => r.businessId === bid)?.id || row.id, fromUrl: d.page, toUrl: d.target, anchor: d.anchor, rel: rel || relShort(d.rel || ''), since: todayIn(b.timezone), status: 'live', lastCheckedAt: new Date() });
  }
  const now = new Date().toISOString();
  for (const r of rows) await db.update(schema.proposals).set({ data: { ...r.data, placedAt: now } }).where(eq(schema.proposals.id, r.id));
}

/** Check approved placements that aren't live yet. */
export async function checkPendingPlacements(bid: string) {
  const rows = await db.select().from(schema.proposals).where(and(eq(schema.proposals.businessId, bid), inArray(schema.proposals.decision, ['approved', 'auto']), gte(schema.proposals.createdAt, new Date(Date.now() - 120 * 864e5))));
  let placed = 0;
  for (const r of rows) {
    const d = r.data || {};
    if (d.placedAt || d.removedAt) continue;
    // Inbound: the partner's editor places it. Outbound: Radar inserts it on the next publish — the stub can't publish, so it stays pending.
    const res = await checkLink(d.page, d.target, d.rel || '', r.direction === 'in' ? 'present' : 'absent');
    if (res.found && res.relOk) { await markPlaced(r, res.rel); placed++; }
  }
  return { placed };
}

/** Verify one link (and its mirror rows). Returns the resulting status. */
export async function verifyLink(l: LiveRow, opts: { notify: boolean }): Promise<LiveRow['status']> {
  if (l.status === 'removed') return 'removed';
  const stub = l.status === 'live' ? 'present' : 'absent';
  const res = await checkLink(l.fromUrl, l.toUrl, l.rel, stub);
  const now = new Date();
  if (!res.reachable) { await setLinkStatus(l.fromUrl, l.toUrl, { lastCheckedAt: now }); return l.status; } // inconclusive: keep status
  const ok = res.found && res.relOk;
  if (l.status === 'removal') {
    if (!res.found) { await setLinkStatus(l.fromUrl, l.toUrl, { status: 'removed', lastCheckedAt: now }); return 'removed'; }
    await setLinkStatus(l.fromUrl, l.toUrl, { lastCheckedAt: now }); return 'removal';
  }
  if (ok) { await setLinkStatus(l.fromUrl, l.toUrl, { status: 'live', lastCheckedAt: now }); return 'live'; }
  // Missing, or present without the required qualifier → lost; both sides hear about it (once per transition, or on Re-check).
  await setLinkStatus(l.fromUrl, l.toUrl, { status: 'lost', lastCheckedAt: now });
  if (opts.notify || l.status === 'live') await sendLostNotice({ from: l.fromUrl, to: l.toUrl, anchor: l.anchor, rel: l.rel }, l.businessId, res.found ? 'rel' : 'missing').catch(e => console.error('[backlinks] lost notice failed', e?.message));
  return 'lost';
}

/** Weekly: every link this business tracks, plus Editorial links discovered on partners' crawled pages. */
export async function verifyBusiness(bid: string) {
  const links = await db.select().from(schema.liveLinks).where(and(eq(schema.liveLinks.businessId, bid), inArray(schema.liveLinks.status, ['live', 'lost', 'removal'])));
  const seen = new Set<string>();
  for (const l of links) { const k = l.fromUrl + '→' + l.toUrl; if (seen.has(k)) continue; seen.add(k); await verifyLink(l, { notify: false }); }
  await checkPendingPlacements(bid);
  if (!env.devStubs) await discoverEditorial(bid);
  return { checked: seen.size };
}

/** Links to this business found on network partners' crawled pages that weren't placed through a proposal → "Editorial". */
async function discoverEditorial(bid: string) {
  const a = await bizRow(bid); if (!a || !metaOf(a).joined) return;
  const partners = (await db.select().from(schema.businesses)).filter(b => b.id !== bid && metaOf(b).joined);
  if (!partners.length) return;
  const pages = await db.select({ url: schema.crawlPages.url, links: schema.crawlPages.links }).from(schema.crawlPages).where(inArray(schema.crawlPages.businessId, partners.map(p => p.id)));
  const known = new Set((await db.select({ f: schema.liveLinks.fromUrl, t: schema.liveLinks.toUrl }).from(schema.liveLinks).where(eq(schema.liveLinks.businessId, bid))).map(r => r.f + '→' + r.t));
  for (const p of pages) for (const href of p.links || []) {
    if (hostOf(href) !== a.domain) continue;
    const from = displayUrl(p.url), to = displayUrl(href);
    if (known.has(from + '→' + to)) continue;
    known.add(from + '→' + to);
    const res = await checkLink(from, to, 'Editorial', 'present');
    if (res.found) await db.insert(schema.liveLinks).values({ businessId: bid, fromUrl: from, toUrl: to, anchor: res.anchorText || (a.profile as Profile)?.business?.name || a.domain, rel: res.rel || 'Editorial', since: todayIn(a.timezone), status: 'live', lastCheckedAt: new Date() });
  }
}

/** Re-check on demand. A link that's still missing re-notifies the partner. */
export async function recheck(bid: string, id: string) {
  const l = (await db.select().from(schema.liveLinks).where(and(eq(schema.liveLinks.id, id), eq(schema.liveLinks.businessId, bid))).limit(1))[0];
  if (!l) return null;
  const status = await verifyLink(l, { notify: true });
  return { status };
}

/** Request removal: the host's editor is asked to remove it within 7 days; Radar stops re-inserting it. */
export async function requestRemoval(b: BizRow, id: string) {
  const l = (await db.select().from(schema.liveLinks).where(and(eq(schema.liveLinks.id, id), eq(schema.liveLinks.businessId, b.id))).limit(1))[0];
  if (!l) return null;
  if (l.status !== 'live') return { status: l.status };
  await setLinkStatus(l.fromUrl, l.toUrl, { status: 'removal', removalRequestedAt: new Date() });
  // Any approved outbound insertion for this link must not come back on the next publish.
  const props = await db.select().from(schema.proposals).where(and(sql`${schema.proposals.data}->>'page' = ${l.fromUrl}`, sql`${schema.proposals.data}->>'target' = ${l.toUrl}`));
  for (const p of props) if (!p.data?.removedAt) await db.update(schema.proposals).set({ data: { ...p.data, removedAt: new Date().toISOString() } }).where(eq(schema.proposals.id, p.id));
  await sendRemovalRequest({ from: l.fromUrl, to: l.toUrl, anchor: l.anchor }, b).catch(e => console.error('[backlinks] removal mail failed', e?.message));
  return { status: 'removal' as const };
}
