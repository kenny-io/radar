// "Replace topic": 3 alternatives for the same date/slot, from the last research run's leftover pool (else fresh research).
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { estimate, related } from '../keywords/provider';
import { normKw } from '../gsc/metrics';
import { shortId } from '../../crypto';
import { existingArticles, writeTopics, type Candidate } from './research';
import type { CalendarEntry, CalendarSettings, Profile } from '@/lib/types';
import type { PoolItem } from './jobs';

export interface Alternative { id: string; title: string; kw: string; type: CalendarEntry['type']; vol: number | null; kd: number | null; mode: 'new'; url: null; measured: CalendarEntry['measured']; audience: string; relevance: string; outline: string[] }

export async function alternativesFor(bid: string, profile: Profile, settings: CalendarSettings, entry: CalendarEntry, used: string[]): Promise<Alternative[]> {
  const usedSet = new Set(used.map(normKw));
  const job = (await db.select({ result: schema.jobs.result }).from(schema.jobs).where(and(eq(schema.jobs.businessId, bid), eq(schema.jobs.kind, 'calendar.generate'), eq(schema.jobs.status, 'done'))).orderBy(desc(schema.jobs.createdAt)).limit(1))[0];
  const pool: PoolItem[] = (job?.result?.pool || []).filter((p: PoolItem) => !usedSet.has(normKw(p.kw)));
  let cands: Candidate[] = pool.slice(0, 3).map(p => ({ ...p, mode: 'new', url: null, pageTitle: null }));
  if (cands.length < 3) {
    const rel = (await related(entry.kw, settings.market, settings.language, 20)).filter(r => !usedSet.has(normKw(r.kw)) && !cands.some(c => c.kw === normKw(r.kw)));
    const est = await estimate(rel.filter(r => r.vol == null).map(r => r.kw), settings.market, settings.language);
    for (const r of rel) {
      if (cands.length >= 3) break;
      const e = est[r.kw];
      cands.push({ kw: normKw(r.kw), vol: r.vol ?? e?.vol ?? null, kd: r.kd ?? e?.kd ?? null, src: 'related', seed: entry.kw, priority: false, measured: null, mode: 'new', url: null, pageTitle: null, score: 0, facts: [`Related to “${entry.kw}”, the keyword this slot targeted`] });
    }
  }
  if (!cands.length) return [];
  const ex = await existingArticles(bid);
  const topics = await writeTopics(bid, profile, cands, ex.titles.map(t => t.title));
  return topics.map(t => ({ id: shortId('a_'), title: t.title, kw: t.kw, type: t.type, vol: t.vol, kd: t.kd, mode: 'new', url: null, measured: t.measured, audience: t.audience, relevance: t.relevance, outline: t.outline }));
}
