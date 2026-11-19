import { describe, expect, it } from 'vitest';
import { trustedClock, YOUTUBE_CACHE_MS, youtubeProfileStale, youtubeReceiptStale } from './youtubeLifecycle';
const now = Date.parse('2026-11-19T12:00:00Z'), createdAt = new Date(now - 3600e3);
describe('YouTube lifecycle clocks', () => {
  it('uses successful profile and authorization clocks, never routine updatedAt', () => {
    expect(youtubeProfileStale({ createdAt }, { profileFetchedAt: now - YOUTUBE_CACHE_MS + 1, authorizationCheckedAt: now }, now)).toBe(false);
    expect(youtubeProfileStale({ createdAt }, { profileFetchedAt: now - YOUTUBE_CACHE_MS, authorizationCheckedAt: now }, now)).toBe(true);
    expect(youtubeProfileStale({ createdAt }, { profileFetchedAt: now, authorizationCheckedAt: now - YOUTUBE_CACHE_MS }, now)).toBe(true);
    expect(youtubeProfileStale({ createdAt }, undefined, now)).toBe(false);
    expect(youtubeProfileStale({ createdAt: new Date(now - YOUTUBE_CACHE_MS) }, undefined, now)).toBe(true);
  });
  it('fails closed for malformed/future clocks and falls back to immutable creation only when absent', () => {
    for (const value of [null, NaN, Infinity, -1, '123', now + 3600e3]) expect(trustedClock(value, createdAt, now)).toBe(0);
    expect(youtubeProfileStale({ createdAt }, { profileFetchedAt: null, authorizationCheckedAt: now } as any, now)).toBe(true);
    expect(trustedClock(undefined, createdAt, now)).toBe(createdAt.getTime());
    expect(trustedClock(undefined, new Date('invalid'), now)).toBe(0);
  });
  it('expires receipts on posted/processing clock independently of renewed profile', () => {
    const row = { createdAt, postedAt: null, claimedAt: null, payload: { processingStartedAt: now - YOUTUBE_CACHE_MS } };
    expect(youtubeReceiptStale(row, now)).toBe(true);
    expect(youtubeReceiptStale({ ...row, postedAt: new Date(now - YOUTUBE_CACHE_MS + 1) }, now)).toBe(false);
    expect(youtubeReceiptStale({ ...row, payload: { processingStartedAt: 'malformed' } }, now)).toBe(true);
    expect(youtubeReceiptStale({ ...row, payload: { youtubeRetention: {} } }, now)).toBe(true);
  });
});
