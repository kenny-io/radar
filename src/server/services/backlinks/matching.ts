// Partner matching (02-system.md §13): among businesses that joined the network, find partners with overlapping topics or
// audience that aren't competitors, then find a real sentence on the host's page where a link to the other business genuinely
// helps the reader. The LLM drafts before/anchor/after (no exact-match commercial anchors) and a one-line fit rationale.
import { z } from 'zod';
import { and, desc, eq, gte, isNotNull, or } from 'drizzle-orm';
import { db, schema } from '../../db';
import { env } from '../../env';
import ai, { profileContext } from '../../ai';
import { registerStub } from '../../ai/adapters/stub';
import { todayIn } from '@/lib/format';
import type { Block, Profile } from '@/lib/types';
import { authorityOf } from './authority';
import { absUrl, competitorsBlocked, displayUrl, hostOf, languageOf, metaOf, monthKey, networkBusinesses, pathOf, prefsOf, relFor, relevance, tokens, tokenSet, overlap, type BizRow } from './network';
import { scheduleDecisionNotice } from './decisions';
import { ensureSyntheticPartners, seedStubLiveLinks, stubHostPages, stubTargetPages } from './stub';

export interface HostPage { url: string; title: string; text: string; links: string[] }
export interface TargetPage { url: string; title: string; about: string }
interface Candidate { page: HostPage; sentence: string; prev: string; target: TargetPage; score: number }

const RECENT_PARTNER_DAYS = 60;

/* ── content sources ── */
function blocksText(body: Block[] = []): string {
  return body.map(b => (b[0] === 'ul' ? (b[1] as string[]).map(x => x.replace(/[.!?]?$/, '.')).join(' ') : b[0] === 'p' ? String(b[1]) : '')).filter(Boolean).join(' ');
}
async function hostPagesOf(b: BizRow): Promise<HostPage[]> {
  const crawl = await db.select().from(schema.crawlPages).where(eq(schema.crawlPages.businessId, b.id)).orderBy(desc(schema.crawlPages.kind)).limit(60);
  const pages: HostPage[] = crawl.filter(p => p.text.length > 120).sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'article' ? -1 : 1))
    .map(p => ({ url: displayUrl(p.url), title: p.title || p.h1, text: p.text, links: p.links || [] }));
  // Articles Radar published (their live URL) — the next publish can carry an approved outbound link.
  const pub = await db.select({ e: schema.calendarEntries, a: schema.articles }).from(schema.calendarEntries)
    .innerJoin(schema.articles, eq(schema.articles.entryId, schema.calendarEntries.id))
    .where(and(eq(schema.calendarEntries.businessId, b.id), or(isNotNull(schema.calendarEntries.publishedUrl), isNotNull(schema.calendarEntries.url))));
  for (const { e, a } of pub) {
    const url = displayUrl(e.publishedUrl || e.url || '');
    if (!url || pages.some(p => p.url === url)) continue;
    pages.push({ url, title: e.title, text: blocksText((a.data as any)?.body), links: [] });
  }
  if (!pages.length && env.devStubs && !metaOf(b).synthetic) return stubHostPages(b);
  return pages;
}
async function targetPagesOf(b: BizRow): Promise<TargetPage[]> {
  const p = b.profile as Profile;
  const crawl = await db.select({ url: schema.crawlPages.url, title: schema.crawlPages.title, h1: schema.crawlPages.h1, description: schema.crawlPages.description }).from(schema.crawlPages).where(eq(schema.crawlPages.businessId, b.id)).limit(200);
  const out: TargetPage[] = crawl.map(c => ({ url: displayUrl(c.url), title: c.title || c.h1, about: [c.h1, c.description].filter(Boolean).join(' — ') }));
  const pub = await db.select({ title: schema.calendarEntries.title, url: schema.calendarEntries.publishedUrl, kw: schema.calendarEntries.kw }).from(schema.calendarEntries).where(and(eq(schema.calendarEntries.businessId, b.id), isNotNull(schema.calendarEntries.publishedUrl)));
  for (const e of pub) if (e.url && !out.some(o => o.url === displayUrl(e.url!))) out.push({ url: displayUrl(e.url), title: e.title, about: e.kw });
  if (!out.some(o => o.url === b.domain)) out.push({ url: b.domain, title: p?.business?.name || b.domain, about: [p?.business?.description, ...(p?.business?.offerings || [])].filter(Boolean).join(' · ') });
  if (env.devStubs && out.length < 3) out.push(...stubTargetPages(b).filter(s => !out.some(o => o.url === s.url)));
  return out;
}

