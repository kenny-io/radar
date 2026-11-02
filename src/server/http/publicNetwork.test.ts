import dns from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertPublicUrl, isPublicAddress, publicLookup } from './publicNetwork';

afterEach(() => vi.restoreAllMocks());
const lookup = (all = false) => new Promise<any[]>((resolve, reject) => {
  (publicLookup as any)('customer.example', { all }, (error: Error | null, ...result: any[]) => error ? reject(error) : resolve(result));
});

describe('public socket DNS lookup', () => {
  it('returns the exact validated addresses to the connecting socket with one DNS resolution', async () => {
    const addresses = [{ address: '93.184.216.34', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }];
    const spy = vi.spyOn(dns, 'lookup').mockImplementation(((_host: any, _options: any, callback: any) => callback(null, addresses)) as any);
    expect(await lookup(true)).toEqual([addresses]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await lookup()).toEqual(['93.184.216.34', 4]);
  });
  it('refuses a rebinding result or mixed public/private DNS answers before opening a socket', async () => {
    vi.spyOn(dns, 'lookup').mockImplementation(((_host: any, _options: any, callback: any) => callback(null, [
      { address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 },
    ])) as any);
    await expect(lookup(true)).rejects.toThrow('blocked host');
  });
  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '198.18.0.1', '192.0.2.1',
    '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fc00::1', 'fe80::1', '64:ff9b::7f00:1', '2001:db8::1', '2002:7f00:1::'])('blocks non-public literal %s', address => {
    expect(isPublicAddress(address)).toBe(false);
    const host = address.includes(':') ? `[${address}]` : address;
    expect(() => assertPublicUrl(new URL(`http://${host}/`))).toThrow('blocked host');
  });
  it('keeps public URLs and TLS hostnames and rejects other protocols or embedded credentials', () => {
    expect(() => assertPublicUrl(new URL('https://example.com/'))).not.toThrow();
    expect(() => assertPublicUrl(new URL('https://1.1.1.1/'))).not.toThrow();
    expect(() => assertPublicUrl(new URL('file:///etc/passwd'))).toThrow();
    expect(() => assertPublicUrl(new URL('https://user:pass@example.com'))).toThrow();
  });
});
