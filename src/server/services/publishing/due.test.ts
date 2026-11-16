// The "due" rule the publishing scheduler and the restore of a deleted business share.
import { describe, expect, it } from 'vitest';
import { entryDue, lastDueDate } from './due';

const NY = { tz: 'America/New_York', time: '09:00' };
// 2026-11-16 08:59 and 09:00 in New York (UTC-5 in November).
const before = new Date('2026-11-16T13:59:00Z');
const at = new Date('2026-11-16T14:00:00Z');

describe('when a calendar entry is due', () => {
  it('is due on any earlier day, and today only once the publish time has come', () => {
    expect(entryDue('2026-11-15', NY, before)).toBe(true);
    expect(entryDue('2026-11-16', NY, before)).toBe(false);
    expect(entryDue('2026-11-16', NY, at)).toBe(true);
    expect(entryDue('2026-11-17', NY, at)).toBe(false);
  });
  it('reads the day and the time in the business time zone, not in UTC', () => {
    // 23:30 on the 16th in Auckland is still the 16th in UTC, and already past a 09:00 publish time there.
    const lateInAuckland = new Date('2026-11-16T10:30:00Z');
    expect(entryDue('2026-11-16', { tz: 'Pacific/Auckland', time: '09:00' }, lateInAuckland)).toBe(true);
    // The same moment is 05:30 on the 16th in New York: not yet.
    expect(entryDue('2026-11-16', NY, lateInAuckland)).toBe(false);
  });
  it('falls back to New York and 09:00 when the business has neither', () => {
    expect(entryDue('2026-11-16', {}, before)).toBe(false);
    expect(entryDue('2026-11-16', { tz: null, time: null }, at)).toBe(true);
  });
  it('names the last due date so that every date up to it is due and every later one is not', () => {
    for (const now of [before, at]) for (const clock of [NY, { tz: 'Pacific/Auckland', time: '18:15' }, { tz: 'UTC', time: '00:00' }]) {
      const last = lastDueDate(clock, now);
      for (const date of ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'])
        expect([date, entryDue(date, clock, now)]).toEqual([date, date <= last]);
    }
    expect(lastDueDate(NY, before)).toBe('2026-11-15');
    expect(lastDueDate(NY, at)).toBe('2026-11-16');
  });
});
