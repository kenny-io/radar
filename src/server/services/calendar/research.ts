// Content Calendar research pipeline (02-system.md §6). Every count and every relevance reason comes from real data:
// the Business Profile, keyword-provider estimates, Search Console rows and the site crawl.
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ai, profileContext } from '../../ai';
import { estimate, related } from '../keywords/provider';
import { normKw, topPages, topQueries } from '../gsc/metrics';
import { ENTRY_TYPES } from '@/lib/constants';
import { fmtN } from '@/lib/format';
import type { EntryType, Measured, Profile } from '@/lib/types';
import './stubs';

export interface Candidate {
  kw: string; vol: number | null; kd: number | null;
  src: 'target' | 'related' | 'gsc' | 'refresh'; seed: string | null; priority: boolean;
  measured: Measured | null; mode: 'new' | 'refresh'; url: string | null; pageTitle: string | null;
  score: number; facts: string[];
}
export interface Topic extends Candidate { title: string; type: EntryType; audience: string; relevance: string; outline: string[] }

const STOP = new Set('a an and are as at be by for from how i in is it of on or our the to vs what when why with you your my do does can best new get'.split(' '));
export const tokens = (s: string) => normKw(s).split(' ').filter(w => w.length > 2 && !STOP.has(w)).map(w => w.replace(/(ing|es|s)$/, ''));
const overlap = (a: string[], b: Set<string>) => a.filter(t => b.has(t)).length;

export const gscHasData = (status: string) => status === 'connected' || status === 'error' || status === 'syncing';

/* ── Phase helpers ── */
export async function existingArticles(bid: string): Promise<{ count: number | null; titles: { title: string; url: string }[] }> {
  const rows = await db.select({ title: schema.crawlPages.title, url: schema.crawlPages.url }).from(schema.crawlPages).where(and(eq(schema.crawlPages.businessId, bid), eq(schema.crawlPages.kind, 'article')));
  return { count: rows.length || null, titles: rows };
}

export async function gscQueryStats(bid: string): Promise<{ queries: number; months: number }> {
  const r = await db.execute(sql`select count(distinct key)::int as n, count(distinct date_trunc('month', date))::int as m from gsc_rows where business_id = ${bid} and kind = 'query'`);
  const row: any = (r as any).rows?.[0] || {};
  return { queries: Number(row.n || 0), months: Math.min(16, Number(row.m || 0)) };
}

/** Pages at positions 8–20 with high impressions or low CTR → refresh candidates (with url + measured). */
export async function refreshCandidates(bid: string, max = 5): Promise<Candidate[]> {
  const pages = (await topPages(bid, 28, 500)).filter(p => p.pos >= 8 && p.pos <= 20 && p.impr > 0);
  if (!pages.length) return [];
  const sorted = [...pages].map(p => p.impr).sort((a, b) => a - b);
  const p75 = sorted[Math.floor(sorted.length * 0.75)] || 0;
  const expectedCtr = (pos: number) => (pos <= 10 ? 0.025 : 0.01);
  const picks = pages.filter(p => p.impr >= Math.max(100, p75) || p.ctr < expectedCtr(p.pos) * 0.6).sort((a, b) => b.impr - a.impr).slice(0, max);
  if (!picks.length) return [];
  const qs = (await topQueries(bid, 28, 5000)).filter(q => q.pos >= 5 && q.pos <= 25);
  return picks.map(p => {
    const pt = new Set(tokens(p.path.replace(/[/-]/g, ' ') + ' ' + p.title));
    let best: (typeof qs)[number] | null = null; let bestScore = 0;
    for (const q of qs) { const o = overlap(tokens(q.q), pt); if (!o) continue; const s = o * Math.log10(q.impr + 10); if (s > bestScore) { best = q; bestScore = s; } }
    const kw = best ? best.q : normKw(p.title || p.path.replace(/[/-]/g, ' ')).split(' ').slice(0, 5).join(' ');
    const pos = Math.round(p.pos * 10) / 10; const ctrPct = Math.round(p.ctr * 1000) / 10;
    const facts = [
      `Your page ${p.path} averages position ${pos} in Search Console over the last 28 days`,
      `${fmtN(p.impr)} impressions and ${fmtN(p.clicks)} clicks (${ctrPct}% CTR) in the last 28 days`,
      ...(pos > 10 ? ['It sits on page 2 of search results'] : ['It sits near the bottom of page 1']),
    ];
    return { kw, vol: null, kd: null, src: 'refresh', seed: null, priority: false, measured: { impr: p.impr, clicks: p.clicks, pos }, mode: 'refresh', url: p.path, pageTitle: p.title && p.title !== p.path ? p.title : null, score: 0, facts } satisfies Candidate;
  });
}

