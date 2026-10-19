// Performance → What to improve (02-system.md §10). Candidates come from the user's own Search Console data and crawl:
//  · refresh — pages at positions 8–20 with high impressions
//  · meta    — page-one pages whose CTR is well below expCtr = max(0.02, 0.30/pos) (title/meta rewrite)
//  · links   — the top articles don't link to a money page (crawl links)
//  · faq     — related questions searchers ask that the page text doesn't answer (LLM over page text + queries)
// Every `why` is built from real numbers; impact is a conservative, explainable range. The LLM writes only the diff wording.
import { z } from 'zod';
import { and, desc, eq, gte, ne } from 'drizzle-orm';
import { db, schema } from '../../db';
import { getBiz } from '../../workspace';
import { ai } from '../../ai';
import { registerStub } from '../../ai/adapters/stub';
import { fmtN } from '@/lib/format';
import type { Profile } from '@/lib/types';
import { expCtr, pageQueries, topPages, type PageRow, type QueryRow } from './metrics';

export type SuggKind = 'refresh' | 'meta' | 'links' | 'faq';
export interface Diff { title: [string, string] | null; meta: [string, string] | null; blocks: ['add' | 'edit', string, string][] }
export interface SuggestionData {
  prio: 'High' | 'Medium' | 'Low'; title: string; why: string; impact: string; page: string; url: string; kind: SuggKind;
  gain: number; lo: number; hi: number; diff: Diff; measured: { impr: number; clicks: number; pos: number } | null; queries: QueryRow[]; entryId?: string;
}

const M = 30 / 28; // 28-day window → per month
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
const numWord = (n: number) => NUM[n] || String(n);
const NumWord = (n: number) => { const w = numWord(n); return w.charAt(0).toUpperCase() + w.slice(1); };
const roundG = (v: number) => (v >= 100 ? Math.round(v / 10) * 10 : v >= 20 ? Math.round(v / 5) * 5 : Math.round(v));
const normUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').toLowerCase();
const QUESTION = /^(how|what|why|when|where|which|who|is|are|can|should|do|does|will|vs\b)|\?$|\b(vs|versus|examples?|checklist|worth it)\b/i;
const MONEY = /^\/(pricing|plans|features|product|demo|signup|sign-up|trial|start)(\/|$)/i;

