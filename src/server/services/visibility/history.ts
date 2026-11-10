import { and, eq, gte } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import type { Q } from '@/server/billing/draft';
import { sha256 } from '@/server/crypto';
import { AI_ENGINES } from '@/lib/constants';
import { dailyObservations, weeklyRecommendationShare } from '@/lib/recommendationShare';
const DAY = 864e5;
export function promptSeries(prompts: readonly { id: string; prompt: string }[]) {
  return sha256(JSON.stringify({ engines: AI_ENGINES, prompts: [...prompts].map(p => [p.id, p.prompt.trim()]).sort((a,b) => a[0].localeCompare(b[0])) }));
}
export async function currentPromptSeries(bid: string, q: Q = db) {
  return promptSeries(await q.select({ id: schema.aiPrompts.id, prompt: schema.aiPrompts.prompt }).from(schema.aiPrompts).where(eq(schema.aiPrompts.businessId, bid)));
}
/** No reconstruction of historical measurements from the mutable latest-result grid. */
export async function visibilitySummary(bid: string, now = new Date(), q: Q = db) {
  const series = await currentPromptSeries(bid, q);
  const [biz] = await q.select({ domain: schema.businesses.domain }).from(schema.businesses).where(eq(schema.businesses.id, bid)).limit(1);
  const observations = await q.select().from(schema.aiObservations).where(and(eq(schema.aiObservations.businessId, bid), eq(schema.aiObservations.series, series), gte(schema.aiObservations.day, new Date(+now - 15 * DAY).toISOString().slice(0,10))));
  const weekly = weeklyRecommendationShare(observations, series, biz?.domain || '', now);
  const misses = new Map<string, number>();
  for (const r of dailyObservations(observations, series)) if (r.day >= weekly.start && r.day < weekly.end && r.status === 'not-mentioned') misses.set(r.promptId, (misses.get(r.promptId) || 0) + 1);
  const largest = [...misses].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const [prompt] = largest ? await q.select().from(schema.aiPrompts).where(and(eq(schema.aiPrompts.id, largest[0]), eq(schema.aiPrompts.businessId, bid))).limit(1) : [];
  const T = schema.aiMissTopics, C = schema.calendarEntries;
  const [topic] = prompt ? await q.select({ id: C.id }).from(T).innerJoin(C, and(eq(C.id, T.entryId), eq(C.businessId, bid), eq(C.status, 'proposed'))).where(and(eq(T.businessId, bid), eq(T.promptId, prompt.id), eq(T.series, series))).limit(1) : [];
  return { series, weekly, weeklyBiggestMiss: prompt && largest ? { promptId: prompt.id, prompt: prompt.prompt.length > 300 ? prompt.prompt.slice(0,299) + '…' : prompt.prompt, misses: largest[1], entryId: topic?.id || null } : null };
}
export type VisibilitySummary = Awaited<ReturnType<typeof visibilitySummary>>;
/** Only the weekly biggest miss gets one proposed topic per prompt series; never approve/draft/publish here. */
export async function ensureWeeklyMissTopic(bid: string, summary: VisibilitySummary, day: string, q: Q) {
  const miss = summary.weeklyBiggestMiss;
  if (!miss || await currentPromptSeries(bid, q) !== summary.series) return;
  const entryId = `vis-${sha256(`${bid}|${miss.promptId}|${summary.series}`).slice(0,40)}`;
  await q.insert(schema.calendarEntries).values({ id: entryId, businessId: bid, title: miss.prompt.slice(0,300), kw: miss.prompt.slice(0,120), type: 'Guide', date: day, status: 'proposed', audience: 'Buyers asking this tracked question', relevance: 'Proposed from a missing AI recommendation. Research and review required; no keyword estimates have been collected.' }).onConflictDoNothing();
  await q.insert(schema.aiMissTopics).values({ businessId: bid, promptId: miss.promptId, series: summary.series, entryId }).onConflictDoNothing();
}