/** Expand the target keywords (provider related/questions) + Search Console queries into scored candidates. */
export async function researchCandidates(bid: string, profile: Profile, market: string, language: string, gsc: boolean): Promise<Candidate[]> {
  const kl = profile.keywords?.list || [];
  const seeds = [...kl].sort((a, b) => Number(b.priority) - Number(a.priority)).slice(0, 10);
  const map = new Map<string, Candidate>();
  const add = (c: Omit<Candidate, 'score' | 'facts'> & { facts?: string[] }) => {
    const k = normKw(c.kw); if (!k || k.length < 3) return;
    const prev = map.get(k);
    if (prev) { prev.priority ||= c.priority; if (c.measured && !prev.measured) prev.measured = c.measured; if (prev.vol == null) prev.vol = c.vol; if (prev.kd == null) prev.kd = c.kd; return; }
    map.set(k, { ...c, kw: k, score: 0, facts: c.facts || [] });
  };
  for (const s of seeds) add({ kw: s.kw, vol: s.vol, kd: s.kd, src: 'target', seed: s.kw, priority: s.priority, measured: null, mode: 'new', url: null, pageTitle: null });
  const rel = await Promise.all(seeds.map(s => related(s.kw, market, language, 25).then(r => r.map(x => ({ x, s })))));
  for (const { x, s } of rel.flat()) add({ kw: x.kw, vol: x.vol, kd: x.kd, src: 'related', seed: s.kw, priority: s.priority, measured: null, mode: 'new', url: null, pageTitle: null });
  // Questions and phrasings customers search for, from the profile's needs and offerings. Kept only when the
  // keyword provider has search volume for them (validated below), so nothing rests on the model's guess.
  const ideas = await ideaKeywords(bid, profile, market, language).catch(() => [] as string[]);
  const ideaEst = ideas.length ? await estimate(ideas, market, language) : {};
  for (const kw of ideas) { const e = ideaEst[normKw(kw)] || ideaEst[kw.toLowerCase()]; if (e && e.vol) add({ kw, vol: e.vol, kd: e.kd, src: 'related', seed: null, priority: false, measured: null, mode: 'new', url: null, pageTitle: null }); }
  if (gsc) {
    const brand = tokens(profile.business.name + ' ' + profile.domain.split('.')[0]);
    for (const q of (await topQueries(bid, 28, 400))) {
      if (brand.some(b => tokens(q.q).includes(b))) continue; // branded queries aren't article topics
      if (q.impr < 20) continue;
      add({ kw: q.q, vol: null, kd: null, src: 'gsc', seed: null, priority: false, measured: { impr: q.impr, clicks: q.clicks, pos: Math.round(q.pos * 10) / 10 }, mode: 'new', url: null, pageTitle: null });
    }
  }
  const list = [...map.values()];
  // Fill missing estimates from the provider (cached).
  const missing = list.filter(c => c.vol == null || c.kd == null).map(c => c.kw);
  if (missing.length) {
    const est = await estimate(missing, market, language);
    for (const c of list) { const e = est[c.kw]; if (e) { if (c.vol == null) c.vol = e.vol; if (c.kd == null) c.kd = e.kd; } }
  }
  // Measured rows for every candidate keyword (query-level, last 28 days).
  if (gsc) {
    const qs = await topQueries(bid, 28, 5000); const qm = new Map(qs.map(q => [normKw(q.q), q]));
    for (const c of list) if (!c.measured) { const q = qm.get(c.kw); if (q) c.measured = { impr: q.impr, clicks: q.clicks, pos: Math.round(q.pos * 10) / 10 }; }
  }
  const prio = new Set(kl.filter(k => k.priority).map(k => normKw(k.kw)));
  const targets = new Set(kl.map(k => normKw(k.kw)));
  const needs = profile.audience.needs.map(n => ({ n, t: new Set(tokens(n)) }));
  const offers = profile.business.offerings.map(n => ({ n, t: new Set(tokens(n)) }));
  for (const c of list) {
    const f: string[] = [];
    if (c.measured) f.push(`Search Console shows ${fmtN(c.measured.impr)} impressions at average position ${c.measured.pos} for this query in the last 28 days`);
    if (targets.has(c.kw)) f.push(`“${c.kw}” is on the keyword list in your Business Profile${prio.has(c.kw) ? ' and marked as a priority' : ''}`);
    else if (c.seed) f.push(`Related to “${c.seed}”, ${prio.has(normKw(c.seed)) ? 'one of your priority keywords' : 'a keyword on your list'}`);
    const ct = tokens(c.kw);
    const need = needs.map(x => ({ ...x, o: overlap(ct, x.t) })).sort((a, b) => b.o - a.o)[0];
    if (need && need.o > 0) f.push(`Matches a stated buyer need in your Business Profile: “${need.n}”`);
    const off = offers.map(x => ({ ...x, o: overlap(ct, x.t) })).sort((a, b) => b.o - a.o)[0];
    if (off && off.o > 0) f.push(`Ties to “${off.n}”, one of your offerings`);
    c.facts = f;
    const vol = c.vol ?? (c.measured ? c.measured.impr : 40);
    c.score = Math.sqrt(Math.max(10, vol)) * (1 - Math.min(95, c.kd ?? 30) / 120) * (c.priority ? 1.6 : 1) * (c.measured ? 1.25 : 1) * (need && need.o > 0 ? 1.1 : 1);
  }
  return list.sort((a, b) => b.score - a.score);
}

