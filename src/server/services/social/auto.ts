// Automatic generation (02-system.md §8.2): per business at auto.time (business timezone) on the selected days.
// Idempotent per business per day. Creates a pack (auto:true) and saves it to the library. With social publishing on and
// auto.post 'schedule', its X and LinkedIn posts are also scheduled for the next day (never posted right away).
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { enqueue, once } from '../../jobs/queue';
import { socialAutoOf, getBiz, bizToday } from '../../workspace';
import { addDays, nowHMIn, todayIn, weekday } from '@/lib/format';
import type { SocialAuto, SocialPack } from '@/lib/types';
import { createPack } from './generate';
import { suggestIdeas } from './ideas';
import { autoSchedule } from './publish/schedule';

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayName = (d: string) => DAYS[(weekday(d) + 6) % 7];
const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + (m || 0); };

/** Is this business due right now? Fires in the hour after auto.time so a short worker outage doesn't skip a day. */
export function isDue(a: SocialAuto, tz: string, now: Date): { due: boolean; date: string } {
  const date = todayIn(tz, now);
  if (!a.on || !a.platforms.length) return { due: false, date };
  if (a.freq === 'custom' && !a.days.includes(dayName(date))) return { due: false, date };
  const diff = toMin(nowHMIn(tz, now)) - toMin(a.time || '08:00');
  return { due: diff >= 0 && diff < 60, date };
}

export async function autoTick(now: Date) {
  const rows = await db.select({ id: schema.businesses.id, tz: schema.businesses.timezone, auto: schema.businesses.socialAuto })
    .from(schema.businesses).where(and(eq(schema.businesses.status, 'active'), sql`${schema.businesses.socialAuto}->>'on' = 'true'`));
  for (const r of rows) {
    const a = socialAutoOf({ socialAuto: r.auto } as any);
    const { due, date } = isDue(a, r.tz || 'America/New_York', now);
    if (!due) continue;
    if (!(await once(`social.auto:${r.id}:${date}`))) continue;
    await enqueue('social.autoRun', { date }, { businessId: r.id, singletonKey: `social.auto:${r.id}:${date}` });
  }
}

/** Pick the source: the most recent published or approved article not yet used, else the top Suggest-ideas idea. */
export async function autoRun(bid: string): Promise<string | null> {
  const b = await getBiz(bid); const a = socialAutoOf(b); const today = bizToday(b);
  const packs = (await db.select({ data: schema.socialPacks.data }).from(schema.socialPacks).where(eq(schema.socialPacks.businessId, bid))).map(r => r.data as SocialPack);
  const usedArticles = new Set(packs.filter(p => p.source.kind === 'article' && p.source.ref).map(p => p.source.ref));
  const usedLabels = new Set(packs.map(p => p.source.label.toLowerCase()));
  const entries = await db.select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.businessId, bid), inArray(schema.calendarEntries.status, ['published', 'scheduled', 'approved'])));
  const rank = (s: string) => (s === 'published' ? 0 : 1);
  const art = entries.filter(e => !usedArticles.has(e.id) && (e.status === 'published' || String(e.date) <= addDays(today, 7)))
    .sort((x, y) => rank(x.status) - rank(y.status) || (String(x.date) < String(y.date) ? 1 : -1))[0];
  const base = { platforms: a.platforms, style: a.style, auto: true } as const;
  // With publishing on and "Schedule posts" chosen, the pack's X and LinkedIn posts are scheduled for tomorrow (AC-16).
  const ready = async (id: string) => { try { await autoSchedule(bid, id); } catch (e: any) { console.error('[social] auto schedule failed', e?.message || e); } return id; };
  if (art) return ready(await createPack(bid, { ...base, source: { kind: 'article', label: art.title, ref: art.id } }));
  const { ideas } = await suggestIdeas(bid);
  const idea = ideas.find(i => !usedLabels.has(i.t.toLowerCase()));
  if (idea) return ready(await createPack(bid, { ...base, source: { kind: 'suggest', label: idea.t }, idea: { metric: idea.metric, why: idea.why, tie: idea.tie, page: idea.page, q: idea.q } }));
  console.log(`[social] auto: nothing new to generate for ${bid}`);
  return null;
}
