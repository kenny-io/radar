// Suggest ideas over real data (02-system.md §8.3). Scores and copy: ideas-core.ts. The LLM writes angle titles and
// proposes the "Ties to" fact; every proposed fact is VERIFIED (whole-word overlap, else a second yes/no check) and
// dropped when nothing genuinely supports the angle (README §2.5 #6). Never shows a model name.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ai, profileContext } from '../../ai';
import { getBiz } from '../../workspace';
import { kwMeasured, lastDataDate, topPages, topQueries } from '../gsc/metrics';
import type { Profile } from '@/lib/types';
import { candidates, facts, factOverlaps, finish, type AngleOut, type Candidate, type Idea, type PageIn } from './ideas-core';
import './stubs';

const MAX_LLM = 30;

export async function ideaInputs(bid: string) {
  const b = await getBiz(bid); const profile = { ...(b.profile as Profile), domain: b.domain };
  const g = (await db.select({ status: schema.gscConnections.status }).from(schema.gscConnections).where(eq(schema.gscConnections.businessId, bid)).limit(1))[0];
  // 'error' = connected but the latest sync failed: the synced data is still real, so it's used (like Workspace.measured).
  const gscOn = (g?.status === 'connected' || g?.status === 'error') && (await lastDataDate(bid)) != null;
  const [queries, gpages, crawl, last] = gscOn
    ? await Promise.all([topQueries(bid, 28, 500), topPages(bid, 28, 500), crawlPages(bid), lastDataDate(bid)])
    : [[], [], await crawlPages(bid), null];
  const measured = gscOn ? await kwMeasured(bid, (profile.keywords?.list || []).map(k => k.kw)) : {};
  // query → page map: Search Console pages (with impressions) enriched with crawl titles/H1s, plus crawled pages that don't rank yet.
  const byPath = new Map<string, PageIn>();
  for (const c of crawl) byPath.set(c.path, { path: c.path, title: c.title, h1: c.h1, description: c.description, impr: null });
  for (const p of gpages) { const c = byPath.get(p.path); byPath.set(p.path, { path: p.path, title: c?.title || p.title, h1: c?.h1, description: c?.description, impr: p.impr }); }
  return { profile, gscOn, queries, pages: [...byPath.values()], measured, last };
}
async function crawlPages(bid: string) {
  return db.select({ path: schema.crawlPages.path, title: schema.crawlPages.title, h1: schema.crawlPages.h1, description: schema.crawlPages.description }).from(schema.crawlPages).where(eq(schema.crawlPages.businessId, bid));
}

const AnglesSchema = z.object({ angles: z.array(z.object({ id: z.string(), title: z.string().max(140).nullable(), factRef: z.string().nullable() })) });
const TieSchema = z.object({ results: z.array(z.object({ id: z.string(), supports: z.boolean() })) });

