import { describe, expect, it } from 'vitest';
import { addMonthIso, fmtD, fmtDW } from './dates';

// A trial that ends at 2026-10-28T07:30:00Z: still Oct 28 in Los Angeles (00:30 PDT), already Oct 28 evening in
// Auckland (20:30 NZDT). One that ends at 2026-10-28T02:00:00Z is Oct 27 in LA but Oct 28 in Auckland.
describe('trial dates in the browser time zone', () => {
  it('formats "Mon D" and "Weekday, Mon D" in Los Angeles', () => {
    expect(fmtD('2026-10-28T07:30:00Z', 'America/Los_Angeles')).toBe('Oct 28');
    expect(fmtDW('2026-10-28T07:30:00Z', 'America/Los_Angeles')).toBe('Wed, Oct 28');
    expect(fmtD('2026-10-28T02:00:00Z', 'America/Los_Angeles')).toBe('Oct 27');
    expect(fmtDW('2026-10-28T02:00:00Z', 'America/Los_Angeles')).toBe('Tue, Oct 27');
  });
  it('formats the same instants in Auckland', () => {
    expect(fmtD('2026-10-28T02:00:00Z', 'Pacific/Auckland')).toBe('Oct 28');
    expect(fmtDW('2026-10-28T02:00:00Z', 'Pacific/Auckland')).toBe('Wed, Oct 28');
    // Late on the 28th UTC is already the 29th in Auckland.
    expect(fmtDW('2026-10-28T13:00:00Z', 'Pacific/Auckland')).toBe('Thu, Oct 29');
  });
  it('keeps the timeline date and the fine-print date on the same day', () => {
    const iso = '2026-12-31T23:59:59Z';
    for (const tz of ['America/Los_Angeles', 'Pacific/Auckland']) expect(fmtDW(iso, tz).endsWith(fmtD(iso, tz))).toBe(true);
  });
  it('adds a calendar month for the restart preview, clamping to the month end', () => {
    expect(addMonthIso(new Date('2026-10-25T12:00:00Z'))).toBe('2026-11-25T12:00:00.000Z');
    expect(addMonthIso(new Date('2027-01-31T12:00:00Z'))).toBe('2027-02-28T12:00:00.000Z');
  });
});
