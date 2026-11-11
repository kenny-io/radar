import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ default: { lookup } }));
import { env } from '@/server/env';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PublishError, req, reqJson } from './http';

const nativeFetch = globalThis.fetch;
const fetchMock = vi.fn();
const saved = { isProd: env.isProd, allowPrivateHosts: env.allowPrivateHosts };
beforeEach(() => {
  env.isProd = true; env.allowPrivateHosts = false;
  vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); lookup.mockReset();
  lookup.mockResolvedValue([{ address: '93.184.216.34' }]);
});
afterEach(() => { env.isProd = saved.isProd; env.allowPrivateHosts = saved.allowPrivateHosts; vi.unstubAllGlobals(); });

describe('publishing HTTP redirect boundaries', () => {
  it.each(['http://127.0.0.1/private', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://[::ffff:7f00:1]/', 'file:///etc/passwd', 'https://user:secret@public.example/private'])
    ('refuses a private or prohibited redirect before contacting %s', async target => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: target } }));
      await expect(req('https://public.example/')).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
    });
  it('checks each redirect DNS result before sending another request', async () => {
    lookup.mockResolvedValueOnce([{ address: '93.184.216.34' }]).mockResolvedValueOnce([{ address: '10.1.2.3' }]);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://other.example/private' } }));
    await expect(req('https://public.example/')).rejects.toThrow(/Private address/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('follows public relative redirects with a fresh DNS check, preserving GET and HEAD', async () => {
    for (const method of ['GET', 'HEAD']) {
      fetchMock.mockReset(); lookup.mockClear();
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/new' } }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      expect((await req('https://public.example/old', { method })).status).toBe(200);
      expect(fetchMock.mock.calls.map(c => [c[0], c[1].method, c[1].redirect])).toEqual([
        ['https://public.example/old', method, 'manual'], ['https://public.example/new', method, 'manual'],
      ]);
      expect(lookup).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][1].dispatcher).toBeDefined();
      expect(fetchMock.mock.calls[1][1].dispatcher).toBe(fetchMock.mock.calls[0][1].dispatcher);
    }
  });
  it('strips auth/cookies across a GET origin change and never reattaches them on return', async () => {
    const seen: Headers[] = [];
    const targets = ['https://other.example/next', 'https://public.example/back'];
    fetchMock.mockImplementation(async (_url, init) => {
      seen.push(new Headers(init.headers));
      const location = targets.shift();
      return location ? new Response(null, { status: 302, headers: { location } }) : new Response('ok');
    });
    await req('https://public.example/start', { headers: { Authorization: 'Basic secret', Cookie: 'session=secret', 'proxy-authorization': 'secret', Host: 'public.example', Accept: 'application/json' } });
    expect(seen[0].get('authorization')).toBe('Basic secret');
    expect(seen[0].get('cookie')).toBe('session=secret');
    for (const headers of seen.slice(1)) {
      expect(headers.get('authorization')).toBeNull(); expect(headers.get('cookie')).toBeNull();
      expect(headers.get('proxy-authorization')).toBeNull(); expect(headers.get('accept')).toBe('application/json');
      expect(headers.get('host')).toBeNull();
    }
  });
  it('refuses redirect loops after five GET hops', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: '/loop' } }));
    await expect(req('https://public.example/')).rejects.toThrow('Too many redirects');
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
  it('honors manual/error caller modes and still guards explicit follow', async () => {
    for (const redirect of ['manual', 'error', 'follow'] as const) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
      await expect(req('https://public.example/', { redirect })).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
    }
  });
  it('preserves write method/body/auth only on same-origin 307/308, including explicit follow', async () => {
    for (const status of [307, 308]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(new Response(null, { status, headers: { location: '/new' } })).mockResolvedValueOnce(new Response('ok'));
      await req('https://public.example/old', { method: 'PUT', body: '{"a":1}', headers: { authorization: 'Basic secret' }, redirect: 'follow' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PUT', body: '{"a":1}' });
      expect(new Headers(fetchMock.mock.calls[1][1].headers).get('authorization')).toBe('Basic secret');
    }
    for (const [status, location] of [[302, '/new'], [307, 'https://other.example/']] as const) {
      fetchMock.mockReset(); fetchMock.mockResolvedValueOnce(new Response(null, { status, headers: { location } }));
      await expect(req('https://public.example/old', { method: 'POST', body: '{}', redirect: 'follow' })).rejects.toMatchObject({ http: status });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });
  it('keeps private-host overrides for self-hosted development while forbidding protocol/URL credentials', async () => {
    for (const config of [{ isProd: false, allowPrivateHosts: false }, { isProd: true, allowPrivateHosts: true }]) {
      Object.assign(env, config); fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }))
        .mockResolvedValueOnce(new Response('ok'));
      expect((await req('http://localhost/start')).status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.every(c => c[1].dispatcher === undefined)).toBe(true);
      fetchMock.mockReset();
      await expect(req('file:///etc/passwd')).rejects.toThrow('HTTP');
      await expect(req('https://user:secret@public.example/')).rejects.toThrow('credentials');
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });
});

describe('publishing response deadlines', () => {
  it.each(['text', 'arrayBuffer', 'json'] as const)('aborts a stalled %s body after headers without repeating the accepted write', async method => {
    env.isProd = false;
    vi.stubGlobal('fetch', nativeFetch);
    let requests = 0, closed = false;
    const server = http.createServer((_request, response) => {
      requests++;
      response.writeHead(201, { 'content-type': 'application/json' }); response.flushHeaders(); response.write('{"id":');
      response.on('close', () => { closed = true; });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/post`;
      const response = await req(url, { method: 'POST', body: '{}', timeoutMs: 150 });
      expect(response.status).toBe(201);
      const result = Promise.race([response[method](), new Promise<never>((_resolve, reject) => { watchdog = setTimeout(() => reject(new Error('Body deadline was lost after headers')), 1000); })]);
      const error = await result.catch(value => value);
      expect(error).toBeInstanceOf(PublishError);
      expect(error).toMatchObject({ kind: 'ambiguous-write', retryable: false, line: 'The platform may have saved this post. Check your blog before trying again.' });
      expect(requests).toBe(1);
      await vi.waitFor(() => expect(closed).toBe(true));
    } finally { clearTimeout(watchdog); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('maps a stalled JSON read to a retryable timeout, retaining the caller deadline', async () => {
    env.isProd = false;
    vi.stubGlobal('fetch', nativeFetch);
    let requests = 0;
    const server = http.createServer((_request, response) => { requests++; response.writeHead(200, { 'content-type': 'application/json' }); response.flushHeaders(); response.write('{'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = reqJson(`http://127.0.0.1:${(server.address() as AddressInfo).port}/read`, { timeoutMs: 100 });
      const result = Promise.race([request, new Promise<never>((_resolve, reject) => { watchdog = setTimeout(() => reject(new Error('Body deadline was lost after headers')), 1000); })]);
      const error = await result.catch(value => value);
      expect(error).toBeInstanceOf(PublishError);
      expect(error).toMatchObject({ kind: 'network', detail: 'timed out', retryable: true });
      expect(requests).toBe(1);
    } finally { clearTimeout(watchdog); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
