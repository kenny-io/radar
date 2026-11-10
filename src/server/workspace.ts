import { env } from './env';
import { autopilotPublic } from './services/autopilot/policy';
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { notFound } from './errors';
import { AI_DEFAULT, BRIEF_DEFAULT } from '@/lib/constants';
import { imageSettingsOf } from '@/lib/imageOptions';
import { addDays, todayIn } from '@/lib/format';
import { kwMeasured } from './services/gsc/metrics';
import { decrypt } from './crypto';
import { socialOn } from './flags';
import { readInstructions } from './ai/instructions';
import { applySocial, extraBriefDays, socialProjection, stripSocial } from './services/social/publish/project';
import { firstRunOf } from './services/firstRun';
import { activityUnread, failedJobsOf } from './services/activity';
import { billingNoticeOf } from './billing/notice';
import type { ArticleSummary, BacklinksState, BlogState, BriefDay, BriefState, CalendarEntry, CalendarSettings, ConnectionPublic, GscState, JobSummary, Member, Profile, Proposal, Role, SocialAuto, SocialPack, Workspace, LiveLink } from '@/lib/types';

export type BizRow = typeof schema.businesses.$inferSelect;

export async function getBiz(bid: string): Promise<BizRow> {
  const r = await db.select().from(schema.businesses).where(eq(schema.businesses.id, bid)).limit(1);
  if (!r[0]) throw notFound('Business');
  return r[0];
}

/** Bump the business revision so connected clients refetch (SSE). Call after every write. Returns the new revision. */
export async function bump(bid: string): Promise<number> {
  const r = await db.update(schema.businesses).set({ rev: sql`${schema.businesses.rev} + 1`, updatedAt: new Date() }).where(eq(schema.businesses.id, bid)).returning({ rev: schema.businesses.rev });
  return r[0]?.rev ?? 0;
}

/* ── Articles in the workspace (first-five architecture §3.1, §3.2) ── */
export type ArticlesMode = 'summary' | 'full';
/** The client sends `x-radar-client: 2` on every request (src/client/api.ts) and loads bodies with `article.get`. A request
 *  without it comes from a tab opened before that shipped: it must keep getting whole articles, or its editor would
 *  render empty and could autosave an empty body. Remove the 'full' branch one release after this ships. */
export const articlesMode = (req: Request): ArticlesMode => (Number(req.headers.get('x-radar-client')) >= 2 ? 'summary' : 'full');
/** `v` of an article row: its updated_at in epoch ms. Every writer of `articles` advances it. */
export const articleV = (updatedAt: Date | null | undefined) => (updatedAt ? updatedAt.getTime() : 0);
/** `articles.updated_at` for a write to an existing row: now, and always at least a millisecond after the stored value, so
 *  `v` moves forward even when the web, worker and database clocks disagree by a few milliseconds. */
export const laterV = () => sql`greatest(date_trunc('milliseconds', clock_timestamp()), ${schema.articles.updatedAt} + interval '1 millisecond')`;
async function articlesOf(bid: string, mode: ArticlesMode): Promise<Record<string, ArticleSummary>> {
  const A = schema.articles; const out: Record<string, any> = {};
  // Legacy tabs: exactly what they always got (typed as summaries only because the current client never takes this branch).
  if (mode === 'full') { for (const a of await db.select().from(A).where(eq(A.businessId, bid))) out[a.entryId] = a.data; return out; }
  // Never select `data`: the body stays in Postgres.
  const rows = await db.select({ id: A.entryId, generated: sql<string | null>`${A.data}->>'generated'`, outline: sql<unknown>`${A.data}->'brief'->'outline'`, at: A.updatedAt }).from(A).where(eq(A.businessId, bid));
  for (const r of rows) out[r.id] = { generated: r.generated === 'true', outline: Array.isArray(r.outline) ? r.outline : [], v: articleV(r.at) } satisfies ArticleSummary;
  return out;
}

export const bizToday = (b: Pick<BizRow, 'timezone'>) => todayIn(b.timezone || 'America/New_York');

