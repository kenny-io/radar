// Suggest ideas — the deterministic half of prototype analyzeIdeas (02-system.md §8.3 is the spec).
// Numbers, "Why" copy, metric lines and scores come from data here. The LLM only writes angle titles and proposes
// a "Ties to" fact, which ideas.ts verifies before it is shown. Pure module: unit-tested in ideas-core.test.ts.
import { fmtN, lcf, pct } from '@/lib/format';
import type { Keyword, Profile } from '@/lib/types';

export interface QueryIn { q: string; clicks: number; impr: number; ctr: number; pos: number }
export interface PageIn { path: string; title: string; h1?: string; description?: string; impr: number | null }
export interface IdeaInputs { profile: Profile; gscOn: boolean; queries: QueryIn[]; pages: PageIn[]; measured: Record<string, QueryIn | null> }

export interface Candidate {
  id: string; kind: 'query' | 'keyword'; text: string; score: number; why: string; metric: string;
  page: string | null; priority: boolean; kw: Keyword | null;
}
export interface Idea { t: string; metric: string; why: string; tie: string | null; page: string | null; score: number; kind: 'query' | 'keyword'; q: string }

/* ── tokens ── */
const STOP = new Set('a an the and or but of for to in on at by with from as is are was be been do does did how what why when where which who whom your you my our we i it its this that these those vs versus best top free online guide tips can should will would get make 2023 2024 2025 2026 2027 into about than then so if not no near me'.split(' '));
/** Words too generic to count as evidence that a profile fact supports an angle. */
const GENERIC = new Set('work business people thing things way ways help need needs use using more less without easy simple better good great new every each all any team teams small'.split(' '));
export function stem(w: string): string {
  let s = w.toLowerCase();
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}
export function tokens(s: string, { minLen = 2, generic = false }: { minLen?: number; generic?: boolean } = {}): Set<string> {
  const out = new Set<string>();
  for (const w of (s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < minLen || STOP.has(w) || (!generic && GENERIC.has(w))) continue;
    out.add(stem(w));
  }
  return out;
}
export const overlap = (a: Set<string>, b: Set<string>) => [...a].filter(x => b.has(x));

/* ── branded queries ── */
export function brandTerms(p: Profile): string[] {
  const t = new Set<string>();
  const n = (p.business.name || '').toLowerCase().trim();
  if (n.length > 2) { t.add(n); t.add(n.replace(/\s+/g, '')); }
  const label = (p.domain || '').toLowerCase().replace(/^www\./, '').split('.')[0];
  if (label && label.length > 2) t.add(label);
  return [...t];
}
export const isBranded = (q: string, terms: string[]) => { const s = q.toLowerCase(); const flat = s.replace(/\s+/g, ''); return terms.some(t => s.includes(t) || flat.includes(t.replace(/\s+/g, ''))); };

/* ── query / keyword → the user's page ── */
/** The user's page written for `text`: ≥ 2/3 of the text's content words appear in the page's title, H1 or path.
 *  Prefers pages that already rank in Search Console. `rankingOnly` restricts to pages with impressions. */
export function pageFor(text: string, pages: PageIn[], { rankingOnly = false }: { rankingOnly?: boolean } = {}): PageIn | null {
  const q = tokens(text, { generic: true }); if (!q.size) return null;
  let best: { p: PageIn; r: number } | null = null;
  for (const p of pages) {
    if (rankingOnly && !(p.impr && p.impr > 0)) continue;
    const pt = tokens([p.title, p.h1 || '', p.path.replace(/[-_/]+/g, ' ')].join(' '), { generic: true });
    const hit = overlap(q, pt).length; const r = hit / q.size;
    if (!hit || r < 0.66) continue;
    const better = !best || r > best.r + 1e-9 || (Math.abs(r - best.r) < 1e-9 && ((p.impr || 0) > (best.p.impr || 0)));
    if (better) best = { p, r };
  }
  return best ? best.p : null;
}

