// What each activity tier gets from the three gated crons (IS-2, IS-3), on the database with the real cron functions:
// AI visibility, automatic social packs and background brief rescans.
// AI visibility is weekly (VW-1, VW-1a): its cases run the cron on a simulated clock, which the cron, `lastFullVisibilityRuns`
// and `touchActive` all take as an argument. The last block ties the night of that run to the Monday report email (VW-3). The schedule it replaced stays behind RADAR_VISIBILITY_CADENCE=nightly (VW-6): its
// cases are the ones this file had before, unchanged, with that variable set. There a week is simulated by ageing the jobs
// (`lastRuns` reads the database clock) and clearing the business's daily marks, which is what a new date does.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { failEnqueueFor: '', failEnqueueTimes: 0 }; });
// The real queue, except that enqueueing for one chosen business can be made to fail a set number of times.
vi.mock('./jobs/queue', async orig => { const real = await orig<typeof import('./jobs/queue')>();
  return { ...real, enqueue: (async (kind, payload, opts) => { if (H.failEnqueueTimes > 0 && opts?.businessId === H.failEnqueueFor) { H.failEnqueueTimes--; throw new Error('enqueue failed (test)'); } return real.enqueue(kind, payload, opts); }) as typeof real.enqueue }; });

import { and, eq, inArray, like } from 'drizzle-orm';
import { db, schema } from './db';
import { Fixtures, type TUser } from './testing/fixtures';
import { getBiz } from './workspace';
import { nowHMIn, todayIn } from '@/lib/format';
import { VIS_WEEKDAY, lastFullVisibilityRuns, lastRuns, touchActive, visibilityDue } from './idle';
import { collectAiReports } from './services/visibility/digest';
import { weeklyRecommendationShare } from '@/lib/recommendationShare';
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

