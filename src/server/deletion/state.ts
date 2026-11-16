// What every gate needs to know about a deleted business (.factory/delete-business/architecture.md §3.1). This file
// imports only the database and the error type, so access.ts, the job queue and ai.run can import it without a cycle.
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { RadarError } from '../errors';
import { DELETE_RETENTION_HOURS } from '@/lib/deletion';

/** How long a deleted business is kept, as Postgres reads it. `businesses_deleted_check` holds the same 168 hours. */
export const RETENTION_INTERVAL = sql.raw(`interval '${DELETE_RETENTION_HOURS} hours'`);
/** What a job that was cancelled or refused for a deleted business records as its result. */
export const SKIPPED_DELETED = { skipped: 'deleted' } as const;

/** 404 for a member of a deleted business. The copy is the ordinary "not found"; the code tells an open tab to leave. */
export const businessDeleted = () => new RadarError('Business wasn’t found.', 404, 'business_deleted');

/** True only for a business that exists and is marked deleted. A missing row is the caller's "not found". */
export async function isBusinessDeleted(bid: string): Promise<boolean> {
  const r = await db.select({ status: schema.businesses.status }).from(schema.businesses).where(eq(schema.businesses.id, bid)).limit(1);
  return r[0]?.status === 'deleted';
}
