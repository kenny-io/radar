import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ default: { lookup } }));
vi.mock('@/server/env', () => ({ env: { devStubs: false, crawlerUserAgent: 'RadarBot/1.0' } }));
import { fetchUrl } from './crawl';
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); lookup.mockReset();
  lookup.mockResolvedValue([{ address: '93.184.216.34' }]);
});
afterEach(() => vi.unstubAllGlobals());
describe('crawler redirects', () => {
  it.each(['http://127.0.0.1/private', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://[::ffff:7f00:1]/', 'file:///etc/passwd'])('rejects private/prohibited redirect before contacting %s', async target => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: target } }));
    await expect(fetchUrl('https://public.example/')).rejects.toThrow('blocked host');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
  });
  it('checks DNS at every hop and blocks a hostname that resolves privately', async () => {
    lookup.mockResolvedValueOnce([{ address: '93.184.216.34' }]).mockResolvedValueOnce([{ address: '10.0.0.1' }]);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: 'https://internal.example/' } }));
    await expect(fetchUrl('https://public.example/')).rejects.toThrow('blocked host');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('follows safe relative redirects and retains the final canonical URL', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/new' } }))
      .mockResolvedValueOnce(new Response('hello', { headers: { 'content-type': 'text/html' } }));
    const result = await fetchUrl('https://public.example/old');
    expect(result.url).toBe('https://public.example/new');
    expect(result.body.toString()).toBe('hello');
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it('bounds redirect loops', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: '/loop' } }));
    await expect(fetchUrl('https://public.example/')).rejects.toThrow('invalid redirect');
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
