// Optional work reminders. Sources store references only; useful current state is checked again before delivery.
import { and, asc, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import type { Q } from '@/server/billing/draft';
import { accountGrants, billingEnforced } from '@/server/billing/access';
import { addDays, nowHMIn, todayIn } from '@/lib/format';
import { zonedTimeToUtc } from '@/lib/socialPublish';
import type { Article, BriefItem, SocialPack } from '@/lib/types';
import { engagementKey, type EngagementPreference } from './preferences';
import { queueLifecycle, type LifecyclePayload } from './queue';
import type { WorkUpdateSection } from './templates';

const E = schema.engagementEvents, M = schema.lifecycleEmails, B = schema.businesses, P = schema.userEmailPreferences;
export type EngagementKind = typeof E.$inferSelect.kind;
export type EngagementEvent = typeof E.$inferSelect;
export const WORK_DELAYS = { brief_reply: 3600e3, calendar_review: 24 * 3600e3, article_social: 2 * 3600e3, social_publish: 24 * 3600e3 } as const;
const DAY = 864e5;
const sinceKey = (key: EngagementPreference) => `${key}Since` as const;
const zone = (tz: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(); return tz; } catch { return 'UTC'; } };

/** Called inside the source write transaction. Existing source keys can never be reopened by regeneration or retries. */
export async function recordEngagement(q: Q, input: { businessId: string; kind: EngagementKind; ref: string; entryIds?: string[]; now?: Date }) {
  const now = input.now || new Date();
  if (!input.ref || input.ref.length > 200 || (input.entryIds?.length || 0) > 100) throw new Error('Invalid work reminder source');
  const [b] = await q.select({ ownerId: B.ownerId, status: B.status, timezone: B.timezone, guest: schema.users.guest, verified: schema.users.emailVerifiedAt }).from(B).innerJoin(schema.users, eq(schema.users.id, B.ownerId)).where(eq(B.id, input.businessId)).limit(1);
  if (!b || b.status !== 'active' || b.guest || !b.verified) return;
  const [p] = await q.select().from(P).where(eq(P.userId, b.ownerId)).limit(1);
  const key = engagementKey(input.kind), since = p?.[sinceKey(key)];
  if (p?.[key] === false || (since && since > now)) return;
  const tz = zone(b.timezone);
  if (input.kind === 'brief_reply' && input.ref !== todayIn(tz, now)) return;
  const sourceKey = `${input.kind}:${input.businessId}:${input.ref}`;
  await q.insert(E).values({ userId: b.ownerId, businessId: input.businessId, kind: input.kind, sourceKey,
    sourceRef: { ref: input.ref, ...(input.entryIds ? { entryIds: input.entryIds } : {}) }, occurredAt: now,
    eligibleAt: new Date(now.getTime() + WORK_DELAYS[input.kind]), expiresAt: input.kind === 'brief_reply' ? new Date(zonedTimeToUtc(addDays(input.ref, 1), '00:00', tz)) : new Date(now.getTime() + 7 * DAY),
  }).onConflictDoNothing({ target: E.sourceKey });
}

export async function resolveEngagement(q: Q, businessId: string, kind: EngagementKind, ref: string, reason = 'action_taken', now = new Date()) {
  await q.update(E).set({ resolvedAt: sql`coalesce(${E.resolvedAt}, ${now.toISOString()}::timestamptz)`, resolvedReason: reason }).where(and(eq(E.businessId, businessId), eq(E.kind, kind), sql`${E.sourceRef}->>'ref' = ${ref}`, or(isNull(E.resolvedAt), eq(E.resolvedReason, 'queued'))));
}
export async function resolveCalendarForEntries(q: Q, businessId: string, entryIds: string[]) {
  if (!entryIds.length) return;
  const events = await q.select().from(E).where(and(eq(E.businessId, businessId), eq(E.kind, 'calendar_review'), or(isNull(E.resolvedAt), eq(E.resolvedReason, 'queued'))));
  for (const e of events) if (e.sourceRef.entryIds?.some(id => entryIds.includes(id))) await resolveEngagement(q, businessId, 'calendar_review', e.sourceRef.ref);
}

