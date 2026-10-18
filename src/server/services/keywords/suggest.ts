// Suggested keywords (02-system.md §5): competitor gaps, Search Console queries at positions 20–40, and profile needs.
// Every suggestion carries a one-line `why` grounded in the user's data (README §2.5 #6); no matching fact → no suggestion.
// Other areas may call refreshKeywordSuggestions(bid) (e.g. after a Search Console sync).
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ai } from '../../ai';
import { registerStub } from '../../ai/adapters/stub';
import { enqueue } from '../../jobs/queue';
import { competitorGaps, estimate } from './provider';
import { classifyIntent } from './intent';
import { topQueries, hasData } from '../gsc/metrics';
import { listL } from '@/lib/format';
import type { KeywordSuggestion, Profile } from '@/lib/types';

const MAX = 8;
const DomainsSchema = z.object({ items: z.array(z.object({ name: z.string(), domain: z.string().nullable() })) });
const NeedsSchema = z.object({ items: z.array(z.object({ kw: z.string(), need: z.string() })) });

/** Queue a refresh (deduplicated per business). */
export async function refreshKeywordSuggestions(bid: string) {
  return enqueue('keywords.suggest', {}, { businessId: bid, ref: bid, singletonKey: 'kw-sugg:' + bid });
}

const cleanHost = (d: string | null | undefined) => (d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || null;

async function resolveCompetitorDomains(bid: string, p: Profile, cached: Record<string, string | null>): Promise<Record<string, string | null>> {
  const names = p.audience.competitors.filter(Boolean).slice(0, 5);
  const missing = names.filter(n => !(n in cached));
  const out: Record<string, string | null> = {};
  names.forEach(n => { if (n in cached) out[n] = cached[n]; });
  if (!missing.length) return out;
  try {
    const r = await ai.run('research', { purpose: 'keywords.competitorDomains', schema: DomainsSchema, schemaName: 'competitors', webSearch: true, stubContext: { names: missing },
      prompt: `${p.business.name} (${p.domain}) — ${p.business.description}\n\nFind the official website domain of each competitor below. Use web search. If a name is generic (e.g. "local agencies") or you can’t find an official site with confidence, return null.\n\n${missing.map(n => '- ' + n).join('\n')}` }, { businessId: bid, retries: 1 });
    for (const it of r.json!.items) if (missing.includes(it.name)) out[it.name] = cleanHost(it.domain);
  } catch { /* leave unresolved */ }
  missing.forEach(n => { if (!(n in out)) out[n] = null; });
  return out;
}

export async function computeSuggestions(bid: string): Promise<KeywordSuggestion[]> {
  const b = (await db.select().from(schema.businesses).where(eq(schema.businesses.id, bid)).limit(1))[0];
  if (!b) return [];
  const p = { ...(b.profile as Profile), domain: b.domain };
  const have = new Set((p.keywords?.list || []).map(k => k.kw.toLowerCase()));
  const market = p.brand.markets[0] || 'United States'; const lang = p.brand.language || 'English (US)';
  const site = (b.site || {}) as any;

  // 1) Competitor gaps
  const domains = await resolveCompetitorDomains(bid, p, site.competitorDomains || {});
  const gapMap = new Map<string, { names: string[]; vol: number | null; kd: number | null }>();
  for (const [name, dom] of Object.entries(domains)) {
    if (!dom || dom === p.domain) continue;
    const gaps = await competitorGaps(p.domain, dom, market, lang, 25);
    for (const g of gaps) { if (have.has(g.kw)) continue; const e = gapMap.get(g.kw) || { names: [], vol: g.vol, kd: g.kd }; if (!e.names.includes(name)) e.names.push(name); gapMap.set(g.kw, e); }
  }
  const comp = [...gapMap.entries()].filter(([, e]) => e.vol != null).sort((a, b) => (b[1].names.length - a[1].names.length) || ((b[1].vol || 0) - (a[1].vol || 0))).slice(0, 4)
    .map(([kw, e]) => ({ kw, vol: e.vol, kd: e.kd, src: 'competitor' as const, why: `${listL(e.names.slice(0, 3))} rank${e.names.length > 1 ? '' : 's'} for it; you don’t` }));

  // 2) Search Console queries at positions 20–40
  let gsc: { kw: string; vol: number | null; kd: number | null; src: 'gsc'; why: string }[] = [];
  const g = (await db.select().from(schema.gscConnections).where(eq(schema.gscConnections.businessId, bid)).limit(1))[0];
  if (g && (g.status === 'connected' || g.status === 'error') && await hasData(bid)) {
    const qs = (await topQueries(bid, 28, 2000)).filter(q => q.pos >= 20 && q.pos <= 40 && q.impr >= 5 && !have.has(q.q.toLowerCase()) && !gapMap.has(q.q.toLowerCase()) && !q.q.toLowerCase().includes(p.business.name.toLowerCase()))
      .sort((a, b) => b.impr - a.impr).slice(0, 3);
    gsc = qs.map(q => ({ kw: q.q.toLowerCase(), vol: null, kd: null, src: 'gsc' as const, why: `You get impressions at position ${Math.round(q.pos)}` }));
  }

  // 3) Profile needs
  let needs: { kw: string; vol: number | null; kd: number | null; src: 'site'; why: string }[] = [];
  if (p.audience.needs.length) {
    try {
      const r = await ai.run('writing', { purpose: 'keywords.needs', schema: NeedsSchema, schemaName: 'keywords', stubContext: { domain: p.domain, needs: p.audience.needs },
        prompt: `${ai.profileContext(p)}\n\nFor the audience needs listed in the profile, propose up to 4 search keywords (lowercase, 2–5 words) that someone with that need would type into Google, and that this business could credibly write about. Don’t repeat these existing keywords: ${[...have].join(', ') || 'none'}. Return each keyword with the exact need it matches.` }, { businessId: bid, retries: 1 });
      const valid = new Set(p.audience.needs);
      needs = r.json!.items.filter(i => valid.has(i.need)).map(i => ({ kw: i.kw.trim().toLowerCase(), vol: null, kd: null, src: 'site' as const, why: 'Matches a need in your profile' })).filter(i => i.kw && !have.has(i.kw) && !gapMap.has(i.kw)).slice(0, 3);
    } catch { /* none */ }
  }

  // Volumes for GSC + needs suggestions; drop any without data ("~N searches" must be real).
  const est = await estimate([...gsc, ...needs].map(s => s.kw), market, lang);
  const fill = <T extends { kw: string; vol: number | null; kd: number | null }>(s: T) => ({ ...s, vol: est[s.kw]?.vol ?? null, kd: est[s.kw]?.kd ?? null });
  const lists = [comp, gsc.map(fill), needs.map(fill)].map(l => l.filter(s => s.vol != null));
  const merged: Omit<KeywordSuggestion, 'intent'>[] = []; const seen = new Set<string>();
  for (let i = 0; merged.length < MAX && i < 6; i++) for (const l of lists) { const s = l[i]; if (s && !seen.has(s.kw) && merged.length < MAX) { seen.add(s.kw); merged.push(s); } }
  const intents = await classifyIntent(bid, merged.map(s => s.kw), `Business: ${p.business.name} — ${p.business.description}`);
  const out: KeywordSuggestion[] = merged.map(s => ({ ...s, intent: intents[s.kw] }));

  await db.update(schema.businesses).set({ kwSuggestions: out, site: { ...site, competitorDomains: { ...(site.competitorDomains || {}), ...domains }, kwSuggestedAt: new Date().toISOString() } }).where(eq(schema.businesses.id, bid));
  return out;
}

/* ── Dev stubs ── */
registerStub('keywords.competitorDomains', (_i, c) => ({ items: (c.names as string[]).map(name => ({ name, domain: /local|freelance|experts?|firms?|agencies/i.test(name) ? null : name.toLowerCase().replace(/[^a-z0-9]+/g, '') + '.com' })) }));
registerStub('keywords.needs', async (_i, c) => {
  const { devProfileFor } = await import('../analysis/devsite');
  const dp = devProfileFor(c.domain);
  const needs = c.needs as string[];
  const items = dp.needsKeywords.filter(n => needs.includes(n.need));
  return { items: items.length ? items : needs.slice(0, 2).map(n => ({ kw: n.toLowerCase().split(' ').slice(0, 4).join(' '), need: n })) };
});
