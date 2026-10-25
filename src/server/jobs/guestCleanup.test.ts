// The abandoned-guest cleanup (architecture §8, §16.13).
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; });

import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { encrypt } from '../crypto';
import { Fixtures, uniq } from '../testing/fixtures';
import { cleanupGuests } from './guestCleanup';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const H = 3600e3;
const ago = (ms: number) => new Date(Date.now() - ms);
async function guest(createdAgoMs: number, sessionHours: number | null) {
  const g = await F.user({ guest: true });
  await db.update(schema.users).set({ createdAt: ago(createdAgoMs) }).where(eq(schema.users.id, g.id));
  if (sessionHours != null) await db.insert(schema.sessions).values({ id: 'test-' + uniq(), userId: g.id, expiresAt: new Date(Date.now() + sessionHours * H) });
  const d = await F.biz(g, { status: 'onboarding' });
  await db.insert(schema.gscConnections).values({ businessId: d.id, status: 'connected', tokensEnc: encrypt({ stub: true, access_token: 'x' }) });
  return { g, d };
}
const exists = async (uid: string) => (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, uid))).length > 0;

describe.skipIf(!ON)('guest cleanup (database)', () => {
  afterAll(() => F.cleanup());

  it('deletes an expired guest older than 24h with its draft; keeps live and young guests and real users', async () => {
    const old = await guest(30 * H, -1);           // session expired an hour ago
    const none = await guest(25 * H, null);        // no session row at all (maintenance pruned it)
    const live = await guest(48 * H, 20);          // still writing: the session slid forward
    const young = await guest(2 * H, -1);          // under 24h, even with an expired session
    const real = await F.user(); await db.update(schema.users).set({ createdAt: ago(90 * 24 * H) }).where(eq(schema.users.id, real.id));
    const r = await cleanupGuests(new Date(), 10_000);
    expect(r.guests).toBeGreaterThanOrEqual(2);
    expect(await exists(old.g.id)).toBe(false); expect(await exists(none.g.id)).toBe(false);
    expect((await db.select().from(schema.businesses).where(inArray(schema.businesses.id, [old.d.id, none.d.id])))).toHaveLength(0);
    expect((await db.select().from(schema.gscConnections).where(inArray(schema.gscConnections.businessId, [old.d.id, none.d.id])))).toHaveLength(0);
    expect(await exists(live.g.id)).toBe(true); expect(await exists(young.g.id)).toBe(true); expect(await exists(real.id)).toBe(true);
  });

  it('prunes rate-limit windows older than two days and processed webhook events older than 30 days', async () => {
    const k = `cleanup-test:${uniq()}`;
    await db.execute(sql`INSERT INTO rate_limits (key, window_start, count) VALUES (${k + ':old'}, ${ago(3 * 24 * H)}, 1), (${k + ':new'}, ${ago(H)}, 1)`);
    const ev = { old: `evt_test_${uniq()}`, fresh: `evt_test_${uniq()}`, pending: `evt_test_${uniq()}` };
    await db.insert(schema.billingEvents).values([
      { id: ev.old, type: 'invoice.paid', processedAt: ago(31 * 24 * H) }, { id: ev.fresh, type: 'invoice.paid', processedAt: ago(H) },
      { id: ev.pending, type: 'invoice.paid', receivedAt: ago(40 * 24 * H) },
    ]);
    await cleanupGuests();
    const keys = (await db.execute(sql`SELECT key FROM rate_limits WHERE key LIKE ${k + '%'}`)).rows.map((r: any) => r.key);
    expect(keys).toEqual([k + ':new']);
    const left = (await db.select({ id: schema.billingEvents.id }).from(schema.billingEvents).where(inArray(schema.billingEvents.id, Object.values(ev)))).map(r => r.id).sort();
    expect(left).toEqual([ev.fresh, ev.pending].sort());                  // an unprocessed event is never pruned
    await db.execute(sql`DELETE FROM rate_limits WHERE key LIKE ${k + '%'}`);
    await db.delete(schema.billingEvents).where(inArray(schema.billingEvents.id, Object.values(ev)));
  });
});
