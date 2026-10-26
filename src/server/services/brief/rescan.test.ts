import { describe, expect, it } from 'vitest';
import { RESCAN_EVERY_MS, rescanDue } from './rescan';

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
