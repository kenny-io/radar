// The app shell's "a member is using the app" ping (IS-1): at most one per business per tab every 10 minutes, at once for a
// business the tab has not pinged, and a refusal (a business that lost access answers 402) is dropped without a trace.
import { describe, expect, it, vi } from 'vitest';
import { SEEN_EVERY_MS, claimSeen, sendSeen } from './seen';

const MIN = 60e3;
const t0 = Date.parse('2026-11-10T09:00:00Z');
const settle = () => new Promise(r => setTimeout(r, 0));

describe('seen ping throttle', () => {
  it('mount pings; route changes inside 10 minutes do not; the next one after 10 minutes does', async () => {
    const call = vi.fn(async () => ({ ok: true })); const last = new Map<string, number>();
    expect(SEEN_EVERY_MS).toBe(10 * MIN);
    sendSeen('b1', t0, call, last);                       // mount
    sendSeen('b1', t0 + 1 * MIN, call, last);             // route change
    sendSeen('b1', t0 + 10 * MIN - 1, call, last);        // route change, 1 ms early
    await settle();
    expect(call.mock.calls).toEqual([['b1', 'app.seen', {}]]);
    sendSeen('b1', t0 + 10 * MIN, call, last);
    sendSeen('b1', t0 + 11 * MIN, call, last);
    await settle();
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('a business switch pings the new business at once; switching back inside 10 minutes pings nothing', async () => {
    const call = vi.fn(async () => ({ ok: true })); const last = new Map<string, number>();
    sendSeen('b1', t0, call, last);
    sendSeen('b2', t0 + 5e3, call, last);
    sendSeen('b1', t0 + 10e3, call, last);
    sendSeen('b2', t0 + 15e3, call, last);
    await settle();
    expect(call.mock.calls.map(c => (c as unknown as string[])[0])).toEqual(['b1', 'b2']);
  });
  it('no business (signed in, none selected yet): nothing is sent or recorded', async () => {
    const call = vi.fn(async () => ({ ok: true })); const last = new Map<string, number>();
    sendSeen(null, t0, call, last);
    await settle();
    expect(call).not.toHaveBeenCalled();
    expect(last.size).toBe(0);
    expect(claimSeen(last, null, t0)).toBe(false);
  });
  it('a refused or failed ping is dropped: nothing is thrown or left unhandled, and the next due ping is sent as usual', async () => {
    const unhandled = vi.fn(); process.on('unhandledRejection', unhandled);
    try {
      const last = new Map<string, number>();
      const refused = vi.fn(async () => { throw Object.assign(new Error('Subscription required'), { status: 402 }); });
      expect(() => sendSeen('b1', t0, refused, last)).not.toThrow();
      const broken = vi.fn(() => { throw new Error('offline'); });      // even a call that throws before returning a promise
      expect(() => sendSeen('b2', t0, broken as any, last)).not.toThrow();
      await settle(); await settle();
      expect([refused.mock.calls.length, broken.mock.calls.length]).toEqual([1, 1]);
      expect(unhandled).not.toHaveBeenCalled();
      const ok = vi.fn(async () => ({ ok: true }));
      sendSeen('b1', t0 + 10 * MIN, ok, last);
      await settle();
      expect(ok).toHaveBeenCalledTimes(1);
    } finally { process.off('unhandledRejection', unhandled); }
  });
});