/* ── Defaults for each JSON slice ── */
export function calendarSettingsOf(b: BizRow): CalendarSettings {
  const p = b.profile as Profile;
  return { market: p?.brand?.markets?.[0] || 'United States', language: p?.brand?.language || 'English (US)', start: addDays(bizToday(b), 1), cadence: 'daily', perWeek: 3, ...(b.calendarSettings || {}) };
}
/** Blog platforms this deployment can actually connect: credential-based ones always; OAuth ones only when their app is configured. */
export function availablePlatforms(): string[] {
  if (env.devStubs) return ['wordpress', 'ghost', 'webhook', 'framer', 'webflow', 'notion', 'wix', 'shopify', 'wpcom', 'nextjs'];
  const oauth: Record<string, boolean> = { webflow: !!env.webflowClientId, notion: !!env.notionClientId, wix: !!env.wixClientId, shopify: !!env.shopifyClientId, wpcom: !!env.wpcomClientId, nextjs: !!env.githubClientId };
  return ['wordpress', 'ghost', 'webhook', 'framer', ...Object.keys(oauth).filter(k => oauth[k])];
}

export function blogOf(b: BizRow, conns: ConnectionPublic[]): BlogState {
  const bl = b.blog || {};
  const def = bl.defaultId && conns.find(c => c.id === bl.defaultId) ? bl.defaultId : conns[0]?.id || null;
  return { conns, defaultId: def, mode: bl.mode || 'review', autopilotAckAt: bl.autopilotAckAt || null, paused: !!bl.paused, tz: b.timezone, time: bl.time || '09:00', available: availablePlatforms() };
}
export function socialAutoOf(b: BizRow): SocialAuto {
  return { on: true, freq: 'daily', days: ['Mon', 'Wed', 'Fri'], platforms: ['linkedin', 'x'], style: 'branded', time: '08:00', post: 'library', ...(b.socialAuto || {}) };
}
export function briefSettingsOf(b: BizRow) { return { ...BRIEF_DEFAULT, ...(b.briefSettings || {}) }; }
/** Model choices only: writing instructions share the `ai` column but are projected separately (Workspace.instructions). */
export function aiPrefsOf(b: BizRow) { return { writing: b.ai?.writing || AI_DEFAULT.writing, research: b.ai?.research || AI_DEFAULT.research }; }
export function defaultProfile(domain: string): Profile {
  return { domain, business: { name: '', description: '', offerings: [], industry: '', positioning: '', differentiators: [] }, audience: { segments: [], buyers: [], needs: [], competitors: [] }, keywords: { list: [] }, brand: { logo: null, primary: '#17181C', secondary: '#EF6A2E', voice: '', language: 'English (US)', markets: ['United States'] } };
}

export function entryFromRow(r: typeof schema.calendarEntries.$inferSelect): CalendarEntry {
  return { id: r.id, title: r.title, kw: r.kw, type: r.type as any, vol: r.vol, kd: r.kd, date: String(r.date), mode: r.mode, url: r.url, measured: r.measured || null, audience: r.audience, relevance: r.relevance, dest: r.dest, status: r.status as any, publishError: r.publishError || null, publishedUrl: r.publishedUrl };
}
/** Webhook signing secret display form "whsec_7Kq2…f91A" (publishing area). The full secret never reaches the client. */
function webhookSecretHint(enc: string): string { try { const s = decrypt<string>(enc) || ''; return s.length > 16 ? `whsec_${s.slice(6, 10)}…${s.slice(-4)}` : 'whsec_…'; } catch { return 'whsec_…'; } }
export function connPublic(r: typeof schema.connections.$inferSelect): ConnectionPublic {
  return { id: r.id, type: r.type as any, url: r.url, target: r.target, targetId: r.targetId, f: r.fields || {}, secretHint: r.secretEnc ? webhookSecretHint(r.secretEnc) : null, status: r.status, lastError: r.lastError };
}
export function proposalFromRow(r: typeof schema.proposals.$inferSelect): Proposal {
  return { ...(r.data || {}), id: r.id, direction: r.direction, partnerBusinessId: r.partnerBusinessId, decision: r.decision || null, note: r.note };
}
export function liveFromRow(r: typeof schema.liveLinks.$inferSelect): LiveLink {
  return { id: r.id, from: r.fromUrl, to: r.toUrl, anchor: r.anchor, rel: r.rel, since: String(r.since), status: r.status, lastCheckedAt: r.lastCheckedAt ? r.lastCheckedAt.toISOString() : null };
}