describe.skipIf(!ON)('RADAR_VISIBILITY_CADENCE=nightly: cadence by activity tier as before the weekly schedule (database, real crons)', () => {
  let owner: TUser; let night = ''; let noon = '';
  beforeAll(async () => { vi.stubEnv('RADAR_VISIBILITY_CADENCE', 'nightly'); owner = await F.user(); const now = new Date(); night = zoneAt('03', now); noon = zoneAt('12', now); });
  afterAll(async () => { vi.unstubAllEnvs(); await clearMarks(); await F.cleanup(); });

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

describe.skipIf(!ON)('weekly AI visibility (database, real cron, simulated clock)', () => {
  // Sunday 2027-06-06, 03:00 at UTC−5. `at(days, hours)` is that many days and hours later.
  const TZ = 'Etc/GMT+5', SUNDAY = new Date('2027-06-06T08:00:00Z');
  const at = (days: number, hours = 0) => new Date(SUNDAY.getTime() + days * DAY + hours * HOUR);
  const PILOT = { autopilot: { enabled: true, activationId: 'a1' } };   // active however long nobody opens the app
  let owner: TUser; const mine: string[] = [];
  beforeAll(async () => { vi.stubEnv('RADAR_VISIBILITY_CADENCE', ''); owner = await F.user(); });
  // Each case retires its businesses, so a later case's ticks do not keep queueing runs for them.
  afterEach(async () => { if (mine.length) await db.update(B).set({ status: 'onboarding' }).where(inArray(B.id, mine.splice(0))); });
  afterAll(async () => { vi.unstubAllEnvs(); await clearMarks(); await F.cleanup(); });

  /** A business a member last used at `usedAt`. */
  async function usedAt(usedAt: Date, tz = TZ, o: { autopilot?: any } = {}): Promise<Biz> {
    const b = await biz(owner, 0, tz, o); mine.push(b.id);
    await db.update(B).set({ lastActiveAt: usedAt }).where(eq(B.id, b.id));
    return b;
  }
  const use = (b: Biz, when: Date) => db.update(B).set({ lastActiveAt: when }).where(eq(B.id, b.id));
  const runs = async (b: Biz) => (await jobs(b, 'visibility.run')).length;
  const clearDay = (b: Biz) => db.delete(schema.cronMarks).where(like(schema.cronMarks.key, `%${b.id}%`));
  /** A queued job carries the database's time. Give the business's unfinished runs the simulated time and finish them. */
  const finish = (b: Biz, when: Date) => db.update(J).set({ status: 'done', createdAt: when, finishedAt: when }).where(and(eq(J.businessId, b.id), eq(J.kind, 'visibility.run'), eq(J.status, 'queued')));
  const ran = (b: Biz, when: Date, o: { status?: 'queued' | 'running' | 'done' | 'failed'; payload?: any } = {}) =>
    db.insert(J).values({ businessId: b.id, kind: 'visibility.run', ref: b.id, status: o.status || 'done', payload: o.payload || {}, createdAt: when });
  /** One look by the scheduler at `when`. Whatever it queued for this case's businesses gets the simulated time and ends as `outcome`. */
  async function look(when: Date, outcome: 'done' | 'failed' = 'done') {
    await nightlyTick(when);
    await db.update(J).set({ status: outcome, createdAt: when, finishedAt: when }).where(and(inArray(J.businessId, mine), eq(J.kind, 'visibility.run'), eq(J.status, 'queued')));
  }
  /** The local days on which the business has a full run that did not fail, oldest first. */
  const fullDays = async (b: Biz) => (await jobs(b, 'visibility.run')).filter(j => j.status !== 'failed' && !j.payload?.promptIds).map(j => todayIn(b.tz, j.createdAt)).sort();
  const weekdayOf = (isoDay: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(isoDay + 'T00:00:00Z').getUTCDay()];
  const gaps = (daysList: string[]) => daysList.slice(1).map((d, i) => (Date.parse(d) - Date.parse(daysList[i])) / DAY);

  it('the simulated clock is what it says: 03:00 on a Sunday in the business’s zone', () => {
    expect([todayIn(TZ, SUNDAY), nowHMIn(TZ, SUNDAY), SUNDAY.getUTCDay()]).toEqual(['2027-06-06', '03:00', 0]);
  });

  it('active, idle and Autopilot businesses: one run on Sunday night, none on the other six nights, one the next Sunday; dormant none', async () => {
    const active = await usedAt(at(-1)), idle = await usedAt(at(-10)), dormant = await usedAt(at(-40));
    const piloted = await usedAt(at(-40), TZ, PILOT);
    const noon = await usedAt(at(-1), 'Etc/GMT-4');               // 12:00 on the same Sunday: outside the night window
    const all = [active, idle, piloted, dormant, noon];
    for (const b of all) await ran(b, at(-7));                    // each had its run the Sunday before
    const counts = () => Promise.all(all.map(runs));

    await nightlyTick(at(0)); await nightlyTick(at(0, 0.02));     // the cron runs every minute: the second tick adds nothing
    expect(await counts()).toEqual([2, 2, 2, 1, 1]);
    expect(await marks(active)).toEqual(['vis:BID:2027-06-06']);
    expect((await jobs(active, 'visibility.run')).map(j => j.payload)).toEqual([{}, {}]);    // a full run: no promptIds
    // The run finishes. Later in the window, with the day's mark gone, the rule alone holds the second run back.
    for (const b of all) { await finish(b, at(0)); await clearDay(b); }
    await nightlyTick(at(0, 2.9));
    expect(nowHMIn(TZ, at(0, 2.9))).toBe('05:54');
    expect(await counts()).toEqual([2, 2, 2, 1, 1]);

    // Monday to Saturday, 03:00: nothing, and nothing queues up behind the skipped nights.
    for (const d of [1, 2, 3, 4, 5, 6]) {
      await use(active, at(d, -1));                               // a member is in the app every day
      for (const b of all) await clearDay(b);
      await nightlyTick(at(d));
      expect([d, ...(await counts())]).toEqual([d, 2, 2, 2, 1, 1]);
      expect([d, ...(await marks(active)), ...(await marks(piloted))]).toEqual([d]);
    }

    // The next Sunday, at 02:00: an hour earlier than last week's run started, and under 7 × 24 hours after it.
    for (const b of all) await clearDay(b);
    await nightlyTick(at(7, -1)); await nightlyTick(at(7, -0.98));
    expect(nowHMIn(TZ, at(7, -1))).toBe('02:00');
    expect(await counts()).toEqual([3, 3, 3, 1, 1]);
  });

  it('the Sunday is the business’s own: at one instant it is 03:00 on Sunday at UTC+14 and 03:00 on Saturday at UTC−10', async () => {
    const east = await usedAt(at(-1), 'Pacific/Kiritimati'), west = await usedAt(at(-1), 'Etc/GMT+10');
    const local = (b: Biz, d: Date) => `${todayIn(b.tz, d)} ${nowHMIn(b.tz, d)}`;
    const eastNight = new Date('2027-06-05T13:00:00Z'), westNight = new Date('2027-06-06T13:00:00Z');
    await ran(east, new Date(eastNight.getTime() - 7 * DAY)); await ran(west, new Date(westNight.getTime() - 7 * DAY));   // each ran on its own Sunday a week before
    expect([local(east, eastNight), local(west, eastNight)]).toEqual(['2027-06-06 03:00', '2027-06-05 03:00']);
    await nightlyTick(eastNight);
    expect([await runs(east), await runs(west)]).toEqual([2, 1]);  // both inside the night window; only one is on its Sunday
    await finish(east, eastNight); await clearDay(east);
    // A day later it is Sunday night at UTC−10 and Monday night at UTC+14.
    expect([local(east, westNight), local(west, westNight)]).toEqual(['2027-06-07 03:00', '2027-06-06 03:00']);
    await nightlyTick(westNight);
    expect([await runs(east), await runs(west)]).toEqual([2, 2]);
  });

  it('nothing missed, eight weeks: every scheduled run lands on Sunday, whatever the time of night the scheduler looks', async () => {
    const b = await usedAt(at(-1), TZ, PILOT);
    await ran(b, at(0));
    for (let n = 1; n <= 56; n++) await look(at(n, (n * 7) % 4 - 1));   // 02:00, 03:00, 04:00 or 05:00
    const days = await fullDays(b);
    expect(days).toEqual(Array.from({ length: 9 }, (_, k) => todayIn(TZ, at(7 * k))));
    expect([[...new Set(days.map(weekdayOf))], [...new Set(gaps(days))]]).toEqual([['Sun'], [7]]);
  });

  it('a Sunday the scheduler missed entirely: the run happens on Monday night, then the following Sunday, and not again that week', async () => {
    const b = await usedAt(at(-1), TZ, PILOT);
    await ran(b, at(0));
    for (const n of [1, 2, 3, 4, 5, 6]) await look(at(n));        // an ordinary week: nothing
    expect(await runs(b)).toBe(1);
    // Sunday at(7): the scheduler is down all night. No tick.
    await look(at(8)); await look(at(8, 1));                      // Monday night: the catch-up, once
    expect(await fullDays(b)).toEqual(['2027-06-06', '2027-06-14']);
    for (const n of [9, 10, 11, 12, 13]) await look(at(n));
    expect(await runs(b)).toBe(2);
    await look(at(14));                                           // the following Sunday, 6 days after the catch-up
    for (const n of [15, 16, 17, 18, 19, 20]) await look(at(n));  // and not again that week
    await look(at(21));
    const days = await fullDays(b);
    expect(days).toEqual(['2027-06-06', '2027-06-14', '2027-06-20', '2027-06-27']);
    expect([days.map(weekdayOf), gaps(days)]).toEqual([['Sun', 'Mon', 'Sun', 'Sun'], [8, 6, 7]]);
  });

  it('a Sunday run that failed: tried again on Monday night, not again on Sunday', async () => {
    const b = await usedAt(at(-1), TZ, PILOT);
    await ran(b, at(0));
    await look(at(7), 'failed');
    expect((await jobs(b, 'visibility.run')).map(j => j.status).sort()).toEqual(['done', 'failed']);
    await look(at(7, 1)); await look(at(7, 2.9));                 // later the same night: the day's mark holds
    expect(await runs(b)).toBe(2);
    await look(at(8));                                            // Monday night
    expect(await fullDays(b)).toEqual(['2027-06-06', '2027-06-14']);
    await look(at(9)); await look(at(14));
    expect(await fullDays(b)).toEqual(['2027-06-06', '2027-06-14', '2027-06-20']);
  });

  it('a business whose every full run fails gets one new run per local day, however often the scheduler looks', async () => {
    const b = await usedAt(at(-1), TZ, PILOT);
    await ran(b, at(0));
    for (const n of [7, 8, 9, 10]) {                              // Sunday, then Monday to Wednesday
      for (const h of [-1, -0.5, 0, 1, 2, 2.9]) await look(at(n, h), 'failed');
      expect([n, await runs(b)]).toEqual([n, 1 + (n - 6)]);
    }
    expect((await jobs(b, 'visibility.run')).filter(j => j.status === 'failed').map(j => todayIn(TZ, j.createdAt)).sort()).toEqual(['2027-06-13', '2027-06-14', '2027-06-15', '2027-06-16']);
    await look(at(11));                                           // the provider is back
    for (const n of [12, 13]) await look(at(n));
    expect((await fullDays(b)).slice(1)).toEqual(['2027-06-17']);
  });

  it('a business with no full run on record runs on its next night whatever the weekday; a dormant one never', async () => {
    const active = await usedAt(at(2)), idle = await usedAt(at(-10)), dormant = await usedAt(at(-40)), overdue = await usedAt(at(-40));
    const noon = await usedAt(at(2), 'Etc/GMT-4');
    await ran(active, at(1), { status: 'failed' }); await ran(idle, at(1), { payload: { promptIds: ['p'] } });   // neither is a full run that counts
    await ran(overdue, at(-30));                                  // dormant and long overdue
    const wednesday = at(3);
    expect(weekdayOf(todayIn(TZ, wednesday))).toBe('Wed');
    await look(wednesday); await look(at(3, 1));
    expect(await Promise.all([active, idle, dormant, overdue, noon].map(fullDays))).toEqual([['2027-06-09'], ['2027-06-09'], [], ['2027-05-07'], []]);
    for (const n of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) await look(at(n));
    // Four days later is Sunday: the weekly rhythm starts there. The dormant businesses still have nothing.
    expect(await fullDays(active)).toEqual(['2027-06-09', '2027-06-13', '2027-06-20']);
    expect([await fullDays(dormant), await fullDays(overdue)]).toEqual([[], ['2027-05-07']]);
  });

  it('an off-cycle full run from Monday to Friday keeps that Sunday’s run; one on Saturday skips it, and the next Sunday, 8 days on, runs', async () => {
    // Six businesses, each with last Sunday's run and one more full run (a first run, a catch-up on return) at midday on a different weekday.
    const bs: Biz[] = [];
    for (const w of [1, 2, 3, 4, 5, 6]) { const b = await usedAt(at(-1), TZ, PILOT); await ran(b, at(0)); await ran(b, at(w, 9)); bs.push(b); }
    for (let n = 1; n <= 21; n++) await look(at(n));
    const days = await Promise.all(bs.map(fullDays));
    expect(days).toEqual([
      ['2027-06-06', '2027-06-07', '2027-06-13', '2027-06-20', '2027-06-27'],   // Monday: Sunday runs, 6 days on
      ['2027-06-06', '2027-06-08', '2027-06-13', '2027-06-20', '2027-06-27'],   // Tuesday: 5
      ['2027-06-06', '2027-06-09', '2027-06-13', '2027-06-20', '2027-06-27'],   // Wednesday: 4
      ['2027-06-06', '2027-06-10', '2027-06-13', '2027-06-20', '2027-06-27'],   // Thursday: 3
      ['2027-06-06', '2027-06-11', '2027-06-13', '2027-06-20', '2027-06-27'],   // Friday: 2, the boundary
      ['2027-06-06', '2027-06-12', '2027-06-20', '2027-06-27'],                 // Saturday: Sunday skipped; the next Sunday is 8 days on
    ]);
    // Every scheduled run is on a Sunday, and the longest gap between full runs is 8 local days, after the Saturday run.
    const scheduled = days.flatMap((d, k) => d.filter(x => x !== todayIn(TZ, at(k + 1, 9))));
    expect([scheduled.length, [...new Set(scheduled.map(weekdayOf))]]).toEqual([23, ['Sun']]);
    expect(days.map(d => Math.max(...gaps(d)))).toEqual([7, 7, 7, 7, 7, 8]);
  });

  it('a run for a few new prompts, and a run that failed, do not use up the week; one still under way does', async () => {
    const scoped = await usedAt(at(5)), failed = await usedAt(at(5)), both = await usedAt(at(5)), underWay = await usedAt(at(5));
    for (const b of [scoped, failed, both, underWay]) await ran(b, at(0));                               // last Sunday's run
    await ran(scoped, at(6, 9), { payload: { promptIds: ['00000000-0000-4000-8000-000000000001'] } });   // a prompt added on Saturday
    await ran(failed, at(6, 9), { status: 'failed' });
    await ran(both, at(6, 9), { payload: { promptIds: ['00000000-0000-4000-8000-000000000001'] } }); await ran(both, at(6, 10), { status: 'failed' });
    await ran(underWay, at(6, 20), { status: 'running' });         // started at 23:00 on Saturday, still collecting
    await nightlyTick(at(7));
    expect([await runs(scoped), await runs(failed), await runs(both), await runs(underWay)]).toEqual([3, 3, 4, 2]);
  });

  it('coming back: the one catch-up run is unchanged; on Wednesday it leaves Sunday’s run in place, on Saturday it stands in for it', async () => {
    const wed = await usedAt(at(-45)), sat = await usedAt(at(-45));
    await look(at(0));
    expect([await runs(wed), await runs(sat)]).toEqual([0, 0]);    // dormant: nothing on Sunday
    const wednesday = at(3, 7), saturday = at(6, 7);
    await touchActive(await getBiz(wed.id), { guest: false }, wednesday);
    expect(await runs(wed)).toBe(1);                              // at once, before any tick
    expect((await jobs(wed, 'visibility.run'))[0].payload).toEqual({});
    expect(await marks(wed)).toEqual([`vis:BID:${todayIn(TZ, wednesday)}`]);
    await finish(wed, wednesday);
    for (const n of [4, 5, 6]) await look(at(n));
    await touchActive(await getBiz(sat.id), { guest: false }, saturday);
    await finish(sat, saturday);
    for (let n = 7; n <= 14; n++) await look(at(n));
    expect(await fullDays(wed)).toEqual(['2027-06-09', '2027-06-13', '2027-06-20']);   // Sunday is 4 days after the catch-up: it runs
    expect(await fullDays(sat)).toEqual(['2027-06-12', '2027-06-20']);                 // Sunday is the next day: skipped; the Sunday after, 8 days on, runs
  });

  it('coming back inside the Sunday window: the catch-up is that night’s run, even once it has finished', async () => {
    for (const quietDays of [12, 45]) {
      const b = await usedAt(at(-quietDays));
      await touchActive(await getBiz(b.id), { guest: false }, at(0));
      expect(await runs(b)).toBe(1);
      await nightlyTick(at(0, 0.02));                             // still queued: the mark and the singleton hold
      await finish(b, at(0));
      await nightlyTick(at(0, 0.5));
      expect([quietDays, await runs(b)]).toEqual([quietDays, 1]);
    }
  });

  it('an enqueue that fails gives the day’s mark back: the next tick in the same window queues the run, and only one', async () => {
    const b = await usedAt(at(-1));
    H.failEnqueueFor = b.id; H.failEnqueueTimes = 1;
    try {
      await expect(nightlyTick(at(0))).rejects.toThrow('enqueue failed (test)');
      expect(H.failEnqueueTimes).toBe(0);                         // it was this business's enqueue that failed
      expect([await runs(b), ...(await marks(b))]).toEqual([0]);  // no run, and no mark holding the next tick back
      await nightlyTick(at(0, 0.02));                             // a minute later, same window
      expect(await runs(b)).toBe(1);
      expect(await marks(b)).toEqual(['vis:BID:2027-06-06']);
      await nightlyTick(at(0, 0.04)); await finish(b, at(0, 0.02)); await nightlyTick(at(0, 2));
      expect(await runs(b)).toBe(1);                              // still exactly one, queued or finished
    } finally { H.failEnqueueFor = ''; H.failEnqueueTimes = 0; }
  });

  it('lastFullVisibilityRuns: the newest full run that did not fail, per business, in the 10 days before `now`', async () => {
    const a = await usedAt(at(0)), old = await usedAt(at(0)), nine = await usedAt(at(0)), c = await usedAt(at(0)), none = await usedAt(at(0));
    const now = at(7);
    await ran(a, at(1)); await ran(a, at(3), { status: 'running' });
    await ran(a, at(5), { status: 'failed' }); await ran(a, at(6), { payload: { promptIds: ['p'] } });
    await db.insert(J).values({ businessId: a.id, kind: 'visibility.collect', ref: 'cell', status: 'done', createdAt: at(6, 12) });   // another kind
    await ran(old, at(-3, -1));                                   // 10 days and an hour before `now`: outside the lookback, so absent (and overdue)
    await ran(nine, at(-2));                                      // 9 days: found, and overdue by its date
    await ran(c, at(6), { status: 'queued' });
    const m = await lastFullVisibilityRuns([a.id, old.id, nine.id, c.id, none.id], now);
    expect([...m.keys()].sort()).toEqual([a.id, nine.id, c.id].sort());
    expect([m.get(a.id)!.toISOString(), m.get(nine.id)!.toISOString(), m.get(c.id)!.toISOString()]).toEqual([at(3).toISOString(), at(-2).toISOString(), at(6).toISOString()]);
    expect((await lastFullVisibilityRuns([], now)).size).toBe(0);
  });

  it('the lookback never mistakes a run 7 local days ago for none, even when that is more than 8 × 24 hours ago', async () => {
    // New York, the week the clocks go back: Monday 00:00 to the next Monday 23:59 is 7 local days and 8 days 0 h 59 min.
    const NY = 'America/New_York', b = await usedAt(new Date('2026-11-01T00:00:00Z'), NY);
    const ranAt = new Date('2026-10-26T04:00:00Z'), now = new Date('2026-11-03T04:59:00Z');
    expect([`${todayIn(NY, ranAt)} ${nowHMIn(NY, ranAt)}`, `${todayIn(NY, now)} ${nowHMIn(NY, now)}`, (now.getTime() - ranAt.getTime()) / HOUR > 8 * 24]).toEqual(['2026-10-26 00:00', '2026-11-02 23:59', true]);
    await ran(b, ranAt);
    const found = (await lastFullVisibilityRuns([b.id], now)).get(b.id) ?? null;
    expect(found?.toISOString()).toBe(ranAt.toISOString());
    expect([visibilityDue('active', NY, found, now), visibilityDue('active', NY, null, now)]).toEqual([false, true]);   // 7 days on a Monday: not due; "none" would have been
  });
});

// VW-3 (TQ-3). The night of the weekly run and the morning of the weekly report are set in two places: `VIS_WEEKDAY` and
// the night window here, the Monday send gate and its UTC period in the digest. This drives both for real and fails if
// either moves without the other: for every UTC offset, whenever in its window the scheduler looks, the run is queued
// inside the period the next report covers, before that report is sent, and under two days before it.
describe.skipIf(!ON)('the weekly run and the weekly report (database, real cron, real send gate)', () => {
  let owner: TUser;
  beforeAll(async () => { vi.stubEnv('RADAR_VISIBILITY_CADENCE', ''); vi.stubEnv('RADAR_EDUCATION_EMAILS', '1'); owner = await F.user(); });
  afterAll(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await clearMarks(); await F.cleanup(); });

  it('for every offset from UTC−12 to UTC+14 the scheduled run lands in the reported week, before the email, and is under two days old', async () => {
    /** The real gate: `collectAiReports` reads the database only once it is time to send. */
    const sends = async (when: Date) => { const spy = vi.spyOn(db, 'select'); try { await collectAiReports(when, [owner.id]); return spy.mock.calls.length > 0; } finally { spy.mockRestore(); } };
    let sendAt = new Date('2027-06-09T00:00:00Z');
    for (let n = 0; n < 8 * 24 && !(await sends(sendAt)); n++) sendAt = new Date(sendAt.getTime() + HOUR);
    expect(await sends(sendAt)).toBe(true);
    expect(await sends(new Date(sendAt.getTime() - HOUR))).toBe(false);
    const period = weeklyRecommendationShare([], '', '', sendAt);                 // the real period: what the email reports
    const utcDay = (d: Date) => d.toISOString().slice(0, 10);

    // One business per offset, each with a full run at 03:00 on its own run-weekday in the week before the reported one.
    const offsetMs = (tz: string, d: Date) => Date.parse(`${todayIn(tz, d)}T${nowHMIn(tz, d)}:00Z`) - d.getTime();
    const bs: Biz[] = [];
    for (const tz of ZONES) {
      const b = await F.biz(owner); made.push(b.id);
      const days = [8, 9, 10, 11, 12, 13, 14].map(k => utcDay(new Date(sendAt.getTime() - k * DAY))), seedDay = days.find(d => new Date(d + 'T00:00:00Z').getUTCDay() === VIS_WEEKDAY)!;
      const seed = new Date(Date.parse(seedDay + 'T03:00:00Z') - offsetMs(tz, sendAt));
      await db.update(B).set({ timezone: tz, lastActiveAt: sendAt }).where(eq(B.id, b.id));
      await db.insert(J).values({ businessId: b.id, kind: 'visibility.run', ref: b.id, status: 'done', payload: {}, createdAt: seed });
      bs.push({ id: b.id, tz });
    }
    expect(bs.length).toBe(27);
    const ids = bs.map(b => b.id);

    // The scheduler looks every half hour from four days before the email to a day after it. Each run it queues is noted
    // and removed with its mark, so the next look queues it again: that gives every moment at which the run can start.
    const queuedAt = new Map<string, Date[]>(bs.map(b => [b.id, []]));
    for (let t = sendAt.getTime() - 4 * DAY; t <= sendAt.getTime() + DAY; t += HOUR / 2) {
      const now = new Date(t);
      await nightlyTick(now);
      const queued = await db.select({ id: J.id, bid: J.businessId }).from(J).where(and(inArray(J.businessId, ids), eq(J.kind, 'visibility.run'), eq(J.status, 'queued')));
      if (!queued.length) continue;
      for (const q of queued) { queuedAt.get(q.bid!)!.push(now); await db.delete(schema.cronMarks).where(like(schema.cronMarks.key, `vis:${q.bid}:%`)); }
      await db.delete(J).where(inArray(J.id, queued.map(q => q.id)));
    }
    const rows = bs.map(b => {
      const all = queuedAt.get(b.id)!, firstDay = all.length ? todayIn(b.tz, all[0]) : '';
      const night = all.filter(d => todayIn(b.tz, d) === firstDay);              // the scheduled night; later ones are the overdue rule, since nothing was kept
      return { tz: b.tz, looks: night.length, weekdays: [...new Set(night.map(d => new Date(todayIn(b.tz, d) + 'T00:00:00Z').getUTCDay()))],
        inPeriod: night.every(d => utcDay(d) >= period.start && utcDay(d) < period.end), beforeSend: night.every(d => d < sendAt),
        hoursBefore: night.map(d => (sendAt.getTime() - d.getTime()) / HOUR) };
    });
    for (const r of rows) {
      expect([r.tz, r.looks > 0, r.weekdays, r.inPeriod, r.beforeSend]).toEqual([r.tz, true, [VIS_WEEKDAY], true, true]);
      expect([r.tz, Math.max(...r.hoursBefore) < 48, Math.min(...r.hoursBefore) > 0]).toEqual([r.tz, true, true]);
    }
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
