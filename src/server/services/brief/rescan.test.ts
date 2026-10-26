import { describe, expect, it } from 'vitest';
import { NEW_SINCE_MARGIN_MS, RESCAN_EVERY_MS, newSinceFor, rescanDue } from './rescan';
import { xStartMs } from './sources/x';

const now = new Date('2026-10-26T15:30:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const M = 60e3;

describe('rescanDue (background rescans of today’s brief)', () => {
  it('is due 2 h after the last scan of the day was created, not a minute earlier', () => {
    expect(RESCAN_EVERY_MS).toBe(120 * M);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(119 * M), status: 'done' }, now })).toBe(false);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(120 * M), status: 'done' }, now })).toBe(true);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(9 * 60 * M), status: 'done' }, now })).toBe(true);
  });
  it('never while a scan is queued or running, however old it is', () => {
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(3 * 60 * M), status: 'queued' }, now })).toBe(false);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(3 * 60 * M), status: 'running' }, now })).toBe(false);
  });
  it('a failed scan is retried after 2 h, not every minute', () => {
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(5 * M), status: 'failed' }, now })).toBe(false);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(121 * M), status: 'failed' }, now })).toBe(true);
  });
  it('never without today’s brief (before the morning scan, or after local midnight)', () => {
    expect(rescanDue({ hasDay: false, last: { createdAt: ago(10 * 60 * M), status: 'done' }, now })).toBe(false);
    expect(rescanDue({ hasDay: false, last: null, now })).toBe(false);
  });
  it('a day that has no scan job of its own (seeded) is due', () => {
    expect(rescanDue({ hasDay: true, last: null, now })).toBe(true);
  });
});

describe('X API reads on a background rescan: only posts since the previous scan that read X', () => {
  const H = 3600e3, D = 864e5;
  const scan = (agoMs: number, o: { status?: string; mode?: string; result?: any } = {}) => ({ createdAt: ago(agoMs), status: o.status || 'done', payload: { mode: o.mode || 'again' }, result: o.result || { added: 1 } });
  it('starts 10 minutes before the newest earlier scan that read the platform', () => {
    expect(NEW_SINCE_MARGIN_MS).toBe(10 * M);
    expect(newSinceFor([scan(2 * H), scan(4 * H, { mode: 'first' })], 'x')).toBe(now.getTime() - 2 * H - 10 * M);
  });
  it('passes over scans that didn’t read it: failed, skipped, Keep runs, or the platform skipped', () => {
    const earlier = [
      scan(1 * H, { status: 'failed' }), scan(2 * H, { result: { failed: 'reddit' } }), scan(3 * H, { result: { skipped: 'no_access' } }),
      scan(4 * H, { mode: 'keep' }), scan(5 * H, { result: { added: 0, skippedPlats: ['x'] } }), scan(6 * H, { mode: 'first' }),
    ];
    expect(newSinceFor(earlier, 'x')).toBe(now.getTime() - 6 * H - 10 * M);
    expect(newSinceFor(earlier, 'linkedin')).toBe(now.getTime() - 5 * H - 10 * M);
    expect(newSinceFor([scan(1 * H, { status: 'running' })], 'x')).toBeUndefined();
    expect(newSinceFor([], 'x')).toBeUndefined();
  });
  it('start_time = the later of the 48h window and the previous scan, within the API’s 7 days and before now', () => {
    const t = now.getTime();
    expect(xStartMs(t - 48 * H, undefined, t)).toBe(t - 48 * H);                 // first scans, Scan again: unchanged
    expect(xStartMs(t - 48 * H, t - 2 * H - 10 * M, t)).toBe(t - 2 * H - 10 * M); // rescan: only new posts
    expect(xStartMs(t - 48 * H, t - 60 * H, t)).toBe(t - 48 * H);                 // never wider than the usual window
    expect(xStartMs(t - 8 * D, undefined, t)).toBe(t - 6.9 * D);                  // the recent-search API limit
    expect(xStartMs(t - 48 * H, t + 5 * M, t)).toBe(t - 60e3);                    // never in the future
  });
});
