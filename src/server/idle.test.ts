// Idle spend thresholds (IS-2): the tier a business is in and how often each tier's background work may run. Pure.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATCH_UP_AFTER_MS, DORMANT_AFTER_DAYS, IDLE_AFTER_DAYS, IDLE_EVERY_DAYS, TOUCH_EVERY_MS, VIS_LOOKBACK_DAYS, VIS_OVERDUE_DAYS, VIS_SKIP_WITHIN_DAYS, VIS_WEEKDAY, activityTier, cadenceDue, visibilityCadence, visibilityDue } from './idle';
import { nowHMIn, todayIn } from '@/lib/format';

const now = new Date('2026-11-10T15:00:00Z');
const DAY = 864e5;
const daysAgo = (d: number, lessMs = 0) => new Date(now.getTime() - d * DAY + lessMs);
const used = (d: number, lessMs = 0) => ({ lastActiveAt: daysAgo(d, lessMs) });

describe('activity tiers (owner decision 2026-11-10)', () => {
  it('the thresholds are the owner’s: idle after 7 days, dormant after 30, idle work weekly, activity written hourly', () => {
    expect([IDLE_AFTER_DAYS, DORMANT_AFTER_DAYS, IDLE_EVERY_DAYS]).toEqual([7, 30, 7]);
    expect([TOUCH_EVERY_MS, CATCH_UP_AFTER_MS]).toEqual([3600e3, 24 * 3600e3]);
  });
  it('active under 7 days since a member last used the app, idle from day 7, dormant from day 30', () => {
    expect(activityTier(used(0), now)).toBe('active');
    expect(activityTier(used(6), now)).toBe('active');
    expect(activityTier(used(7, 1), now)).toBe('active');           // 1 ms short of 7 days
    expect(activityTier(used(7), now)).toBe('idle');
    expect(activityTier(used(29), now)).toBe('idle');
    expect(activityTier(used(30, 1), now)).toBe('idle');            // 1 ms short of 30 days
    expect(activityTier(used(30), now)).toBe('dormant');
    expect(activityTier(used(400), now)).toBe('dormant');
  });
  it('Autopilot on is never slowed, however long nobody has opened the app', () => {
    for (const d of [8, 31, 400]) expect(activityTier({ ...used(d), autopilot: { enabled: true, activationId: 'a1' } }, now)).toBe('active');
    // Only the switch itself counts: a paused Autopilot, or leftovers of an old activation, do not.
    expect(activityTier({ ...used(8), autopilot: { enabled: false, activationId: 'a1' } }, now)).toBe('idle');
    expect(activityTier({ ...used(31), autopilot: { enabled: 'true' } }, now)).toBe('dormant');
    expect(activityTier({ ...used(31), autopilot: null }, now)).toBe('dormant');
  });
  it('a business that became active under 7 days ago is active even if nobody has been back since', () => {
    const committed = (d: number, lessMs = 0) => ({ onboarding: { committedAt: daysAgo(d, lessMs).toISOString() } });
    expect(activityTier({ ...used(40), ...committed(6) }, now)).toBe('active');
    expect(activityTier({ ...used(40), ...committed(7, 1) }, now)).toBe('active');
    expect(activityTier({ ...used(40), ...committed(7) }, now)).toBe('dormant');
    expect(activityTier({ ...used(10), ...committed(8) }, now)).toBe('idle');
    // No commit time, or one that isn't a date, is no reason to be active.
    expect(activityTier({ ...used(40), onboarding: {} }, now)).toBe('dormant');
    expect(activityTier({ ...used(40), onboarding: null }, now)).toBe('dormant');
    expect(activityTier({ ...used(40), onboarding: { committedAt: 'soon' } }, now)).toBe('dormant');
  });
});

describe('cadence per tier (automatic social packs; AI visibility only under RADAR_VISIBILITY_CADENCE=nightly)', () => {
  it('active: always due, whatever ran before', () => {
    expect(cadenceDue('active', null, now)).toBe(true);
    expect(cadenceDue('active', daysAgo(0, -60e3), now)).toBe(true);
  });
  it('idle: due with no run on record, then not again until the newest run is 7 days old', () => {
    expect(cadenceDue('idle', null, now)).toBe(true);
    expect(cadenceDue('idle', daysAgo(1), now)).toBe(false);
    expect(cadenceDue('idle', daysAgo(6), now)).toBe(false);
    expect(cadenceDue('idle', daysAgo(7, 1), now)).toBe(false);
    expect(cadenceDue('idle', daysAgo(7), now)).toBe(true);
    expect(cadenceDue('idle', daysAgo(20), now)).toBe(true);
  });
  it('dormant: never, even with nothing on record', () => {
    expect(cadenceDue('dormant', null, now)).toBe(false);
    expect(cadenceDue('dormant', daysAgo(60), now)).toBe(false);
  });
});

