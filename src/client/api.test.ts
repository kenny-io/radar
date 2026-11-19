import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openOAuth } from './api';
import { OAUTH_FLOW_QUERY, OAUTH_RETURN_TTL_MS, oauthReturnKey } from '@/lib/oauthReturn';

const ORIGIN = 'https://radar.test';
let listeners: Map<string, Set<(event: any) => void>>;
let popups: { closed: boolean; close: ReturnType<typeof vi.fn> }[];
let channels: FakeChannel[];
let storage: Map<string, string>;
let open: ReturnType<typeof vi.fn>;
class FakeChannel {
  name: string; onmessage: ((e: any) => void) | null = null; closed = false;
  constructor(name: string) { this.name = name; channels.push(this); }
  close() { this.closed = true; this.onmessage = null; }
}
const flow = (n = 0) => new URL(String(open.mock.calls[n][0]), ORIGIN).searchParams.get(OAUTH_FLOW_QUERY)!;
const data = (n = 0, extra: Record<string, unknown> = {}) => ({ type: 'radar-oauth', provider: 'youtube', flow: flow(n), at: Date.now(), ok: true, result: { oauthRef: 'pending-' + n }, ...extra });
const emit = (type: string, event: any) => { for (const listener of [...(listeners.get(type) || [])]) listener(event); };
const message = (n = 0, payload: any = data(n), origin = ORIGIN, source: any = popups[n]) => emit('message', { source, data: payload, origin });
const broadcast = (n = 0, payload: any = data(n), origin = ORIGIN) => channels[n].onmessage?.({ data: payload, origin });
const storageReturn = (n = 0, payload: any = data(n), url = ORIGIN + '/api/oauth/youtube/callback') => emit('storage', { key: oauthReturnKey(flow(n)), newValue: JSON.stringify(payload), url, storageArea: (window as any).localStorage });
function clean() { expect([...listeners.values()].every(x => x.size === 0)).toBe(true); expect(channels.every(c => c.closed)).toBe(true); expect(vi.getTimerCount()).toBe(0); expect(storage.size).toBe(0); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-19T08:00:00Z'));
  listeners = new Map(); popups = []; channels = []; storage = new Map();
  open = vi.fn(() => { const popup = { closed: false, close: vi.fn() }; popups.push(popup); return popup; });
  vi.stubGlobal('BroadcastChannel', FakeChannel); vi.stubGlobal('location', { origin: ORIGIN });
  vi.stubGlobal('window', {
    screenX: 0, screenY: 0, outerWidth: 1200, outerHeight: 900, open,
    localStorage: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    addEventListener: (type: string, listener: (event: any) => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener); },
    removeEventListener: (type: string, listener: (event: any) => void) => listeners.get(type)?.delete(listener),
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('nonce-bound OAuth return transport', () => {
  it('registers listeners and a fresh nonce before opening, and resolves simultaneous attempts once in reverse order', async () => {
    open.mockImplementation(() => { expect(listeners.get('message')?.size).toBeGreaterThan(0); expect(listeners.get('storage')?.size).toBeGreaterThan(0); expect(channels.length).toBeGreaterThan(0); const p = { closed: false, close: vi.fn() }; popups.push(p); return p; });
    const firstDone = vi.fn(); const secondDone = vi.fn();
    const first = openOAuth('youtube', 'business-a', { [OAUTH_FLOW_QUERY]: 'cannot-override-nonce' }).then(firstDone);
    const second = openOAuth('youtube', 'business-b').then(secondDone);
    expect(flow(0)).not.toBe(flow(1)); expect(flow(0)).toMatch(/^[0-9a-f-]{36}$/); expect(open.mock.calls[0][1]).not.toBe(open.mock.calls[1][1]);
    message(1); broadcast(1); await second;
    expect(secondDone).toHaveBeenCalledTimes(1); expect(firstDone).not.toHaveBeenCalled();
    message(0); await first; expect(firstDone).toHaveBeenCalledWith({ ok: true, result: { oauthRef: 'pending-0' } }); clean();
  });
  it('does not mistake a COOP-severed WindowProxy.closed for cancellation and accepts the later same-origin broadcast', async () => {
    const done = vi.fn(); const promise = openOAuth('youtube', 'business').then(done);
    popups[0].closed = true;
    await vi.advanceTimersByTimeAsync(60_000); expect(done).not.toHaveBeenCalled();
    broadcast(0); await promise; expect(done).toHaveBeenCalledWith({ ok: true, result: { oauthRef: 'pending-0' } }); clean();
  });
  it('falls back to a fresh same-origin storage event when BroadcastChannel is blocked', async () => {
    vi.stubGlobal('BroadcastChannel', class { constructor() { throw new Error('blocked'); } });
    const promise = openOAuth('youtube', 'business');
    storage.set(oauthReturnKey(flow()), JSON.stringify(data())); storageReturn();
    expect(await promise).toEqual({ ok: true, result: { oauthRef: 'pending-0' } }); clean();
  });
  it('rejects wrong origin, popup source, provider, flow, timestamps and malformed returns', async () => {
    const done = vi.fn(); const promise = openOAuth('youtube', 'business').then(done);
    message(0, data(), 'https://other.test'); message(0, data(), ORIGIN, { closed: false });
    message(0, data(0, { provider: 'github' })); message(0, data(0, { flow: crypto.randomUUID() }));
    message(0, data(0, { at: Date.now() - 1 })); message(0, data(0, { at: Date.now() + 5000 }));
    message(0, { type: 'radar-oauth', provider: 'youtube', ok: true }); broadcast(0, data(), 'https://other.test');
    broadcast(0, data(0, { flow: crypto.randomUUID() })); storageReturn(0, data(), 'https://other.test/callback');
    emit('storage', { key: oauthReturnKey(flow()), newValue: 'not JSON', url: ORIGIN, storageArea: (window as any).localStorage });
    await Promise.resolve(); expect(done).not.toHaveBeenCalled();
    message(0, data(0, { ok: false, error: 'scope_denied', result: undefined })); await promise;
    expect(done).toHaveBeenCalledWith({ ok: false, error: 'scope_denied' }); clean();
  });
  it('supports explicit cancellation, closes the reachable popup and ignores late callbacks', async () => {
    const controller = new AbortController(); const done = vi.fn();
    const promise = openOAuth('youtube', 'business', {}, { signal: controller.signal }).then(done);
    const late = data(); controller.abort(); await promise; message(0, late); broadcast(0, late);
    expect(done).toHaveBeenCalledTimes(1); expect(done).toHaveBeenCalledWith({ ok: false, error: 'cancelled' }); expect(popups[0].close).toHaveBeenCalledTimes(1); clean();
    const aborted = new AbortController(); aborted.abort(); expect(await openOAuth('youtube', 'business', {}, { signal: aborted.signal })).toEqual({ ok: false, error: 'cancelled' }); expect(open).toHaveBeenCalledTimes(1);
  });
  it('times out a lost return with cleanup and reports blocked popups without leaving listeners', async () => {
    const promise = openOAuth('youtube', 'business'); await vi.advanceTimersByTimeAsync(OAUTH_RETURN_TTL_MS);
    expect(await promise).toEqual({ ok: false, error: 'timeout' }); clean();
    open.mockReturnValueOnce(null); expect(await openOAuth('youtube', 'business')).toEqual({ ok: false, error: 'blocked' }); clean();
  });
  it('still completes direct messages when BroadcastChannel and storage are unavailable, and drops credential-shaped result fields', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
    const promise = openOAuth('youtube', 'business');
    message(0, data(0, { result: { oauthRef: 'safe-reference', access_token: 'never-send', code: 'never-send', client_secret: 'never-send' } }));
    expect(await promise).toEqual({ ok: true, result: { oauthRef: 'safe-reference' } });
    expect([...listeners.values()].every(x => x.size === 0)).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
});
