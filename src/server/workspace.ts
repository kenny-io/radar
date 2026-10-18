import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { notFound } from './errors';
import { AI_DEFAULT, BRIEF_DEFAULT } from '@/lib/constants';
import { addDays, todayIn } from '@/lib/format';
import { kwMeasured } from './services/gsc/metrics';
import type { Article, BacklinksState, BlogState, BriefDay, BriefState, CalendarEntry, CalendarSettings, ConnectionPublic, GscState, JobSummary, Member, Profile, Proposal, Role, SocialAuto, SocialPack, Workspace, LiveLink } from '@/lib/types';

export type BizRow = typeof schema.businesses.$inferSelect;

export async function getBiz(bid: string): Promise<BizRow> {
  const r = await db.select().from(schema.businesses).where(eq(schema.businesses.id, bid)).limit(1);
  if (!r[0]) throw notFound('Business');
  return r[0];
}

/** Bump the business revision so connected clients refetch (SSE). Call after every write. */
export async function bump(bid: string) {
  await db.update(schema.businesses).set({ rev: sql`${schema.businesses.rev} + 1`, updatedAt: new Date() }).where(eq(schema.businesses.id, bid));
}

export const bizToday = (b: Pick<BizRow, 'timezone'>) => todayIn(b.timezone || 'America/New_York');

/* ── Defaults for each JSON slice ── */
export function calendarSettingsOf(b: BizRow): CalendarSettings {
  const p = b.profile as Profile;
  return { market: p?.brand?.markets?.[0] || 'United States', language: p?.brand?.language || 'English (US)', start: addDays(bizToday(b), 1), cadence: 'daily', perWeek: 3, ...(b.calendarSettings || {}) };
}
export function blogOf(b: BizRow, conns: ConnectionPublic[]): BlogState {
  const bl = b.blog || {};
  const def = bl.defaultId && conns.find(c => c.id === bl.defaultId) ? bl.defaultId : conns[0]?.id || null;
  return { conns, defaultId: def, mode: bl.mode || 'review', autopilotAckAt: bl.autopilotAckAt || null, paused: !!bl.paused, tz: b.timezone, time: bl.time || '09:00' };
}
export function socialAutoOf(b: BizRow): SocialAuto {
  return { on: false, freq: 'daily', days: ['Mon', 'Wed', 'Fri'], platforms: ['linkedin', 'x'], style: 'branded', time: '08:00', ...(b.socialAuto || {}) };
}
export function briefSettingsOf(b: BizRow) { return { ...BRIEF_DEFAULT, ...(b.briefSettings || {}) }; }
export function aiPrefsOf(b: BizRow) { return { ...AI_DEFAULT, ...(b.ai || {}) }; }
export function defaultProfile(domain: string): Profile {
  return { domain, business: { name: '', description: '', offerings: [], industry: '', positioning: '', differentiators: [] }, audience: { segments: [], buyers: [], needs: [], competitors: [] }, keywords: { list: [] }, brand: { logo: null, primary: '#17181C', secondary: '#EF6A2E', voice: '', language: 'English (US)', markets: ['United States'] } };
}

export function entryFromRow(r: typeof schema.calendarEntries.$inferSelect): CalendarEntry {
  return { id: r.id, title: r.title, kw: r.kw, type: r.type as any, vol: r.vol, kd: r.kd, date: String(r.date), mode: r.mode, url: r.url, measured: r.measured || null, audience: r.audience, relevance: r.relevance, dest: r.dest, status: r.status as any, publishError: r.publishError || null, publishedUrl: r.publishedUrl };
}
export function connPublic(r: typeof schema.connections.$inferSelect): ConnectionPublic {
  return { id: r.id, type: r.type as any, url: r.url, target: r.target, f: r.fields || {}, secretHint: r.secretEnc ? 'whsec_…' : null, status: r.status, lastError: r.lastError };
}
export function proposalFromRow(r: typeof schema.proposals.$inferSelect): Proposal {
  return { ...(r.data || {}), id: r.id, direction: r.direction, partnerBusinessId: r.partnerBusinessId, decision: r.decision || null, note: r.note };
}
export function liveFromRow(r: typeof schema.liveLinks.$inferSelect): LiveLink {
  return { id: r.id, from: r.fromUrl, to: r.toUrl, anchor: r.anchor, rel: r.rel, since: String(r.since), status: r.status, lastCheckedAt: r.lastCheckedAt ? r.lastCheckedAt.toISOString() : null };
}