async function activeOwner(q: Q, e: EngagementEvent) {
  const [r] = await q.select({ b: B, email: schema.users.email, guest: schema.users.guest, verified: schema.users.emailVerifiedAt }).from(B)
    .innerJoin(schema.users, eq(schema.users.id, B.ownerId)).innerJoin(schema.members, and(eq(schema.members.businessId, B.id), eq(schema.members.userId, e.userId), eq(schema.members.status, 'active')))
    .where(and(eq(B.id, e.businessId), eq(B.ownerId, e.userId), eq(B.status, 'active'))).limit(1);
  if (!r || r.guest || !r.verified) return null;
  // A reminder must never reactivate billing or lazy-grandfather an account while checking eligibility.
  if (billingEnforced(r.email)) {
    const [account] = await q.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId, e.userId)).limit(1);
    if (!accountGrants(account)) return null;
  }
  return r.b;
}

/** A user taking any meaningful next action resolves the source, rather than nagging about leftover items. */
export async function engagementSection(e: EngagementEvent, now = new Date(), q: Q = db): Promise<WorkUpdateSection | null> {
  if (e.eligibleAt > now || e.expiresAt <= now) return null;
  const key = engagementKey(e.kind);
  const [p] = await q.select().from(P).where(eq(P.userId, e.userId)).limit(1);
  const since = p?.[sinceKey(key)];
  if (p?.[key] === false || (since && e.occurredAt < since)) return null;
  const b = await activeOwner(q, e);
  if (!b) return null;
  const base = { eventId: e.id, kind: e.kind, businessId: e.businessId, businessName: String(b.profile?.business?.name || b.domain).slice(0, 200), ref: e.sourceRef.ref };
  if (e.kind === 'brief_reply') {
    if (e.sourceRef.ref !== todayIn(zone(b.timezone), now)) return null;
    const [day] = await q.select().from(schema.briefDays).where(and(eq(schema.briefDays.businessId, e.businessId), eq(schema.briefDays.date, e.sourceRef.ref))).limit(1);
    const replies = (day?.items || []).filter((i: BriefItem) => i.kind === 'reply' && /^https?:\/\//i.test(i.url || '')) as BriefItem[];
    if (!replies.length || replies.some(i => ['copied', 'posted', 'scheduled', 'skipped'].includes(i.st))) return null;
    const open = replies.filter(i => i.st === 'open');
    if (!open.length) return null;
    // Publication state is stored separately and may not have been projected into the day's JSON yet.
    const pubs = await q.select({ id: schema.socialPubs.id }).from(schema.socialPubs).where(and(eq(schema.socialPubs.businessId, e.businessId), inArray(schema.socialPubs.sid, replies.map(i => `b:${e.sourceRef.ref}:${i.id}`)))).limit(1);
    if (pubs.length) return null; // a publishing attempt is already follow-through, including a recoverable failure
    return { ...base, count: open.length };
  }
  if (e.kind === 'calendar_review') {
    if (b.calendarGeneratedAt?.toISOString() !== e.sourceRef.ref) return null;
    const ids = e.sourceRef.entryIds || [];
    if (!ids.length) return null;
    const entries = await q.select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.businessId, e.businessId), inArray(schema.calendarEntries.id, ids)));
    if (entries.length !== ids.length || entries.some(r => r.status !== 'proposed')) return null;
    return { ...base, count: entries.length };
  }
  if (e.kind === 'article_social') {
    const [r] = await q.select({ entry: schema.calendarEntries, data: schema.articles.data }).from(schema.calendarEntries)
      .innerJoin(schema.articles, and(eq(schema.articles.entryId, schema.calendarEntries.id), eq(schema.articles.businessId, e.businessId)))
      .where(and(eq(schema.calendarEntries.id, e.sourceRef.ref), eq(schema.calendarEntries.businessId, e.businessId))).limit(1);
    const article = r?.data as Article | undefined;
    if (!article?.generated || !article.body?.length || !['review', 'approved', 'scheduled', 'published'].includes(r.entry.status)) return null;
    const [used] = await q.select({ id: schema.socialPacks.id }).from(schema.socialPacks).where(and(eq(schema.socialPacks.businessId, e.businessId), sql`${schema.socialPacks.data}->'source'->>'kind' = 'article'`, sql`${schema.socialPacks.data}->'source'->>'ref' = ${e.sourceRef.ref}`)).limit(1);
    if (used) return null;
    return { ...base, count: 1, title: r.entry.title.slice(0, 300) };
  }
  const [pack] = await q.select().from(schema.socialPacks).where(and(eq(schema.socialPacks.id, e.sourceRef.ref), eq(schema.socialPacks.businessId, e.businessId))).limit(1);
  const data = pack?.data as SocialPack | undefined;
  const posts = Object.values(data?.posts || {}).filter(Boolean);
  if (!posts.length || posts.some(p => p!.copiedAt != null || ['scheduled', 'sending', 'posted'].includes(p!.pub?.status || ''))) return null;
  const pubs = await q.select({ sid: schema.socialPubs.sid }).from(schema.socialPubs).where(and(eq(schema.socialPubs.businessId, e.businessId), eq(schema.socialPubs.src, 'pack')));
  if (pubs.some(p => p.sid.startsWith(`s:${e.sourceRef.ref}:`))) return null;
  return { ...base, count: posts.length, title: String(data?.name || '').slice(0, 300) };
}

