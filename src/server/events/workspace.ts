import { publicPublishingJob } from '@/lib/publishingFailure';
import { and, eq, gte, inArray, or } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { coalescedReads } from './cache';

/** Only call after the route has authorized membership. No actor/session decisions are cached here. */
export const workspaceEvents = coalescedReads(async (bid: string) => {
  const [business, jobs, notifications] = await Promise.all([
    db.select({ rev: schema.businesses.rev }).from(schema.businesses).where(eq(schema.businesses.id, bid)).limit(1),
    db.select({ id: schema.jobs.id, kind: schema.jobs.kind, status: schema.jobs.status, progress: schema.jobs.progress,
      error: schema.jobs.error, ref: schema.jobs.ref, result: schema.jobs.result, createdAt: schema.jobs.createdAt })
      .from(schema.jobs).where(and(eq(schema.jobs.businessId, bid), or(inArray(schema.jobs.status, ['queued', 'running']),
        gte(schema.jobs.finishedAt, new Date(Date.now() - 15000))))),
    db.select().from(schema.notifications).where(and(eq(schema.notifications.businessId, bid),
      gte(schema.notifications.createdAt, new Date(Date.now() - 5 * 60_000)))).orderBy(schema.notifications.createdAt),
  ]);
  return { rev: business[0]?.rev, jobs: jobs.map(publicPublishingJob), notifications };
});
