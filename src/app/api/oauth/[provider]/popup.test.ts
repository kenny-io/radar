import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { popupResult } from './popup';
import { oauthReturnKey } from '@/lib/oauthReturn';

const flow = 'a9c0b6db-5909-4c67-b057-10446a375136';
async function execute(payload: any, nonce: string | undefined = flow, opener = true) {
  const response = popupResult('youtube', payload, nonce); const html = await response.text();
  const posted = vi.fn(), broadcast = vi.fn(), closed = vi.fn(); const stored = new Map<string, string>(); const events: any[] = [];
  const timers: (() => void)[] = [];
  const context = {
    window: { opener: opener ? { postMessage: posted } : null, close: closed }, location: { origin: 'https://radar.test' },
    BroadcastChannel: class { constructor(public key: string) {} postMessage(value: any) { broadcast(this.key, value); } close() {} },
    localStorage: { setItem(key: string, value: string) { stored.set(key, value); events.push({ key, newValue: value }); }, removeItem(key: string) { stored.delete(key); } },
    setTimeout(fn: () => void) { timers.push(fn); }, Date: { now: () => 1234567 },
  };
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], context);
  return { response, html, posted, broadcast, stored, events, timers, closed };
}
describe('OAuth callback popup return', () => {
  it('returns a public nonce-bound envelope without an opener and leaves no storage residue', async () => {
    const x = await execute({ ok: true, result: { oauthRef: 'opaque-pending-reference', ch: 'youtube', access_token: 'SECRET-TOKEN', code: 'SECRET-CODE' } }, flow, false);
    expect(x.posted).not.toHaveBeenCalled();
    const envelope = { type: 'radar-oauth', provider: 'youtube', flow, ok: true, result: { oauthRef: 'opaque-pending-reference', ch: 'youtube' }, at: 1234567 };
    expect(x.broadcast).toHaveBeenCalledWith(oauthReturnKey(flow), envelope);
    expect(JSON.parse(x.events[0].newValue)).toEqual(envelope);
    expect(x.stored.size).toBe(0); expect(x.html).not.toContain('SECRET');
    x.timers.forEach(fn => fn()); expect(x.closed).toHaveBeenCalledOnce();
    expect(x.response.headers.get('cache-control')).toBe('no-store');
  });
  it('keeps direct opener compatibility without inventing a flow for old state', async () => {
    // Invalid/missing saved flow cannot enable fallback using an untrusted callback parameter.
    const x = await execute({ ok: false, error: 'denied' }, 'invalid');
    expect(x.posted).toHaveBeenCalledWith({ type: 'radar-oauth', provider: 'youtube', ok: false, error: 'denied', at: 1234567 }, 'https://radar.test');
    expect(x.broadcast).not.toHaveBeenCalled(); expect(x.events).toHaveLength(0);
  });
  it('escapes callback errors instead of allowing script or HTML injection', async () => {
    const x = await execute({ ok: false, error: '</script><img src=x onerror=alert(1)>' });
    expect(x.html.match(/<script>/g)).toHaveLength(1); expect(x.html).not.toContain('<img');
    expect(x.posted.mock.calls[0][0].error).toBe('</script><img src=x onerror=alert(1)>');
  });
});
