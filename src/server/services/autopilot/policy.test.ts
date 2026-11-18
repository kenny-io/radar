import { describe, expect, it } from 'vitest';
import { authorized, autopilotOf, autopilotPublic, effectiveSocial, handoffReady, publicationAllowed, socialSlot } from './policy';
import type { SocialAuto } from '@/lib/types';

const active = { status: 'active', autopilot: { enabled: true, activationId: 'current', enabledBy: 'owner', enabledAt: '2026-11-09T06:00:00Z', lastRunAt: '2026-11-09T07:00:00Z', lastError: null, summary: 'Checked the program.' } };

describe('master Autopilot authorization policy', () => {
  it.each([undefined, null, {}, 'true', [], { enabled: 'true' }, { enabled: 1 }])('does not opt in an unconfigured or malformed business: %j', autopilot => {
    expect(autopilotOf({ autopilot }).enabled).toBe(false);
    expect(authorized({ status: 'active', autopilot }, 'current')).toBe(false);
  });
  it('normalizes missing history and keeps internal consent out of the workspace', () => {
    expect(autopilotPublic({})).toEqual({ enabled: false, enabledAt: null, lastRunAt: null, lastError: null });
    expect(autopilotPublic(active)).toEqual({ enabled: true, enabledAt: '2026-11-09T06:00:00Z', lastRunAt: '2026-11-09T07:00:00Z', lastError: null, summary: 'Checked the program.' });
    expect(autopilotPublic(active)).not.toHaveProperty('activationId');
    expect(autopilotPublic(active)).not.toHaveProperty('enabledBy');
  });
  it('revokes old work after an off/on cycle even though the program is enabled again', () => {
    expect(authorized(active, 'current')).toBe(true);
    expect(authorized(active, 'earlier')).toBe(false);
    expect(authorized({ ...active, autopilot: { ...active.autopilot, enabled: false } }, 'current')).toBe(false);
    expect(authorized({ ...active, status: 'onboarding' }, 'current')).toBe(false);
    expect(authorized(active, null)).toBe(false);
    expect(authorized(active, undefined)).toBe(false);
  });
  it('preserves manual and legacy publication eligibility when the master program is off', () => {
    const off = { status: 'active', autopilot: { enabled: false, activationId: 'earlier' } };
    expect(publicationAllowed(off, null)).toBe(true);
    expect(publicationAllowed(off, undefined)).toBe(true);
    expect(publicationAllowed(off, 'earlier')).toBe(false);
    expect(publicationAllowed(active, 'current')).toBe(true);
  });
  it('temporarily enables generation without mutating saved preferences or invoking legacy scheduling', () => {
    const saved: SocialAuto = { on: false, freq: 'custom', days: ['Mon', 'Thu'], platforms: ['x', 'reddit'], style: 'branded', time: '11:30', post: 'schedule' };
    const before = structuredClone(saved);
    expect(effectiveSocial(saved)).toEqual({ ...saved, on: true, post: 'library' });
    expect(saved).toEqual(before);
  });
});

describe('Autopilot publication slots use the business local day', () => {
  it.each([
    ['before the saved slot', '2026-11-09T03:00:00Z', { date: '2026-11-09', time: '08:00' }],
    ['during the active day', '2026-11-09T07:45:00Z', { date: '2026-11-09', time: '11:46' }],
    ['at the saved time', '2026-11-09T04:00:00Z', { date: '2026-11-09', time: '08:01' }],
    ['at the evening cutoff', '2026-11-09T16:00:00Z', { date: '2026-11-10', time: '08:00' }],
    ['late in the evening', '2026-11-09T19:59:00Z', { date: '2026-11-10', time: '08:00' }],
    ['after local midnight before UTC midnight', '2026-11-09T20:15:00Z', { date: '2026-11-10', time: '08:00' }],
  ])('%s in Dubai', (_name, now, expected) => {
    expect(socialSlot('Asia/Dubai', '08:00', new Date(now))).toEqual(expected);
  });
  it('honors a later saved time instead of publishing before it', () => {
    expect(socialSlot('Asia/Dubai', '14:30', new Date('2026-11-09T07:45:00Z'))).toEqual({ date: '2026-11-09', time: '14:30' });
  });
  it.each([
    ['spring change', '2026-03-08T13:15:00Z', { date: '2026-03-08', time: '09:16' }],
    ['fall change', '2026-11-01T14:15:00Z', { date: '2026-11-01', time: '09:16' }],
  ])('uses local time after the New York %s', (_name, now, expected) => {
    expect(socialSlot('America/New_York', '08:00', new Date(now))).toEqual(expected);
  });
});

