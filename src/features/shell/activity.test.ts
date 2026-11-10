// RL-4 / RL-5, the React-free parts: the bell's label, relative times, which links are followed, and when an item's
// newest run counts as failed.
import { describe, expect, it } from 'vitest';
import { agoLabel, badgeText, bellLabel, failedNow, internalHref, isNew } from './activity';
import type { FailedJob } from '@/lib/types';

describe('bell', () => {
  it('the accessible name carries the unread count', () => {
    expect(bellLabel(0)).toBe('Activity');
    expect(bellLabel(1)).toBe('Activity, 1 unread');
    expect(bellLabel(12)).toBe('Activity, 12 unread');
  });
  it('the badge caps at 99+', () => { expect(badgeText(3)).toBe('3'); expect(badgeText(99)).toBe('99'); expect(badgeText(100)).toBe('99+'); });
});

describe('agoLabel', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z'); const at = (ms: number) => new Date(now - ms).toISOString();
  it('speaks in minutes, hours and days', () => {
    expect(agoLabel(at(20e3), now)).toBe('just now');
    expect(agoLabel(at(5 * 60e3), now)).toBe('5m ago');
    expect(agoLabel(at(59 * 60e3 + 59e3), now)).toBe('59m ago');
    expect(agoLabel(at(60 * 60e3), now)).toBe('1h ago');
    expect(agoLabel(at(23 * 3600e3 + 59 * 60e3), now)).toBe('23h ago');
    expect(agoLabel(at(24 * 3600e3), now)).toBe('1d ago');
    expect(agoLabel(at(29 * 864e5), now)).toBe('29d ago');
  });
  it('a clock that is slightly behind does not show a negative time', () => { expect(agoLabel(at(-5000), now)).toBe('just now'); });
  it('an unreadable date shows nothing', () => { expect(agoLabel('nope', now)).toBe(''); });
});

describe('internalHref', () => {
  it('keeps paths inside the app', () => { for (const h of ['/article/e_1', '/calendar?view=list&filter=review', '/calendar']) expect(internalHref(h)).toBe(h); });
  it('drops anything that would leave it', () => { for (const h of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', '/\\evil.example', 'calendar', '', null, undefined]) expect(internalHref(h as any)).toBeNull(); });
});

describe('isNew', () => {
  it('is what was written after the read cursor', () => {
    expect(isNew('2026-11-10T12:00:01.000Z', '2026-11-10T12:00:00.000Z')).toBe(true);
    expect(isNew('2026-11-10T12:00:00.000Z', '2026-11-10T12:00:00.000Z')).toBe(false);
    expect(isNew('2026-11-10T11:00:00.000Z', '2026-11-10T12:00:00.000Z')).toBe(false);
    expect(isNew('2026-11-10T12:00:01.000Z', null)).toBe(false);
  });
});

describe('failedNow', () => {
  // The workspace's record of run j1, created at 10:05.
  const snap: FailedJob = { jobId: 'j1', error: 'Radar couldn’t finish this. Try again.', at: '2026-11-10T10:05:00.000Z' };
  const job = (id: string, status: 'queued' | 'running' | 'done' | 'failed', createdAt: string, progress: any = null) => ({ id, status, error: status === 'failed' ? 'Radar couldn’t finish this. Try again.' : null, createdAt, progress });
  it('after a reload there is no live job: the workspace’s record decides', () => {
    expect(failedNow(null, snap)).toBe(snap);
    expect(failedNow(null, null)).toBeNull();
    expect(failedNow(undefined, undefined)).toBeNull();
  });
  it('a failed live job shows at once, before the workspace has caught up', () => {
    expect(failedNow(job('j9', 'failed', '2026-11-10T11:00:00.000Z'), null)).toEqual({ jobId: 'j9', error: 'Radar couldn’t finish this. Try again.', at: '2026-11-10T11:00:00.000Z' });
    // Same run in both: one answer.
    expect(failedNow(job('j1', 'failed', '2026-11-10T10:05:00.000Z'), snap)).toBe(snap);
  });
  it('a failed calendar run keeps its keep flag for the retry', () => {
    expect(failedNow(job('j9', 'failed', '2026-11-10T11:00:00.000Z', { phase: 3, results: [], keep: true, gsc: false }), null)!.keep).toBe(true);
    expect(failedNow(job('j9', 'failed', '2026-11-10T11:00:00.000Z', { phase: 0, results: [], keep: false, gsc: false }), null)!.keep).toBe(false);
  });
  it('a retry that is queued or running hides the failure, even while the workspace still records it', () => {
    expect(failedNow(job('j2', 'queued', '2026-11-10T10:06:00.000Z'), snap)).toBeNull();
    expect(failedNow(job('j2', 'running', '2026-11-10T10:06:00.000Z'), snap)).toBeNull();
  });
  it('a later successful run clears it', () => {
    expect(failedNow(job('j2', 'done', '2026-11-10T10:06:00.000Z'), snap)).toBeNull();
    expect(failedNow(job('j2', 'done', '2026-11-10T10:06:00.000Z'), null)).toBeNull();
  });
  it('an older run the tab still remembers does not hide a newer failure', () => {
    expect(failedNow(job('j0', 'done', '2026-11-10T09:00:00.000Z'), snap)).toBe(snap);
    expect(failedNow(job('j0', 'failed', '2026-11-10T09:00:00.000Z'), snap)).toBe(snap);
    expect(failedNow(job('j0', 'running', '2026-11-10T09:00:00.000Z'), snap)).toBe(snap);
  });
  it('a run the tab last saw running, which the workspace says has failed, is shown as failed', () => {
    // The event stream dropped before the final event; the workspace has the outcome.
    expect(failedNow(job('j1', 'running', '2026-11-10T10:05:00.000Z'), snap)).toBe(snap);
  });
  it('a newer failure the tab saw replaces an older one the workspace still holds', () => {
    expect(failedNow(job('j2', 'failed', '2026-11-10T10:06:00.000Z'), snap)!.jobId).toBe('j2');
  });
});