/** A job's progress as the workspace carries it. A draft streams its text through `blocks` and `partial`; once the job
 *  has finished the article holds that text (loaded on demand), so the copy is dropped and a batch of drafts adds nothing. */
export function jobProgress(j: { kind: string; status: string; progress: unknown }): any {
  if (j.kind !== 'article.draft' || (j.status !== 'done' && j.status !== 'failed') || !j.progress || typeof j.progress !== 'object') return j.progress;
  const { blocks: _b, partial: _p, ...rest } = j.progress as Record<string, unknown>;
  return rest;
}
export async function loadWorkspace(bid: string, userId: string, role: Role, opts: { articles?: ArticlesMode } = {}): Promise<Workspace> {
  const b = await getBiz(bid);
  const today = bizToday(b);
  const [entries, articles, conns, packs, days, gscRow, props, live, team, jobRows, suggs, firstRun, billing, unread, failed] = await Promise.all([
    db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.businessId, bid)).orderBy(schema.calendarEntries.date, schema.calendarEntries.createdAt),
    articlesOf(bid, opts.articles || 'summary'),
    db.select().from(schema.connections).where(eq(schema.connections.businessId, bid)).orderBy(schema.connections.createdAt),
    db.select().from(schema.socialPacks).where(eq(schema.socialPacks.businessId, bid)).orderBy(desc(schema.socialPacks.createdAt)),
    db.select().from(schema.briefDays).where(and(eq(schema.briefDays.businessId, bid), gte(schema.briefDays.date, addDays(today, -30)))).orderBy(schema.briefDays.date),
    db.select().from(schema.gscConnections).where(eq(schema.gscConnections.businessId, bid)).limit(1),
    db.select().from(schema.proposals).where(eq(schema.proposals.businessId, bid)).orderBy(desc(schema.proposals.createdAt)),
    db.select().from(schema.liveLinks).where(eq(schema.liveLinks.businessId, bid)).orderBy(desc(schema.liveLinks.since)),
    db.select({ m: schema.members, name: schema.users.name }).from(schema.members).leftJoin(schema.users, eq(schema.users.id, schema.members.userId)).where(eq(schema.members.businessId, bid)).orderBy(schema.members.createdAt),
    db.select().from(schema.jobs).where(and(eq(schema.jobs.businessId, bid), or(inArray(schema.jobs.status, ['queued', 'running']), gte(schema.jobs.finishedAt, new Date(Date.now() - 120000))))).orderBy(desc(schema.jobs.createdAt)).limit(30),
    db.select().from(schema.suggestions).where(and(eq(schema.suggestions.businessId, bid), eq(schema.suggestions.state, 'open'))),
    firstRunOf(b), billingNoticeOf(b, userId), activityUnread(bid, userId), failedJobsOf(bid),
  ]);
  const g = gscRow[0];
  const gsc: GscState = g ? { status: g.status, property: g.property, progress: g.progress, lastSyncedThrough: g.lastSyncedThrough ? String(g.lastSyncedThrough) : null, error: g.error } : { status: 'none', property: null, progress: 0, lastSyncedThrough: null, error: null };
  const connsPub = conns.map(connPublic);
  const publishing = await socialOn(b);
  const proj = publishing ? await socialProjection(bid) : null;
  const briefDaysMap: Record<string, BriefDay> = {};
  const extra = proj ? await extraBriefDays(bid, proj, Object.fromEntries(days.map(d => [String(d.date), true as any]))) : [];
  for (const d of [...extra, ...days].sort((x, y) => (String(x.date) < String(y.date) ? -1 : 1))) {
    const date = String(d.date);
    const past = date < today;
    briefDaysMap[date] = { date, scannedAt: d.scannedAt, stats: (d.stats || {}) as BriefDay['stats'], items: (d.items || []).map((i: any) => (past && (i.st === 'open' || i.st === 'copied') ? { ...i, st: 'expired' } : i)) };
  }
  // A timed-out worker cannot commit image state. Recover from the exact persisted job even after
  // it has aged out of the recent-jobs feed, preserving the previous assets and retry direction.
  const imageJobIds = [...new Set(Object.values(briefDaysMap).flatMap(d => d.items.flatMap(i => i.img?.status === 'generating' && i.img.jobId ? [i.img.jobId] : [])))];
  if (imageJobIds.length) {
    const imageJobs = await db.select({ id: schema.jobs.id, status: schema.jobs.status, error: schema.jobs.error }).from(schema.jobs)
      .where(and(eq(schema.jobs.businessId, bid), eq(schema.jobs.kind, 'brief.visuals'), inArray(schema.jobs.id, imageJobIds)));
    const byId = new Map(imageJobs.map(j => [j.id, j]));
    for (const day of Object.values(briefDaysMap)) day.items = day.items.map(item => {
      const img = item.img;
      if (img?.status !== 'generating' || !img.jobId) return item;
      const job = byId.get(img.jobId);
      if (job && (job.status === 'queued' || job.status === 'running')) return item;
      return { ...item, img: { ...img, status: 'failed', error: job?.error || 'Radar couldn’t finish generating these images. Try again.' } };
    });
  }
  const brief: BriefState = { setup: b.briefSetup, settings: briefSettingsOf(b) as any, days: briefDaysMap };
  const proposals = props.map(proposalFromRow);
  const backlinks: BacklinksState = { joined: !!(b.backlinks || {}).joined, prefs: (b.backlinks || {}).prefs || {}, inbound: proposals.filter(p => p.direction === 'in'), outbound: proposals.filter(p => p.direction === 'out'), live: live.map(liveFromRow) };
  const socialPacks = packs.map(p => ({ ...(p.data as SocialPack), id: p.id }));
  const auto = socialAutoOf(b);
  if (proj) applySocial(socialPacks, briefDaysMap, proj); else stripSocial(socialPacks, briefDaysMap, auto);
  const calEntries = entries.map(entryFromRow);
  const todayBrief = briefDaysMap[today];
  const kwl = ((b.profile as Profile)?.keywords?.list || []).map(k => k.kw);
  const measured = gsc.status === 'connected' || gsc.status === 'error' ? await kwMeasured(bid, kwl) : {};
  const members: Member[] = team.map(({ m, name }) => ({ id: m.id, userId: m.userId, name: name || null, email: m.email, role: m.role, status: m.status, you: m.userId === userId }));
  const jobs: JobSummary[] = jobRows.map(j => ({ id: j.id, kind: j.kind, status: j.status, progress: jobProgress(j), error: j.error, createdAt: j.createdAt.toISOString(), ref: j.ref }));
  return {
    id: b.id, rev: b.rev, role, status: b.status, today, tz: b.timezone, ...(proj ? { now: new Date().toISOString() } : {}),
    autopilot: autopilotPublic(b),
    profile: { ...(b.profile as Profile), domain: b.domain }, edited: b.edited || {},
    gsc,
    calendar: { entries: calEntries, settings: calendarSettingsOf(b), generatedAt: b.calendarGeneratedAt ? b.calendarGeneratedAt.toISOString() : null },
    articles,
    blog: blogOf(b, connsPub),
    social: { packs: socialPacks, auto, img: b.socialImg ? imageSettingsOf(b.socialImg) : null, ...(proj ? { publishing: true, accounts: proj.accounts, channels: proj.channels } : {}) },
    brief, backlinks, ai: aiPrefsOf(b), instructions: readInstructions(b.ai), team: members,
    site: { pages: b.site?.pages ?? null, articles: b.site?.articles ?? null, ranking: b.site?.ranking ?? null, analyzedAt: b.site?.analyzedAt ?? null },
    jobs, measured, kwSuggestions: (b.kwSuggestions || []) as any,
    counts: {
      briefOpen: todayBrief ? todayBrief.items.filter(i => i.st === 'open' || i.st === 'copied').length : 0,
      review: calEntries.filter(e => e.status === 'review').length,
      backlinksPending: backlinks.joined ? backlinks.inbound.filter(p => !p.decision).length : 0,
      highSuggestions: suggs.filter(s => (s.data as any)?.prio === 'High').length,
      activityUnread: unread,
    },
    onboarding: b.onboarding || {},
    ...(firstRun ? { firstRun } : {}), ...(billing ? { billing } : {}), failed,
  };
}