// Weekly AI visibility (VW-1, VW-1a; architecture §15 R10). Scheduled full runs happen on the business's Sunday night;
// a Sunday that was missed or failed is caught up the next night. All days are business-local calendar days.
describe('weekly AI visibility: visibilityDue', () => {
  const NY = 'America/New_York', WEST = 'Etc/GMT+12' /* UTC−12 */, EAST = 'Pacific/Kiritimati' /* UTC+14 */;
  const at = (iso: string) => new Date(iso);
  /** What the clock on the wall says there. Every boundary case states the instant and this, so a wrong offset fails loudly. */
  const local = (tz: string, d: Date) => `${todayIn(tz, d)} ${nowHMIn(tz, d)}`;
  const weekday = (tz: string, d: Date) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(todayIn(tz, d) + 'T00:00:00Z').getUTCDay()];
  /** `isoLocal` on the wall at a fixed offset of `hours` from UTC. */
  const wall = (hours: number, isoLocal: string) => new Date(Date.parse(isoLocal + ':00Z') - hours * 3600e3);
  const days = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

  it('the thresholds: Sunday; skipped only within 2 days of a full run; overdue at 8; a 10-day lookback', () => {
    expect([VIS_WEEKDAY, VIS_SKIP_WITHIN_DAYS, VIS_OVERDUE_DAYS, VIS_LOOKBACK_DAYS]).toEqual([0, 2, 8, 10]);
    // The Sunday run is 7 days after the last one; overdue must be later than that, and the lookback later still.
    expect(VIS_SKIP_WITHIN_DAYS < 7 && 7 < VIS_OVERDUE_DAYS && VIS_OVERDUE_DAYS < VIS_LOOKBACK_DAYS).toBe(true);
  });

  it('(a) on Sunday: runs unless a full run started under 2 local days ago (that Saturday, or earlier that Sunday)', () => {
    const sunday = at('2026-11-15T08:00:00Z');                                  // Sunday 03:00 in New York
    expect([local(NY, sunday), weekday(NY, sunday)]).toEqual(['2026-11-15 03:00', 'Sun']);
    // The newest full run was 0 to 7 days ago, at the same time of night.
    const table = [0, 1, 2, 3, 4, 5, 6, 7].map(n => [weekday(NY, days(sunday, -n)), n, visibilityDue('active', NY, days(sunday, -n), sunday)]);
    expect(table).toEqual([['Sun', 0, false], ['Sat', 1, false], ['Fri', 2, true], ['Thu', 3, true], ['Wed', 4, true], ['Tue', 5, true], ['Mon', 6, true], ['Sun', 7, true]]);
  });

  it('(b) on any other weekday: only when the newest full run started 8 or more local days ago', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {                                        // Monday to Saturday night
      const night = at(new Date(Date.UTC(2026, 10, 15 + n, 8)).toISOString());
      const due = (ago: number) => visibilityDue('active', NY, days(night, -ago), night);
      expect([weekday(NY, night), due(0), due(3), due(6), due(7), due(8), due(9), due(40)]).toEqual([weekday(NY, night), false, false, false, false, true, true, true]);
    }
    // A missed Sunday: the run of the Sunday before is 8 days old on Monday night. Not before.
    const lastSunday = at('2026-11-08T08:00:00Z');
    expect(['2026-11-14', '2026-11-15', '2026-11-16'].map(d => visibilityDue('active', NY, lastSunday, at(d + 'T08:00:00Z')))).toEqual([false, true /* Sunday itself */, true /* Monday */]);
  });

  it('no full run on record: due on the next night whatever the weekday; a dormant business never', () => {
    const week = Array.from({ length: 7 }, (_, n) => new Date(Date.UTC(2026, 10, 15 + n, 8)));
    for (const tier of ['active', 'idle'] as const) expect([tier, ...week.map(d => visibilityDue(tier, NY, null, d))]).toEqual([tier, true, true, true, true, true, true, true]);
    expect(week.map(d => visibilityDue('dormant', NY, null, d))).toEqual([false, false, false, false, false, false, false]);
    // Dormant: not on Sunday after a week, and not when long overdue.
    expect([visibilityDue('dormant', NY, days(week[0], -7), week[0]), visibilityDue('dormant', NY, days(week[2], -60), week[2])]).toEqual([false, false]);
  });

  it('active and idle get the same rule', () => {
    const sunday = at('2026-11-15T08:00:00Z'), tuesday = at('2026-11-17T08:00:00Z');
    for (const tier of ['active', 'idle'] as const) {
      expect([tier, visibilityDue(tier, NY, days(sunday, -7), sunday), visibilityDue(tier, NY, days(sunday, -1), sunday), visibilityDue(tier, NY, days(tuesday, -7), tuesday), visibilityDue(tier, NY, days(tuesday, -8), tuesday)])
        .toEqual([tier, true, false, false, true]);
    }
  });

  it('both boundaries are local midnight, not a number of hours', () => {
    // 2 days: Friday 23:59 counts as 2 days before Sunday 03:00, Saturday 00:01 as 1.
    const sunday = at('2026-11-15T08:00:00Z');
    expect([local(NY, at('2026-11-14T04:59:00Z')), local(NY, at('2026-11-14T05:01:00Z'))]).toEqual(['2026-11-13 23:59', '2026-11-14 00:01']);
    expect([visibilityDue('active', NY, at('2026-11-14T04:59:00Z'), sunday), visibilityDue('active', NY, at('2026-11-14T05:01:00Z'), sunday)]).toEqual([true, false]);
    // 8 days: Sunday 23:59 counts as 8 days before Monday-week 03:00, Monday 00:01 as 7.
    const monday = at('2026-11-16T08:00:00Z');
    expect([local(NY, monday), local(NY, at('2026-11-09T04:59:00Z')), local(NY, at('2026-11-09T05:01:00Z'))]).toEqual(['2026-11-16 03:00', '2026-11-08 23:59', '2026-11-09 00:01']);
    expect([visibilityDue('active', NY, at('2026-11-09T04:59:00Z'), monday), visibilityDue('active', NY, at('2026-11-09T05:01:00Z'), monday)]).toEqual([true, false]);
  });

  it('does not drift: a run that started late in last Sunday’s window does not push this Sunday’s past 02:00', () => {
    const lastRun = at('2026-11-08T10:59:00Z'), now = at('2026-11-15T07:00:00Z');
    expect([local(NY, lastRun), local(NY, now)]).toEqual(['2026-11-08 05:59', '2026-11-15 02:00']);
    expect(visibilityDue('active', NY, lastRun, now)).toBe(true);
    // Counting elapsed time instead (the idle rule) would say no for another four hours, and later again each week.
    expect(cadenceDue('idle', lastRun, now)).toBe(false);
  });

  it('the weekday and both boundaries are the business’s own, at UTC+14 and at UTC−12', () => {
    // One instant, three weekdays; the newest full run was 5 days earlier, so only the Sunday rule can apply.
    const instant = at('2026-11-15T10:30:00Z');
    expect([local(WEST, instant), local('UTC', instant), local(EAST, instant)]).toEqual(['2026-11-14 22:30', '2026-11-15 10:30', '2026-11-16 00:30']);
    expect([WEST, 'UTC', EAST].map(tz => visibilityDue('active', tz, days(instant, -5), instant))).toEqual([false, true, false]);
    for (const [tz, offset] of [[EAST, 14], [WEST, -12]] as const) {
      const sunday = wall(offset, '2026-11-15T03:00'), monday = wall(offset, '2026-11-16T03:00');
      expect([tz, local(tz, sunday), weekday(tz, sunday), local(tz, monday)]).toEqual([tz, '2026-11-15 03:00', 'Sun', '2026-11-16 03:00']);
      const fri2359 = wall(offset, '2026-11-13T23:59'), sat0001 = wall(offset, '2026-11-14T00:01'), sun2359 = wall(offset, '2026-11-08T23:59'), mon0001 = wall(offset, '2026-11-09T00:01');
      expect([local(tz, fri2359), local(tz, sat0001), local(tz, sun2359), local(tz, mon0001)]).toEqual(['2026-11-13 23:59', '2026-11-14 00:01', '2026-11-08 23:59', '2026-11-09 00:01']);
      expect([tz, visibilityDue('active', tz, fri2359, sunday), visibilityDue('active', tz, sat0001, sunday)]).toEqual([tz, true, false]);     // 2 days, 1 day
      expect([tz, visibilityDue('active', tz, sun2359, monday), visibilityDue('active', tz, mon0001, monday)]).toEqual([tz, true, false]);     // 8 days, 7 days
    }
  });

  it('a clock change in between moves neither boundary (New York, both changes)', () => {
    // Clocks go back on Sunday 2026-11-01.
    const fallSunday = at('2026-11-01T10:59:00Z'), fallMonday = at('2026-11-02T08:00:00Z');
    expect([local(NY, fallSunday), local(NY, fallMonday)]).toEqual(['2026-11-01 05:59', '2026-11-02 03:00']);
    expect([local(NY, at('2026-10-31T03:59:00Z')), local(NY, at('2026-10-31T04:01:00Z'))]).toEqual(['2026-10-30 23:59', '2026-10-31 00:01']);
    expect([visibilityDue('active', NY, at('2026-10-31T03:59:00Z'), fallSunday), visibilityDue('active', NY, at('2026-10-31T04:01:00Z'), fallSunday)]).toEqual([true, false]);
    expect([local(NY, at('2026-10-26T03:59:00Z')), local(NY, at('2026-10-26T04:01:00Z'))]).toEqual(['2026-10-25 23:59', '2026-10-26 00:01']);
    expect([visibilityDue('active', NY, at('2026-10-26T03:59:00Z'), fallMonday), visibilityDue('active', NY, at('2026-10-26T04:01:00Z'), fallMonday)]).toEqual([true, false]);
    // Sunday to Sunday across it is 169 hours and still the weekly run.
    expect(visibilityDue('active', NY, at('2026-10-25T06:00:00Z'), fallSunday)).toBe(true);
    // Clocks go forward on Sunday 2027-03-14.
    const springSunday = at('2027-03-14T07:00:00Z'), springMonday = at('2027-03-15T07:00:00Z');
    expect([local(NY, springSunday), local(NY, springMonday)]).toEqual(['2027-03-14 03:00', '2027-03-15 03:00']);
    expect([local(NY, at('2027-03-13T04:59:00Z')), local(NY, at('2027-03-13T05:01:00Z'))]).toEqual(['2027-03-12 23:59', '2027-03-13 00:01']);
    expect([visibilityDue('active', NY, at('2027-03-13T04:59:00Z'), springSunday), visibilityDue('active', NY, at('2027-03-13T05:01:00Z'), springSunday)]).toEqual([true, false]);
    expect([local(NY, at('2027-03-08T04:59:00Z')), local(NY, at('2027-03-08T05:01:00Z'))]).toEqual(['2027-03-07 23:59', '2027-03-08 00:01']);
    expect([visibilityDue('active', NY, at('2027-03-08T04:59:00Z'), springMonday), visibilityDue('active', NY, at('2027-03-08T05:01:00Z'), springMonday)]).toEqual([true, false]);
    // 05:59 one Sunday to 03:00 the next, with an hour lost: under 7 × 24 hours and still the weekly run.
    expect(visibilityDue('active', NY, at('2027-03-07T10:59:00Z'), springSunday)).toBe(true);
  });
});

