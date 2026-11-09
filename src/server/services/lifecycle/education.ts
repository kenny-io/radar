// A finite account-wide sequence. Never derive lesson position from signup age or billing transitions.
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import type { Q } from '@/server/billing/draft';
import { accountGrants, billingEnforced } from '@/server/billing/access';
import { grandfatherCutoff } from '@/server/flags';
import { educationAllowed } from './preferences';
import { optionalDeliveryAfter } from './engagement';
import { lifecyclePayload, queueLifecycle, type LifecyclePayload } from './queue';
import { EDUCATION_LESSONS, type EducationContext } from './educationContent';

const E = schema.educationEnrollments, M = schema.lifecycleEmails, U = schema.users, B = schema.businesses;
export const EDUCATION_WEEK = 7 * 864e5;
export const educationEnabled = () => process.env.RADAR_EDUCATION_EMAILS === '1';
type Mail = typeof M.$inferSelect;
const clean = (v: unknown, limit = 100) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) || undefined : undefined;
const first = (v: unknown) => Array.isArray(v) ? v.map(x => clean(x)).find(Boolean) : undefined;
const lock = (q: Q, uid: string) => q.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`radar-education:${uid}`}, 0))`);

/** Persisted read-only access, including configured grandfather eligibility; no billing/provider writes. */
export async function educationOwnerAccess(user: { id: string; email: string; guest: boolean }, q: Q = db) {
  if (user.guest) return false;
  if (!billingEnforced(user.email)) return true;
  const [account] = await q.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId, user.id)).limit(1);
  if (accountGrants(account)) return true;
  const cutoff = grandfatherCutoff();
  if (!cutoff) return false;
  const [old] = await q.select({ id: B.id }).from(B).where(and(eq(B.ownerId, user.id), eq(B.status, 'active'), sql`${B.createdAt} < ${cutoff.toISOString()}::timestamptz`)).limit(1);
  return !!old;
}

/** Deterministic owned profile only. A member-only account receives neutral copy, never another owner's details. */
export async function educationContext(userId: string, q: Q = db): Promise<{ context: EducationContext; businessId?: string }> {
  const [u] = await q.select().from(U).where(eq(U.id, userId)).limit(1);
  if (!u || u.guest) return { context: { gscConnected: false, access: 'setup' } };
  const own = await educationOwnerAccess(u, q);
  const owned = () => q.select({ b: B }).from(B).innerJoin(schema.members, and(eq(schema.members.businessId, B.id), eq(schema.members.userId, userId), eq(schema.members.status, 'active'))).where(and(eq(B.ownerId, userId), eq(B.status, 'active'))).orderBy(asc(B.createdAt), asc(B.id)).limit(1);
  let b = (await owned())[0]?.b;
  if (!b) b = (await q.select({ b: B }).from(B).innerJoin(schema.members, and(eq(schema.members.businessId, B.id), eq(schema.members.userId, userId), eq(schema.members.status, 'active'))).where(and(eq(B.ownerId, userId), eq(B.status, 'onboarding'))).orderBy(desc(B.createdAt), desc(B.id)).limit(1))[0]?.b;
  const [account] = await q.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId, userId)).limit(1);
  let access: EducationContext['access'] = 'setup';
  if (b?.status === 'active' && own) access = 'workspace';
  else if (b && (b.status === 'active' || b.onboarding?.savedAt)) access = account?.stripeSubscriptionId || (account && !['none', 'incomplete'].includes(account.status)) ? 'restart' : 'start_trial';
  if (!b) {
    const members = await q.select({ owner: U }).from(schema.members).innerJoin(B, eq(B.id, schema.members.businessId)).innerJoin(U, eq(U.id, B.ownerId)).where(and(eq(schema.members.userId, userId), eq(schema.members.status, 'active'), eq(B.status, 'active'))).orderBy(asc(B.createdAt), asc(B.id)).limit(100);
    for (const { owner } of members) if (await educationOwnerAccess(owner, q)) { access = 'workspace'; break; }
    return { context: { gscConnected: false, access } };
  }
  const [gsc] = await q.select({ status: schema.gscConnections.status }).from(schema.gscConnections).where(eq(schema.gscConnections.businessId, b.id)).limit(1);
  const p = b.profile;
  const keywords: { kw?: unknown; priority?: boolean }[] = Array.isArray(p?.keywords?.list) ? p.keywords.list.filter((k: unknown) => k !== null && typeof k === 'object') : [];
  const keyword = keywords.find(k => k.priority && clean(k.kw)) || keywords.find(k => clean(k.kw));
  return { businessId: b.id, context: { businessName: clean(p?.business?.name, 120) || clean(b.domain, 120), industry: clean(p?.business?.industry), offering: first(p?.business?.offerings), audience: first(p?.audience?.segments), keyword: clean(keyword?.kw), gscConnected: gsc?.status === 'connected', access } };
}

/** Indexed bounded discovery also enrolls old accounts that verify today. Atomic keys protect concurrent invocations. */
export async function collectEducation(now = new Date(), onlyUsers?: string[]) {
  if (!educationEnabled() || (onlyUsers && !onlyUsers.length)) return { enrolled: 0, queued: 0 };
  const P = schema.userEmailPreferences;
  const candidates = await db.select({ id: U.id }).from(U).leftJoin(E, eq(E.userId, U.id)).leftJoin(P, eq(P.userId, U.id)).where(and(eq(U.guest, false), isNotNull(U.emailVerifiedAt), isNull(E.userId), sql`coalesce(${P.education}, ${P.onboarding}, true)`, ...(onlyUsers ? [inArray(U.id, onlyUsers)] : []))).orderBy(asc(U.emailVerifiedAt), asc(U.id)).limit(100);
  let enrolled = 0, queued = 0;
  for (const { id } of candidates) await db.transaction(async tx => {
    await lock(tx, id);
    const [user] = await tx.select().from(U).where(eq(U.id, id)).limit(1);
    if (!user || user.guest || !user.emailVerifiedAt || !await educationAllowed(id, tx)) return;
    const rows = await tx.insert(E).values({ userId: id, nextDueAt: now, createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ id: E.userId });
    enrolled += rows.length;
  });
  const due = await db.select({ id: E.userId }).from(E).where(and(eq(E.status, 'active'), isNull(E.pendingEmailId), lte(E.nextDueAt, now), ...(onlyUsers ? [inArray(E.userId, onlyUsers)] : []))).orderBy(asc(E.nextDueAt), asc(E.userId)).limit(100);
  for (const { id } of due) await db.transaction(async tx => {
    await lock(tx, id);
    const [e] = await tx.select().from(E).where(eq(E.userId, id)).for('update');
    if (!e || e.status !== 'active' || e.pendingEmailId || e.nextDueAt > now || e.nextLesson >= EDUCATION_LESSONS.length) return;
    const [u] = await tx.select().from(U).where(eq(U.id, id)).limit(1);
    if (!u || u.guest || !u.emailVerifiedAt || !await educationAllowed(id, tx)) {
      await tx.update(E).set({ status: 'paused', reason: 'recipient_or_preference', updatedAt: now }).where(eq(E.userId, id)); return;
    }
    const after = await optionalDeliveryAfter(id, now, undefined, tx, 'weekly_education');
    const current = await educationContext(id, tx), lesson = EDUCATION_LESSONS[e.nextLesson];
    const eventKey = `education:v1:${id}:${lesson}`;
    await queueLifecycle(tx, { userId: id, type: 'weekly_education', eventKey, sendAt: after || now, data: { education: { version: 1, lesson, ...current } } });
    const [mail] = await tx.select().from(M).where(eq(M.eventKey, eventKey)).limit(1);
    if (!mail || !['queued', 'sending'].includes(mail.status)) {
      await tx.update(E).set({ status: 'blocked', reason: 'existing_terminal_step', updatedAt: now }).where(eq(E.userId, id)); return;
    }
    await tx.update(E).set({ pendingEmailId: mail.id, updatedAt: now }).where(eq(E.userId, id)); queued++;
  });
  return { enrolled, queued };
}

type Prepared = { kind: 'send'; payload: LifecyclePayload } | { kind: 'defer'; until: Date; reason: string } | { kind: 'suppress'; reason: string };
export async function prepareEducation(row: Mail, payload: LifecyclePayload, now = new Date()): Promise<Prepared> {
  if (!educationEnabled()) return { kind: 'defer', until: new Date(now.getTime() + 3600e3), reason: 'education_paused' };
  const [e] = await db.select().from(E).where(eq(E.userId, row.userId)).limit(1);
  const [u] = await db.select().from(U).where(eq(U.id, row.userId)).limit(1);
  const d = payload.data.education;
  if (!d?.context || typeof d.context.gscConnected !== 'boolean' || !['workspace', 'start_trial', 'restart', 'setup'].includes(d.context.access) ||
    !Array.isArray(payload.envelope.to) || ['businessName', 'industry', 'offering', 'audience', 'keyword'].some(key => { const value = d.context[key as keyof EducationContext]; return value !== undefined && (typeof value !== 'string' || value.length > 200); })) return { kind: 'suppress', reason: 'invalid_education_payload' };
  if (!e || e.pendingEmailId !== row.id || e.version !== 1 || d?.version !== 1 || d.lesson !== EDUCATION_LESSONS[e.nextLesson] || ['blocked', 'completed'].includes(e.status)) return { kind: 'suppress', reason: 'invalid_education_step' };
  if (!u || u.guest || !u.emailVerifiedAt || u.email.endsWith('@guest.radar.invalid') || payload.envelope.to.length !== 1 || payload.envelope.to[0] !== u.email) return { kind: 'suppress', reason: 'recipient_changed' };
  if (!await educationAllowed(u.id) || e.status === 'paused') {
    if (row.firstAttemptAt) return { kind: 'suppress', reason: 'opted_out_after_attempt' };
    await db.update(E).set({ status: 'paused', reason: 'opted_out', updatedAt: now }).where(eq(E.userId, e.userId));
    return { kind: 'defer', until: new Date(now.getTime() + 864e5), reason: 'education_opted_out' };
  }
  if (e.lastAcceptedAt && e.lastAcceptedAt.getTime() + EDUCATION_WEEK > now.getTime()) return { kind: 'defer', until: new Date(e.lastAcceptedAt.getTime() + EDUCATION_WEEK), reason: 'education_weekly_cadence' };
  const current = await educationContext(u.id);
  if (row.firstAttemptAt) {
    if (current.businessId !== d.businessId || current.context.access !== d.context.access || current.context.gscConnected !== d.context.gscConnected) return { kind: 'suppress', reason: 'unsafe_retry_context' };
    return { kind: 'send', payload };
  }
  return { kind: 'send', payload: lifecyclePayload('weekly_education', u, { education: { version: 1, lesson: d.lesson, ...current } }) };
}

/** The same transaction must save provider acceptance and progression, including a retry after a lost acknowledgment. */
export async function acknowledgeEducation(q: Q, row: Mail, acceptedAt: Date) {
  const [e] = await q.select().from(E).where(eq(E.userId, row.userId)).for('update');
  if (!e || e.pendingEmailId !== row.id || !['active', 'paused'].includes(e.status) || e.nextLesson >= EDUCATION_LESSONS.length || row.eventKey !== `education:v1:${row.userId}:${EDUCATION_LESSONS[e.nextLesson]}`) throw new Error('Education acknowledgment state changed');
  const nextLesson = e.nextLesson + 1;
  await q.update(E).set({ nextLesson, pendingEmailId: null, lastAcceptedAt: acceptedAt, nextDueAt: new Date(acceptedAt.getTime() + EDUCATION_WEEK), status: nextLesson === EDUCATION_LESSONS.length ? 'completed' : e.status, reason: null, updatedAt: acceptedAt }).where(eq(E.userId, e.userId));
}
export async function blockEducation(q: Q, row: Mail, reason: string, now = new Date()) {
  await q.update(E).set({ status: 'blocked', reason, updatedAt: now }).where(and(eq(E.userId, row.userId), eq(E.pendingEmailId, row.id)));
}