function impactText(lo: number, hi: number) {
  const a = roundG(lo), b = roundG(hi);
  return a >= 1 && a < b ? `Est. +${a}–${b} clicks / month` : `Est. +${Math.max(1, b)} clicks / month`;
}
/** Keep the model's note only if every quoted term it says is missing really is missing from the current title. */
function noteOk(note: string | null | undefined, title: string) {
  if (!note) return false;
  const terms = [...note.matchAll(/[“"]([^”"]+)[”"]/g)].map(m => m[1].toLowerCase());
  return terms.length > 0 && terms.every(t => !title.toLowerCase().includes(t));
}
const prioOf = (mid: number): SuggestionData['prio'] => (mid >= 40 ? 'High' : mid >= 15 ? 'Medium' : 'Low');

interface Cand { id: string; kind: SuggKind; page: PageRow; crawl: typeof schema.crawlPages.$inferSelect | null; lo: number; hi: number; queries: QueryRow[]; questions?: string[]; money?: { path: string; title: string }; articles?: PageRow[]; clicks?: number }

const FaqOut = z.object({ pages: z.array(z.object({ url: z.string(), unanswered: z.array(z.string()) })) });
const DiffOut = z.object({ items: z.array(z.object({
  id: z.string(), title: z.string().nullable(), meta: z.string().nullable(), note: z.string().nullable(),
  blocks: z.array(z.object({ op: z.enum(['add', 'edit']), heading: z.string(), description: z.string() })),
})) });

export async function generateSuggestions(bid: string) {
  const biz = await getBiz(bid); const profile = { ...(biz.profile as Profile), domain: biz.domain };
  const [pages, qp, crawl, handled] = await Promise.all([
    topPages(bid, 28, 500), pageQueries(bid),
    db.select().from(schema.crawlPages).where(eq(schema.crawlPages.businessId, bid)),
    db.select().from(schema.suggestions).where(and(eq(schema.suggestions.businessId, bid), ne(schema.suggestions.state, 'open'), gte(schema.suggestions.createdAt, new Date(Date.now() - 120 * 864e5)))),
  ]);
  if (!pages.length) { await db.delete(schema.suggestions).where(and(eq(schema.suggestions.businessId, bid), eq(schema.suggestions.state, 'open'))); return []; }
  const crawlBy = new Map(crawl.map(c => [normUrl(c.url), c]));
  const crawlOf = (p: PageRow) => crawlBy.get(normUrl(p.url)) || crawl.find(c => c.path === p.path) || null;
  const done = new Set(handled.map(h => `${(h.data as any).kind}|${(h.data as any).page}`));
  const qOf = (p: PageRow) => qp.get(p.url) || [];
  const cands: Cand[] = []; let n = 0;
  const imprFloor = Math.max(150, (pages.map(p => p.impr).sort((a, b) => b - a)[Math.min(4, pages.length - 1)] || 0) * 0.25);

  for (const p of pages) {
    const cur = p.clicks * M, mi = p.impr * M; const c = crawlOf(p);
    // Refresh: positions 8–20 with high impressions. Target: 3 to 6 positions higher (never above 4), CTR at 60% of expCtr.
    if (p.pos >= 8 && p.pos <= 20 && p.impr >= imprFloor && (!c || c.kind === 'article')) {
      const lo = mi * expCtr(Math.max(5, p.pos - 3)) * 0.6 - cur, hi = mi * expCtr(Math.max(4, p.pos - 6)) * 0.6 - cur;
      if (hi >= 5) cands.push({ id: 'c' + n++, kind: 'refresh', page: p, crawl: c, lo: Math.max(1, lo), hi, queries: qOf(p) });
    }
    // Title/meta rewrite: page one, CTR below 60% of what the position usually earns. Target: 70–90% of expCtr at the same position.
    if (p.pos < 8 && p.impr >= imprFloor && p.ctr < 0.6 * expCtr(p.pos) && c && c.title) {
      const lo = mi * expCtr(p.pos) * 0.7 - cur, hi = mi * expCtr(p.pos) * 0.9 - cur;
      if (hi >= 5) cands.push({ id: 'c' + n++, kind: 'meta', page: p, crawl: c, lo: Math.max(1, lo), hi, queries: qOf(p) });
    }
  }

  // Internal links: the top articles by clicks that don't link to a money page.
  const money = crawl.filter(c => c.kind === 'page' && MONEY.test(c.path)).sort((a, b) => (a.path.startsWith('/pricing') ? -1 : 0) - (b.path.startsWith('/pricing') ? -1 : 0))[0];
  if (money) {
    const tops = pages.map(p => ({ p, c: crawlOf(p) })).filter(x => x.c?.kind === 'article').slice(0, 3);
    const missing = tops.filter(x => !(x.c!.links || []).some(l => { try { return new URL(l, x.c!.url).pathname.replace(/\/$/, '') === money.path.replace(/\/$/, ''); } catch { return false; } }));
    if (missing.length >= 2) {
      const clicks = missing.reduce((s, x) => s + x.p.clicks, 0);
      cands.push({ id: 'c' + n++, kind: 'links', page: missing[0].p, crawl: missing[0].c, lo: 0, hi: 0, queries: [], money: { path: money.path, title: money.title || money.path }, articles: missing.map(x => x.p), clicks });
    }
  }

  // FAQ gaps: question-style queries the page ranks for (positions ≤ 15). The LLM checks the page text for answers.
  const faqPages = pages.filter(p => p.pos <= 15 && crawlOf(p)?.kind === 'article' && crawlOf(p)?.text && qOf(p).filter(q => QUESTION.test(q.q) && q.impr >= 10).length >= 2).slice(0, 4);
  let unanswered = new Map<string, string[]>();
  if (faqPages.length) {
    const input = faqPages.map(p => ({ url: p.url, title: crawlOf(p)!.title, text: crawlOf(p)!.text.slice(0, 5000), questions: qOf(p).filter(q => QUESTION.test(q.q) && q.impr >= 10).slice(0, 8).map(q => q.q) }));
    const r = await ai.run('writing', {
      purpose: 'suggestions.faq', schema: FaqOut, schemaName: 'faq_gaps', stubContext: { input },
      system: 'You audit web pages for unanswered search questions. Be strict: a question counts as answered only if the page text clearly answers it.',
      prompt: `${ai.profileContext(profile)}\n\nFor each page, list which of its search queries the page text does NOT answer. Only use queries from the list given for that page, copied exactly.\n\n${JSON.stringify(input)}`,
    }, { businessId: bid });
    const allowed = new Map(input.map(i => [i.url, new Set(i.questions)]));
    unanswered = new Map((r.json?.pages || []).map(x => [x.url, x.unanswered.filter(q => allowed.get(x.url)?.has(q))]));
    for (const p of faqPages) {
      const qs = unanswered.get(p.url) || [];
      if (qs.length < 2) continue;
      const qi = qOf(p).filter(q => qs.includes(q.q)).reduce((s, q) => s + q.impr, 0) * M;
      const lo = qi * expCtr(p.pos) * 0.3, hi = qi * expCtr(p.pos) * 0.6;
      if (hi >= 3) cands.push({ id: 'c' + n++, kind: 'faq', page: p, crawl: crawlOf(p), lo: Math.max(1, lo), hi, queries: qOf(p), questions: qs });
    }
  }

  // One suggestion per page (best estimated gain), skip pages/kinds the user already handled, keep the top 6.
  // The best candidate of each kind goes first so one kind can't crowd out the others; then fill by estimated gain.
  const open = cands.filter(c => !done.has(`${c.kind}|${c.page.path}`)).sort((a, b) => b.hi - a.hi);
  const chosen: Cand[] = []; const used = new Set<string>();
  const take = (c: Cand) => { const k = c.kind === 'links' ? 'links' : c.page.path; if (used.has(k) || chosen.length >= 6) return; used.add(k); chosen.push(c); };
  for (const kind of ['refresh', 'meta', 'faq', 'links'] as SuggKind[]) { const c = open.find(x => x.kind === kind && !used.has(x.kind === 'links' ? 'links' : x.page.path)); if (c) take(c); }
  for (const c of open) take(c);
  if (!chosen.length) { await db.delete(schema.suggestions).where(and(eq(schema.suggestions.businessId, bid), eq(schema.suggestions.state, 'open'))); return []; }

  // The writing model drafts the diff wording. Old title/meta always come from the crawl, never from the model.
  const diffIn = chosen.map(c => ({
    id: c.id, kind: c.kind, url: c.page.url, title: c.crawl?.title || null, meta: c.crawl?.description || null, h1: c.crawl?.h1 || null,
    text: (c.crawl?.text || '').slice(0, 3500),
    topQueries: c.queries.slice(0, 8).map(q => ({ q: q.q, impressions: q.impr, clicks: q.clicks, position: +q.pos.toFixed(1) })),
    unansweredQuestions: c.kind === 'faq' ? c.questions : (unanswered.get(c.page.url) || []),
    linkTarget: c.money ? c.money.path : null, articlesMissingLink: c.articles?.map(a => a.path) || null,
  }));
  const dr = await ai.run('writing', {
    purpose: 'suggestions.diff', schema: DiffOut, schemaName: 'refresh_diffs', stubContext: { input: diffIn, profile },
    system: 'You are an SEO editor. Propose specific, modest changes that match what searchers look for. Never invent statistics, dates or facts about the business; never mention competitors favorably. Write in the brand voice and language.',
    prompt: `${ai.profileContext(profile)}\n\nFor each item write:\n- title: a better SEO title (≤60 chars) for kind refresh/meta, else null\n- meta: a better meta description (≤155 chars) for kind refresh/meta, else null\n- note: for kind meta only, one short factual sentence about what the current title misses compared with the top queries (e.g. "The title doesn’t mention “free” or “designer”."), else null\n- blocks: 1–3 content changes as {op:'add'|'edit', heading, description}. description is one sentence saying what changes. For kind links: one 'add' block "Internal links" describing contextual links to linkTarget from articlesMissingLink. For kind faq: an 'add' block "FAQ" naming the unanswered questions.\n\n${JSON.stringify(diffIn)}`,
  }, { businessId: bid });
  const diffs = new Map((dr.json?.items || []).map(d => [d.id, d]));

  const rows = chosen.map(c => {
    const d = diffs.get(c.id); const p = c.page; const t = c.crawl?.title || p.title || p.path;
    const diff: Diff = {
      title: (c.kind === 'refresh' || c.kind === 'meta') && d?.title && c.crawl?.title && d.title !== c.crawl.title ? [c.crawl.title, d.title] : null,
      meta: (c.kind === 'refresh' || c.kind === 'meta') && d?.meta && c.crawl?.description !== undefined && d.meta !== c.crawl?.description ? [c.crawl?.description || '', d.meta] : null,
      blocks: (d?.blocks || []).slice(0, 4).map(b => [b.op, b.heading, b.description] as ['add' | 'edit', string, string]),
    };
    if (!diff.blocks.length && c.kind === 'links') diff.blocks = [['add', 'Internal links', `Adds a contextual link to ${c.money!.path} in ${numWord(c.articles!.length)} articles.`]];
    if (!diff.blocks.length && c.kind === 'faq') diff.blocks = [['add', 'FAQ', `Answers ${c.questions!.map(q => `“${q}”`).join(', ')}.`]];
    const posL = p.pos.toFixed(1);
    let title = '', why = '', impact = '', mid = (c.lo + c.hi) / 2;
    if (c.kind === 'refresh') {
      const gap = (unanswered.get(p.url) || []).slice(0, 2);
      title = `Refresh “${t}”`;
      why = `${fmtN(p.impr)} impressions at position ${posL} — ${p.pos > 10 ? 'just off page one' : 'at the bottom of page one'}.` + (gap.length ? ` Searchers also look for ${gap.map(q => `“${q}”`).join(' and ')}, which the page doesn’t answer.` : '');
      impact = impactText(c.lo, c.hi);
    } else if (c.kind === 'meta') {
      title = `Rewrite the title on “${t}”`;
      why = `${fmtN(p.impr)} impressions but a ${(p.ctr * 100).toFixed(1)}% CTR, below what position ${posL} usually earns.` + (noteOk(d?.note, c.crawl?.title || '') ? ' ' + d!.note!.trim() : '');
      impact = impactText(c.lo, c.hi);
    } else if (c.kind === 'links') {
      const clicks = c.clicks || 0;
      title = `Link to ${c.money!.title} from your ${numWord(c.articles!.length)} top articles`;
      why = `Your ${numWord(c.articles!.length)} best-performing articles (${fmtN(clicks)} clicks in the last 28 days) don’t link to ${c.money!.path}, so search visitors have no direct path to it.`;
      impact = 'Helps conversion, not traffic';
      mid = clicks * M >= 100 ? 20 : 5; // ranked by the traffic that would see the link
    } else {
      const top = c.queries[0];
      title = `Add an FAQ to “${t}”`;
      why = `Ranks ${(top?.pos ?? p.pos).toFixed(1)} for “${top?.q || c.questions![0]}”. ${NumWord(c.questions!.length)} related questions searchers ask aren’t answered on the page.`;
      impact = impactText(c.lo, c.hi);
    }
    const data: SuggestionData = { prio: prioOf(mid), title, why, impact, page: p.path, url: p.url, kind: c.kind, gain: Math.round(mid), lo: Math.round(c.lo), hi: Math.round(c.hi), diff, measured: { impr: p.impr, clicks: p.clicks, pos: +p.pos.toFixed(1) }, queries: c.queries.slice(0, 10) };
    return { businessId: bid, data, state: 'open' as const };
  });
  await db.transaction(async tx => {
    await tx.delete(schema.suggestions).where(and(eq(schema.suggestions.businessId, bid), eq(schema.suggestions.state, 'open')));
    if (rows.length) await tx.insert(schema.suggestions).values(rows);
  });
  return rows.map(r => r.data);
}

const PRIO_RANK = { High: 0, Medium: 1, Low: 2 } as const;
export async function listSuggestions(bid: string) {
  const rows = await db.select().from(schema.suggestions).where(eq(schema.suggestions.businessId, bid)).orderBy(desc(schema.suggestions.createdAt));
  // Handled rows stay visible (dimmed) for 30 days.
  const recent = rows.filter(r => r.state === 'open' || Date.now() - r.createdAt.getTime() < 30 * 864e5);
  return recent.map(r => { const d = r.data as SuggestionData; return { id: r.id, prio: d.prio, title: d.title, why: d.why, impact: d.impact, page: d.page, kind: d.kind, state: r.state, gain: d.gain, diff: d.diff, entryId: d.entryId || null }; })
    .sort((a, b) => PRIO_RANK[a.prio] - PRIO_RANK[b.prio] || b.gain - a.gain);
}

/* ── dev stubs ── */
registerStub('suggestions.faq', (_i, ctx) => ({ pages: (ctx?.input || []).map((p: any) => ({ url: p.url, unanswered: p.questions.filter((q: string) => !p.text.toLowerCase().includes(q.toLowerCase())).slice(0, 3) })) }));
registerStub('suggestions.diff', (_i, ctx) => {
  const seg = (ctx?.profile?.audience?.segments?.[0] || 'small teams').toLowerCase();
  return { items: (ctx?.input || []).map((x: any) => {
    const q = x.topQueries?.[0]?.q || (x.title || '').toLowerCase();
    const qs: string[] = x.unansweredQuestions || [];
    if (x.kind === 'links') return { id: x.id, title: null, meta: null, note: null, blocks: [{ op: 'add', heading: 'Internal links', description: `Adds a contextual link to ${x.linkTarget} in ${x.articlesMissingLink?.length || 2} articles where readers compare options.` }] };
    if (x.kind === 'faq') return { id: x.id, title: null, meta: null, note: null, blocks: [{ op: 'add', heading: 'FAQ', description: `Answers ${qs.map(s => `“${s}”`).join(', ')} in a short FAQ at the end.` }] };
    const cap = q.charAt(0).toUpperCase() + q.slice(1);
    const blocks = x.kind === 'meta'
      ? [{ op: 'edit', heading: 'Intro', description: `Leads with what ${seg} get from the page and who it’s for.` }]
      : [{ op: 'add', heading: `A step-by-step approach to ${q}`, description: 'A new section with a short checklist readers can follow.' }, { op: 'edit', heading: x.h1 || 'Introduction', description: 'Tightened and updated so the answer comes in the first paragraph.' }, ...(qs.length ? [{ op: 'add', heading: 'FAQ', description: `Answers ${qs.slice(0, 2).map(s => `“${s}”`).join(' and ')}.` }] : [])];
    return { id: x.id, title: x.kind === 'meta' ? `${cap} for ${seg}`.slice(0, 60) : `${cap}: how to get it right`.slice(0, 60), meta: `A practical guide to ${q} for ${seg} — what to do, what to avoid, and a checklist you can reuse.`.slice(0, 155), note: x.kind === 'meta' ? (() => { const miss = q.split(' ').filter((w: string) => w.length > 3 && !(x.title || '').toLowerCase().includes(w)); return miss.length ? `The title doesn’t mention ${miss.slice(0, 2).map((w: string) => `“${w}”`).join(' or ')}.` : null; })() : null, blocks };
  }) };
});
