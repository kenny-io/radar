// Keyword data provider (02-system.md §5): monthly volume + difficulty per market/language, related keywords, competitor gaps.
// DataForSEO (Google Ads volume + Labs difficulty). Cached 30 days in keyword_cache. Dev stub when RADAR_DEV_STUBS=1.
import { and, eq, gte, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { env } from '../../env';
import { kwIntentHeuristic } from '@/lib/constants';

export interface KwData { kw: string; vol: number | null; kd: number | null }
export interface RelatedKw extends KwData { intent?: 'Commercial' | 'Informational' }

const API = 'https://api.dataforseo.com/v3';
export const providerConfigured = () => env.devStubs || !!(env.dataforseoLogin && env.dataforseoPassword);

/** "English (US)" → "English"; "Portuguese (BR)" → "Portuguese" */
export const languageName = (l: string) => (l || 'English').replace(/\s*\(.*\)\s*$/, '').trim() || 'English';

async function dfs(path: string, body: any[]): Promise<any> {
  const auth = Buffer.from(`${env.dataforseoLogin}:${env.dataforseoPassword}`).toString('base64');
  const r = await fetch(API + path, { method: 'POST', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`DataForSEO ${r.status}`);
  const j = await r.json();
  const t = j.tasks?.[0];
  if (!t || (t.status_code && t.status_code >= 40000)) throw new Error(`DataForSEO task error ${t?.status_code}: ${t?.status_message}`);
  return t.result || [];
}

function hash(s: string) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h); }
function stubData(kw: string): KwData { const h = hash(kw); const words = kw.split(' ').length; return { kw, vol: Math.round(((h % 90) + 10) * (words > 3 ? 4 : words > 2 ? 20 : 60) / 10) * 10, kd: 8 + (h % 55) }; }

