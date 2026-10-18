// Domain authority for proposals ("Authority N"): Open PageRank (OPENPAGERANK_API_KEY), normalized 0–100.
// null when the provider is unavailable — the UI then omits the metric (never shows a fake number).
import { env } from '../../env';
import { metaOf, patchMeta, type BizRow } from './network';

const TTL = 30 * 864e5;

/** Deterministic dev value (RADAR_DEV_STUBS=1). */
export function stubAuthority(domain: string): number {
  const fixed: Record<string, number> = { 'paperandpixel.co': 46, 'studioledger.com': 61, 'brightlinetax.com': 38, 'quietops.io': 52, 'makersmonthly.com': 57 };
  if (fixed[domain]) return fixed[domain];
  let h = 0; for (const c of domain) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 22 + (h % 54);
}

export async function fetchAuthority(domain: string): Promise<number | null> {
  if (env.devStubs) return stubAuthority(domain);
  if (!env.openPageRankKey) return null;
  try {
    const r = await fetch(`https://openpagerank.com/api/v1.0/getPageRank?domains%5B0%5D=${encodeURIComponent(domain)}`, { headers: { 'API-OPR': env.openPageRankKey }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const j: any = await r.json();
    const row = j?.response?.[0];
    if (!row || Number(row.status_code) !== 200 || row.page_rank_decimal == null) return null;
    return Math.max(0, Math.min(100, Math.round(Number(row.page_rank_decimal) * 10)));
  } catch (e: any) {
    console.warn('[backlinks] authority lookup failed', domain, e?.message || e);
    return null;
  }
}

/** Cached per business (30 days) on businesses.backlinks.auth. */
export async function authorityOf(b: BizRow): Promise<number | null> {
  const m = metaOf(b);
  if (m.auth && Date.now() - new Date(m.auth.at).getTime() < TTL && (m.auth.v != null || !env.openPageRankKey)) return m.auth.v;
  const v = await fetchAuthority(b.domain);
  const auth = { v, at: new Date().toISOString() };
  await patchMeta(b.id, { auth });
  b.backlinks = { ...m, auth };
  return v;
}
