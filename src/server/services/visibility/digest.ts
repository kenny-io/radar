import { reportFailure } from '@/server/observability/failures';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import type { Q } from '@/server/billing/draft';
import { todayIn } from '@/lib/format';
import { educationEnabled } from '../lifecycle/education';
import { optionalDeliveryAfter } from '../lifecycle/engagement';
import { lifecyclePayload, queueLifecycle, type LifecyclePayload } from '../lifecycle/queue';
import { currentPromptSeries, ensureWeeklyMissTopic, visibilitySummary } from './history';
import { validReport } from './digestTypes';
const B = schema.businesses, U = schema.users, M = schema.lifecycleEmails, P = schema.visibilityPreferences, MB = schema.members;
const DAY = 864e5;
export const reportKey = (bid: string, periodEnd: string, uid: string) => `visibility-weekly:${bid}:${periodEnd}:${uid}`;
const source = async (bid: string, uid: string, q: Q) => (await q.select({ business:B, user:U, weekly:P.weeklyEmail }).from(B).innerJoin(U, and(eq(U.id,B.ownerId), eq(U.id,uid), eq(U.guest,false), isNotNull(U.emailVerifiedAt)))
  .innerJoin(MB,and(eq(MB.businessId,B.id),eq(MB.userId,uid),eq(MB.role,'Owner'),eq(MB.status,'active'))).leftJoin(P,eq(P.businessId,B.id)).where(and(eq(B.id,bid),eq(B.status,'active'))).limit(1))[0];
