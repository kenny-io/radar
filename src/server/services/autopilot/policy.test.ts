import { describe, expect, it } from 'vitest';
import { authorized, autopilotOf, autopilotPublic, effectiveSocial, publicationAllowed, socialSlot } from './policy';
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
