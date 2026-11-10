import { lt, and, inArray } from 'drizzle-orm';
import { db, schema } from '../db';
import { defineCron } from './cron';

/** Notifications are the Activity list (first-five architecture §4): kept this long, then pruned. */
export const NOTIFICATION_DAYS = 30;
export async function pruneNotifications(now: Date) {
  await db.delete(schema.notifications).where(lt(schema.notifications.createdAt, new Date(now.getTime() - NOTIFICATION_DAYS * 864e5)));
}
// Housekeeping: prune finished jobs (>14 days), old notifications (>30 days), expired sessions and oauth states.
defineCron('maintenance', async (now) => {
  if (now.getUTCMinutes() !== 7) return;
  await db.delete(schema.jobs).where(and(inArray(schema.jobs.status, ['done', 'failed']), lt(schema.jobs.createdAt, new Date(now.getTime() - 14 * 864e5))));
  await pruneNotifications(now);
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now));
  await db.delete(schema.emailVerificationTokens).where(lt(schema.emailVerificationTokens.expiresAt, now));
  await db.delete(schema.oauthStates).where(lt(schema.oauthStates.createdAt, new Date(now.getTime() - 3600e3)));
});