const IdeasOut = z.object({ keywords: z.array(z.string()) });
async function ideaKeywords(bid: string, profile: Profile, market: string, language: string): Promise<string[]> {
  const out = await ai.run('writing', {
    purpose: 'calendar.ideas', schemaName: 'keywords', schema: IdeasOut, maxTokens: 1500, temperature: 0.3,
    system: 'You are Radar, an SEO researcher. Return search phrases real customers type, lowercase, 2–6 words.',
    prompt: `${profileContext(profile)}\n\nMarket: ${market}. Language: ${language}.\nList 30 search phrases (questions and how-to/comparison/template searches) that this business’s audience types when they have the needs listed in the profile. No brand names, no competitor names.`,
    stubContext: { profile },
  }, { businessId: bid });
  return [...new Set((out.json?.keywords || []).map(k => normKw(k)).filter(k => k.split(' ').length >= 2 && k.length <= 60))].slice(0, 40);
}

/** The keyword difficulty this domain can realistically win: what it already ranks for (GSC) or its target list, plus headroom. */
export async function difficultyCeiling(bid: string, profile: Profile, market: string, language: string, gsc: boolean): Promise<number> {
  let base: number | null = null;
  if (gsc) {
    const top = (await topQueries(bid, 28, 200)).filter(q => q.pos <= 10).slice(0, 25).map(q => q.q);
    if (top.length) { const est = await estimate(top, market, language); const kds = Object.values(est).map(e => e.kd).filter((x): x is number => x != null); if (kds.length) base = Math.max(...kds); }
  }
  if (base == null) {
    const kds = (profile.keywords?.list || []).map(k => k.kd).filter((x): x is number => x != null).sort((a, b) => a - b);
    if (kds.length) base = kds[Math.floor(kds.length / 2)];
  }
  return Math.max(30, Math.min(75, (base ?? 35) + 15));
}

/* ── LLM: cluster + off-topic (phase 6) ── */
const ClusterOut = z.object({ offTopic: z.array(z.number().int()), duplicates: z.array(z.object({ keep: z.number().int(), drop: z.array(z.number().int()) })) });
export async function clusterCandidates(bid: string, profile: Profile, cands: Candidate[], existing: string[], kept: string[]): Promise<{ keep: Candidate[]; offTopic: number }> {
  if (!cands.length) return { keep: [], offTopic: 0 };
  const lines = cands.map((c, i) => `${i}. ${c.kw}${c.vol != null ? ` (~${c.vol}/mo)` : ''}`).join('\n');
  const out = await ai.run('writing', {
    purpose: 'calendar.cluster', schemaName: 'clusters', schema: ClusterOut, maxTokens: 3000, temperature: 0,
    system: 'You are Radar, a careful SEO content strategist. You only use the data you are given.',
    prompt: `${profileContext(profile)}\n\nCANDIDATE KEYWORDS (index. keyword):\n${lines}\n\nEXISTING ARTICLES ON THE SITE:\n${existing.slice(0, 80).map(t => '- ' + t).join('\n') || '- none'}\n\nALREADY IN THE CALENDAR:\n${kept.map(t => '- ' + t).join('\n') || '- none'}\n\nTasks:\n1. offTopic: indexes of keywords that are off-topic for this business and its audience (the business could not credibly write about them, or the searcher is not a potential customer), or that promote a competitor's brand rather than comparing honestly.\n2. duplicates: groups of keywords with the same search intent that one article would cover (keep the best one; drop the rest). Also drop keywords already covered by an existing article or already in the calendar (use keep = -1 for those).\nReturn only indexes from the list.`,
    stubContext: { cands, profile, existing, kept },
  }, { businessId: bid });
  const j = out.json!;
  const off = new Set(j.offTopic.filter(i => i >= 0 && i < cands.length));
  const drop = new Set<number>();
  for (const d of j.duplicates) for (const i of d.drop) if (i >= 0 && i < cands.length && i !== d.keep) drop.add(i);
  return { keep: cands.filter((_, i) => !off.has(i) && !drop.has(i)), offTopic: off.size };
}

