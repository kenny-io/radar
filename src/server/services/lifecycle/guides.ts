import { autopilotOf } from '../autopilot/policy';
// Finite guides captured at useful observed states, never historical signup/connection timestamps.
import { and, asc, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import type { Q } from '@/server/billing/draft';
import { addDays, todayIn } from '@/lib/format';
import { educationContext, educationEnabled, EDUCATION_WEEK } from './education';
import { educationAllowed } from './preferences';
import { optionalDeliveryAfter } from './engagement';
import { lifecyclePayload, queueLifecycle, type LifecyclePayload } from './queue';
import { GUIDE_IDS, type GuideId } from './guideContent';
import type { EducationContext } from './educationContent';
const G = schema.lifecycleGuideStates, M = schema.lifecycleEmails, U = schema.users, B = schema.businesses;
const DAY = 864e5;
type State = typeof G.$inferSelect;
type Mail = typeof M.$inferSelect;
const key = (uid: string, id: GuideId) => `guide:v1:${uid}:${id}`;
const whereState = (state: Pick<State, 'userId' | 'guideId'>) => and(eq(G.userId, state.userId), eq(G.guideId, state.guideId));
const lock = (q: Q, uid: string) => q.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`radar-education:${uid}`}, 0))`);
const zone = (tz: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(); return tz; } catch { return 'UTC'; } };
/** Any currently owned program use makes an account-level introduction redundant, including a later disable. */
async function autopilotAlreadyEnabled(uid: string, q: Q) {
  const [candidate] = await q.select({ autopilot: B.autopilot }).from(B).where(and(eq(B.ownerId, uid), or(
    sql`${B.autopilot}->'enabled' = 'true'::jsonb`,
    sql`jsonb_typeof(${B.autopilot}->'enabledAt') = 'string' AND length(${B.autopilot}->>'enabledAt') > 0`,
  ))).limit(1);
  if (!candidate) return false;
  const normalized = autopilotOf(candidate);
  return normalized.enabled || !!normalized.enabledAt;
}
async function completedWorkflow(uid: string, q: Q) {
  const topics = await q.select({ id: schema.calendarEntries.id }).from(schema.calendarEntries).innerJoin(B, eq(B.id, schema.calendarEntries.businessId))
    .where(and(eq(B.ownerId, uid), inArray(schema.calendarEntries.status, ['approved', 'drafting', 'draft', 'review', 'scheduled', 'publishing', 'published']))).limit(1);
  if (topics.length) return true;
  return !!(await q.select({ id: schema.articles.entryId }).from(schema.articles).innerJoin(B, eq(B.id, schema.articles.businessId))
    .where(and(eq(B.ownerId, uid), sql`${schema.articles.data}->>'generated' = 'true'`)).limit(1)).length;
}
async function organicAccepted(uid: string, q: Q) {
  return (await q.select({ at: M.sentAt }).from(M).where(and(eq(M.userId, uid), eq(M.eventKey, `education:v1:${uid}:organic_search`), eq(M.type, 'weekly_education'), eq(M.status, 'sent'), isNotNull(M.sentAt))).limit(1))[0]?.at || null;
}
async function source(uid: string, q: Q, id: GuideId) {
  const current = await educationContext(uid, q);
  const [business] = current.businessId ? await q.select().from(B).where(and(eq(B.id, current.businessId), eq(B.ownerId, uid))).limit(1) : [];
  const usable = !!business && (business.status === 'active' || !!business.onboarding?.savedAt || (typeof business.site?.analyzedAt === 'string' && !!business.site.analyzedAt.trim()));
  const ownerRole = id !== 'autopilot_intro' || !!(business && (await q.select({ id: schema.members.id }).from(schema.members).where(and(eq(schema.members.businessId, business.id), eq(schema.members.userId, uid), eq(schema.members.status, 'active'), eq(schema.members.role, 'Owner'))).limit(1)).length);
  return { ...current, business: usable && ownerRole ? business : undefined };
}
async function searchReady(b: typeof B.$inferSelect, now: Date, q: Q) {
  const [conn] = await q.select({ status: schema.gscConnections.status, property: schema.gscConnections.property, through: schema.gscConnections.lastSyncedThrough }).from(schema.gscConnections).where(eq(schema.gscConnections.businessId, b.id)).limit(1);
  if (conn?.status !== 'connected' || !conn.property?.trim() || !conn.through) return false;
  const day = todayIn(zone(b.timezone), now), R = schema.gscRows;
  return !!(await q.select({ date: R.date }).from(R).where(and(eq(R.businessId, b.id), eq(R.kind, 'page'), sql`${R.impressions} > 0`, sql`${R.date} >= ${addDays(day, -28)}`, sql`${R.date} < ${day}`)).limit(1)).length;
}

/** Indexed discovery restricts the candidate page before loading any profiles, tokens or measured data. */
async function candidates(id: GuideId, now: Date, onlyUsers?: string[]) {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT u.id FROM users u
    LEFT JOIN user_email_preferences p ON p.user_id=u.id
    JOIN LATERAL (
      SELECT b.id,b.status,b.onboarding,b.site,b.timezone FROM businesses b
      JOIN members mb ON mb.business_id=b.id AND mb.user_id=u.id AND mb.status='active'
      WHERE b.owner_id=u.id AND b.status IN ('active','onboarding')
      ORDER BY CASE WHEN b.status='active' THEN 0 ELSE 1 END,
        CASE WHEN b.status='active' THEN b.created_at END ASC, CASE WHEN b.status='onboarding' THEN b.created_at END DESC,
        CASE WHEN b.status='active' THEN b.id END ASC, CASE WHEN b.status='onboarding' THEN b.id END DESC LIMIT 1
    ) b ON true
    WHERE NOT u.guest AND u.email_verified_at IS NOT NULL AND coalesce(p.education,p.onboarding,true)
      AND NOT EXISTS(SELECT 1 FROM lifecycle_guide_states g WHERE g.user_id=u.id AND g.guide_id=${id})
      ${id === 'autopilot_intro' ? sql`AND EXISTS(SELECT 1 FROM members own WHERE own.business_id=b.id AND own.user_id=u.id AND own.status='active' AND own.role='Owner')` : sql``}
      AND (b.status='active' OR coalesce(b.onboarding->>'savedAt','')<>'' OR coalesce(b.site->>'analyzedAt','')<>'')
      ${onlyUsers ? sql`AND u.id IN (${sql.join(onlyUsers.map(uid => sql`${uid}::uuid`), sql`,`)})` : sql``}
      ${id === 'search_refresh' ? sql`AND EXISTS(SELECT 1 FROM lifecycle_emails m WHERE m.user_id=u.id AND m.type='weekly_education' AND m.event_key='education:v1:'||u.id::text||':organic_search' AND m.status='sent' AND m.sent_at IS NOT NULL)
        AND EXISTS(SELECT 1 FROM gsc_connections c WHERE c.business_id=b.id AND c.status='connected' AND trim(coalesce(c.property,''))<>'' AND c.last_synced_through IS NOT NULL)
        AND EXISTS(SELECT 1 FROM gsc_rows r WHERE r.business_id=b.id AND r.kind='page' AND r.impressions>0
          AND r.date >= ((${now.toISOString()}::timestamptz AT TIME ZONE coalesce((SELECT name FROM pg_timezone_names WHERE name=b.timezone LIMIT 1),'UTC'))::date - 28)
          AND r.date < (${now.toISOString()}::timestamptz AT TIME ZONE coalesce((SELECT name FROM pg_timezone_names WHERE name=b.timezone LIMIT 1),'UTC'))::date)` : sql``}
    ORDER BY u.email_verified_at,u.id LIMIT 100`);
  return rows.rows;
}
export async function collectGuides(now = new Date(), onlyUsers?: string[]) {
  if (!educationEnabled() || (onlyUsers && !onlyUsers.length)) return { observed: 0, queued: 0 };
  let observed = 0, queued = 0;
  for (const id of GUIDE_IDS) for (const { id: uid } of await candidates(id, now, onlyUsers)) await db.transaction(async tx => {
    await lock(tx, uid);
    const [u] = await tx.select().from(U).where(eq(U.id, uid)).limit(1);
    if (!u || u.guest || !u.emailVerifiedAt || !await educationAllowed(uid, tx)) return;
    const current = await source(uid, tx, id);
    if (!current.business) return;
    const accepted = id === 'search_refresh' ? await organicAccepted(uid, tx) : null;
    if (id === 'search_refresh' && (!accepted || !await searchReady(current.business, now, tx))) return;
    const reason = id === 'article_workflow' && await completedWorkflow(uid, tx) ? 'workflow_already_started'
      : id === 'autopilot_intro' && await autopilotAlreadyEnabled(uid, tx) ? 'autopilot_already_enabled' : null;
    const dueAt = id === 'search_refresh' ? new Date(Math.max(now.getTime() + DAY, accepted!.getTime() + EDUCATION_WEEK))
      : new Date(now.getTime() + (id === 'autopilot_intro' ? 2 * DAY : current.context.access === 'workspace' ? DAY : 3 * DAY));
    const inserted = await tx.insert(G).values({ userId: uid, guideId: id, firstObservedAt: now, dueAt, sourceBusinessId: current.business.id, status: reason ? 'skipped' : 'waiting', reason, updatedAt: now }).onConflictDoNothing().returning({ id: G.userId });
    observed += inserted.length;
  });
  // Refresh bounded waiting states, including newly accessible workspaces before their three-day due time.
  const P = schema.userEmailPreferences;
  const waiting = await db.select({ g: G }).from(G).innerJoin(U, and(eq(U.id, G.userId), eq(U.guest, false), isNotNull(U.emailVerifiedAt))).leftJoin(P, eq(P.userId, G.userId))
    .where(and(eq(G.status, 'waiting'), sql`coalesce(${P.education},${P.onboarding},true)`, ...(onlyUsers ? [inArray(G.userId, onlyUsers)] : []))).orderBy(asc(G.updatedAt), asc(G.userId), asc(G.guideId)).limit(100);
  for (const { g } of waiting) await db.transaction(async tx => {
    await lock(tx, g.userId);
    const [state] = await tx.select().from(G).where(whereState(g)).for('update');
    if (!state || state.status !== 'waiting' || !await educationAllowed(g.userId, tx)) return;
    const current = await source(g.userId, tx, g.guideId);
    if (!state.sourceBusinessId || current.business?.id !== state.sourceBusinessId) { await tx.update(G).set({ status: 'skipped', reason: 'source_changed', updatedAt: now }).where(whereState(state)); return; }
    if (state.guideId === 'autopilot_intro' && await autopilotAlreadyEnabled(state.userId, tx)) { await tx.update(G).set({ status: 'skipped', reason: 'autopilot_already_enabled', updatedAt: now }).where(whereState(state)); return; }
    if (state.guideId === 'article_workflow' && await completedWorkflow(state.userId, tx)) { await tx.update(G).set({ status: 'skipped', reason: 'workflow_already_started', updatedAt: now }).where(whereState(state)); return; }
    const dueAt = state.guideId === 'article_workflow' && current.context.access === 'workspace' ? new Date(Math.min(state.dueAt.getTime(), now.getTime() + DAY)) : state.dueAt;
    if (dueAt > now) { await tx.update(G).set({ dueAt, updatedAt: now }).where(whereState(state)); return; }
    const after = await optionalDeliveryAfter(state.userId, now, undefined, tx, 'lifecycle_guide');
    await queueLifecycle(tx, { type: 'lifecycle_guide', userId: state.userId, eventKey: key(state.userId, state.guideId), sendAt: after || now, data: { guide: { version: 1, id: state.guideId, context: current.context, businessId: current.business.id } } });
    const [mail] = await tx.select().from(M).where(eq(M.eventKey, key(state.userId, state.guideId))).limit(1);
    if (!mail || !['queued', 'sending'].includes(mail.status)) { await tx.update(G).set({ status: 'blocked', reason: 'existing_terminal_guide', updatedAt: now }).where(whereState(state)); return; }
    await tx.update(G).set({ dueAt, status: 'queued', pendingEmailId: mail.id, expiresAt: mail.expiresAt, updatedAt: now }).where(whereState(state)); queued++;
  });
  return { observed, queued };
}