async function writeAngles(bid: string, p: Profile, cands: Candidate[]): Promise<Map<string, AngleOut>> {
  const fs = facts(p); const out = new Map<string, AngleOut>();
  if (!cands.length) return out;
  const list = cands.map(c => ({ id: c.id, kind: c.kind, text: c.text, intent: c.kw?.intent, why: c.why, metric: c.metric }));
  const r = await ai.run('writing', {
    purpose: 'social.angles',
    system: 'You suggest social post angles for a small business, grounded in its search data. You never invent facts about the business.',
    prompt: [
      profileContext(p),
      `\nPROFILE FACTS (refer to them by ref):\n${fs.map(f => `${f.ref}: ${f.text}`).join('\n') || '(none)'}`,
      `\nCANDIDATES (a search query the site appears for, or a target keyword):\n${list.map(c => `${c.id} [${c.kind}${c.intent ? ', ' + c.intent : ''}] "${c.text}" — ${c.why}`).join('\n')}`,
      `\nFor each candidate write one social post angle title: specific, useful, sentence case, at most 70 characters, no quotes around it, no clickbait, in the brand voice and the profile language. Return title null when the topic doesn’t fit this business or its audience.`,
      `Also pick factRef: the ref of ONE profile fact that genuinely supports this angle (the business actually offers, does or addresses what the angle is about). Return null if no fact clearly supports it. Never stretch.`,
      `Never write angles that promote a competitor. Return JSON {"angles":[{"id","title","factRef"}]} with every candidate id.`,
    ].join('\n'),
    schema: AnglesSchema, schemaName: 'angles', maxTokens: 3000, temperature: 0.6,
    stubContext: { cands: list, facts: fs },
  }, { businessId: bid });
  const byRef = new Map(fs.map(f => [f.ref, f.text]));
  const pending: { id: string; angle: string; topic: string; fact: string }[] = [];
  for (const a of r.json!.angles) {
    const c = cands.find(x => x.id === a.id); if (!c) continue;
    const title = a.title ? a.title.trim().replace(/^["“”']+|["“”']+$/g, '').slice(0, 120) : null;
    const fact = a.factRef ? byRef.get(a.factRef.trim()) || null : null;
    out.set(c.id, { id: c.id, title, tie: null });
    if (!title || !fact) continue;
    if (factOverlaps(fact, title, c.text)) out.get(c.id)!.tie = fact; // whole-word evidence
    else pending.push({ id: c.id, angle: title, topic: c.text, fact });
  }
  if (pending.length) {
    // Second, independent yes/no check for facts without word overlap. Anything not confirmed is omitted.
    try {
      const v = await ai.run('writing', {
        purpose: 'social.tieCheck',
        system: 'You check whether a fact about a business genuinely supports a social post angle. Be strict: answer true only when the fact is directly about what the angle discusses. Loose or thematic connections are false.',
        prompt: `${pending.map(x => `${x.id}: angle "${x.angle}" (topic "${x.topic}") — fact "${x.fact}"`).join('\n')}\n\nReturn JSON {"results":[{"id","supports"}]} for every id.`,
        schema: TieSchema, schemaName: 'ties', maxTokens: 800, temperature: 0,
        stubContext: { pairs: pending },
      }, { businessId: bid });
      for (const res of v.json!.results) { const x = pending.find(y => y.id === res.id); if (x && res.supports) out.get(x.id)!.tie = x.fact; }
    } catch (e: any) { console.error('[social] tie check failed — omitting unverified facts', e?.message); }
  }
  return out;
}

/* ── per-business cache: keyed by the inputs that change the result ── */
const g = globalThis as unknown as { __radarIdeas?: Map<string, { at: number; key: string; ideas: Idea[]; gsc: boolean }> };
const cache = (g.__radarIdeas ??= new Map());
const TTL = 6 * 3600e3;

export async function suggestIdeas(bid: string, { fresh = false } = {}): Promise<{ ideas: Idea[]; gsc: boolean }> {
  const inp = await ideaInputs(bid);
  const key = JSON.stringify([inp.gscOn, inp.last, inp.queries.length, inp.pages.length, inp.profile.business, inp.profile.audience, inp.profile.keywords, inp.profile.brand.language]);
  const hit = cache.get(bid);
  if (!fresh && hit && hit.key === key && Date.now() - hit.at < TTL) return { ideas: hit.ideas, gsc: hit.gsc };
  const all = candidates(inp);
  // Only the strongest candidates need titles; the rest could never reach the list.
  const top = [...all].sort((a, b) => b.score - a.score).slice(0, MAX_LLM);
  const keep = new Set(top.map(c => c.id));
  const angles = await writeAngles(bid, inp.profile, top);
  const ideas = finish(inp.profile, all.filter(c => keep.has(c.id)), angles);
  cache.set(bid, { at: Date.now(), key, ideas, gsc: inp.gscOn });
  return { ideas, gsc: inp.gscOn };
}