/** Volume + difficulty for keywords. Never throws; unknown → nulls (UI shows "Estimating…" / "—"). */
export async function estimate(kws: string[], market: string, language: string): Promise<Record<string, KwData>> {
  const out: Record<string, KwData> = {};
  const list = [...new Set(kws.map(k => k.trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return out;
  const lang = languageName(language);
  const cached = await db.select().from(schema.keywordCache).where(and(eq(schema.keywordCache.market, market), eq(schema.keywordCache.language, lang), inArray(schema.keywordCache.kw, list), gte(schema.keywordCache.fetchedAt, new Date(Date.now() - 30 * 864e5))));
  for (const c of cached) out[c.kw] = { kw: c.kw, vol: c.vol, kd: c.kd };
  const missing = list.filter(k => !out[k]);
  if (!missing.length) return out;
  let fresh: KwData[] = [];
  if (env.devStubs) fresh = missing.map(stubData);
  else if (providerConfigured()) {
    try {
      const [vol, kd] = await Promise.all([
        dfs('/keywords_data/google_ads/search_volume/live', [{ keywords: missing.slice(0, 1000), location_name: market, language_name: lang }]),
        dfs('/dataforseo_labs/google/bulk_keyword_difficulty/live', [{ keywords: missing.slice(0, 1000), location_name: market, language_name: lang }]),
      ]);
      const vm = new Map<string, number>((vol as any[]).map(r => [String(r.keyword).toLowerCase(), r.search_volume ?? null]));
      const km = new Map<string, number>(((kd?.[0]?.items) || []).map((r: any) => [String(r.keyword).toLowerCase(), r.keyword_difficulty ?? null]));
      fresh = missing.map(k => ({ kw: k, vol: vm.has(k) ? (vm.get(k) ?? 0) : null, kd: km.has(k) ? (km.get(k) ?? null) : null }));
    } catch (e: any) { console.error('[keywords] estimate failed', e.message); return out; }
  } else return out;
  for (const f of fresh) out[f.kw] = f;
  if (fresh.length) await db.insert(schema.keywordCache).values(fresh.map(f => ({ market, language: lang, kw: f.kw, vol: f.vol, kd: f.kd, fetchedAt: new Date() })))
    .onConflictDoUpdate({ target: [schema.keywordCache.market, schema.keywordCache.language, schema.keywordCache.kw], set: { vol: schemaExcluded('vol'), kd: schemaExcluded('kd'), fetchedAt: new Date() } }).catch(() => {});
  return out;
}
import { sql } from 'drizzle-orm';
const schemaExcluded = (c: string) => sql.raw(`excluded.${c}`);

/** Related keywords and questions for a seed (Labs related_keywords). */
export async function related(seed: string, market: string, language: string, limit = 30): Promise<RelatedKw[]> {
  if (env.devStubs) {
    const mods = ['how to', 'best', 'template', 'for small business', 'examples', 'vs', 'checklist', 'guide', 'tips', 'cost'];
    return mods.slice(0, Math.min(limit, mods.length)).map((m, i) => { const kw = i % 2 ? `${seed} ${m}` : `${m} ${seed}`; return { ...stubData(kw), intent: kwIntentHeuristic(kw) }; });
  }
  if (!providerConfigured()) return [];
  try {
    const res = await dfs('/dataforseo_labs/google/related_keywords/live', [{ keyword: seed, location_name: market, language_name: languageName(language), limit, depth: 2 }]);
    return ((res?.[0]?.items) || []).map((it: any) => { const d = it.keyword_data || {}; const kw = String(d.keyword || '').toLowerCase(); return { kw, vol: d.keyword_info?.search_volume ?? null, kd: d.keyword_properties?.keyword_difficulty ?? null, intent: d.search_intent_info?.main_intent === 'commercial' || d.search_intent_info?.main_intent === 'transactional' ? 'Commercial' : kwIntentHeuristic(kw) }; }).filter((k: RelatedKw) => k.kw);
  } catch (e: any) { console.error('[keywords] related failed', e.message); return []; }
}

/** Keywords a competitor domain ranks for that `domain` doesn't (Labs domain_intersection, intersections=false). */
export async function competitorGaps(domain: string, competitorDomain: string, market: string, language: string, limit = 30): Promise<RelatedKw[]> {
  if (env.devStubs) { const { devProfileFor } = await import('../analysis/devsite'); return (devProfileFor(domain).gapKeywords || []).slice(0, limit).map(kw => ({ ...stubData(kw), intent: kwIntentHeuristic(kw) })); }
  if (!providerConfigured()) return [];
  try {
    const res = await dfs('/dataforseo_labs/google/domain_intersection/live', [{ target1: competitorDomain, target2: domain, intersections: false, location_name: market, language_name: languageName(language), limit, order_by: ['keyword_data.keyword_info.search_volume,desc'] }]);
    return ((res?.[0]?.items) || []).map((it: any) => { const d = it.keyword_data || {}; const kw = String(d.keyword || '').toLowerCase(); return { kw, vol: d.keyword_info?.search_volume ?? null, kd: d.keyword_properties?.keyword_difficulty ?? null, intent: kwIntentHeuristic(kw) }; }).filter((k: RelatedKw) => k.kw);
  } catch (e: any) { console.error('[keywords] gaps failed', e.message); return []; }
}

/** Keywords a domain ranks for (Labs ranked_keywords) — used to seed from the site when GSC isn't connected. */
export async function rankedFor(domain: string, market: string, language: string, limit = 50): Promise<(RelatedKw & { pos: number | null })[]> {
  if (env.devStubs) return [];
  if (!providerConfigured()) return [];
  try {
    const res = await dfs('/dataforseo_labs/google/ranked_keywords/live', [{ target: domain, location_name: market, language_name: languageName(language), limit }]);
    return ((res?.[0]?.items) || []).map((it: any) => { const d = it.keyword_data || {}; const kw = String(d.keyword || '').toLowerCase(); return { kw, vol: d.keyword_info?.search_volume ?? null, kd: d.keyword_properties?.keyword_difficulty ?? null, intent: kwIntentHeuristic(kw), pos: it.ranked_serp_element?.serp_item?.rank_absolute ?? null }; }).filter((k: any) => k.kw);
  } catch (e: any) { console.error('[keywords] ranked failed', e.message); return []; }
}
