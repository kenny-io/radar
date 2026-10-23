// Impact metrics over a date range (used by /api/admin/metrics; also callable from scripts).
import { and, gte, inArray, lt, sql } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { IMPACT } from '@/server/events';

export async function impactMetrics(from: string, to: string, by: 'week' | 'month') {
  const E = schema.events;
  const range = and(gte(E.createdAt, new Date(from + 'T00:00:00Z')), lt(E.createdAt, new Date(to + 'T00:00:00Z')), inArray(E.kind, Object.keys(IMPACT)));

  const totals = await db.select({ kind: E.kind, n: sql<number>`count(*)::int`, businesses: sql<number>`count(distinct ${E.businessId})::int` }).from(E).where(range).groupBy(E.kind);
  const series = await db.select({ period: sql<string>`to_char(date_trunc(${by}, ${E.createdAt}), 'YYYY-MM-DD')`, kind: E.kind, n: sql<number>`count(*)::int` })
    .from(E).where(range).groupBy(sql`1`, E.kind).orderBy(sql`1`);
  // Derived figures a report usually wants.
  const [d] = (await db.execute(sql`
    SELECT
      coalesce(sum((props->>'threadsRead')::int) FILTER (WHERE kind = 'brief.scanned'), 0)::int AS "threadsRead",
      count(*) FILTER (WHERE kind = 'brief.reply_posted' AND props->>'plugged' = 'true')::int AS "pluggedRepliesPosted",
      count(DISTINCT business_id) FILTER (WHERE kind IN ('brief.reply_posted','brief.post_posted','article.published','social.copied'))::int AS "businessesThatShipped",
      count(DISTINCT business_id)::int AS "activeBusinesses"
    FROM events
    WHERE created_at >= ${from + 'T00:00:00Z'}::timestamptz AND created_at < ${to + 'T00:00:00Z'}::timestamptz AND kind IN ${Object.keys(IMPACT)}`)).rows as any[];
  const byPlat = (await db.execute(sql`
    SELECT props->>'plat' AS plat, count(*)::int AS n FROM events
    WHERE kind = 'brief.reply_posted' AND created_at >= ${from + 'T00:00:00Z'}::timestamptz AND created_at < ${to + 'T00:00:00Z'}::timestamptz
    GROUP BY 1 ORDER BY 2 DESC`)).rows as any[];

  // Social channels (AC-23): share of scheduled posts sent, and how often accounts need reconnecting.
  const [so] = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE kind = 'social.posted' AND props->>'scheduled' = 'true')::int AS sent,
      count(*) FILTER (WHERE kind = 'social.failed' AND props->>'scheduled' = 'true')::int AS failed,
      count(*) FILTER (WHERE kind = 'social.failed' AND props->>'code' = 'quota')::int AS "quotaFailures",
      count(*) FILTER (WHERE kind = 'social.expired')::int AS expiries,
      count(*) FILTER (WHERE kind = 'social.reconnected')::int AS reconnects,
      count(DISTINCT props->>'acct') FILTER (WHERE kind IN ('social.connected','social.reconnected','social.expired','social.posted','social.scheduled'))::int AS accts
    FROM events
    WHERE created_at >= ${from + 'T00:00:00Z'}::timestamptz AND created_at < ${to + 'T00:00:00Z'}::timestamptz AND kind LIKE 'social.%'`)).rows as any[];
  const [{ n: accountsConnected }] = (await db.execute(sql`SELECT count(*)::int AS n FROM social_accounts`)).rows as any[];
  const social = {
    scheduledSent: so.sent, scheduledFailed: so.failed, scheduledSuccessRate: so.sent + so.failed ? so.sent / (so.sent + so.failed) : null,
    quotaFailures: so.quotaFailures, expiries: so.expiries, reconnects: so.reconnects, accountsConnected,
    expiriesPerAccount: so.expiries / Math.max(1, so.accts),
  };

  const metrics = Object.entries(IMPACT).map(([kind, label]) => { const t = totals.find(x => x.kind === kind); return { kind, label, count: t?.n || 0, businesses: t?.businesses || 0 }; });
  return { metrics, derived: { ...d, briefRepliesPostedByPlatform: byPlat, social }, series };
}
