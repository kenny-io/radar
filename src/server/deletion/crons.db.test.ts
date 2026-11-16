// Every cron hook against a deleted business, and against one restored after its work came due (DEL-5, RES-2). The
// hooks run exactly as the scheduler runs them, database-wide, so this file works in a database of its own: on the
// shared test database they would enqueue, mark and mail for other test files' rows. Skipped without DATABASE_URL.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const H = await vi.hoisted(async () => {
  process.env.RADAR_DEV_STUBS = '1'; process.env.RADAR_SOCIAL_PUBLISHING = 'all';
  return { jar: new Map<string, string>(), own: await (await import('@/server/testing/privateDb')).privateDatabase() };
});
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { db, pool, schema } from '../db';
import { encrypt } from '../crypto';
import { Fixtures, uniq, type TUser } from '../testing/fixtures';
import { cronDefs } from '../jobs/cron';
import '../jobs/all';
import { collectWorkUpdates } from '../services/lifecycle/engagement';
import { collectEducation } from '../services/lifecycle/education';
import { collectGuides } from '../services/lifecycle/guides';
import { collectAiReports } from '../services/visibility/digest';
import { deleteBusiness, restoreBusiness } from './index';
import { addDays, todayIn } from '@/lib/format';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const B = schema.businesses; const J = schema.jobs; const E = schema.calendarEntries;
const row = async (bid: string) => (await db.select().from(B).where(eq(B.id, bid)))[0];
/** A time zone where it is between 06:00 and 22:00 right now, so hooks that wait for an hour of the business's day act
 *  whenever the suite runs. (UTC-11, UTC and UTC+14: one of them always is.) */
const dayZone = () => ['UTC', 'Pacific/Pago_Pago', 'Pacific/Kiritimati'].find(tz => { const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date())); return h >= 6 && h < 22; })!;
/** Every registered cron hook, run once at the real current time. The four account-wide mail collectors are run for
 *  `users` only, the way their own tests narrow them, in case this file had to fall back to the shared database. Every
 *  other hook, and any hook added later, runs exactly as the scheduler runs it. Never pass a time in the future here:
 *  on a shared database the housekeeping hooks would act on other files' rows. */
const ACCOUNT_WIDE: Record<string, (now: Date, users: string[]) => Promise<unknown>> = {
  'lifecycle.work-updates': collectWorkUpdates, 'lifecycle.weekly-education': collectEducation, 'lifecycle.guides': collectGuides, 'visibility.weeklyDigest': collectAiReports,
};
async function runEveryHook(users: string[], after?: (name: string) => Promise<void>) {
  const hooks = cronDefs(); const now = new Date();
  for (const name of Object.keys(ACCOUNT_WIDE)) expect(hooks.map(h => h.name)).toContain(name);
  for (const h of hooks) {
    await (ACCOUNT_WIDE[h.name] ? ACCOUNT_WIDE[h.name](now, users) : h.run(now)).catch(() => {});   // a hook failing on a thin seed still must not have touched it
    await after?.(h.name);
  }
  return hooks.length;
}
afterEach(() => { vi.restoreAllMocks(); H.jar.clear(); });

