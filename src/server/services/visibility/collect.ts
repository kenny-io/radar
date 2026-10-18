// AI Visibility: prompt generation, per-cell collection and parsing (02-system.md §11).
// Parse rules: mentioned = the business is named in the answer; position = its order among the products the answer names
// (the writing model extracts the ordered list; Radar matches the business name/domain). Citations are URLs; own-domain ones count
// toward "Cited your site". Any failure leaves the cell "not collected" — never "not mentioned".
import { z } from 'zod';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { getBiz, bizToday, bump } from '../../workspace';
import { ai } from '../../ai';
import { AI_ENGINES } from '@/lib/constants';
import type { AiEngine, AiPrompt, AiResult, Profile } from '@/lib/types';
import { askEngine, EngineUnavailable } from './engines';
import './stub';

const P = schema.aiPrompts; const A = schema.aiResults;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const hostOf = (u: string) => { try { return new URL(/^https?:/i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
export const isOwn = (u: string, domain: string) => { const h = hostOf(u); const d = domain.replace(/^www\./, '').toLowerCase(); return !!h && (h === d || h.endsWith('.' + d)); };

/** Plain text for display: drop markdown emphasis/headings/link syntax, keep the words. */
export function cleanResponse(t: string) {
  return t.replace(/\r/g, '').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1').replace(/\*\*|__/g, '').replace(/(^|\s)\*(\S[^*]*\S)\*(?=\s|$)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*•]\s+/gm, '• ').replace(/【[^】]*】/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/* ── prompts ── */
const PromptsOut = z.object({ prompts: z.array(z.string()) });
/** Auto-generate 3–8 natural questions from the target keywords (once, when the business has keywords and no keyword prompts yet). */
export async function ensurePrompts(bid: string): Promise<string[]> {
  const have = await db.select({ id: P.id }).from(P).where(and(eq(P.businessId, bid), eq(P.source, 'keyword'))).limit(1);
  if (have.length) return [];
  const biz = await getBiz(bid); const profile = { ...(biz.profile as Profile), domain: biz.domain };
  const kl = [...(profile.keywords?.list || [])].sort((a, b) => Number(b.priority) - Number(a.priority) || (b.vol || 0) - (a.vol || 0));
  if (!kl.length) return [];
  const keywords = kl.slice(0, 8).map(k => k.kw);
  const r = await ai.run('writing', {
    purpose: 'visibility.prompts', schema: PromptsOut, schemaName: 'prompts', stubContext: { profile, keywords },
    system: 'You write the questions real customers type into AI assistants. Natural, specific, one sentence each. Never include the business’s own name or domain.',
    prompt: `${ai.profileContext(profile)}\n\nWrite 3 to 8 questions a potential customer in ${profile.brand.markets.join(', ')} would ask an AI assistant, built from these target keywords: ${keywords.join(', ')}. Mix "best tool for…" questions with how-to questions the business can answer. One question per keyword at most. Language: ${profile.brand.language}.`,
  }, { businessId: bid });
  const name = norm(profile.business.name || '#'); const dom = norm(profile.domain);
  const list = [...new Set((r.json?.prompts || []).map(s => s.trim()).filter(s => s.length >= 6 && !norm(s).includes(name) && !norm(s).includes(dom)))].slice(0, 8);
  // Re-check under the insert so two concurrent callers don't both add prompts.
  return db.transaction(async tx => {
    const again = await tx.select({ id: P.id }).from(P).where(and(eq(P.businessId, bid), eq(P.source, 'keyword'))).limit(1);
    if (again.length || !list.length) return [];
    const ins = await tx.insert(P).values(list.map(prompt => ({ businessId: bid, prompt, source: 'keyword' as const }))).returning({ id: P.id });
    await tx.insert(A).values(ins.flatMap(p => AI_ENGINES.map(engine => ({ businessId: bid, promptId: p.id, engine })))).onConflictDoNothing();
    return ins.map(p => p.id);
  });
}

export async function addPrompt(bid: string, prompt: string) {
  const [p] = await db.insert(P).values({ businessId: bid, prompt, source: 'user' }).returning();
  await db.insert(A).values(AI_ENGINES.map(engine => ({ businessId: bid, promptId: p.id, engine }))).onConflictDoNothing();
  return p.id;
}

/* ── read model ── */
export async function listVisibility(bid: string) {
  const prompts = await db.select().from(P).where(eq(P.businessId, bid)).orderBy(asc(P.createdAt));
  const rows = await db.select().from(A).where(eq(A.businessId, bid));
  const by = new Map(rows.map(r => [r.promptId + '|' + r.engine, r]));
  const results: AiResult[] = [];
  for (const p of prompts) for (const engine of AI_ENGINES) {
    const r = by.get(p.id + '|' + engine);
    if (!r) continue;
    results.push({ id: r.id, promptId: p.id, prompt: p.prompt, engine, date: r.date ? String(r.date) : null, status: r.status, pos: r.pos, cites: r.cites || [], resp: r.resp });
  }
  const dates = results.map(r => r.date).filter(Boolean) as string[];
  return { prompts: prompts.map(p => ({ id: p.id, prompt: p.prompt, source: p.source })) as AiPrompt[], results, lastCollected: dates.length ? dates.sort().pop()! : null };
}

/* ── collection ── */
const ExtractOut = z.object({ products: z.array(z.string()) });

export async function collectOne(resultId: string, opts: { manual: boolean }): Promise<{ status: AiResult['status'] }> {
  const row = (await db.select({ r: A, prompt: P.prompt }).from(A).innerJoin(P, eq(P.id, A.promptId)).where(eq(A.id, resultId)).limit(1))[0];
  if (!row) return { status: 'not-collected' };
  const bid = row.r.businessId; const engine = row.r.engine as AiEngine;
  const biz = await getBiz(bid); const profile = { ...(biz.profile as Profile), domain: biz.domain };
  const pages = (await db.select({ url: schema.crawlPages.url }).from(schema.crawlPages).where(eq(schema.crawlPages.businessId, bid))).map(x => x.url);
  try {
    const ans = await askEngine(engine, row.prompt, { stub: { bid, profile, pages, manual: opts.manual } });
    const text = cleanResponse(ans.text || '');
    if (!text) throw new Error('empty response');
    const name = profile.business.name || profile.domain.split('.')[0];
    const ex = await ai.run('writing', {
      purpose: 'visibility.extract', schema: ExtractOut, schemaName: 'products', temperature: 0,
      stubContext: { text, candidates: [name, ...profile.audience.competitors] },
      system: 'You extract structured facts from text. Output only names that appear in the text.',
      prompt: `List every product, app, tool, service or company that this answer names as an option or recommendation, in the order they first appear. Copy each name as written. Exclude publishers that are only cited as sources.\n\nANSWER:\n${text.slice(0, 12000)}`,
    }, { businessId: bid });
    const products = (ex.json?.products || []).map(s => s.trim()).filter(Boolean);
    const n = norm(name), d = norm(profile.domain), root = norm(profile.domain.split('.')[0]);
    const isBiz = (s: string) => { const x = norm(s); return !!x && (x === n || x === d || x === root || (n.length >= 4 && x.includes(n)) || x.includes(d)); };
    let idx = products.findIndex(isBiz);
    const inText = new RegExp(`(^|[^a-z0-9])(${escapeRe(name.toLowerCase())}|${escapeRe(profile.domain.toLowerCase())})([^a-z0-9]|$)`, 'i').test(text);
    if (idx < 0 && inText) {
      // Named in the text but missed by extraction: place it by first appearance among the extracted names.
      const at = text.toLowerCase().indexOf(name.toLowerCase());
      idx = products.filter(p => { const i = text.toLowerCase().indexOf(p.toLowerCase()); return i >= 0 && i < at; }).length;
    }
    const mentioned = idx >= 0;
    const cites = [...new Set(ans.cites.filter(Boolean))].slice(0, 20);
    await db.update(A).set({ status: mentioned ? 'mentioned' : 'not-mentioned', pos: mentioned ? idx + 1 : null, cites, resp: text, raw: ans.raw, error: null, date: bizToday(biz), collectedAt: new Date() }).where(eq(A.id, resultId));
    await bump(bid);
    return { status: mentioned ? 'mentioned' : 'not-mentioned' };
  } catch (e: any) {
    const msg = e instanceof EngineUnavailable ? 'not_configured' : String(e?.message || e).slice(0, 300);
    if (!(e instanceof EngineUnavailable)) console.error(`[visibility] ${engine} failed`, msg);
    // Keep an earlier real measurement if there is one; otherwise the cell stays "not collected".
    await db.update(A).set({ error: msg }).where(eq(A.id, resultId));
    await bump(bid);
    return { status: row.r.status === 'not-collected' ? 'not-collected' : row.r.status };
  }
}

/** Collect every cell (or the cells of the given prompts) with a small concurrency limit. */
export async function collectAll(bid: string, opts: { promptIds?: string[]; onProgress?: (done: number, total: number) => Promise<void> } = {}) {
  const where = opts.promptIds?.length ? and(eq(A.businessId, bid), inArray(A.promptId, opts.promptIds)) : eq(A.businessId, bid);
  const cells = await db.select({ id: A.id }).from(A).where(where);
  let done = 0; const queue = [...cells];
  const worker = async () => { for (let c = queue.shift(); c; c = queue.shift()) { await collectOne(c.id, { manual: false }); done++; await opts.onProgress?.(done, cells.length); } };
  await Promise.all(Array.from({ length: Math.min(4, cells.length) }, worker));
  return { total: cells.length };
}
