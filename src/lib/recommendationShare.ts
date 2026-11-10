/** Collected answers are the denominator. Missing/failed collections never mean zero visibility. */
export interface RecommendationAnswer {
  engine: string; status: 'mentioned' | 'not-mentioned' | 'not-collected';
  pos?: number | null; position?: number | null; cites?: readonly string[];
}
export interface RecommendationTotals {
  mentioned: number; collected: number; share: number | null; averagePosition: number | null;
  ownDomainCitations: number; ownDomainCitationShare: number | null;
}
export interface RecommendationSummary extends RecommendationTotals { byEngine: Record<string, RecommendationTotals> }
export function ownDomainCitation(url: string, domain: string): boolean {
  try {
    const source = new URL(url);
    const own = new URL(/^https?:\/\//i.test(domain) ? domain : `https://${domain}`);
    const host = source.hostname.toLowerCase().replace(/^www\./, '');
    const root = own.hostname.toLowerCase().replace(/^www\./, '');
    return ['http:', 'https:'].includes(source.protocol) && !!root && (host === root || host.endsWith(`.${root}`));
  } catch { return false; }
}
function totals(rows: readonly RecommendationAnswer[], domain: string): RecommendationTotals {
  const collected = rows.filter(r => r.status !== 'not-collected');
  const named = collected.filter(r => r.status === 'mentioned');
  const positions = named.map(r => r.pos ?? r.position).filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0);
  // Count answers that cite the site, not the number of citation links in an answer.
  const cited = collected.filter(r => r.cites?.some(url => ownDomainCitation(url, domain))).length;
  return { mentioned: named.length, collected: collected.length, share: collected.length ? named.length / collected.length : null,
    averagePosition: positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : null,
    ownDomainCitations: cited, ownDomainCitationShare: collected.length ? cited / collected.length : null };
}
export function summarizeRecommendationShare(rows: readonly RecommendationAnswer[], domain: string): RecommendationSummary {
  const engines = [...new Set(rows.map(r => r.engine))];
  return { ...totals(rows, domain), byEngine: Object.fromEntries(engines.map(engine => [engine, totals(rows.filter(r => r.engine === engine), domain)])) };
}
export interface HistoryAnswer extends RecommendationAnswer { promptId: string; series: string; day: string; measuredAt: Date | string }
/** A manual retry cannot outweigh a nightly cell: use the latest successful observation per UTC day/cell. */
export function dailyObservations(rows: readonly HistoryAnswer[], series: string): HistoryAnswer[] {
  const cells = new Map<string, HistoryAnswer>();
  for (const row of rows) {
    if (row.series !== series) continue;
    const key = `${row.day}|${row.promptId}|${row.engine}`;
    const prior = cells.get(key);
    if (!prior || (row.status !== 'not-collected' && prior.status === 'not-collected') ||
      ((row.status === 'not-collected') === (prior.status === 'not-collected') && new Date(row.measuredAt).getTime() > new Date(prior.measuredAt).getTime())) cells.set(key, row);
  }
  return [...cells.values()];
}
export function weeklyRecommendationShare(rows: readonly HistoryAnswer[], series: string, domain: string, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 7 * 86400e3), previousStart = new Date(start.getTime() - 7 * 86400e3);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const all = dailyObservations(rows, series);
  const current = summarizeRecommendationShare(all.filter(r => r.day >= iso(start) && r.day < iso(end)), domain);
  const previous = summarizeRecommendationShare(all.filter(r => r.day >= iso(previousStart) && r.day < iso(start)), domain);
  const delta = current.share !== null && previous.share !== null ? current.share - previous.share : null;
  return { current, previous, delta, start: iso(start), end: iso(end), previousStart: iso(previousStart), timezone: 'UTC' as const,
    days: Array.from({ length: 7 }, (_, i) => { const day = iso(new Date(start.getTime() + i * 86400e3)); return { day, ...summarizeRecommendationShare(all.filter(r => r.day === day), domain) }; }) };
}
