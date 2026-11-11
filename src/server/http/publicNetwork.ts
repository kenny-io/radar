// Dedicated public-network dispatcher: validate DNS answers used by the socket itself, not a separate lookup.
import dns, { type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent } from 'undici';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16]] as const)
  blocked.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

export function assertPublicUrl(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('blocked host');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // IP literals bypass Node's lookup callback, so reject them before handing the URL to fetch.
  if (isIP(host) && !isPublicAddress(host)) throw new Error('blocked host');
}

/** Exported for regression checks. Node may request all addresses for automatic family selection. */
export const publicLookup: typeof dns.lookup = ((hostname: string, options: { all?: boolean } | number, callback: (...args: any[]) => void) => {
  dns.lookup(hostname, { all: true }, (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => {
    if (error) { callback(error); return; }
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) {
      callback(Object.assign(new Error('blocked host'), { code: 'EACCES' })); return;
    }
    if (typeof options === 'object' && options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}) as typeof dns.lookup;

const global = globalThis as unknown as { __radarPublicDispatcher?: Agent };
export const publicDispatcher = () => global.__radarPublicDispatcher ??= new Agent({
  connections: 4, connect: { lookup: publicLookup, timeout: 10_000 },
  keepAliveTimeout: 1000, keepAliveMaxTimeout: 10_000,
});