// The schedule the rule produces, night after night: one look at 03:00 local every night, as the cron does.
describe('weekly AI visibility: the schedule over time', () => {
  const NY = 'America/New_York';
  const day = (tz: string, d: Date) => todayIn(tz, d);
  const weekday = (isoDay: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(isoDay + 'T00:00:00Z').getUTCDay()];
  const gap = (a: string, b: string) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY;
  /** The instants at which it is 03:00 in `tz`, for `count` nights from `fromUtc` (found on the clock, so a clock change cannot shift them). */
  function nights(tz: string, fromUtc: string, count: number): Date[] {
    const out: Date[] = [];
    for (let t = Date.parse(fromUtc); out.length < count; t += 3600e3) if (nowHMIn(tz, new Date(t)) === '03:00') out.push(new Date(t));
    return out;
  }
  /** Run the rule each night. `missed`: local days on which the scheduler never looked. `failed`: days whose run crashed.
   *  `offCycle`: local days with a full run at midday from another origin (first run, catch-up on return). */
  function simulate(tz: string, when: Date[], o: { last?: Date | null; missed?: string[]; failed?: string[]; offCycle?: string[] } = {}) {
    let last = o.last ?? null; const scheduled: string[] = [], attempts: string[] = [], full: string[] = last ? [day(tz, last)] : [], waited: number[] = [];
    for (const night of when) {
      const today = day(tz, night);
      if (!o.missed?.includes(today) && visibilityDue('active', tz, last, night)) {
        attempts.push(today);
        if (!o.failed?.includes(today)) { waited.push(full.length ? gap(full[full.length - 1], today) : Infinity); last = night; scheduled.push(today); full.push(today); }
      }
      if (o.offCycle?.includes(today)) { last = new Date(night.getTime() + 9 * 3600e3); full.push(today); }
    }
    /** `waited[i]`: local days from the full run before it to `scheduled[i]`. */
    return { scheduled, waited, attempts, full, gaps: full.slice(1).map((d, i) => gap(full[i], d)) };
  }
  // Sunday 2026-10-11 in New York; the eight weeks from it include the clock change of 2026-11-01.
  const START = '2026-10-11T00:00:00Z', SUNDAY0 = new Date('2026-10-04T07:00:00Z');       // the run of the Sunday before, 03:00

  it('nothing missed, eight weeks: every scheduled run is on Sunday, seven days apart', () => {
    for (const tz of [NY, 'Etc/GMT+12', 'Pacific/Kiritimati', 'UTC']) {
      const first = nights(tz, START, 8).find(n => weekday(day(tz, n)) === 'Sun')!;
      const r = simulate(tz, nights(tz, first.toISOString(), 56), { last: new Date(first.getTime() - 7 * DAY) });
      expect([tz, r.scheduled.length, [...new Set(r.scheduled.map(weekday))], [...new Set(r.gaps)]]).toEqual([tz, 8, ['Sun'], [7]]);
    }
  });

  it('a Sunday the scheduler missed entirely: the run happens on Monday night, then on the following Sunday, and not again that week', () => {
    const r = simulate(NY, nights(NY, START, 21), { last: SUNDAY0, missed: ['2026-10-11'] });
    expect(r.scheduled).toEqual(['2026-10-12', '2026-10-18', '2026-10-25']);
    expect(r.scheduled.map(weekday)).toEqual(['Mon', 'Sun', 'Sun']);
    expect(r.gaps).toEqual([8, 6, 7]);
    // Down from Sunday to Wednesday: one run on the first night back, no burst for the nights missed.
    const long = simulate(NY, nights(NY, START, 21), { last: SUNDAY0, missed: ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'] });
    expect(long.scheduled).toEqual(['2026-10-15', '2026-10-18', '2026-10-25']);
  });

  it('a Sunday run that failed: tried again on Monday night; a business whose every run fails is tried once a night', () => {
    const r = simulate(NY, nights(NY, START, 15), { last: SUNDAY0, failed: ['2026-10-11'] });
    expect([r.attempts.slice(0, 3), r.scheduled.slice(0, 2)]).toEqual([['2026-10-11', '2026-10-12', '2026-10-18'], ['2026-10-12', '2026-10-18']]);
    const all = nights(NY, START, 10), never = simulate(NY, all, { last: SUNDAY0, failed: all.map(n => day(NY, n)) });
    expect(never.attempts).toEqual(all.map(n => day(NY, n)));     // every night from the Sunday on, and (the day's mark) no more than that
    expect(never.scheduled).toEqual([]);
  });

  it('an off-cycle full run from Monday to Friday keeps that Sunday’s run; one on Saturday skips it, and the next Sunday runs', () => {
    const next = (offCycleDay: string) => { const r = simulate(NY, nights(NY, START, 28), { last: SUNDAY0, offCycle: [offCycleDay] }); const after = r.scheduled.filter(d => d > offCycleDay); return [weekday(offCycleDay), after[0], weekday(after[0]), gap(offCycleDay, after[0]), after[1], weekday(after[1])]; };
    expect(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map(next)).toEqual([
      ['Mon', '2026-10-18', 'Sun', 6, '2026-10-25', 'Sun'], ['Tue', '2026-10-18', 'Sun', 5, '2026-10-25', 'Sun'],
      ['Wed', '2026-10-18', 'Sun', 4, '2026-10-25', 'Sun'], ['Thu', '2026-10-18', 'Sun', 3, '2026-10-25', 'Sun'],
      ['Fri', '2026-10-18', 'Sun', 2, '2026-10-25', 'Sun'],
    ]);
    // Saturday: Sunday is 1 day on and is skipped; the next Sunday is 8 days on, which is the overdue rule and still a Sunday.
    expect(next('2026-10-17')).toEqual(['Sat', '2026-10-25', 'Sun', 8, '2026-11-01', 'Sun']);
  });

  it('nothing missed: at most 8 local days between full runs and every scheduled run on Sunday; one lost Sunday: at most 9', () => {
    // A long stretch with full runs from other origins on random days (seeded), nothing missed and nothing failing.
    let seed = 20261110; const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const all = nights(NY, START, 700), offCycle = all.filter(() => rand() < 0.12).map(n => day(NY, n));
    const r = simulate(NY, all, { last: SUNDAY0, offCycle });
    expect(offCycle.length).toBeGreaterThan(50);
    expect(Math.max(...r.gaps)).toBe(VIS_OVERDUE_DAYS);
    // Where 8 comes from: only after a full run on a Saturday (the Sunday right after it is skipped).
    expect([...new Set(r.gaps.map((g, i) => g === 8 ? weekday(r.full[i]) : '').filter(Boolean))]).toEqual(['Sat']);
    // Every scheduled run is on Sunday, off-cycle runs or not.
    expect([...new Set(r.scheduled.map(weekday))]).toEqual(['Sun']);
    expect([...new Set(simulate(NY, all, { last: SUNDAY0 }).scheduled.map(weekday))]).toEqual(['Sun']);

    // The same stretch with Sundays the scheduler missed (about one in six) and Sunday runs that failed (another one in six).
    const sundays = all.map(n => day(NY, n)).filter(d => weekday(d) === 'Sun');
    const missed = sundays.filter(() => rand() < 0.17), failed = sundays.filter(d => !missed.includes(d) && rand() < 0.2), lost = new Set([...missed, ...failed]);
    const m = simulate(NY, all, { last: SUNDAY0, offCycle, missed, failed });
    expect(missed.length > 5 && failed.length > 5).toBe(true);
    const plus = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
    const long = m.gaps.map((g, i) => ({ g, from: m.full[i], to: m.full[i + 1] })).filter(x => x.g >= 8);
    // One lost Sunday can stretch the gap to 9, in exactly one way: a Saturday run (so the Sunday after it is skipped) whose
    // next Sunday, 8 days on, is the one lost; it is collected on the Monday. Otherwise a lost Sunday costs one day: 8.
    expect([...new Set(long.map(x => x.g))].sort()).toEqual([8, 9]);
    expect(long.filter(x => x.g === 9).every(x => weekday(x.from) === 'Sat' && weekday(x.to) === 'Mon' && lost.has(plus(x.from, 8)))).toBe(true);
    // Every gap of 8 or more starts on a Saturday or spans a lost Sunday.
    expect(long.every(x => weekday(x.from) === 'Sat' || [...lost].some(d => d > x.from && d <= x.to))).toBe(true);
    // A scheduled run off Sunday is always the overdue rule catching up: 8 or more days after the full run before it.
    const offSunday = m.scheduled.map((d, i) => ({ d, waited: m.waited[i] })).filter(x => weekday(x.d) !== 'Sun');
    expect(offSunday.length).toBeGreaterThan(5);
    expect(offSunday.every(x => x.waited >= 8)).toBe(true);
    // Not always the night after the lost Sunday: when a full run from another origin came earlier that week, the catch-up
    // waits until that run is 8 days old (Tuesday off-cycle, Sunday lost: collected on Wednesday).
    expect([...new Set(offSunday.map(x => weekday(x.d)))].length).toBeGreaterThan(1);
  });
});

describe('RADAR_VISIBILITY_CADENCE (VW-6)', () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it('weekly unless it says nightly', () => {
    vi.stubEnv('RADAR_VISIBILITY_CADENCE', '');
    expect(visibilityCadence()).toBe('weekly');
    for (const v of ['nightly', 'NIGHTLY', ' Nightly ']) { vi.stubEnv('RADAR_VISIBILITY_CADENCE', v); expect([v, visibilityCadence()]).toEqual([v, 'nightly']); }
    for (const v of ['weekly', 'daily', 'off', '1', 'night']) { vi.stubEnv('RADAR_VISIBILITY_CADENCE', v); expect([v, visibilityCadence()]).toEqual([v, 'weekly']); }
  });
});