export async function loadWorkspace(bid: string, userId: string, role: Role): Promise<Workspace> {
  const b = await getBiz(bid);
  const today = bizToday(b);
  const [entries, arts, conns, packs, days, gscRow, props, live, team, jobRows, suggs] = await Promise.all([
    db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.businessId, bid)).orderBy(schema.calendarEntries.date, schema.calendarEntries.createdAt),
    db.select().from(schema.articles).where(eq(schema.articles.businessId, bid)),
    db.select().from(schema.connections).where(eq(schema.connections.businessId, bid)).orderBy(schema.connections.createdAt),
    db.select().from(schema.socialPacks).where(eq(schema.socialPacks.businessId, bid)).orderBy(desc(schema.socialPacks.createdAt)),
    db.select().from(schema.briefDays).where(and(eq(schema.briefDays.businessId, bid), gte(schema.briefDays.date, addDays(today, -30)))).orderBy(schema.briefDays.date),
    db.select().from(schema.gscConnections).where(eq(schema.gscConnections.businessId, bid)).limit(1),
    db.select().from(schema.proposals).where(eq(schema.proposals.businessId, bid)).orderBy(desc(schema.proposals.createdAt)),
    db.select().from(schema.liveLinks).where(eq(schema.liveLinks.businessId, bid)).orderBy(desc(schema.liveLinks.since)),
    db.select({ m: schema.members, name: schema.users.name }).from(schema.members).leftJoin(schema.users, eq(schema.users.id, schema.members.userId)).where(eq(schema.members.businessId, bid)).orderBy(schema.members.createdAt),
    db.select().from(schema.jobs).where(and(eq(schema.jobs.businessId, bid), or(inArray(schema.jobs.status, ['queued', 'running']), gte(schema.jobs.finishedAt, new Date(Date.now() - 120000))))).orderBy(desc(schema.jobs.createdAt)).limit(30),
    db.select().from(schema.suggestions).where(and(eq(schema.suggestions.businessId, bid), eq(schema.suggestions.state, 'open'))),
  ]);
  const g = gscRow[0];
  const gsc: GscState = g ? { status: g.status, property: g.property, progress: g.progress, lastSyncedThrough: g.lastSyncedThrough ? String(g.lastSyncedThrough) : null, error: g.error } : { status: 'none', property: null, progress: 0, lastSyncedThrough: null, error: null };
  const connsPub = conns.map(connPublic);
  const briefDaysMap: Record<string, BriefDay> = {};
  for (const d of days) {
    const date = String(d.date);
    const past = date < today;
    briefDaysMap[date] = { date, scannedAt: d.scannedAt, items: (d.items || []).map((i: any) => (past && (i.st === 'open' || i.st === 'copied') ? { ...i, st: 'expired' } : i)) };
  }
  const brief: BriefState = { setup: b.briefSetup, settings: briefSettingsOf(b) as any, days: briefDaysMap };
  const proposals = props.map(proposalFromRow);
  const backlinks: BacklinksState = { joined: !!(b.backlinks || {}).joined, prefs: (b.backlinks || {}).prefs || {}, inbound: proposals.filter(p => p.direction === 'in'), outbound: proposals.filter(p => p.direction === 'out'), live: live.map(liveFromRow) };
  const articles: Record<string, Article> = {};
  for (const a of arts) articles[a.entryId] = a.data as Article;
  const calEntries = entries.map(entryFromRow);
  const todayBrief = briefDaysMap[today];
  const kwl = ((b.profile as Profile)?.keywords?.list || []).map(k => k.kw);
  const measured = gsc.status === 'connected' || gsc.status === 'error' ? await kwMeasured(bid, kwl) : {};
  const members: Member[] = team.map(({ m, name }) => ({ id: m.id, userId: m.userId, name: name || null, email: m.email, role: m.role, status: m.status, you: m.userId === userId }));
  const jobs: JobSummary[] = jobRows.map(j => ({ id: j.id, kind: j.kind, status: j.status, progress: j.progress, error: j.error, createdAt: j.createdAt.toISOString(), ref: j.ref }));
  return {
    id: b.id, rev: b.rev, role, status: b.status, today, tz: b.timezone,
    profile: { ...(b.profile as Profile), domain: b.domain }, edited: b.edited || {},
    gsc,
    calendar: { entries: calEntries, settings: calendarSettingsOf(b), generatedAt: b.calendarGeneratedAt ? b.calendarGeneratedAt.toISOString() : null },
    articles,
    blog: blogOf(b, connsPub),
    social: { packs: packs.map(p => ({ ...(p.data as SocialPack), id: p.id })), auto: socialAutoOf(b) },
    brief, backlinks, ai: aiPrefsOf(b), team: members,
    site: { pages: b.site?.pages ?? null, articles: b.site?.articles ?? null, ranking: b.site?.ranking ?? null, analyzedAt: b.site?.analyzedAt ?? null },
    jobs, measured, kwSuggestions: (b.kwSuggestions || []) as any,
    counts: {
      briefOpen: todayBrief ? todayBrief.items.filter(i => i.st === 'open' || i.st === 'copied').length : 0,
      review: calEntries.filter(e => e.status === 'review').length,
      backlinksPending: backlinks.joined ? backlinks.inbound.filter(p => !p.decision).length : 0,
      highSuggestions: suggs.filter(s => (s.data as any)?.prio === 'High').length,
    },
  };
}