/** All optional mail shares a rolling cap. Ambiguous attempts count, even when their acknowledgment was lost. */
export async function optionalDeliveryAfter(userId: string, now = new Date(), excludeId?: string, q: Q = db, type = 'work_update'): Promise<Date | null> {
  const rows = await q.select({ at: M.firstAttemptAt, sent: M.sentAt, created: M.createdAt, status: M.status }).from(M).where(and(eq(M.userId, userId), inArray(M.type, ['work_update', 'founder_note', 'weekly_education', 'lifecycle_guide']), ...(excludeId ? [ne(M.id, excludeId)] : []), or(gt(M.firstAttemptAt, new Date(now.getTime() - DAY)), gt(M.sentAt, new Date(now.getTime() - DAY)), and(eq(M.status, 'logged'), gt(M.createdAt, new Date(now.getTime() - DAY))))));
  const latest = rows.reduce((t, r) => Math.max(t, r.sent?.getTime() || 0, r.at?.getTime() || 0, r.status === 'logged' ? r.created.getTime() : 0), 0);
  if (latest && latest + DAY > now.getTime()) return new Date(latest + DAY);
  // One stable owner timezone across all businesses, rather than allowing another workspace to evade quiet hours.
  let [b] = await q.select({ timezone: B.timezone }).from(B).where(and(eq(B.ownerId, userId), eq(B.status, 'active'))).orderBy(asc(B.createdAt), asc(B.id)).limit(1);
  if (!b && (type === 'weekly_education' || type === 'lifecycle_guide')) [b] = await q.select({ timezone: B.timezone }).from(B).where(and(eq(B.ownerId, userId), eq(B.status, 'onboarding'))).orderBy(sql`${B.createdAt} desc`, sql`${B.id} desc`).limit(1);
  const tz = zone(b?.timezone || 'UTC');
  const time = nowHMIn(tz, now), hour = Number(time.slice(0, 2));
  if (hour >= 9 && hour < 18) return null;
  const day = todayIn(tz, now);
  return new Date(zonedTimeToUtc(hour < 9 ? day : addDays(day, 1), '09:00', tz));
}

