import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { defineCron } from '@/server/jobs/cron';
import { defineJob } from '@/server/jobs/queue';
import { sendMail } from '@/server/services/mail';
import { digestPreferencesUrl } from './digestPreferences';
import { visibilitySummary } from './history';
import { recommendationDigestContent } from './digestContent';
export { recommendationDigestText } from './digestContent';

interface DigestPayload { bid: string; ownerId: string; to: string; subject: string; text: string; html?: string; key: string }
defineJob<DigestPayload>({ kind: 'visibility.digest', maxAttempts: 3, run: async ctx => {
  const p = ctx.payload;
  const [owner] = await db.select({ weekly: schema.visibilityPreferences.weeklyEmail, email: schema.users.email, guest: schema.users.guest })
    .from(schema.businesses).innerJoin(schema.users, eq(schema.users.id, schema.businesses.ownerId))
    .leftJoin(schema.visibilityPreferences, eq(schema.visibilityPreferences.businessId, schema.businesses.id))
    .where(and(eq(schema.businesses.id, p.bid), eq(schema.businesses.ownerId, p.ownerId), eq(schema.businesses.status, 'active'))).limit(1);
  if (!owner || owner.weekly === false || owner.guest || owner.email !== p.to) return { skipped: 'preference_or_recipient_changed' };
  await sendMail(p.to, p.subject, p.text, p.html, { idempotencyKey: p.key });
  return { sent: true };
} });
/** Monday after 08:00 UTC, with atomic schedule marks+job insertion and persisted, retry-stable mail payloads. */
defineCron('visibility.weeklyDigest', async now => {
  if (now.getUTCDay() !== 1 || now.getUTCHours() < 8) return;
  const rows = await db.select({ id: schema.businesses.id, ownerId: schema.businesses.ownerId, domain: schema.businesses.domain, email: schema.users.email, guest: schema.users.guest }).from(schema.businesses)
    .innerJoin(schema.users, eq(schema.users.id, schema.businesses.ownerId))
    .leftJoin(schema.visibilityPreferences, eq(schema.visibilityPreferences.businessId, schema.businesses.id))
    .where(and(eq(schema.businesses.status, 'active'), sql`coalesce(${schema.visibilityPreferences.weeklyEmail}, true)`));
  for (const row of rows) {
    if (row.guest) continue;
    const summary = await visibilitySummary(row.id, now);
    if (!summary.weekly.current.collected) continue;
    const key = `visibility-weekly:${row.id}:${summary.weekly.end}:${row.ownerId}`;
    const preferencesUrl = digestPreferencesUrl(row.id, row.ownerId);
    const { text, html } = recommendationDigestContent(summary, env.appUrl, preferencesUrl);
    const payload: DigestPayload = { bid: row.id, ownerId: row.ownerId, to: row.email, subject: `Recommendation share this week · ${row.domain}`, text, html, key };
    await db.transaction(async tx => {
      const mark = await tx.insert(schema.cronMarks).values({ key }).onConflictDoNothing().returning();
      if (!mark.length) return;
      await tx.insert(schema.jobs).values({ kind: 'visibility.digest', payload, businessId: row.id, ref: row.id, singletonKey: key, maxAttempts: 3 });
    });
  }
});

