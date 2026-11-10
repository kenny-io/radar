// What each activity tier gets from the three gated crons (IS-2, IS-3), on the database with the real cron functions:
// nightly AI visibility, automatic social packs and background brief rescans. A week is simulated by ageing the jobs
// (`lastRuns` reads the database clock) and clearing the business's daily marks, which is what a new date does.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; });

import { and, eq, like } from 'drizzle-orm';
import { db, schema } from './db';
import { Fixtures, type TUser } from './testing/fixtures';
import { getBiz } from './workspace';
import { nowHMIn, todayIn } from '@/lib/format';
import { lastRuns, touchActive } from './idle';
import { nightlyTick } from './services/visibility/jobs';
import { autoTick } from './services/social/auto';
import { rescanTick } from './services/brief/jobs';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const B = schema.businesses; const J = schema.jobs;
const DAY = 864e5, HOUR = 3600e3;
const ZONES = [...Array.from({ length: 12 }, (_, i) => `Etc/GMT+${12 - i}`), 'Etc/GMT', ...Array.from({ length: 14 }, (_, i) => `Etc/GMT-${i + 1}`)];
/** A timezone where it is `hour` o'clock right now: the visibility window is 02:00–05:59 local, and the crons take the real time. */
const zoneAt = (hour: string, now: Date) => ZONES.find(z => nowHMIn(z, now).startsWith(hour + ':'))!;

type Biz = { id: string; tz: string };
const made: string[] = [];
/** Daily marks carry no business reference of their own, so they are removed by key. */
const clearMarks = async () => { for (const id of made.splice(0)) await db.delete(schema.cronMarks).where(like(schema.cronMarks.key, `%${id}%`)); };
async function biz(owner: TUser, usedDaysAgo: number, tz: string, o: { autopilot?: any; briefSetup?: boolean } = {}): Promise<Biz> {
  const b = await F.biz(owner); made.push(b.id);
  await db.update(B).set({ timezone: tz, lastActiveAt: new Date(Date.now() - usedDaysAgo * DAY), socialAuto: { on: true, freq: 'daily', platforms: ['x'], time: '00:00' }, ...(o.autopilot ? { autopilot: o.autopilot } : {}), ...(o.briefSetup ? { briefSetup: true } : {}) }).where(eq(B.id, b.id));
  return { id: b.id, tz };
}
const jobs = (b: Biz, kind: string) => db.select().from(J).where(and(eq(J.businessId, b.id), eq(J.kind, kind)));
const count = async (b: Biz) => [(await jobs(b, 'visibility.run')).length, (await jobs(b, 'social.autoRun')).length];
const marks = async (b: Biz) => (await db.select().from(schema.cronMarks).where(like(schema.cronMarks.key, `%${b.id}%`))).map(m => m.key.replace(b.id, 'BID')).sort();
/** It is now `days` later: the business's jobs finished long ago, and the date in every daily mark has changed. */
async function later(b: Biz, days: number) {
  await db.update(J).set({ status: 'done', finishedAt: new Date(), createdAt: new Date(Date.now() - days * DAY) }).where(eq(J.businessId, b.id));
  await db.delete(schema.cronMarks).where(like(schema.cronMarks.key, `%${b.id}%`));
}
const tick = async (now = new Date()) => { await nightlyTick(now); await autoTick(now); };