export function splitSentences(text: string): string[] {
  return text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z“"‘'(])/).map(s => s.trim()).filter(Boolean);
}

/** Rank (host sentence → target page) pairs by topical overlap. */
export function candidates(host: HostPage[], targets: TargetPage[], targetDomain: string, minScore: number): Candidate[] {
  const tt = targets.map(t => ({ t, set: tokenSet([t.title, t.about, pathOf(t.url).replace(/[/-]+/g, ' ')]) }));
  const out: Candidate[] = [];
  for (const page of host) {
    if (page.links.some(l => hostOf(l) === targetDomain)) continue; // already links to them
    const ss = splitSentences(page.text);
    ss.forEach((s, i) => {
      if (s.length < 40 || s.length > 300 || /https?:|www\.|@/.test(s)) return;
      const st = new Set(tokens(s));
      let best: { t: TargetPage; n: number } | null = null;
      for (const { t, set } of tt) { const n = overlap(st, set); if (!best || n > best.n) best = { t, n }; }
      if (best && best.n >= minScore) out.push({ page, sentence: s, prev: i > 0 && ss[i - 1].length < 200 ? ss[i - 1] : '', target: best.t, score: best.n });
    });
  }
  const seen = new Set<string>();
  return out.sort((a, b) => b.score - a.score).filter(c => (seen.has(c.sentence) ? false : (seen.add(c.sentence), true))).slice(0, 6);
}

/* ── LLM drafting ── */
const PlacementOut = z.object({
  ok: z.boolean(),
  candidate: z.number().int(),
  before: z.string(), anchor: z.string(), after: z.string(),
  fitForTarget: z.string(), fitForHost: z.string(),
});
type Placement = z.infer<typeof PlacementOut>;

const SYSTEM = `You place links for an honest partner network between small businesses. A link is only proposed where it genuinely helps the reader of the host page.
Rules:
- Choose at most one candidate sentence. If none of them would genuinely help a reader by linking to the target page, return ok=false.
- Keep the host's sentence: same meaning, nearly all of its words. You may change a few words so the anchor reads naturally.
- before + anchor + after must read as the full sentence. "before" ends with a space if a word follows; "after" starts with a space or punctuation.
- The anchor is 2–6 descriptive words a human editor would choose. Never use an exact-match commercial keyword as the anchor (e.g. "best time tracking software"), never a bare brand name, never "click here".
- Never place a link between competitors.
- fitForTarget: one short line (max 90 characters) telling the TARGET business why the host is a good fit (shared audience, complementary, not a competitor).
- fitForHost: one short line (max 90 characters) telling the HOST why the target's page helps its readers.`;

function exactCommercial(anchor: string, target: BizRow): boolean {
  const a = anchor.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const kws = ((target.profile as Profile)?.keywords?.list || []).filter(k => k.intent === 'Commercial').map(k => k.kw.toLowerCase().trim());
  return kws.includes(a) || /^(best|top|cheap|buy)\b/.test(a) || /\bclick here\b/.test(a);
}
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
function similar(a: string, b: string): number { const A = new Set(words(a)), B = new Set(words(b)); let n = 0; for (const x of A) if (B.has(x)) n++; return n / Math.max(1, Math.max(A.size, B.size)); }

