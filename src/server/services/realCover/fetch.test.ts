// The guard every real-cover request goes through. Global fetch is replaced, so nothing here touches the network; the
// DNS half (a public name that resolves to a private address) is covered by publicNetwork.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ env: { devStubs: false, crawlerUserAgent: 'RadarBot/1.0 (+https://radar.test/bot)' }, dev: vi.fn() }));
vi.mock('@/server/env', () => ({ env: H.env }));
vi.mock('../analysis/devsite', () => ({ devFetch: H.dev }));
import { publicDispatcher } from '../../http/publicNetwork';
import { ACCEPT, MAX_REDIRECTS, SitePictureError, fetchOwn } from './fetch';

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); H.dev.mockReset(); H.env.devStubs = false; });
afterEach(() => vi.unstubAllGlobals());

const MB = 1024 * 1024;
const opts = (over: Partial<Parameters<typeof fetchOwn>[1]> = {}) => ({ domain: 'lived.ae', accept: ACCEPT.picture, maxBytes: 8 * MB, over: 'reject' as const, signal: new AbortController().signal, requests: { left: 12 }, ...over });
const get = (address: string, over: Partial<Parameters<typeof fetchOwn>[1]> = {}) => fetchOwn(new URL(address), opts(over));
const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });
const picture = (body: BodyInit = 'bytes', headers: Record<string, string> = {}) => new Response(body, { headers: { 'content-type': 'image/png', ...headers } });
const requested = () => fetchMock.mock.calls.map(c => String(c[0]));
const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { expect(e).toBeInstanceOf(SitePictureError); return (e as SitePictureError).code; } throw new Error('expected a SitePictureError'); };
/** Every request is made with redirects off and through the dispatcher that checks the addresses the socket connects to. */
const everyRequestGuarded = () => { for (const [, init] of fetchMock.mock.calls) { expect(init.redirect).toBe('manual'); expect(init.dispatcher).toBe(publicDispatcher()); } };