type Prepared = { kind: 'send'; payload: LifecyclePayload } | { kind: 'defer'; until: Date; reason: string } | { kind: 'suppress'; reason: string };
export async function prepareGuide(row: Mail, payload: LifecyclePayload, now = new Date()): Promise<Prepared> {
  if (!educationEnabled()) return { kind: 'defer', until: new Date(now.getTime() + DAY), reason: 'education_paused' };
  const d = payload.data.guide;
  if (d?.version !== 1 || !GUIDE_IDS.includes(d.id) || !d.context || typeof d.context.gscConnected !== 'boolean' || !['workspace', 'start_trial', 'restart', 'setup'].includes(d.context.access) ||
    ['businessName', 'industry', 'offering', 'audience', 'keyword'].some(k => { const value = d.context[k as keyof EducationContext]; return value !== undefined && (typeof value !== 'string' || value.length > 200); }) || !Array.isArray(payload.envelope.to)) return { kind: 'suppress', reason: 'invalid_guide_payload' };
  const [state] = await db.select().from(G).where(and(eq(G.userId, row.userId), eq(G.guideId, d.id))).limit(1);
  if (!state || state.status !== 'queued' || state.pendingEmailId !== row.id || row.eventKey !== key(row.userId, d.id)) return { kind: 'suppress', reason: 'invalid_guide_state' };
  const [u] = await db.select().from(U).where(eq(U.id, row.userId)).limit(1);
  if (!u || u.guest || !u.emailVerifiedAt || payload.envelope.to.length !== 1 || payload.envelope.to[0] !== u.email) return { kind: 'suppress', reason: 'recipient_changed' };
  if (!await educationAllowed(u.id)) return row.firstAttemptAt ? { kind: 'suppress', reason: 'opted_out_after_attempt' } : { kind: 'defer', until: new Date(now.getTime() + DAY), reason: 'education_opted_out' };
  // Pauses above preserve the window; unavailable source data below must not defer forever past it.
  if (row.expiresAt <= now) return { kind: 'suppress', reason: 'expired_delivery_window' };
  if (state.dueAt > now) return { kind: 'defer', until: state.dueAt, reason: 'guide_original_delay' };
  const current = await source(row.userId, db, d.id);
  if (!state.sourceBusinessId || current.business?.id !== state.sourceBusinessId || d.businessId !== state.sourceBusinessId) return { kind: 'suppress', reason: 'source_changed' };
  if (d.id === 'autopilot_intro' && await autopilotAlreadyEnabled(u.id, db)) return { kind: 'suppress', reason: 'autopilot_already_enabled' };
  if (d.id === 'article_workflow' && await completedWorkflow(u.id, db)) return { kind: 'suppress', reason: 'workflow_already_started' };
  if (d.id === 'search_refresh') {
    const accepted = await organicAccepted(u.id, db);
    if (!accepted || !await searchReady(current.business, now, db)) return row.firstAttemptAt ? { kind: 'suppress', reason: 'unsafe_retry_context' } : { kind: 'defer', until: new Date(now.getTime() + DAY), reason: 'search_data_not_ready' };
    if (accepted.getTime() + EDUCATION_WEEK > now.getTime()) return { kind: 'defer', until: new Date(accepted.getTime() + EDUCATION_WEEK), reason: 'organic_lesson_gap' };
  }
  if (row.firstAttemptAt) {
    if (d.context.access !== current.context.access || (d.id !== 'autopilot_intro' && d.context.gscConnected !== current.context.gscConnected)) return { kind: 'suppress', reason: 'unsafe_retry_context' };
    return { kind: 'send', payload };
  }
  return { kind: 'send', payload: lifecyclePayload('lifecycle_guide', u, { guide: { version: 1, id: d.id, context: current.context, businessId: current.business.id } }) };
}
export async function acknowledgeGuide(q: Q, row: Mail, acceptedAt: Date) {
  const changed = await q.update(G).set({ status: 'sent', sentAt: acceptedAt, pendingEmailId: null, reason: null, updatedAt: acceptedAt })
    .where(and(eq(G.userId, row.userId), eq(G.pendingEmailId, row.id), eq(G.status, 'queued'), sql`${row.eventKey} = 'guide:v1:'||${G.userId}::text||':'||${G.guideId}`)).returning({ id: G.userId });
  if (changed.length !== 1) throw new Error('Guide acknowledgment state changed');
}
export async function finishGuide(q: Q, row: Mail, reason: string, now = new Date()) {
  const skipped = !row.firstAttemptAt && ['source_changed', 'workflow_already_started', 'autopilot_already_enabled'].includes(reason);
  await q.update(G).set({ status: skipped ? 'skipped' : 'blocked', reason, updatedAt: now }).where(and(eq(G.userId, row.userId), eq(G.pendingEmailId, row.id)));
}
