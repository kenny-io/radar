import { describe, expect, it } from 'vitest';
import { NEW_SINCE_MARGIN_MS, RESCAN_EVERY_MS, newSinceFor, rescanDue } from './rescan';
import { xStartMs } from './sources/x';

const now = new Date('2026-10-26T15:30:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const M = 60e3;

describe('rescanDue (background rescans of today’s brief)', () => {
  // Someone acted a minute ago, i.e. after every scan below: these cases are about the clock alone.
  const acted = ago(1 * M);
  it('is due 2 h after the last scan of the day was created, not a minute earlier', () => {
    expect(RESCAN_EVERY_MS).toBe(120 * M);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(119 * M), status: 'done' }, now, actedAt: acted })).toBe(false);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(120 * M), status: 'done' }, now, actedAt: acted })).toBe(true);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(9 * 60 * M), status: 'done' }, now, actedAt: acted })).toBe(true);
  });
  it('never while a scan is queued or running, however old it is', () => {
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(3 * 60 * M), status: 'queued' }, now, actedAt: acted })).toBe(false);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(3 * 60 * M), status: 'running' }, now, actedAt: acted })).toBe(false);
  });
  it('a failed scan is retried after 2 h, not every minute', () => {
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(5 * M), status: 'failed' }, now, actedAt: acted })).toBe(false);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(121 * M), status: 'failed' }, now, actedAt: acted })).toBe(true);
  });
  it('never without today’s brief (before the morning scan, or after local midnight)', () => {
    expect(rescanDue({ hasDay: false, last: { createdAt: ago(10 * 60 * M), status: 'done' }, now, actedAt: acted })).toBe(false);
    expect(rescanDue({ hasDay: false, last: null, now, actedAt: acted })).toBe(false);
  });
  it('a day that has no scan job of its own (seeded) is due once someone has acted on it', () => {
    expect(rescanDue({ hasDay: true, last: null, now, actedAt: acted })).toBe(true);
    expect(rescanDue({ hasDay: true, last: null, now, actedAt: null })).toBe(false);
  });
});

describe('rescanDue: a rescan has to be earned (IS-7)', () => {
  const H = 60 * M;
  it('no action on the day: never due, however long ago the last scan was', () => {
    for (const hours of [2, 6, 14]) expect(rescanDue({ hasDay: true, last: { createdAt: ago(hours * H), status: 'done' }, now, actedAt: null })).toBe(false);
  });
  it('an action before the last scan does not count: that scan already answered it', () => {
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(3 * H), status: 'done' }, now, actedAt: ago(4 * H) })).toBe(false);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(3 * H), status: 'done' }, now, actedAt: ago(3 * H) })).toBe(false); // the same instant is not "after"
  });
  it('an action after the last scan earns one, still no sooner than 2 h after that scan', () => {
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(3 * H), status: 'done' }, now, actedAt: ago(3 * H - 1) })).toBe(true);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(1 * H), status: 'done' }, now, actedAt: ago(30 * M) })).toBe(false);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(1 * H), status: 'done' }, now: new Date(now.getTime() + 1 * H), actedAt: ago(30 * M) })).toBe(true);
  });
  it('every scan restarts it, whatever started that scan: after a Keep run or a rescan a new action is needed', () => {
    // 09:00 morning scan, 10:00 the owner copies a reply, 11:30 a Keep run (or a rescan, or Scan again): the copy is spent.
    const actedAt = ago(5.5 * H);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(6.5 * H), status: 'done' }, now, actedAt })).toBe(true);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(4 * H), status: 'done' }, now, actedAt })).toBe(false);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(4 * H), status: 'failed' }, now, actedAt })).toBe(false);
    expect(rescanDue({ hasDay: true, last: { createdAt: ago(4 * H), status: 'done' }, now, actedAt: ago(10 * M) })).toBe(true);
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