describe('one request on the business’s own site', () => {
  it('returns the body, the type and the address that answered, and sends only the crawler’s three headers', async () => {
    fetchMock.mockResolvedValueOnce(picture('hello'));
    const r = await get('https://www.lived.ae/a.png?x=1#frag');
    expect(r).toEqual({ url: 'https://www.lived.ae/a.png?x=1', type: 'image/png', body: Buffer.from('hello') });
    expect(requested()).toEqual(['https://www.lived.ae/a.png?x=1']);
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers).toEqual({ 'user-agent': 'RadarBot/1.0 (+https://radar.test/bot)', accept: ACCEPT.picture, 'accept-language': 'en;q=0.9,*;q=0.5' });
    for (const name of Object.keys(init.headers)) expect(name).not.toMatch(/cookie|authorization|referer/i);
    expect(init.credentials).toBe('omit'); expect(init.referrerPolicy).toBe('no-referrer');
    everyRequestGuarded();
  });

  it.each(['https://10.0.0.5/a.png', 'https://127.0.0.1/a.png', 'https://169.254.169.254/latest/meta-data/'])('an internal address is refused before any request, even when it is the business’s "domain": %s', async address => {
    expect(await code(get(address, { domain: new URL(address).hostname }))).toBe('unreachable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['https://127.0.0.1/private', 'https://10.0.0.5/', 'https://169.254.169.254/latest/meta-data/', 'https://[::1]/', 'http://localhost/', 'https://0x7f.1/'])('a redirect to the internal address %s is refused after the one request that returned it', async target => {
    fetchMock.mockResolvedValueOnce(redirect(target));
    expect(await code(get('https://lived.ae/a.png'))).toBe('left_site');
    expect(requested()).toEqual(['https://lived.ae/a.png']);
    everyRequestGuarded();
  });

  it('a redirect off the domain ends the attempt: left_site names the host, and that host is never requested', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://cdn.other.com/a.png'));
    const error = await get('https://lived.ae/a.png').catch(e => e);
    expect(error).toMatchObject({ code: 'left_site', host: 'cdn.other.com' });
    expect(requested()).toEqual(['https://lived.ae/a.png']);
    everyRequestGuarded();
  });
  it.each([
    ['a look-alike host', 'https://lived.ae.evil.com/a.png', 'lived.ae.evil.com'],
    ['a host that ends with the name', 'https://notlived.ae/a.png', 'notlived.ae'],
    ['a port', 'https://lived.ae:8443/a.png', 'lived.ae'],
    ['another scheme', 'ftp://lived.ae/a.png', 'lived.ae'],
    ['userinfo', 'https://lived.ae@evil.com/a.png', 'evil.com'],
  ])('a redirect to %s is not followed', async (_name, location, host) => {
    fetchMock.mockResolvedValueOnce(redirect(location));
    expect(await get('https://lived.ae/a.png').catch(e => e)).toMatchObject({ code: 'left_site', host });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a redirect to http on the same site is fetched over https, and a relative redirect is resolved against the hop', async () => {
    fetchMock.mockResolvedValueOnce(redirect('http://img.lived.ae/b.png', 301)).mockResolvedValueOnce(redirect('/c.png', 307)).mockResolvedValueOnce(picture('ok'));
    const r = await get('https://lived.ae/a.png');
    expect(requested()).toEqual(['https://lived.ae/a.png', 'https://img.lived.ae/b.png', 'https://img.lived.ae/c.png']);
    expect(r.url).toBe('https://img.lived.ae/c.png');
    everyRequestGuarded();
  });

  it(`follows ${MAX_REDIRECTS} redirects and no more`, async () => {
    fetchMock.mockImplementation(async () => redirect('/next'));
    expect(await code(get('https://lived.ae/a.png'))).toBe('unreachable');
    expect(fetchMock).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(redirect('/1')).mockResolvedValueOnce(redirect('/2')).mockResolvedValueOnce(redirect('/3')).mockResolvedValueOnce(picture('ok'));
    expect((await get('https://lived.ae/a.png')).url).toBe('https://lived.ae/3');
  });

  it.each([404, 500, 502, 304, 302 /* a redirect with no location */])('status %i is unreachable, and the error carries the status: the site did answer', async status => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }));
    expect(await get('https://lived.ae/a.png').catch(e => e)).toMatchObject({ code: 'unreachable', status });
  });
  it('one redirect too many carries the redirect’s status; no answer at all carries none', async () => {
    fetchMock.mockImplementation(async () => redirect('/next', 307));
    expect(await get('https://lived.ae/a.png').catch(e => e)).toMatchObject({ code: 'unreachable', status: 307 });
    fetchMock.mockReset(); fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const down = await get('https://lived.ae/a.png').catch(e => e);
    expect(down.code).toBe('unreachable'); expect(down.status).toBeUndefined();
    const stopped = new AbortController(); stopped.abort();
    expect((await get('https://lived.ae/a.png', { signal: stopped.signal }).catch(e => e)).status).toBeUndefined();
    expect((await get('https://lived.ae/a.png', { requests: { left: 0 } }).catch(e => e)).status).toBeUndefined();
    expect((await get('https://10.0.0.5/a.png', { domain: '10.0.0.5' }).catch(e => e)).status).toBeUndefined(); // a blocked address is not described
  });

  it('a network failure, a blocked lookup and an abort are all unreachable, with nothing said about why', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('blocked host'), { code: 'EACCES' }));
    expect(await code(get('https://lived.ae/a.png'))).toBe('unreachable');
    fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'));
    expect(await code(get('https://lived.ae/a.png'))).toBe('unreachable');
    const stopped = new AbortController(); stopped.abort();
    fetchMock.mockClear();
    expect(await code(get('https://lived.ae/a.png', { signal: stopped.signal }))).toBe('unreachable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('every hop spends one request, and an attempt with none left makes no request', async () => {
    const requests = { left: 2 };
    fetchMock.mockImplementation(async () => redirect('/next'));
    expect(await code(get('https://lived.ae/a.png', { requests }))).toBe('unreachable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockClear();
    expect(await code(get('https://lived.ae/a.png', { requests }))).toBe('unreachable');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the size limit', () => {
  it('a declared size over the limit is rejected without reading any of the body', async () => {
    const pull = vi.fn(); const cancelled = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ pull, cancel: cancelled }, { highWaterMark: 0 }), { headers: { 'content-type': 'image/png', 'content-length': String(8 * MB + 1) } }));
    expect(await code(get('https://lived.ae/a.png'))).toBe('too_large');
    expect(pull).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it('a body that streams past the limit is rejected and the stream is cancelled, whatever size was declared', async () => {
    let sent = 0; const cancelled = vi.fn();
    const endless = new ReadableStream({ pull(c) { sent++; c.enqueue(new Uint8Array(MB)); }, cancel: cancelled }, { highWaterMark: 0 });
    fetchMock.mockResolvedValueOnce(new Response(endless, { headers: { 'content-type': 'image/png', 'content-length': '1000' } }));
    expect(await code(get('https://lived.ae/a.png'))).toBe('too_large');
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(sent).toBeLessThanOrEqual(10); // 8 MB allowed: the ninth megabyte ends it
  });
  it('a body of exactly the limit is accepted', async () => {
    fetchMock.mockResolvedValueOnce(picture(new Uint8Array(1000)));
    expect((await get('https://lived.ae/a.png', { maxBytes: 1000 })).body).toHaveLength(1000);
  });
  it('with truncate (text only) the first bytes are returned and the rest is not read', async () => {
    const cancelled = vi.fn(); let sent = 0;
    const stream = new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode(String(sent++ % 10).repeat(400))); }, cancel: cancelled }, { highWaterMark: 0 });
    fetchMock.mockResolvedValueOnce(new Response(stream, { headers: { 'content-type': 'text/plain', 'content-length': '999999999' } }));
    const r = await get('https://lived.ae/robots.txt', { accept: ACCEPT.text, maxBytes: 1000, over: 'truncate' });
    expect(r.body).toHaveLength(1000);
    expect(r.body.toString()).toBe('0'.repeat(400) + '1'.repeat(400) + '2'.repeat(200));
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});

