import { reportFailure } from '@/server/observability/failures';
// Proactive daily generation, local to each business. New defaults save editable drafts; explicit legacy scheduling survives.
import { autopilotOf, effectiveSocial } from '../autopilot/policy';
import { canRun } from '../autopilot/guard';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { socialAutoOf, getBiz, bizToday } from '../../workspace';
import { nowHMIn, todayIn, weekday } from '@/lib/format';
import type { Profile, SocialAuto, SocialPack } from '@/lib/types';
import { createPack, getPack } from './generate';
import { dailyContext } from './proactive';
import { autoSchedule } from './publish/schedule';
import { activityTier, cadenceDue, lastRuns } from '../../idle';

class DailyDraftCancelled extends Error {}

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayName = (d: string) => DAYS[(weekday(d) + 6) % 7];
const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + (m || 0); };
export const dailyPackId = (bid: string, date: string) => `auto-${bid}-${date}`;

/** Catch up after the configured time until local midnight; never backfill an outage's earlier days. */
export function isDue(a: SocialAuto, tz: string, now: Date): { due: boolean; date: string } {
  const date = todayIn(tz, now);
  if (!a.on || !a.platforms.length) return { due: false, date };
  if (a.freq === 'custom' && !a.days.includes(dayName(date))) return { due: false, date };
  return { due: toMin(nowHMIn(tz, now)) >= toMin(a.time || '08:00'), date };
}

/** By activity tier (idle.ts): active as before; idle at most one pack per 7 days, counted from the business's newest
 *  social.autoRun job; dormant none. A skipped day writes no daily mark, so nothing queues up for the owner's return. */
export async function autoTick(now: Date) {
  const rows = await db.select({ id: schema.businesses.id, tz: schema.businesses.timezone, auto: schema.businesses.socialAuto, autopilot: schema.businesses.autopilot, lastActiveAt: schema.businesses.lastActiveAt, onboarding: schema.businesses.onboarding })
    .from(schema.businesses).where(eq(schema.businesses.status, 'active'));
  const due = rows.filter(r => !autopilotOf(r).enabled).map(r => ({ ...r, ...isDue(socialAutoOf({ socialAuto: r.auto } as any), r.tz || 'America/New_York', now), tier: activityTier(r, now) })).filter(r => r.due && r.tier !== 'dormant');
  const runs = await lastRuns('social.autoRun', due.filter(r => r.tier === 'idle').map(r => r.id));
  for (const r of due) {
    if (!cadenceDue(r.tier, runs.get(r.id) ?? null, now)) continue;
    const date = r.date;
    const key = `social.auto:${r.id}:${date}`;
    // One commit owns both the daily mark and job. Failed insertion (or worker death) cannot strand a daily mark.
    await db.transaction(async tx => {
      const marks = await tx.insert(schema.cronMarks).values({ key }).onConflictDoNothing().returning({ key: schema.cronMarks.key });
      if (!marks.length) return;
      await tx.insert(schema.jobs).values({ kind: 'social.autoRun', payload: { date }, ref: date, businessId: r.id, singletonKey: key, maxAttempts: 3 });
    });
  }
}

export async function autoRun(bid: string, date?: string, autopilotActivationId?: string): Promise<string | null> {
  const b = await getBiz(bid); const a = autopilotActivationId ? effectiveSocial(socialAutoOf(b)) : socialAutoOf(b); const today = bizToday(b);
  const day = date || today;
  if (autopilotActivationId && !(await canRun(bid, autopilotActivationId))) return null;
  if (!autopilotActivationId && autopilotOf(b).enabled) return (await getPack(bid, dailyPackId(bid, day)))?.id || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const id = dailyPackId(bid, day);
  // A completion retry returns the saved draft, preserving any edits or publication choices made since persistence.
  if (await getPack(bid, id)) return id;
  if (b.status !== 'active' || !a.on || !a.platforms.length || day !== today || (a.freq === 'custom' && !a.days.includes(dayName(day)))) return null;
  const packs = (await db.select({ data: schema.socialPacks.data }).from(schema.socialPacks).where(eq(schema.socialPacks.businessId, bid)).orderBy(desc(schema.socialPacks.createdAt)).limit(12)).map(r => r.data as SocialPack);
  const selection = await dailyContext(bid, { ...(b.profile as Profile), domain: b.domain }, day, packs);
  // Re-read preferences after source work so a pause during context gathering is honored.
  const current = await getBiz(bid); const settings = autopilotActivationId ? effectiveSocial(socialAutoOf(current)) : socialAutoOf(current);
  if (autopilotActivationId && !(await canRun(bid, autopilotActivationId))) return null;
  if (current.status !== 'active' || !settings.on || !settings.platforms.length || bizToday(current) !== day) return null;
  let packId: string;
  try { packId = await createPack(bid, { platforms: settings.platforms, style: settings.style, auto: true, source: selection.source, idea: selection.idea }, undefined, { id, created: day, grounding: selection.grounding, context: selection.context, recent: selection.recent, beforeSave: async () => {
    const latest = await getBiz(bid); const latestSettings = autopilotActivationId ? effectiveSocial(socialAutoOf(latest)) : socialAutoOf(latest);
    if (autopilotActivationId && !(await canRun(bid, autopilotActivationId))) throw new DailyDraftCancelled();
    if (latest.status !== 'active' || !latestSettings.on || !latestSettings.platforms.length || bizToday(latest) !== day || (latestSettings.freq === 'custom' && !latestSettings.days.includes(dayName(day)))) throw new DailyDraftCancelled();
  } }); } catch (e) { if (e instanceof DailyDraftCancelled) return null; throw e; }
  // Only an already-explicit opt-in can schedule generated posts. The default never creates publication rows.
  if (!autopilotActivationId && settings.post === 'schedule') {
    try { await autoSchedule(bid, packId); } catch (e: any) {
      await reportFailure(e, { source: 'social', operation: 'social.autoSchedule', businessId: bid, ref: packId, degraded: true });
      console.error('[social] auto schedule failed', e?.message || e);
    }
  }
  return packId;
}