async function draftPlacement(host: BizRow, target: BizRow, forBid: string): Promise<(Placement & { c: Candidate }) | null> {
  const [hp, tp] = await Promise.all([hostPagesOf(host), targetPagesOf(target)]);
  const minScore = env.devStubs && (metaOf(host).synthetic || metaOf(target).synthetic) ? 1 : 2;
  const cands = candidates(hp, tp, target.domain, minScore);
  if (!cands.length) return null;
  const tProf = target.profile as Profile, hProf = host.profile as Profile;
  const prompt = [
    `TARGET (receives the link)\n${profileContext({ ...tProf, domain: target.domain })}`,
    `HOST (its page carries the link): ${hProf?.business?.name} (${host.domain}) — ${hProf?.business?.description}`,
    'CANDIDATES',
    ...cands.map((c, i) => `[${i}] Host page: "${c.page.title}" (${c.page.url})\n    Sentence: ${c.sentence}\n    Link target: "${c.target.title}" (${c.target.url}) — ${c.target.about}`),
  ].join('\n\n');
  let out: Placement | null = null;
  try {
    const r = await ai.run('writing', {
      purpose: 'backlinks.placement', system: SYSTEM, prompt, schema: PlacementOut, schemaName: 'placement', temperature: 0.2, maxTokens: 800,
      stubContext: { cands: cands.map(c => ({ sentence: c.sentence, target: [c.target.title, c.target.about, pathOf(c.target.url)].join(' ') })), commercial: (tProf?.keywords?.list || []).filter(k => k.intent === 'Commercial').map(k => k.kw), host: hProf, target: tProf },
    }, { businessId: forBid, retries: 1 });
    out = r.json;
  } catch { return null; }
  if (!out || !out.ok || out.candidate < 0 || out.candidate >= cands.length) return null;
  const c = cands[out.candidate];
  const anchor = out.anchor.trim();
  const full = `${out.before}${anchor}${out.after}`;
  const nw = words(anchor).length;
  if (!anchor || nw < 1 || nw > 8 || exactCommercial(anchor, target)) return null;
  if (similar(full, c.sentence) < 0.6) return null; // must remain the host's real sentence
  return { ...out, anchor, c };
}

/* ── creating proposals ── */
function disclosureFor(hostHasRadarPublishing: boolean) {
  return hostHasRadarPublishing ? 'Inline disclosure: “Partner link”' : 'Placed through the Radar network, noted on their partner page';
}
async function hasConnection(bid: string) { const r = await db.select({ id: schema.connections.id }).from(schema.connections).where(eq(schema.connections.businessId, bid)).limit(1); return !!r[0]; }

async function createdThisMonth(bid: string, today: string): Promise<number> {
  const rows = await db.select({ data: schema.proposals.data, createdAt: schema.proposals.createdAt }).from(schema.proposals)
    .where(and(eq(schema.proposals.businessId, bid), gte(schema.proposals.createdAt, new Date(Date.now() - 40 * 864e5))));
  const mk = monthKey(today);
  return rows.filter(r => (r.data?.month || '') === mk).length;
}
async function recentlyPaired(bid: string, partnerId: string, direction: 'in' | 'out') {
  const r = await db.select({ id: schema.proposals.id }).from(schema.proposals).where(and(eq(schema.proposals.businessId, bid), eq(schema.proposals.partnerBusinessId, partnerId), eq(schema.proposals.direction, direction), gte(schema.proposals.createdAt, new Date(Date.now() - RECENT_PARTNER_DAYS * 864e5)))).limit(1);
  return !!r[0];
}

/**
 * One placement = a link on HOST's page pointing at TARGET. TARGET gets an inbound proposal ("Links to you");
 * HOST gets the matching outbound request ("Links from you") when it accepts requests (prefs.outbound). Both share a pairId.
 */