describe.skipIf(!ON)('cadence by activity tier (database, real crons)', () => {
  let owner: TUser; let night = ''; let noon = '';
  beforeAll(async () => { owner = await F.user(); const now = new Date(); night = zoneAt('03', now); noon = zoneAt('12', now); });
  afterAll(async () => { await clearMarks(); await F.cleanup(); });

  it('active: AI visibility every night and a social pack every day, as before; outside the night window no visibility run', async () => {
    const active = await biz(owner, 1, night); const day = await biz(owner, 1, noon); const today = todayIn(night);
    await tick(); await tick();                                   // the cron runs every minute: the second tick adds nothing
    expect(await count(active)).toEqual([1, 1]);
    expect(await marks(active)).toEqual([`social.auto:BID:${today}`, `vis:BID:${today}`]);
    expect(await count(day)).toEqual([0, 1]);
    for (const n of [2, 3]) { await later(active, 1); await tick(); expect(await count(active)).toEqual([n, n]); }
  });

  it('idle: one visibility run and one social pack per 7 days, counted from the newest job; a skipped day leaves no mark', async () => {
    const idle = await biz(owner, 10, night);
    await tick(); await tick();
    expect(await count(idle)).toEqual([1, 1]);                    // nothing on record: the weekly run happens now
    for (const days of [1, 2, 3, 4, 5, 6, 6.99]) {
      await later(idle, days); await tick();
      expect([days, ...(await count(idle))]).toEqual([days, 1, 1]);
      expect(await marks(idle)).toEqual([]);                      // nothing queues up behind the skip
    }
    await later(idle, 7.001); await tick(); await tick();
    expect(await count(idle)).toEqual([2, 2]);
    // The newest job is what counts, whoever started it: a manual or catch-up run yesterday postpones the weekly one.
    await later(idle, 8);
    await db.insert(J).values({ businessId: idle.id, kind: 'visibility.run', ref: idle.id, status: 'done', createdAt: new Date(Date.now() - 1 * DAY) });
    await tick();
    expect(await count(idle)).toEqual([3, 3]);                    // +1 is the row just inserted; the social pack was due
    expect((await marks(idle)).some(k => k.startsWith('vis:'))).toBe(false);
  });

  it('dormant: neither, for as long as nobody returns; Autopilot on is never slowed', async () => {
    const dormant = await biz(owner, 40, night); const piloted = await biz(owner, 40, night, { autopilot: { enabled: true, activationId: 'a1' } });
    const usedAt = async (b: Biz) => (await getBiz(b.id)).lastActiveAt.getTime();
    const used = [await usedAt(dormant), await usedAt(piloted)];
    for (const days of [0, 1, 7, 20]) {
      if (days) { await later(dormant, days); await later(piloted, days); }
      await tick();
      expect([days, ...(await count(dormant)), ...(await marks(dormant))]).toEqual([days, 0, 0]);
    }
    // Autopilot: visibility ran each of those four nights. (Its social packs come from Autopilot's own schedule, not this cron.)
    expect(await count(piloted)).toEqual([4, 0]);
    // The crons and the jobs they queue are not activity: neither business's last use moved.
    expect([await usedAt(dormant), await usedAt(piloted)]).toEqual(used);
  });

  it('coming back: at most one run of each kind, at once for visibility, and the normal cadence from then on', async () => {
    for (const quietDays of [12, 45]) {
      const b = await biz(owner, quietDays, night);
      if (quietDays < 30) { await tick(); await later(b, 2); }     // an idle business had its weekly run two days ago
      const had = await count(b);
      await tick();
      expect(await count(b)).toEqual(had);                         // still quiet: nothing
      // A member opens the app.
      await touchActive(await getBiz(b.id), { guest: false });
      expect(await count(b)).toEqual([had[0] + 1, had[1]]);        // the visibility catch-up, before any tick
      await tick(); await tick();
      // Same night: the nightly tick joins the catch-up run instead of adding one; today's social pack is made once.
      expect(await count(b)).toEqual([had[0] + 1, had[1] + 1]);
      // Next night and after: every night again, no burst for the days missed.
      await later(b, 1); await tick();
      expect(await count(b)).toEqual([had[0] + 2, had[1] + 2]);
    }
  });

  it('coming back inside the night window: the catch-up is that night\'s run even once it has finished', async () => {
    for (const quietDays of [12, 45]) {
      const b = await biz(owner, quietDays, night);
      if (quietDays < 30) { await tick(); await later(b, 2); }
      const had = (await count(b))[0];
      await touchActive(await getBiz(b.id), { guest: false });
      expect((await count(b))[0]).toBe(had + 1);
      expect(await marks(b)).toContain(`vis:BID:${todayIn(b.tz)}`);
      // The run is quick: it is done before the scheduler looks again, so no singleton is left to join.
      await db.update(J).set({ status: 'done', finishedAt: new Date() }).where(and(eq(J.businessId, b.id), eq(J.kind, 'visibility.run')));
      await tick(); await tick();
      expect((await count(b))[0]).toBe(had + 1);
      await later(b, 1); await tick();
      expect((await count(b))[0]).toBe(had + 2);                   // the next night runs as usual
    }
  });

  it('coming back outside the night window: one run now, and the next night still runs', async () => {
    const b = await biz(owner, 45, noon);
    await touchActive(await getBiz(b.id), { guest: false });
    expect((await count(b))[0]).toBe(1);
    await db.update(J).set({ status: 'done', finishedAt: new Date() }).where(eq(J.businessId, b.id));
    // Fourteen hours on it is 02:00 the next local day: a new date, so today's mark does not hold the run back.
    await nightlyTick(new Date(Date.now() + 14 * HOUR));
    expect((await count(b))[0]).toBe(2);
  });

  it('lastRuns: the newest job of the kind per business, any status, within the last 8 days', async () => {
    const a = await biz(owner, 1, noon); const b = await biz(owner, 1, noon); const none = await biz(owner, 1, noon);
    const at = (h: number) => new Date(Date.now() - h * HOUR);
    await db.insert(J).values([
      { businessId: a.id, kind: 'visibility.run', ref: a.id, status: 'done', createdAt: at(50) }, { businessId: a.id, kind: 'visibility.run', ref: a.id, status: 'failed', createdAt: at(20) },
      { businessId: a.id, kind: 'visibility.collect', ref: 'cell', status: 'done', createdAt: at(1) },           // another kind
      { businessId: b.id, kind: 'visibility.run', ref: b.id, status: 'done', createdAt: at(9 * 24) },             // too old to matter
    ]);
    const m = await lastRuns('visibility.run', [a.id, b.id, none.id]);
    expect([...m.keys()]).toEqual([a.id]);
    expect(Math.abs(m.get(a.id)!.getTime() - at(20).getTime())).toBeLessThan(2000);
    expect((await lastRuns('visibility.run', [])).size).toBe(0);
  });
});