describe.skipIf(!ON)('cron hooks and a deleted business (database)', () => {
  afterAll(async () => { if (H.own.isolated) { await pool.end(); await H.own.drop(); } else await F.cleanup(); });

  // Everything a cron could pick up: connected Search Console with synced data, a social account due for its daily
  // refresh, an auto-publishing blog with due entries, a daily brief, automatic social posts, the link network.
  const seed = async (owner: TUser, status: 'active' | 'deleted') => {
    const biz = await F.biz(owner, { status, deletedAt: new Date(Date.now() - 864e5) });
    const tz = dayZone();
    await db.update(B).set({ timezone: tz, blog: { time: '00:00', mode: 'autopilot', autopilotAckAt: new Date().toISOString() }, briefSetup: true, briefSettings: { time: '00:00' },
      socialAuto: { on: true, time: '00:00', platforms: ['x'] }, backlinks: { joined: true, joinedAt: new Date(Date.now() - 30 * 864e5).toISOString() }, lastActiveAt: new Date() }).where(eq(B.id, biz.id));
    await db.insert(schema.gscConnections).values({ businessId: biz.id, status: 'connected', property: `sc-domain:${biz.domain}`, tokensEnc: encrypt({ access_token: 'a', refresh_token: 'r', stub: true }), lastSyncedThrough: addDays(todayIn(tz), -3) });
    const [acct] = await db.insert(schema.socialAccounts).values({ businessId: biz.id, ch: 'x', remoteId: `x-${uniq()}`, name: 'Fieldnote', handle: 'fieldnote',
      tokensEnc: encrypt({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3600e3, scope: '', stub: true }), expiresAt: new Date(Date.now() + 3600e3) }).returning();
    await db.insert(schema.connections).values({ businessId: biz.id, type: 'wordpress', url: 'https://site.test', fields: {} });
    const today = todayIn(tz);
    await db.insert(E).values([{ id: `e-${uniq()}`, businessId: biz.id, title: 'S', kw: 'k', type: 'Guide', date: today, status: 'scheduled' }, { id: `e-${uniq()}`, businessId: biz.id, title: 'A', kw: 'k', type: 'Guide', date: today, status: 'approved' },
      { id: `e-${uniq()}`, businessId: biz.id, title: 'P', kw: 'k', type: 'Guide', date: addDays(today, 1), status: 'proposed' }]);
    await db.insert(schema.socialPubs).values({ businessId: biz.id, sid: `s:p:x`, src: 'pack', platform: 'x', ch: 'x', acctId: acct.id, acctLabel: '@fieldnote', status: 'scheduled', date: today, time: '00:00', dueAt: new Date(Date.now() - 60e3) });
    return { biz, acct };
  };
  const touched = async (x: Awaited<ReturnType<typeof seed>>) => ({
    jobs: (await db.select({ kind: J.kind }).from(J).where(eq(J.businessId, x.biz.id))).map(j => j.kind).sort(),
    marks: (await db.select({ key: schema.cronMarks.key }).from(schema.cronMarks).where(sql`position(${x.biz.id} in ${schema.cronMarks.key}) > 0 OR position(${x.acct.id} in ${schema.cronMarks.key}) > 0`)).map(m => m.key) });

  it('no cron enqueues, marks or refreshes anything for a deleted business (DEL-5)', async () => {
    const owner = await F.user(); await F.account(owner.id, { status: 'active' });
    const dead = await seed(owner, 'deleted'); const live = await seed(owner, 'active');
    const snapshot = async (x: typeof dead) => JSON.stringify({
      biz: await row(x.biz.id), acct: (await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, x.acct.id)))[0],
      gsc: (await db.select().from(schema.gscConnections).where(eq(schema.gscConnections.businessId, x.biz.id)))[0],
      entries: await db.select().from(E).where(eq(E.businessId, x.biz.id)).orderBy(E.id), pubs: await db.select().from(schema.socialPubs).where(eq(schema.socialPubs.businessId, x.biz.id)),
      notes: (await db.select().from(schema.notifications).where(eq(schema.notifications.businessId, x.biz.id))).length });
    const before = await snapshot(dead);
    vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
    const ran = await runEveryHook([owner.id], async name => {
      const t = await touched(dead);
      expect([name, t.jobs, t.marks]).toEqual([name, [], []]);
      expect([name, await snapshot(dead)]).toEqual([name, before]);
    });
    expect(ran).toBeGreaterThan(15);                            // every hook registered through jobs/all.ts, new ones included
    // The same seed on an active business is picked up, so the silence above is the deleted state and not an empty seed.
    const t = await touched(live);
    expect(t.jobs).toEqual(expect.arrayContaining(['gsc.incremental', 'publish.entry', 'social.send']));
    expect(t.marks.some(k => k.startsWith('social.tokens:'))).toBe(true);
    expect(t.marks.some(k => k.startsWith('kw-sugg:'))).toBe(true);
    await db.delete(schema.cronMarks).where(like(schema.cronMarks.key, `%${live.biz.id}%`)); await db.delete(schema.cronMarks).where(like(schema.cronMarks.key, `%${live.acct.id}%`));
  }, 120_000);

  it('the ticks after a restore enqueue no more jobs than for a business that was never deleted, and nothing that came due is published or sent (RES-2)', async () => {
    const owner = await F.user(); await F.account(owner.id, { status: 'active' });
    const never = await seed(owner, 'active'); const restored = await seed(owner, 'active');
    await deleteBusiness(owner.id, restored.biz.id, { domain: restored.biz.domain });
    // While it was deleted a stray job was queued for it; a restore closes it rather than letting it run late.
    await db.insert(J).values({ kind: 'publish.entry', businessId: restored.biz.id, status: 'queued', payload: { entryId: 'x' } });
    await restoreBusiness(owner.id, restored.biz.id);
    vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
    const queuedFor = async (x: typeof never) => (await db.select({ kind: J.kind }).from(J).where(and(eq(J.businessId, x.biz.id), inArray(J.status, ['queued', 'running'])))).map(j => j.kind).sort();
    expect(await queuedFor(restored)).toEqual([]);              // no backlog waiting for the first tick
    for (let i = 0; i < 2; i++) await runEveryHook([owner.id]);
    const a = await queuedFor(never), b = await queuedFor(restored);
    expect(a).toEqual(expect.arrayContaining(['publish.entry', 'social.send']));   // the never-deleted twin did have work due
    for (const kind of new Set(b)) expect([kind, b.filter(k => k === kind).length <= a.filter(k => k === kind).length]).toEqual([kind, true]);
    expect(b).not.toContain('publish.entry'); expect(b).not.toContain('social.send');
    expect((await db.select({ status: schema.socialPubs.status, errCode: schema.socialPubs.errCode }).from(schema.socialPubs).where(eq(schema.socialPubs.businessId, restored.biz.id)))).toEqual([{ status: 'failed', errCode: 'stale' }]);
    for (const x of [never, restored]) { await db.delete(schema.cronMarks).where(like(schema.cronMarks.key, `%${x.biz.id}%`)); await db.delete(schema.cronMarks).where(like(schema.cronMarks.key, `%${x.acct.id}%`)); }
  }, 120_000);
});