describe('dev-stub mode', () => {
  beforeEach(() => { H.env.devStubs = true; });
  it('reads the synthesised site and never calls fetch', async () => {
    H.dev.mockResolvedValueOnce({ status: 200, type: 'image/png', body: Buffer.from('stub'), url: 'x' });
    expect(await get('http://lived.ae/media/a.png')).toEqual({ url: 'https://lived.ae/media/a.png', type: 'image/png', body: Buffer.from('stub') });
    expect(H.dev).toHaveBeenCalledWith('https://lived.ae/media/a.png');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('still applies the domain rule, the size limit and the request count', async () => {
    expect(await get('https://other.example/a.png').catch(e => e)).toMatchObject({ code: 'left_site', host: 'other.example' });
    expect(H.dev).not.toHaveBeenCalled();
    H.dev.mockResolvedValue({ status: 200, type: 'image/png', body: Buffer.alloc(2000), url: 'x' });
    expect(await code(get('https://lived.ae/a.png', { maxBytes: 1000 }))).toBe('too_large');
    expect((await get('https://lived.ae/a.txt', { maxBytes: 1000, over: 'truncate' })).body).toHaveLength(1000);
    H.dev.mockClear();
    expect(await code(get('https://lived.ae/a.png', { requests: { left: 0 } }))).toBe('unreachable');
    expect(H.dev).not.toHaveBeenCalled();
  });
  it('a missing page and an unreachable stub site are unreachable', async () => {
    H.dev.mockResolvedValueOnce({ status: 404, type: 'text/html', body: Buffer.from('nope'), url: 'x' });
    expect(await get('https://lived.ae/missing').catch(e => e)).toMatchObject({ code: 'unreachable', status: 404 });
    H.dev.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const down = await get('https://lived.ae/a.png').catch(e => e);
    expect(down.code).toBe('unreachable'); expect(down.status).toBeUndefined();
  });
});