async function createPlacement(host: BizRow, target: BizRow, p: Placement & { c: Candidate }): Promise<{ inId: string; outId: string | null }> {
  const pairId = crypto.randomUUID();
  const hProf = host.profile as Profile, tProf = target.profile as Profile;
  const rel = relFor(host, target);
  const disclosure = disclosureFor(await hasConnection(host.id));
  const auth = await authorityOf(host);
  const before = (p.c.prev ? p.c.prev + ' ' : '') + p.before;
  const common = { page: p.c.page.url, pageTitle: p.c.page.title, before, anchor: p.anchor, after: p.after, target: p.c.target.url, rel, disclosure, pairId, sentence: p.c.sentence, edit: { before: p.before, anchor: p.anchor, after: p.after } };
  const tToday = todayIn(target.timezone), hToday = todayIn(host.timezone);
  const tPrefs = prefsOf(target);
  const auto = tPrefs.autoApprove && auth != null && auth >= tPrefs.minAuth; // topic relevance + no competitor are guaranteed by matching
  const now = new Date();
  const [inRow] = await db.insert(schema.proposals).values({
    businessId: target.id, direction: 'in', partnerBusinessId: host.id,
    data: { ...common, partner: hProf?.business?.name || host.domain, domain: host.domain, about: hProf?.business?.description || '', fit: p.fitForTarget.trim().replace(/\.?$/, '.'), auth, month: monthKey(tToday), noticeKey: auto ? now.toISOString() : null },
    decision: auto ? 'auto' : null, decidedAt: auto ? now : null,
  }).returning({ id: schema.proposals.id });
  if (auto) await scheduleDecisionNotice(inRow.id, 'approved', now.toISOString());
  let outId: string | null = null;
  if (prefsOf(host).outbound && !metaOf(host).synthetic) {
    const [o] = await db.insert(schema.proposals).values({
      businessId: host.id, direction: 'out', partnerBusinessId: target.id,
      data: { ...common, partner: tProf?.business?.name || target.domain, domain: target.domain, about: tProf?.business?.description || '', fit: p.fitForHost.trim().replace(/\.?$/, '.'), auth: null, yourPage: pathOf(p.c.page.url), month: monthKey(hToday) },
    }).returning({ id: schema.proposals.id });
    outId = o.id;
  } else if (prefsOf(host).outbound && metaOf(host).synthetic) {
    // Dev stub partners "approve" their side instantly so the full flow can be exercised.
    await db.insert(schema.proposals).values({ businessId: host.id, direction: 'out', partnerBusinessId: target.id, data: { ...common, partner: tProf?.business?.name || target.domain, domain: target.domain, about: '', fit: p.fitForHost, auth: null, yourPage: pathOf(p.c.page.url), month: monthKey(hToday) }, decision: 'approved', decidedAt: now });
  }
  return { inId: inRow.id, outId };
}

/** Run matching for one business. Returns the number of new proposals shown to it (inbound + outbound). */
export async function matchBusiness(bid: string): Promise<{ created: number }> {
  if (env.devStubs) await ensureSyntheticPartners();
  const a = (await db.select().from(schema.businesses).where(eq(schema.businesses.id, bid)).limit(1))[0];
  if (!a || !metaOf(a).joined || a.status !== 'active') return { created: 0 };
  const prefs = prefsOf(a);
  const today = todayIn(a.timezone);
  let remaining = prefs.max - (await createdThisMonth(a.id, today));
  if (env.devStubs) await seedStubLiveLinks(a);
  if (remaining <= 0) return { created: 0 };
  const all = (await networkBusinesses(env.devStubs)).filter(b => b.id !== a.id);
  const ranked = all
    .filter(b => languageOf(b) === languageOf(a) && !competitorsBlocked(a, b))
    .map(b => ({ b, r: relevance(a, b) }))
    .filter(x => x.r.score >= 0.15 || (env.devStubs && metaOf(x.b).synthetic))
    .sort((x, y) => y.r.score - x.r.score);
  let created = 0;
  // Leave room for one outbound request when the user accepts them, then fill with inbound.
  const passes: ('in' | 'out')[] = prefs.outbound ? ['in', 'out', 'in'] : ['in'];
  for (let pass = 0; pass < passes.length; pass++) {
    const dir = passes[pass];
    let budget = dir === 'out' ? Math.min(remaining, 1) : pass === 0 && prefs.outbound ? Math.max(1, remaining - 1) : remaining;
    for (const { b } of ranked) {
      if (budget <= 0 || remaining <= 0) break;
      if (dir === 'in') {
        // Inbound: b's page links to a.
        const bRemaining = metaOf(b).synthetic ? 99 : prefsOf(b).max - (await createdThisMonth(b.id, todayIn(b.timezone)));
        if (bRemaining <= 0 || (await recentlyPaired(a.id, b.id, 'in'))) continue;
        const p = await draftPlacement(b, a, a.id);
        if (p) { await createPlacement(b, a, p); created++; remaining--; budget--; }
      } else {
        // Outbound request: a's article links to b — only when a accepts requests.
        if (await recentlyPaired(a.id, b.id, 'out')) continue;
        const p = await draftPlacement(a, b, a.id);
        if (p) { await createPlacement(a, b, p); created++; remaining--; budget--; }
      }
    }
  }
  return { created };
}