async function alreadyAccepted(bid: string, periodEnd: string, q: Q, excludeId?: string) {
  return !!(await q.select({id:M.id}).from(M).where(and(eq(M.businessId,bid),eq(M.type,'ai_weekly_report'),eq(M.status,'sent'),sql`split_part(${M.eventKey},':',3)=${periodEnd}`,...(excludeId?[sql`${M.id}<>${excludeId}::uuid`]:[]))).limit(1)).length;
}
/** Monday-only fixed UTC periods. Queue capped work now so it can compete for its next permitted slot. */
export async function collectAiReports(now = new Date(), onlyUsers?: string[]) {
  if (!educationEnabled() || now.getUTCDay() !== 1 || now.getUTCHours() < 8 || (onlyUsers && !onlyUsers.length)) return { queued:0, scanned:0, skipped:0, failed:0 };
  const periodEnd = now.toISOString().slice(0,10), expiresAt = new Date(Date.parse(periodEnd+'T08:00:00Z') + 7 * DAY);
  const hour = now.toISOString().slice(0,13);
  // A business which has never received a report wins before recently served businesses across weeks.
  const rows = await db.select({ bid:B.id, uid:B.ownerId }).from(B).innerJoin(U,and(eq(U.id,B.ownerId),eq(U.guest,false),isNotNull(U.emailVerifiedAt)))
    .innerJoin(MB,and(eq(MB.businessId,B.id),eq(MB.userId,U.id),eq(MB.status,'active'),eq(MB.role,'Owner'))).leftJoin(P,eq(P.businessId,B.id))
    .where(and(eq(B.status,'active'),sql`coalesce(${P.weeklyEmail},true)`,sql`EXISTS(SELECT 1 FROM ai_observations o WHERE o.business_id=${B.id} AND o.day >= (${periodEnd}::date - 7) AND o.day < ${periodEnd}::date AND o.status IN ('mentioned','not-mentioned'))`, sql`NOT EXISTS(SELECT 1 FROM cron_marks scan WHERE scan.key='ai-report-scan:'||${B.id}::text||':'||${periodEnd}||':'||${hour})`, sql`NOT EXISTS(SELECT 1 FROM lifecycle_emails m WHERE m.event_key='visibility-weekly:'||${B.id}::text||':'||${periodEnd}||':'||${U.id}::text)`,...(onlyUsers?[inArray(U.id,onlyUsers)]:[])))
    .orderBy(sql`(SELECT max(m.sent_at) FROM lifecycle_emails m WHERE m.type='ai_weekly_report' AND m.business_id=${B.id} AND m.status='sent') ASC NULLS FIRST`,asc(B.id)).limit(100);
  let queued = 0, scanned = 0, failed = 0;
  for (const r of rows) {
    const mark = await db.insert(schema.cronMarks).values({ key:`ai-report-scan:${r.bid}:${periodEnd}:${hour}` }).onConflictDoNothing().returning({ key:schema.cronMarks.key });
    if (!mark.length) continue;
    scanned++;
    try { await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`radar-education:${r.uid}`},0))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`radar-ai-report:${r.bid}:${periodEnd}`},0))`);
    await tx.select({id:B.id}).from(B).where(and(eq(B.id,r.bid),eq(B.ownerId,r.uid))).for('update');
    await tx.select({id:MB.id}).from(MB).where(and(eq(MB.businessId,r.bid),eq(MB.userId,r.uid))).for('update');
    const current = await source(r.bid,r.uid,tx);
    if (!current || current.weekly === false || await alreadyAccepted(r.bid,periodEnd,tx)) return;
    if ((await tx.select({ id:M.id }).from(M).where(eq(M.eventKey,reportKey(r.bid,periodEnd,r.uid))).limit(1)).length) return;
    let summary = await visibilitySummary(r.bid,now,tx);
    if (!summary.weekly.current.collected) return;
    await ensureWeeklyMissTopic(r.bid,summary,todayIn(current.business.timezone,now),tx);
    summary = await visibilitySummary(r.bid,now,tx);
    const after = await optionalDeliveryAfter(r.uid,now,undefined,tx,'ai_weekly_report');
    await queueLifecycle(tx,{type:'ai_weekly_report',userId:r.uid,businessId:r.bid,eventKey:reportKey(r.bid,periodEnd,r.uid),sendAt:after||now,expiresAt,data:{aiReport:{version:1,businessId:r.bid,ownerId:r.uid,domain:current.business.domain,series:summary.series,periodEnd,summary}}});
    queued++;
    }); } catch (error) { failed++; await reportFailure(error,{source:'visibility',operation:'visibility.weeklyDigest',businessId:r.bid,degraded:true}); }
  }
  return { queued, scanned, skipped:scanned-queued-failed, failed };
}
type Mail = typeof M.$inferSelect;
type Prepared = {kind:'send';payload:LifecyclePayload}|{kind:'defer';until:Date;reason:string}|{kind:'suppress';reason:string};
export async function prepareAiReport(row: Mail, payload: LifecyclePayload, now = new Date()): Promise<Prepared> {
  if (row.expiresAt <= now) return {kind:'suppress',reason:'expired_report_period'};
  if (!educationEnabled()) return {kind:'defer',until:new Date(+now+3600e3),reason:'report_paused'};
  const d = payload.data.aiReport;
  if (!validReport(d) || d.ownerId !== row.userId || d.businessId !== row.businessId || row.eventKey !== reportKey(d.businessId,d.periodEnd,row.userId) || !Array.isArray(payload.envelope.to)) return {kind:'suppress',reason:'invalid_report_payload'};
  if (await alreadyAccepted(d.businessId,d.periodEnd,db,row.id)) return {kind:'suppress',reason:'report_period_already_accepted'};
  const current = await source(d.businessId,row.userId,db);
  if (!current || current.weekly === false || payload.envelope.to.length !== 1 || payload.envelope.to[0] !== current.user.email || current.business.domain !== d.domain) return {kind:'suppress',reason:'report_recipient_or_preference_changed'};
  if (await currentPromptSeries(d.businessId) !== d.series) return {kind:'suppress',reason:'report_series_changed'};
  const entryId = d.summary.weeklyBiggestMiss?.entryId;
  if (entryId) {
    const [entry] = await db.select({ id:schema.calendarEntries.id }).from(schema.calendarEntries).where(and(eq(schema.calendarEntries.id,entryId),eq(schema.calendarEntries.businessId,d.businessId),eq(schema.calendarEntries.status,'proposed'))).limit(1);
    if (!entry) {
      if (row.firstAttemptAt) return {kind:'suppress',reason:'report_topic_changed_after_attempt'};
      const summary = {...d.summary,weeklyBiggestMiss:{...d.summary.weeklyBiggestMiss!,entryId:null}};
      return {kind:'send',payload:lifecyclePayload('ai_weekly_report',current.user,{aiReport:{...d,summary}})};
    }
  }
  return {kind:'send',payload};
}
