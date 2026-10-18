import { lt, and, inArray } from 'drizzle-orm';
import { db, schema } from '../db';
import { defineCron } from './cron';
// Housekeeping: prune finished jobs (>14 days), old notifications (>1 day), expired sessions and oauth states.
defineCron('maintenance', async (now) => {
  if (now.getUTCMinutes() !== 7) return;
  await db.delete(schema.jobs).where(and(inArray(schema.jobs.status, ['done', 'failed']), lt(schema.jobs.createdAt, new Date(now.getTime() - 14 * 864e5))));
  await db.delete(schema.notifications).where(lt(schema.notifications.createdAt, new Date(now.getTime() - 864e5)));
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now));
  await db.delete(schema.oauthStates).where(lt(schema.oauthStates.createdAt, new Date(now.getTime() - 3600e3)));
});