/* ── A + B: candidates with scores, why and metric lines ── */
export function candidates({ profile: p, gscOn, queries, pages, measured }: IdeaInputs): Candidate[] {
  const kws = p.keywords?.list || [];
  const kwOf = (q: string) => kws.find(k => k.kw === q) || kws.find(k => q.includes(k.kw) || k.kw.includes(q)) || null;
  const out: Candidate[] = []; const brand = brandTerms(p);
  if (gscOn) queries.forEach((q, i) => {
    if (q.pos < 2 || isBranded(q.q, brand)) return;
    const k = kwOf(q.q); const boost = k && k.priority ? 1.6 : 1;
    const pg = pageFor(q.q, pages, { rankingOnly: pages.some(x => x.impr) });
    const expCtr = Math.max(0.02, 0.3 / q.pos); let why: string, score: number;
    if (q.pos > 8) { why = !pg ? 'You rank without a page written for it.' : q.pos > 10 ? 'Just off page one. Shares and links can lift it.' : 'Bottom of page one, where few people scroll.'; score = q.impr * boost / (q.pos - 6); }
    else if (q.ctr < expCtr * 0.95) { why = `On page one, but only ${pct(q.ctr)} of searchers click.`; score = q.impr * 0.12 * boost; }
    else return;
    out.push({ id: 'q' + i, kind: 'query', text: q.q, score, why, metric: `“${q.q}” · position ${q.pos.toFixed(1)} · ${fmtN(q.impr)} impressions`, page: pg ? pg.path : null, priority: !!(k && k.priority), kw: k });
  });
  kws.forEach((k, i) => {
    if (gscOn && queries.some(q => q.q === k.kw || q.q.includes(k.kw))) return;
    const easy = k.kd != null && k.kd <= 25, hard = k.kd != null && k.kd >= 45;
    const why = (k.intent === 'Commercial' ? 'Searchers are close to choosing a tool.' : 'Searchers want practical advice.') + (easy ? ' Few sites compete for it.' : hard ? ' Competitive in search.' : '');
    const m = measured[k.kw]; const notRanking = gscOn && !(m && m.impr > 0);
    const pg = pageFor(k.kw, pages);
    out.push({ id: 'k' + i, kind: 'keyword', text: k.kw, score: (k.vol || 0) * 0.45 * (k.priority ? 1.6 : 1) * (easy ? 1.3 : hard ? 0.8 : 1) * (k.intent === 'Commercial' ? 1.2 : 1), why, metric: `“${k.kw}” · ${fmtN(k.vol)} searches a month${notRanking ? ' · not ranking' : ''}`, page: pg ? pg.path : null, priority: k.priority, kw: k });
  });
  return out;
}

/* ── profile facts ("Ties to") ── */
export const PROF_PATHS = ['business.differentiators', 'business.offerings', 'audience.needs'] as const;
export interface Fact { ref: string; text: string }
export function facts(p: Profile): Fact[] {
  const out: Fact[] = [];
  for (const path of PROF_PATHS) { const [g, f] = path.split('.'); ((p as any)[g]?.[f] || []).forEach((x: string, i: number) => { if (x && x.trim()) out.push({ ref: `${path}.${i}`, text: x.trim() }); }); }
  return out;
}
/** Prototype profFact(p, null, words): the first fact (differentiators → offerings → needs) sharing a whole word (len > 3). */
export function factByWords(p: Profile, text: string): Fact | null {
  const ws = tokens(text, { minLen: 4 }); if (!ws.size) return null;
  for (const f of facts(p)) if (overlap(ws, tokens(f.text, { minLen: 4 })).length) return f;
  return null;
}
/** Whole-word evidence that a fact supports an angle (shared, non-generic content word). */
export const factOverlaps = (fact: string, angle: string, about: string) => overlap(tokens(fact, { minLen: 4 }), tokens(angle + ' ' + about, { minLen: 4 })).length > 0;

/* ── finishing ── */
export interface AngleOut { id: string; title: string | null; tie: string | null }
/** Titles from the LLM (null = no good angle), verified ties. Keyword candidates without an angle fall back to
 *  `“{kw}”: what {segment} get wrong` when the keyword is a priority; others are skipped. Dedupe by title, sort by score. */
export function finish(p: Profile, cands: Candidate[], angles: Map<string, AngleOut>): Idea[] {
  const seen = new Set<string>(); const out: Idea[] = [];
  const seg = p.audience.segments[0] || 'people';
  for (const c of cands) {
    const a = angles.get(c.id); let t = a?.title?.trim() || null; let tie = a?.title ? a.tie : null;
    if (!t && c.kind === 'keyword' && c.priority) { t = `“${c.text}”: what ${lcf(seg)} get wrong`; const f = factByWords(p, c.text); tie = f ? f.text : null; }
    if (!t) continue;
    const key = t.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
    out.push({ t, metric: c.metric, why: c.why, tie: tie || null, page: c.page, score: c.score, kind: c.kind, q: c.text });
  }
  return out.sort((x, y) => y.score - x.score);
}