/** Undecided inbound proposals that now meet the auto-approve rules (after Preferences change). */
export async function applyAutoApprove(bid: string) {
  const a = (await db.select().from(schema.businesses).where(eq(schema.businesses.id, bid)).limit(1))[0];
  if (!a) return;
  const pr = prefsOf(a);
  if (!pr.autoApprove) return;
  const rows = await db.select().from(schema.proposals).where(and(eq(schema.proposals.businessId, bid), eq(schema.proposals.direction, 'in')));
  for (const r of rows) {
    if (r.decision || r.data?.placedAt) continue;
    const auth = r.data?.auth;
    if (auth == null || auth < pr.minAuth) continue;
    if (r.partnerBusinessId) {
      const p = (await db.select().from(schema.businesses).where(eq(schema.businesses.id, r.partnerBusinessId)).limit(1))[0];
      if (p && competitorsBlocked(a, p)) continue;
    }
    const now = new Date();
    await db.update(schema.proposals).set({ decision: 'auto', decidedAt: now, data: { ...r.data, noticeKey: now.toISOString() } }).where(eq(schema.proposals.id, r.id));
    await scheduleDecisionNotice(r.id, 'approved', now.toISOString());
  }
}

/* ── dev stub for the LLM step: keeps the host's real sentence and picks the most topical phrase as the anchor ── */
registerStub('backlinks.placement', (_input, ctx: any) => {
  const c = ctx?.cands?.[0];
  if (!c) return { ok: false, candidate: 0, before: '', anchor: '', after: '', fitForTarget: '', fitForHost: '' };
  const ws = c.sentence.split(' ');
  const tset = new Set(tokens(c.target));
  const commercial = new Set((ctx.commercial || []).map((k: string) => k.toLowerCase()));
  let best = { i: 0, j: Math.min(3, ws.length), n: -1 };
  for (let i = 0; i < ws.length; i++) for (let j = i + 2; j <= Math.min(ws.length, i + 6); j++) {
    const n = overlap(new Set(tokens(ws.slice(i, j).join(' '))), tset);
    const len = j - i;
    if (n > best.n || (n === best.n && n > 0 && len < best.j - best.i)) best = { i, j, n };
  }
  let { i, j } = best;
  const clean = (k: number, l: number) => ws.slice(k, l).join(' ').replace(/[.,;:!?]+$/, '').toLowerCase();
  if (commercial.has(clean(i, j)) && i > 0) i = Math.max(0, i - 2);
  const anchorRaw = ws.slice(i, j).join(' ');
  const trail = (anchorRaw.match(/[.,;:!?]+$/) || [''])[0];
  const anchor = anchorRaw.slice(0, anchorRaw.length - trail.length);
  const before = ws.slice(0, i).join(' ') + (i ? ' ' : '');
  const after = trail + (j < ws.length ? ' ' + ws.slice(j).join(' ') : '');
  const seg = String(ctx.target?.audience?.segments?.[0] || 'small business').toLowerCase();
  const tName = ctx.target?.business?.name || 'your business';
  return {
    ok: true, candidate: 0, before, anchor, after,
    fitForTarget: `Writes for the same ${seg.replace(/\s*\(.*\)/, '')} audience; not a competitor`,
    fitForHost: `${tName}’s guide answers the question this sentence raises`,
  };
});

