// Global privacy work intentionally bypasses publishing, billing and deleted-business queue filters. Never uploads.
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { db, schema as S } from '../../../db';
import { clearOnce, defineJob, enqueue, once } from '../../../jobs/queue';
import { decrypt } from '../../../crypto';
import type { Tokens } from './api';
import { trustedClock } from '@/lib/youtubeLifecycle';
import { reportFailure } from '../../../observability/failures';
import { expireYouTubeCaches, REVOKE_JOB, revokeYouTubeJob, verifyYouTubeAccount } from './youtubeRetention';
export const VERIFY_JOB = 'youtube.verify';
export const EXPIRE_JOB = 'youtube.expire';
interface Walk { day: string; cursor?: string }
interface Sweep { accountCursor: string | null; receiptCursor: string | null }
async function enqueueSweep(next: Sweep) {
  await enqueue(EXPIRE_JOB, next, { businessId: null, singletonKey: `youtube.expire:${next.accountCursor || 'done'}:${next.receiptCursor || 'done'}`, maxAttempts: 3 });
}
defineJob<Sweep>({ kind: EXPIRE_JOB, maxAttempts: 3, timeoutMs: 120_000, run: async ctx => {
  const result = await expireYouTubeCaches(new Date(), ctx.payload);
  if (result.next) await enqueueSweep(result.next);
  return { accounts: result.accounts, receipts: result.receipts };
} });
defineJob<Walk>({ kind: VERIFY_JOB, maxAttempts: 3, timeoutMs: 180_000, run: async ctx => {
  const started = Date.now();
  const rows = await db.select({ id: S.socialAccounts.id, tokensEnc: S.socialAccounts.tokensEnc, createdAt: S.socialAccounts.createdAt }).from(S.socialAccounts).where(and(eq(S.socialAccounts.ch, 'youtube'), ...(ctx.payload.cursor ? [gt(S.socialAccounts.id, ctx.payload.cursor)] : []))).orderBy(asc(S.socialAccounts.id)).limit(10);
  const counts = { fresh: 0, gone: 0, revoked: 0, retry: 0, oldestUncheckedHours: 0 };
  for (const row of rows) { let t: Tokens | null = null; try { t = decrypt(row.tokensEnc); } catch {} counts.oldestUncheckedHours = Math.max(counts.oldestUncheckedHours, Math.floor((Date.now() - trustedClock(t?.youtube?.authorizationCheckedAt, row.createdAt, Date.now())) / 3600e3)); } let cursor = ctx.payload.cursor;
  for (let i = 0; i < rows.length; i += 2) {
    // Five bounded pairs (<=30s each); stop early enough to commit a durable continuation.
    if (Date.now() - started > 135_000) break;
    const pair = rows.slice(i, i + 2);
    const statuses = await Promise.all(pair.map(row => verifyYouTubeAccount(row.id, new Date())));
    statuses.forEach(status => counts[status]++); cursor = pair[pair.length - 1].id;
  }
  if (rows.length && (rows.length === 10 || cursor !== rows[rows.length - 1].id)) {
    await enqueue(VERIFY_JOB, { day: ctx.payload.day, cursor }, { businessId: null, singletonKey: `youtube.verify:${ctx.payload.day}:${cursor}`, maxAttempts: 3 });
  }
  return counts;
} });
defineJob({ kind: REVOKE_JOB, maxAttempts: 8, timeoutMs: 20_000, backoffMs: attempt => Math.min(3600e3, 60e3 * 2 ** (attempt - 1)), run: async ctx => {
  const status = await revokeYouTubeJob(ctx.job.id, new Date(), ctx.attempt >= ctx.job.maxAttempts);
  if (status === 'retry') throw new Error('YouTube revoke temporarily unavailable');
  return { status };
} });
/** Called before ordinary token maintenance; only bounded DB work and enqueue, never network under cron lock. */
export async function youtubeRetentionTick(now: Date) {
  const expiry = await expireYouTubeCaches(now);
  if (expiry.next) await enqueueSweep(expiry.next);
  const day = now.toISOString().slice(0, 10); const key = `youtube.daily:${day}`;
  if (await once(key)) {
    try { await enqueue(VERIFY_JOB, { day }, { businessId: null, singletonKey: `youtube.verify:${day}:start`, maxAttempts: 3 }); }
    catch (error) { await clearOnce(key); throw error; }
  }
  // Counts/local ages only. A growing age warns at day1, before the 28-day hard fail-closed boundary.
  const [oldest] = await db.select({ at: sql<string | null>`min(created_at)` }).from(S.jobs).where(and(eq(S.jobs.kind, VERIFY_JOB), sql`status IN ('queued','running')`));
  if (oldest?.at && now.getTime() - new Date(oldest.at).getTime() > 864e5) await reportFailure(new Error('YouTube verification maintenance backlog exceeds 24 hours'), { source: 'cron', operation: 'youtube.retention', provider: 'youtube', incidentKey: 'youtube.retention.backlog', code: 'maintenance_overdue' });
}
