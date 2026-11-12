import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openOAuth } from './api';

const ORIGIN = 'https://radar.test';
let listeners: Set<(event: MessageEvent) => void>;
let popups: { closed: boolean }[];
let open: ReturnType<typeof vi.fn>;
const emit = (source: unknown, data: unknown = { type: 'radar-oauth', provider: 'github', ok: true }, origin = ORIGIN) => {
  for (const listener of [...listeners]) listener({ source, data, origin } as MessageEvent);
};
beforeEach(() => {
  vi.useFakeTimers(); listeners = new Set(); popups = [];
  open = vi.fn(() => { const popup = { closed: false }; popups.push(popup); return popup; });
  vi.stubGlobal('location', { origin: ORIGIN });
  vi.stubGlobal('window', {
    screenX: 0, screenY: 0, outerWidth: 1200, outerHeight: 900, open,
    addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.delete(listener),
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('OAuth popup correlation', () => {
  it('uses distinct windows and only resolves the matching authorization when two GitHub attempts complete in reverse order', async () => {
    const firstDone = vi.fn(); const secondDone = vi.fn();
    const first = openOAuth('github', 'business-a').then(firstDone);
    const second = openOAuth('github', 'business-b').then(secondDone);
    expect(open.mock.calls[0][1]).not.toBe(open.mock.calls[1][1]);
    expect(open.mock.calls[0][0]).toContain('bid=business-a');
    expect(open.mock.calls[1][0]).toContain('bid=business-b');
    emit(popups[1], { type: 'radar-oauth', provider: 'github', ok: true, result: { oauthRef: 'new-attempt' } });
    await second;
    expect(secondDone).toHaveBeenCalledWith({ ok: true, result: { oauthRef: 'new-attempt' }, error: undefined });
    expect(firstDone).not.toHaveBeenCalled();
    emit(popups[0], { type: 'radar-oauth', provider: 'github', ok: true, result: { oauthRef: 'old-attempt' } });
    await first;
    expect(firstDone).toHaveBeenCalledWith({ ok: true, result: { oauthRef: 'old-attempt' }, error: undefined });
    expect(listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('ignores messages from a different source, origin or provider and unrelated payloads', async () => {
    const done = vi.fn(); const promise = openOAuth('github', 'business').then(done);
    emit({ closed: false });
    emit(popups[0], undefined, 'https://other.test');
    emit(popups[0], { type: 'radar-oauth', provider: 'notion', ok: true });
    emit(popups[0], { type: 'unrelated', provider: 'github', ok: true });
    emit(popups[0], null);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    emit(popups[0], { type: 'radar-oauth', provider: 'github', ok: false, error: 'denied' });
    await promise;
    expect(done).toHaveBeenCalledWith({ ok: false, result: undefined, error: 'denied' });
    expect(listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps the existing blocked-popup failure and removes its listener and timer', async () => {
    open.mockReturnValueOnce(null);
    expect(await openOAuth('github', 'business')).toEqual({ ok: false, error: 'blocked' });
    expect(listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps the existing closed-popup failure and removes its listener and timer', async () => {
    const promise = openOAuth('github', 'business');
    popups[0].closed = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(await promise).toEqual({ ok: false, error: 'closed' });
    expect(listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});
