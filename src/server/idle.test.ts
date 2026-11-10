// Idle spend thresholds (IS-2): the tier a business is in and how often each tier's background work may run. Pure.
import { describe, expect, it } from 'vitest';
import { CATCH_UP_AFTER_MS, DORMANT_AFTER_DAYS, IDLE_AFTER_DAYS, IDLE_EVERY_DAYS, TOUCH_EVERY_MS, activityTier, cadenceDue } from './idle';

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

describe('cadence per tier (nightly AI visibility, automatic social packs)', () => {
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
