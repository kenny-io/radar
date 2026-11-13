// QA probe: the fetch guard (AC2, AC3, D1, D2) with global fetch replaced. Nothing touches the network.
// The real env module is used (dev stubs off), so this is the production branch of fetchOwn.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
delete process.env.RADAR_DEV_STUBS;
import { publicDispatcher } from '@/server/http/publicNetwork';
import { ACCEPT, SitePictureError, fetchOwn } from '@/server/services/realCover/fetch';
import { env } from '@/server/env';

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
const MB = 1024 * 1024;
const opts = (over: any = {}) => ({ domain: 'lived.ae', accept: ACCEPT.picture, maxBytes: 8 * MB, over: 'reject' as const, signal: new AbortController().signal, requests: { left: 12 }, ...over });
const get = (address: string, over: any = {}) => fetchOwn(new URL(address), opts(over));
const outcome = async (p: Promise<any>) => { try { const r = await p; return 'ok ' + r.body.length; } catch (e: any) { if (!(e instanceof SitePictureError)) return 'THROWN ' + e?.message; return e.code + (e.host ? ' ' + e.host : ''); } };
const redirect = (location: string, status = 302, headers: Record<string, string> = {}) => new Response(null, { status, headers: { location, ...headers } });
const asked = () => fetchMock.mock.calls.map(c => String(c[0]));

it('dev stubs are off in this probe', () => expect(env.devStubs).toBe(false));

describe('internal addresses', () => {
  it.each(['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0'])('a business whose "domain" is %s: refused with no request', async ip => {
    expect(await outcome(get(`https://${ip}/a.png`, { domain: ip }))).toBe('unreachable');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['https://127.0.0.1/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://[fd00::1]/', 'https://[fe80::1]/', 'https://2130706433/', 'https://0x7f000001/', 'https://0177.0.0.1/', 'https://127.1/', 'https://169.254.169.254/latest/meta-data/iam/', 'http://localhost:6379/', 'https://localhost/', 'https://metadata.google.internal/', 'http://[::]/', 'https://0/'])('redirect to %s: one request, then stop', async target => {
    fetchMock.mockResolvedValueOnce(redirect(target));
    expect(await outcome(get('https://lived.ae/a.png'))).toMatch(/^left_site/);
    expect(asked()).toEqual(['https://lived.ae/a.png']);
  });
  it('a second-hop redirect to an internal address is not followed either', async () => {
    fetchMock.mockResolvedValueOnce(redirect('/b')).mockResolvedValueOnce(redirect('https://10.0.0.8/secret'));
    expect(await outcome(get('https://lived.ae/a'))).toMatch(/^left_site/);
    expect(asked()).toEqual(['https://lived.ae/a', 'https://lived.ae/b']);
  });
});

describe('redirects', () => {
  it.each([
    'https://cdn.other.com/a.png', 'https://lived.ae.evil.com/a.png', 'https://notlived.ae/a.png', '//evil.com/a.png', 'https://lived.ae@evil.com/a.png', 'https://evil.com/?lived.ae',
    'https://lived.ae:8443/a.png', 'http://lived.ae:8080/a.png', 'ftp://lived.ae/a.png', 'file:///etc/passwd', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://user:pw@lived.ae/a.png',
    'https://lived.ae\\@evil.com/a.png', '\\\\evil.com\\a.png', '/\\evil.com/a.png',
  ])('Location %s is not requested', async location => {
    fetchMock.mockResolvedValueOnce(redirect(location)).mockResolvedValue(new Response('SHOULD NOT BE READ', { headers: { 'content-type': 'image/png' } }));
    const out = await outcome(get('https://lived.ae/a.png'));
    // Every request made must be on the business's own site over https with no port and no userinfo.
    for (const u of asked()) { const x = new URL(u); expect(x.protocol).toBe('https:'); expect(x.port).toBe(''); expect(x.username + x.password).toBe(''); expect(x.hostname === 'lived.ae' || x.hostname.endsWith('.lived.ae')).toBe(true); }
    if (out.startsWith('ok')) expect(asked().length).toBeGreaterThan(1); // it stayed on the site (a backslash form the parser reads as a path)
    else expect(out).toMatch(/^(left_site|unreachable)/);
  });
  it.each([301, 302, 303, 307, 308])('status %i to http on the same site is fetched over https', async status => {
    fetchMock.mockResolvedValueOnce(redirect('http://www.lived.ae/b.png', status)).mockResolvedValueOnce(new Response('ok', { headers: { 'content-type': 'image/png' } }));
    expect(await outcome(get('https://lived.ae/a.png'))).toBe('ok 2');
    expect(asked()).toEqual(['https://lived.ae/a.png', 'https://www.lived.ae/b.png']);
  });
  it('three redirects are followed, a fourth is not; a loop ends', async () => {
    fetchMock.mockImplementation(async () => redirect('/again'));
    expect(await outcome(get('https://lived.ae/a'))).toBe('unreachable');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it('the request budget counts redirect hops and is shared', async () => {
    const requests = { left: 2 };
    fetchMock.mockImplementation(async () => redirect('/again'));
    expect(await outcome(get('https://lived.ae/a', { requests }))).toBe('unreachable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await outcome(get('https://lived.ae/a', { requests }))).toBe('unreachable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([300, 304, 305, 306])('status %i with a Location is not followed', async status => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: status === 304 ? 304 : status, headers: { location: 'https://evil.com/' } }));
    expect(await outcome(get('https://lived.ae/a'))).toBe('unreachable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('a 200 that carries a Location header is a body, not a redirect; a 3xx without Location is unreachable', async () => {
    fetchMock.mockResolvedValueOnce(new Response('abc', { status: 200, headers: { location: 'https://evil.com/', 'content-type': 'image/png' } }));
    expect(await outcome(get('https://lived.ae/a'))).toBe('ok 3');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    expect(await outcome(get('https://lived.ae/a'))).toBe('unreachable');
  });
  it('a cookie set on one hop is not sent on the next, and no hop sends cookie, authorization or referer', async () => {
    fetchMock.mockResolvedValueOnce(redirect('/b', 302, { 'set-cookie': 'sid=secret; Path=/' })).mockResolvedValueOnce(new Response('ok', { headers: { 'content-type': 'image/png' } }));
    await get('https://lived.ae/a');
    for (const [, init] of fetchMock.mock.calls) {
      expect(Object.keys(init.headers).map(k => k.toLowerCase()).sort()).toEqual(['accept', 'accept-language', 'user-agent']);
      expect(init.redirect).toBe('manual'); expect(init.credentials).toBe('omit'); expect(init.referrerPolicy).toBe('no-referrer');
      expect(init.dispatcher).toBe(publicDispatcher()); expect(init.body).toBeUndefined(); expect(init.method ?? 'GET').toBe('GET');
    }
  });
});

describe('size', () => {
  const stream = (chunk: number, state: { sent: number; cancelled: boolean }, total = Infinity) => new ReadableStream<Uint8Array>({
    pull(c) { if (state.sent >= total) { c.close(); return; } state.sent += chunk; c.enqueue(new Uint8Array(chunk)); },
    cancel() { state.cancelled = true; },
  });
  it.each(['8388609', '99999999999', '1e12'])('declared content-length %s: too_large and no byte read', async length => {
    const state = { sent: 0, cancelled: false };
    fetchMock.mockResolvedValueOnce(new Response(stream(MB, state), { headers: { 'content-type': 'image/png', 'content-length': length } }));
    expect(await outcome(get('https://lived.ae/a.png'))).toBe('too_large');
    expect(state.sent).toBeLessThanOrEqual(MB); // at most the stream's own first pull; nothing accumulated
  });
  it.each(['', 'abc', '-1', '0', '12', 'Infinity', '8388608, 8388608'])('content-length "%s" with a 9 MB body: the stream is counted and rejected, not truncated', async length => {
    const state = { sent: 0, cancelled: false };
    fetchMock.mockResolvedValueOnce(new Response(stream(MB, state, 9 * MB), { headers: { 'content-type': 'image/png', ...(length ? { 'content-length': length } : {}) } }));
    expect(await outcome(get('https://lived.ae/a.png'))).toBe('too_large');
    expect(state.sent).toBeLessThanOrEqual(10 * MB);
  });
  it('an endless stream is stopped just past the limit and cancelled', async () => {
    const state = { sent: 0, cancelled: false };
    fetchMock.mockResolvedValueOnce(new Response(stream(64 * 1024, state), { headers: { 'content-type': 'image/png' } }));
    expect(await outcome(get('https://lived.ae/a.png'))).toBe('too_large');
    expect(state.cancelled).toBe(true); expect(state.sent).toBeLessThan(9 * MB);
  });
  it('exactly 8 MB is accepted; one byte more is rejected', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(8 * MB), { headers: { 'content-type': 'image/png' } }));
    expect(await outcome(get('https://lived.ae/a.png'))).toBe('ok ' + 8 * MB);
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(8 * MB + 1), { headers: { 'content-type': 'image/png' } }));
    expect(await outcome(get('https://lived.ae/a.png'))).toBe('too_large');
  });
  it('truncate mode (text only) returns exactly the limit', async () => {
    const state = { sent: 0, cancelled: false };
    fetchMock.mockResolvedValueOnce(new Response(stream(1000, state), { headers: { 'content-type': 'text/html' } }));
    expect(await outcome(get('https://lived.ae/', { over: 'truncate', maxBytes: 2500 }))).toBe('ok 2500');
    expect(state.cancelled).toBe(true);
  });
});