/* ── LLM: titles, type, audience, relevance, outline (phase 7) ── */
const TopicOut = z.object({ topics: z.array(z.object({ i: z.number().int(), title: z.string().min(4), type: z.enum(ENTRY_TYPES), audience: z.string().min(4), relevance: z.string().min(8), outline: z.array(z.string()).min(2).max(6) })) });
const numsIn = (s: string) => (s.match(/\d[\d,.]*/g) || []).map(x => x.replace(/[,.]+$/, '').replace(/,/g, ''));

export function fallbackRelevance(c: Candidate): string {
  if (c.mode === 'refresh') return c.measured && c.measured.pos > 10 ? 'You already rank on page 2 for this. A refresh is the fastest path to page 1.' : 'You already rank for this, but few searchers click. A refresh is the fastest way to earn more of them.';
  const f = c.facts[0];
  if (!f) return 'Expands on the keywords in your Business Profile.';
  return f.replace(/^Search Console shows/, 'Search Console already shows') + '.';
}

export async function writeTopics(bid: string, profile: Profile, cands: Candidate[], existing: string[]): Promise<Topic[]> {
  if (!cands.length) return [];
  const lines = cands.map((c, i) => `${i}. keyword: ${c.kw}${c.mode === 'refresh' ? ` · REFRESH of existing page ${c.url}${c.pageTitle ? ` (“${c.pageTitle}”)` : ''}` : ''}\n   facts: ${c.facts.length ? c.facts.join(' | ') : 'none beyond the profile'}`).join('\n');
  const out = await ai.run('writing', {
    purpose: 'calendar.topics', schemaName: 'topics', schema: TopicOut, maxTokens: 8000, temperature: 0.4,
    system: 'You are Radar, an SEO content strategist writing for a small business. Write in the business’s language and voice. Never invent facts, numbers, customers or results.',
    prompt: `${profileContext(profile)}\n\nEXISTING ARTICLES (don’t duplicate):\n${existing.slice(0, 60).map(t => '- ' + t).join('\n') || '- none'}\n\nPlan one article per keyword below. For each return:\n- title: a specific, useful headline (max 70 characters). For a REFRESH keep the existing page’s subject.\n- type: one of ${ENTRY_TYPES.join(', ')}\n- audience: one short line naming who it’s for, using the profile’s audience segments\n- relevance: ONE sentence explaining why this topic is worth writing, citing the strongest fact given for it. Use only the facts listed; if you use a number it must appear in the facts. Never claim anything not in the facts or the profile.\n- outline: 3–5 section headings\n\nKEYWORDS:\n${lines}`,
    stubContext: { cands, profile },
  }, { businessId: bid });
  const by = new Map(out.json!.topics.map(t => [t.i, t]));
  return cands.map((c, i) => {
    const t = by.get(i);
    const allowed = new Set(c.facts.flatMap(numsIn));
    let relevance = t?.relevance?.trim() || '';
    if (!relevance || numsIn(relevance).some(n => !allowed.has(n))) relevance = fallbackRelevance(c);
    return { ...c, title: (t?.title || c.pageTitle || c.kw).trim().slice(0, 90), type: (t?.type || 'Guide') as EntryType, audience: t?.audience?.trim() || profile.audience.segments[0] || '', relevance, outline: t?.outline?.length ? t.outline.slice(0, 6) : [] };
  });
}