describe.skipIf(!ON)('background brief rescans by tier (database, real cron)', () => {
  let owner: TUser; const TZ = 'America/New_York';
  beforeAll(async () => { owner = await F.user(); });
  afterAll(async () => { await clearMarks(); await F.cleanup(); });
  /** Today's brief, last scanned three hours ago, with an item acted on since (or not): everything a rescan needs but the tier. */
  async function briefed(usedDaysAgo: number, o: { autopilot?: any; acted?: boolean } = {}) {
    const b = await biz(owner, usedDaysAgo, TZ, { briefSetup: true, autopilot: o.autopilot }); const today = todayIn(TZ);
    await db.insert(schema.briefDays).values({ businessId: b.id, date: today, scannedAt: '06:00', items: [], actedAt: o.acted === false ? null : new Date() });
    await db.insert(J).values({ businessId: b.id, kind: 'brief.scan', ref: today, status: 'done', payload: { mode: 'first', date: today }, createdAt: new Date(Date.now() - 3 * HOUR), finishedAt: new Date(Date.now() - 3 * HOUR) });
    return b;
  }
  const scans = async (b: Biz) => (await jobs(b, 'brief.scan')).map(j => (j.payload as any).background ? 'rescan' : 'scan').sort();

  it('active only: idle and dormant businesses get none, Autopilot is never slowed, and no action means no rescan in any tier', async () => {
    const active = await briefed(1), idle = await briefed(10), dormant = await briefed(40);
    const piloted = await briefed(40, { autopilot: { enabled: true, activationId: 'a1' } });
    const untouched = await briefed(0, { acted: false }), pilotedUntouched = await briefed(40, { autopilot: { enabled: true, activationId: 'a1' }, acted: false });
    await rescanTick(new Date()); await rescanTick(new Date());
    expect(await scans(active)).toEqual(['rescan', 'scan']);
    expect(await scans(piloted)).toEqual(['rescan', 'scan']);
    for (const b of [idle, dormant, untouched, pilotedUntouched]) expect(await scans(b)).toEqual(['scan']);
    // The morning brief is not part of this: it has its own cron (brief.daily), which no tier touches.
  });
});