/** Existing cron invokes this; transaction lock also makes direct/concurrent invocations safe. */
export async function collectWorkUpdates(now = new Date(), onlyUsers?: string[]) {
  const due = await db.selectDistinct({ userId: E.userId }).from(E).where(and(isNull(E.resolvedAt), lte(E.eligibleAt, now), ...(onlyUsers ? [inArray(E.userId, onlyUsers)] : []))).limit(200);
  let queued = 0;
  for (const { userId } of due) await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`radar-work:${userId}`}, 0))`);
    const active = await tx.select({ id: M.id }).from(M).where(and(eq(M.userId, userId), eq(M.type, 'work_update'), inArray(M.status, ['queued', 'sending']))).limit(1);
    const after = active.length ? new Date(now.getTime() + 3600e3) : await optionalDeliveryAfter(userId, now, undefined, tx);
    if (after) {
      // Advance only already-due unassigned work, so capped/quiet owners cannot monopolize the bounded user page.
      await tx.update(E).set({ eligibleAt: after }).where(and(eq(E.userId, userId), isNull(E.resolvedAt), lte(E.eligibleAt, now)));
      return;
    }
    const candidates = await tx.select().from(E).where(and(eq(E.userId, userId), isNull(E.resolvedAt), lte(E.eligibleAt, now))).orderBy(asc(E.expiresAt), asc(E.createdAt)).limit(100);
    const sections: WorkUpdateSection[] = [], kinds = new Set<EngagementKind>();
    for (const e of candidates) {
      const section = await engagementSection(e, now, tx);
      if (!section) { await tx.update(E).set({ resolvedAt: now, resolvedReason: 'no_longer_actionable' }).where(and(eq(E.id, e.id), isNull(E.resolvedAt))); continue; }
      if (sections.length >= 3 || kinds.has(e.kind)) continue;
      sections.push(section); kinds.add(e.kind);
    }
    if (!sections.length) return;
    const eventKey = `work-update:${userId}:${now.toISOString().slice(0, 10)}`;
    if ((await tx.select({ id: M.id }).from(M).where(eq(M.eventKey, eventKey)).limit(1)).length) {
      const tomorrowUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      await tx.update(E).set({ eligibleAt: tomorrowUtc }).where(and(eq(E.userId, userId), isNull(E.resolvedAt), lte(E.eligibleAt, now)));
      return;
    }
    await queueLifecycle(tx, { type: 'work_update', userId, eventKey, data: { workSections: sections }, sendAt: now });
    const [mail] = await tx.select({ id: M.id }).from(M).where(eq(M.eventKey, eventKey)).limit(1);
    if (!mail) return;
    // Tombstone at assignment: deleting a queued/sent email can never reopen the same source for another reminder.
    await tx.update(E).set({ lifecycleEmailId: mail.id, resolvedAt: now, resolvedReason: 'queued' }).where(inArray(E.id, sections.map(s => s.eventId)));
    queued++;
  });
  return { queued };
}

/** Rebuild only before the provider's first attempt. Thereafter the exact frozen payload is either retried or suppressed. */
export async function currentWorkSections(row: typeof M.$inferSelect, payload: LifecyclePayload, now = new Date()) {
  const sections = payload.data.workSections;
  if (!sections?.length || sections.length > 3 || new Set(sections.map(s => s.eventId)).size !== sections.length) return [];
  const events = await db.select().from(E).where(and(eq(E.userId, row.userId), eq(E.lifecycleEmailId, row.id), inArray(E.id, sections.map(s => s.eventId))));
  const out: WorkUpdateSection[] = [];
  for (const frozen of sections) {
    const e = events.find(e => e.id === frozen.eventId);
    if (!e || e.kind !== frozen.kind || e.businessId !== frozen.businessId || e.sourceRef.ref !== frozen.ref || e.resolvedReason !== 'queued') continue;
    const current = await engagementSection(e, now);
    if (current) out.push(current);
  }
  return out;
}
