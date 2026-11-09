import crypto from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { hmacSha256 } from '@/server/crypto';
const secret = () => {
  if (!env.secretKey && env.isProd) throw new Error('RADAR_SECRET_KEY is required');
  return env.secretKey || 'radar-dev-only-key';
};
export function preferenceToken(userId: string) { return `${userId}.${hmacSha256(secret(), `radar-onboarding-optout:${userId}`)}`; }
export function preferenceUser(token: string): string | null {
  const [id, signature, extra] = token.split('.');
  if (extra || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id || '') || !/^[\da-f]{64}$/.test(signature || '')) return null;
  const expected = preferenceToken(id).split('.')[1];
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? id : null;
}
export async function stopOnboarding(userId: string) {
  await db.insert(schema.userEmailPreferences).values({ userId, onboarding: false }).onConflictDoUpdate({ target: schema.userEmailPreferences.userId, set: { onboarding: false, updatedAt: new Date() } });
}
export async function onboardingAllowed(userId: string) {
  const [p] = await db.select().from(schema.userEmailPreferences).where(eq(schema.userEmailPreferences.userId, userId)).limit(1);
  return p?.onboarding !== false;
}

export interface EngagementPreferences { dailyBrief: boolean; calendarReminders: boolean; articleSocial: boolean }
export const ENGAGEMENT_KEYS = ['dailyBrief', 'calendarReminders', 'articleSocial'] as const;
export type EngagementPreference = typeof ENGAGEMENT_KEYS[number];
export const engagementKey = (kind: string): EngagementPreference => kind === 'brief_reply' ? 'dailyBrief' : kind === 'calendar_review' ? 'calendarReminders' : 'articleSocial';
const flags = (p?: Partial<EngagementPreferences>): EngagementPreferences => ({ dailyBrief: p?.dailyBrief !== false, calendarReminders: p?.calendarReminders !== false, articleSocial: p?.articleSocial !== false });
export async function getEngagementPreferences(userId: string): Promise<EngagementPreferences> {
  return flags((await db.select().from(schema.userEmailPreferences).where(eq(schema.userEmailPreferences.userId, userId)).limit(1))[0]);
}
/** An enable timestamp is reset only on a genuine off→on transition. Turning off never reopens old source events. */
export async function updateEngagementPreferences(userId: string, patch: Partial<EngagementPreferences>, now = new Date()): Promise<EngagementPreferences> {
  if (!Object.keys(patch).length || Object.entries(patch).some(([k, v]) => !ENGAGEMENT_KEYS.includes(k as EngagementPreference) || typeof v !== 'boolean')) throw new Error('Invalid email preferences');
  return db.transaction(async tx => {
    const P = schema.userEmailPreferences;
    await tx.insert(P).values({ userId }).onConflictDoNothing();
    const [current] = await tx.select().from(P).where(eq(P.userId, userId)).for('update');
    const changes: Partial<typeof P.$inferInsert> = { updatedAt: now };
    const disabled: ('brief_reply' | 'calendar_review' | 'article_social' | 'social_publish')[] = [];
    for (const key of ENGAGEMENT_KEYS) {
      if (patch[key] === undefined) continue;
      changes[key] = patch[key];
      if (patch[key] && current[key] === false) changes[`${key}Since`] = now;
      if (!patch[key]) changes[`${key}Since`] = null;
      if (!patch[key]) disabled.push(...(key === 'dailyBrief' ? ['brief_reply' as const] : key === 'calendarReminders' ? ['calendar_review' as const] : ['article_social' as const, 'social_publish' as const]));
    }
    const [saved] = await tx.update(P).set(changes).where(eq(P.userId, userId)).returning();
    if (disabled.length) await tx.update(schema.engagementEvents).set({ resolvedAt: now, resolvedReason: 'opted_out' }).where(and(eq(schema.engagementEvents.userId, userId), inArray(schema.engagementEvents.kind, disabled), isNull(schema.engagementEvents.resolvedAt)));
    return flags(saved);
  });
}
/** A separate purpose and format prevents old founder links from opting an owner into/out of work updates. */
export function workPreferenceToken(userId: string) { return `${userId}.work.${hmacSha256(secret(), `radar-work-optout:${userId}`)}`; }
export function workPreferenceUser(token: string): string | null {
  const [id, kind, signature, extra] = token.split('.');
  if (extra || kind !== 'work' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id || '') || !/^[\da-f]{64}$/.test(signature || '')) return null;
  const expected = workPreferenceToken(id).split('.')[2];
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? id : null;
}
export async function stopWorkUpdates(userId: string) { await updateEngagementPreferences(userId, { dailyBrief: false, calendarReminders: false, articleSocial: false }); }

/** Purpose-scoped education tokens never affect other email categories. */
export function educationPreferenceToken(userId: string) { return `${userId}.education.${hmacSha256(secret(), `radar-education-optout:${userId}`)}`; }
export function educationPreferenceUser(token: string): string | null {
  const [id, kind, signature, extra] = token.split('.');
  if (extra || kind !== 'education' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id || '') || !/^[\da-f]{64}$/.test(signature || '')) return null;
  const expected = educationPreferenceToken(id).split('.')[2];
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? id : null;
}
export async function educationAllowed(userId: string, q: Pick<typeof db, 'select'> = db) {
  const [p] = await q.select().from(schema.userEmailPreferences).where(eq(schema.userEmailPreferences.userId, userId)).limit(1);
  return p?.education ?? p?.onboarding ?? true;
}
export async function updateEducationPreference(userId: string, enabled: boolean, now = new Date()) {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`radar-education:${userId}`}, 0))`);
    await tx.insert(schema.userEmailPreferences).values({ userId, education: enabled }).onConflictDoUpdate({ target: schema.userEmailPreferences.userId, set: { education: enabled, updatedAt: now } });
    const E = schema.educationEnrollments;
    const [e] = await tx.select().from(E).where(eq(E.userId, userId)).for('update');
    if (!e || ['completed', 'blocked'].includes(e.status)) return;
    const [pending] = e.pendingEmailId ? await tx.select().from(schema.lifecycleEmails).where(eq(schema.lifecycleEmails.id, e.pendingEmailId)).for('update') : [];
    if (!enabled && pending?.firstAttemptAt) {
      await tx.update(E).set({ status: 'blocked', reason: 'opted_out_after_attempt', updatedAt: now }).where(eq(E.userId, userId));
      if (pending.status === 'queued') await tx.update(schema.lifecycleEmails).set({ status: 'suppressed', lastError: 'opted_out_after_attempt' }).where(eq(schema.lifecycleEmails.id, pending.id));
      return;
    }
    const nextDueAt = new Date(Math.max(now.getTime(), e.lastAcceptedAt ? e.lastAcceptedAt.getTime() + 7 * 864e5 : 0));
    await tx.update(E).set({ status: enabled ? 'active' : 'paused', reason: enabled ? null : 'opted_out', nextDueAt, updatedAt: now }).where(eq(E.userId, userId));
    if (enabled && e.pendingEmailId) await tx.update(schema.lifecycleEmails).set({ nextAttemptAt: nextDueAt, ...(!pending?.firstAttemptAt ? { expiresAt: new Date(nextDueAt.getTime() + 30 * 864e5) } : {}) }).where(and(eq(schema.lifecycleEmails.id, e.pendingEmailId), eq(schema.lifecycleEmails.status, 'queued')));
  });
  return { education: await educationAllowed(userId) };
}
