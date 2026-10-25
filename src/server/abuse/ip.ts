// Client IP for rate limits (architecture §8). X-Forwarded-For, taking the entry RADAR_TRUSTED_PROXY_HOPS from the right
// (default 1: the address the edge proxy saw), then X-Real-IP, then 'unknown'. Verify the header shape on Railway at
// deploy (docs/LAUNCH.md): the first request in production logs how many entries it has, never the addresses.
import { env } from '../env';

const g = globalThis as unknown as { __radarXffLogged?: boolean };
export function clientIp(req: Request | { headers: Headers }, hops = env.trustedProxyHops): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const list = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (env.isProd && !g.__radarXffLogged) { g.__radarXffLogged = true; console.info(`[abuse] x-forwarded-for has ${list.length} entr${list.length === 1 ? 'y' : 'ies'}; using ${hops} from the right (RADAR_TRUSTED_PROXY_HOPS)`); }
    if (list.length) return list[Math.max(0, list.length - Math.max(1, hops))];
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}