describe('the day\'s owner email waits for the day\'s work (A17)', () => {
  const NY = 'America/New_York';
  const ready = (now: string, o: Partial<Parameters<typeof handoffReady>[0]> = {}) => handoffReady({ tz: NY, date: '2026-11-09', time: '08:00', enabledAt: '2026-01-01T12:00:00Z', settled: false, ...o, now: Date.parse(now) });
  it('never goes out before the saved daily time, even when the work is done', () => {
    expect(ready('2026-11-09T12:59:59Z', { settled: true })).toBe(false);
    expect(ready('2026-11-09T05:10:00Z', { settled: true })).toBe(false);
  });
  it('goes out from the daily time as soon as the brief and the pack are processed', () => {
    expect(ready('2026-11-09T13:00:00Z', { settled: true })).toBe(true);
    expect(ready('2026-11-09T13:00:00Z')).toBe(false);
  });
  it('stops waiting two hours after the daily time', () => {
    expect(ready('2026-11-09T14:59:59Z')).toBe(false);
    expect(ready('2026-11-09T15:00:00Z')).toBe(true);
  });
  it('counts the two hours from when the program was turned on, when that was later', () => {
    const enabledAt = '2026-11-09T20:00:00Z'; // 15:00 local
    expect(ready('2026-11-09T21:59:59Z', { enabledAt })).toBe(false);
    expect(ready('2026-11-09T22:00:00Z', { enabledAt })).toBe(true);
    expect(ready('2026-11-09T20:01:00Z', { enabledAt, settled: true })).toBe(true);
    expect(ready('2026-11-09T22:00:00Z', { enabledAt: null })).toBe(true);
  });
  it('never waits past 23:30 local, so a late daily time still sends that day', () => {
    expect(ready('2026-11-10T04:29:59Z', { time: '23:00' })).toBe(false);
    expect(ready('2026-11-10T04:30:00Z', { time: '23:00' })).toBe(true);
    expect(ready('2026-11-10T04:44:59Z', { time: '23:45' })).toBe(false);
    expect(ready('2026-11-10T04:45:00Z', { time: '23:45' })).toBe(true);
  });
  it.each([
    ['spring change', '2026-03-08', '2026-03-08T11:59:59Z', '2026-03-08T13:59:59Z', '2026-03-08T14:00:00Z', '2026-03-09T03:29:59Z', '2026-03-09T03:30:00Z'],
    ['fall change', '2026-11-01', '2026-11-01T12:59:59Z', '2026-11-01T14:59:59Z', '2026-11-01T15:00:00Z', '2026-11-02T04:29:59Z', '2026-11-02T04:30:00Z'],
  ])('keeps local wall-clock times on the New York %s', (_name, date, beforeTime, beforeCut, cut, beforeBound, bound) => {
    expect(ready(beforeTime, { date, settled: true })).toBe(false);
    expect(ready(beforeCut, { date })).toBe(false);
    expect(ready(cut, { date })).toBe(true);
    expect(ready(beforeBound, { date, time: '23:00' })).toBe(false);
    expect(ready(bound, { date, time: '23:00' })).toBe(true);
  });
  it('treats a timezone the runtime does not know as UTC instead of failing the run', () => {
    expect(ready('2026-11-09T07:59:59Z', { tz: 'Not/AZone', settled: true })).toBe(false);
    expect(ready('2026-11-09T08:00:00Z', { tz: 'Not/AZone', settled: true })).toBe(true);
    expect(ready('2026-11-09T10:00:00Z', { tz: 'Not/AZone' })).toBe(true);
  });
});