describe('time and failure', () => {
  it('a deadline that fires while the body is being read is unreachable, not a partial picture', async () => {
    const ac = new AbortController();
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(10)); ac.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError'))); } });
    fetchMock.mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'image/png' } }));
    const p = outcome(get('https://lived.ae/a.png', { signal: ac.signal }));
    setTimeout(() => ac.abort(), 30);
    expect(await p).toBe('unreachable');
  });
  it('an already-aborted signal makes no request', async () => {
    const ac = new AbortController(); ac.abort();
    expect(await outcome(get('https://lived.ae/a.png', { signal: ac.signal }))).toBe('unreachable');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([204, 206, 400, 401, 403, 404, 429, 500, 502, 503])('status %i', async status => {
    fetchMock.mockResolvedValueOnce(new Response(status === 204 ? null : 'x', { status }));
    const out = await outcome(get('https://lived.ae/a.png'));
    if (status === 204 || status === 206) expect(out).toMatch(/^ok/); else expect(out).toBe('unreachable');
  });
  it('whatever fetch throws (DNS, TLS, a blocked address from the dispatcher) is unreachable and names nothing', async () => {
    for (const cause of [Object.assign(new Error('blocked host'), { code: 'EACCES' }), new TypeError('fetch failed'), new Error('getaddrinfo ENOTFOUND'), 'a string']) {
      fetchMock.mockRejectedValueOnce(cause);
      const e = await get('https://lived.ae/a.png').catch(x => x);
      expect(e).toBeInstanceOf(SitePictureError); expect(e.code).toBe('unreachable'); expect(e.host).toBeUndefined(); expect(e.message).toBe('unreachable');
    }
  });
});
