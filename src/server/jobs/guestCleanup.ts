// Abandoned guests (architecture §8): hourly at minute 17, once per hour. A guest older than 24h with no live session
// (the 72h session slides on each write) is deleted with its drafts, after its Search Console tokens are read so they
// can be revoked (best effort, after commit; stub tokens are no-ops). Also prunes rate-limit windows older than two days
// and processed webhook events older than 30 days. Known gap: uploaded logos are orphaned (no storage delete helper).
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { decrypt } from '../crypto';
import { revoke, type GscTokens } from '../services/gsc/client';
import { defineCron } from './cron';
import { once } from './queue';

export async function cleanupGuests(now = new Date(), limit = 200) {
  const U = schema.users, B = schema.businesses, E = schema.billingEvents;
  const abandoned = sql`${U.guest} AND ${U.createdAt} < ${new Date(now.getTime() - 864e5)} AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = ${U.id} AND s.expires_at > ${now})`;
  const stale = await db.select({ id: U.id }).from(U).where(abandoned).orderBy(U.createdAt).limit(limit);
  let guests = 0;
  for (const { id } of stale) {
    const tokens: (GscTokens | null)[] = [];
    await db.transaction(async tx => {
      // Re-checked under the row lock a claim also takes: a guest claimed or written to meanwhile is left alone.
      const g = await tx.execute(sql`SELECT id FROM users WHERE users.id = ${id} AND ${abandoned} FOR UPDATE`);
      if (!g.rows.length) return;
      const rows = await tx.select({ t: schema.gscConnections.tokensEnc }).from(schema.gscConnections).innerJoin(B, eq(B.id, schema.gscConnections.businessId)).where(eq(B.ownerId, id));
      for (const r of rows) { if (r.t) try { tokens.push(decrypt<GscTokens>(r.t)); } catch { /* unreadable: nothing to revoke */ } }
      await tx.delete(B).where(eq(B.ownerId, id));                       // cascades GSC rows, crawl pages, jobs, members
      await tx.delete(schema.oauthStates).where(eq(schema.oauthStates.userId, id));
      await tx.delete(U).where(and(eq(U.id, id), eq(U.guest, true)));
      guests++;
    });
    for (const t of tokens) await revoke(t);
  }
  const rl = await db.execute(sql`DELETE FROM rate_limits WHERE window_start < ${new Date(now.getTime() - 2 * 864e5)}`);
  const ev = await db.delete(E).where(and(isNotNull(E.processedAt), lt(E.processedAt, new Date(now.getTime() - 30 * 864e5)))).returning({ id: E.id });
  const out = { guests, rateLimits: rl.rowCount ?? 0, billingEvents: ev.length };
  if (out.guests || out.rateLimits || out.billingEvents) console.info(`[cleanup] guests ${out.guests}, rate-limit windows ${out.rateLimits}, webhook events ${out.billingEvents}`);
  return out;
}

defineCron('onboarding.guestCleanup', async now => {
  if (now.getUTCMinutes() !== 17) return;
  if (!(await once('guest-cleanup:' + now.toISOString().slice(0, 13)))) return;
  await cleanupGuests(now);
});
