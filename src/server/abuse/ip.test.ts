// Client IP selection for rate limits (architecture §8, §16.3).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../env';
import { clientIp } from './ip';

const req = (h: Record<string, string>) => new Request('http://t/', { headers: h });
const saved = env.isProd;
afterEach(() => { env.isProd = saved; vi.restoreAllMocks(); });

describe('clientIp', () => {
  it('takes the X-Forwarded-For entry RADAR_TRUSTED_PROXY_HOPS from the right', () => {
    const r = req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' });
    expect(clientIp(r, 1)).toBe('3.3.3.3');      // the address the edge proxy saw (a client-sent prefix is ignored)
    expect(clientIp(r, 2)).toBe('2.2.2.2');      // one more trusted proxy (a CDN in front)
    expect(clientIp(r, 9)).toBe('1.1.1.1');      // never past the left end
    expect(clientIp(r, 0)).toBe('3.3.3.3');      // at least one hop
    expect(clientIp(req({ 'x-forwarded-for': ' 4.4.4.4 ' }), 1)).toBe('4.4.4.4');
    expect(clientIp(req({ 'x-forwarded-for': '5.5.5.5,,' }), 1)).toBe('5.5.5.5');
  });
  it('falls back to X-Real-IP, then unknown', () => {
    expect(clientIp(req({ 'x-real-ip': ' 6.6.6.6 ' }), 1)).toBe('6.6.6.6');
    expect(clientIp(req({ 'x-forwarded-for': ' , ', 'x-real-ip': '7.7.7.7' }), 1)).toBe('7.7.7.7');
    expect(clientIp(req({}), 1)).toBe('unknown');
  });
  it('in production logs the header shape once, never the addresses', () => {
    env.isProd = true; (globalThis as any).__radarXffLogged = false;
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    clientIp(req({ 'x-forwarded-for': '8.8.8.8, 9.9.9.9' }), 1); clientIp(req({ 'x-forwarded-for': '8.8.8.8' }), 1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toContain('2 entries');
    expect(String(info.mock.calls[0][0])).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});
