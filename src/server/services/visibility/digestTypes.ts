import type { VisibilitySummary } from './history';
export interface AiWeeklyReportData {
  version: 1; businessId: string; ownerId: string; domain: string; series: string; periodEnd: string;
  summary: VisibilitySummary;
}
const DAY = 864e5;
export function validReport(d: AiWeeklyReportData | undefined): d is AiWeeklyReportData {
  if (d?.version !== 1 || ![d.businessId,d.ownerId].every(s => /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(s)) || typeof d.domain !== 'string' || d.domain.length > 300 || /[\r\n]/.test(d.domain) || !/^[\da-f]{64}$/.test(d.series) || !/^\d{4}-\d{2}-\d{2}$/.test(d.periodEnd)) return false;
  const end = Date.parse(d.periodEnd + 'T00:00:00Z'), w = d.summary?.weekly;
  if (!Number.isFinite(end) || new Date(end).getUTCDay() !== 1 || !w || w.end !== d.periodEnd || w.start !== new Date(end - 7 * DAY).toISOString().slice(0,10) || w.previousStart !== new Date(end - 14 * DAY).toISOString().slice(0,10) || d.summary.series !== d.series) return false;
  for (const p of [w.current,w.previous]) if (!p || !Number.isSafeInteger(p.collected) || p.collected < 0 || !Number.isSafeInteger(p.mentioned) || p.mentioned < 0 || p.mentioned > p.collected || p.share !== (p.collected ? p.mentioned / p.collected : null)) return false;
  const miss = d.summary.weeklyBiggestMiss;
  return w.current.collected > 0 && (!miss || (typeof miss.prompt === 'string' && miss.prompt.length <= 300 && typeof miss.promptId === 'string' && (!miss.entryId || /^vis-[\da-f]{40}$/.test(miss.entryId))));
}
