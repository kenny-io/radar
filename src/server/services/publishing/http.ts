import dns from 'node:dns/promises';
import net from 'node:net';
import { env } from '@/server/env';
// HTTP helpers shared by the blog connectors. Every remote failure becomes a PublishError carrying the real HTTP status,
// which the UI shows verbatim ("401 Unauthorized — check the credentials", "{platform} returned 401 Unauthorized").
const REASONS: Record<number, string> = {
  301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
  408: 'Request Timeout', 409: 'Conflict', 410: 'Gone', 413: 'Payload Too Large', 415: 'Unsupported Media Type', 422: 'Unprocessable Entity',
  429: 'Too Many Requests', 500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};
export const reasonOf = (status: number) => REASONS[status] || (status >= 500 ? 'Server Error' : status >= 400 ? 'Request Failed' : 'Error');
export const statusLine = (status: number) => `${status} ${reasonOf(status)}`;

export class PublishError extends Error {
  /** http = 0 when the host couldn't be reached at all. */
  constructor(public http: number, public detail = '', public host = '', public kind: 'http' | 'network' | 'auth-expired' | 'config' = 'http') {
    super(http ? statusLine(http) + (detail ? `: ${detail}` : '') : detail || 'Network error');
  }
  /** "401 Unauthorized" — what the article banner and the dashboard show after "{platform} returned". */
  get line() { return this.http ? statusLine(this.http) : this.host ? `no response from ${this.host}` : 'no response'; }
  /** Retry only transient failures (network, timeouts, rate limits, 5xx). 4xx won't fix themselves. */
  get retryable() { return this.kind === 'network' || this.http === 0 || this.http === 408 || this.http === 409 || this.http === 429 || this.http >= 500; }
  /** A setup problem the connector explains in a sentence (a required field, a taken slug, Blog not installed, no push access). */
  get hint() { return this.kind === 'config' && (this.http === 422 || this.http === 403) && this.detail ? this.detail : null; }
}

/** Throw a PublishError for a non-2xx response (with a short, secret-free detail for logs). */
export async function ensureOk(res: Response, host = ''): Promise<Response> {
  if (res.ok) return res;
  let detail = '';
  try { detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 300); } catch { /* */ }
  throw new PublishError(res.status, detail, host);
}

/** SSRF guard: user-supplied URLs (site URLs, webhook endpoints) must resolve to public addresses in production. */
function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || (v.startsWith('::ffff:') && privateIp(v.slice(7)));
}
export async function assertPublicHost(host: string) {
  if (!env.isProd || env.allowPrivateHosts) return;
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  const addrs = net.isIP(name) ? [{ address: name }] : await dns.lookup(name, { all: true }).catch(() => []);
  if (!addrs.length) throw new PublishError(0, 'DNS lookup failed', host, 'network');
  if (addrs.some(a => privateIp(a.address))) throw new PublishError(0, 'Private address', host, 'network');
}

/** fetch that turns network failures into PublishError(0) and enforces a timeout. */
export async function req(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), init.timeoutMs ?? 30000);
  try {
    await assertPublicHost(host);
    // Writes don't follow redirects blindly: on 301/302/303 fetch replays a POST as a GET (and drops Authorization across
    // origins), so a site URL that redirects (http→https, www, a moved blog) would "create" a post by reading a list.
    // Same-origin 307/308 keep the method, body and credentials, so those are still followed; anything else fails readably.
    const write = !['GET', 'HEAD'].includes(String(init.method || 'GET').toUpperCase());
    if (!write || init.redirect) return await ensureOk(await fetch(url, { ...init, signal: ctl.signal, redirect: init.redirect ?? 'follow' }), host);
    let at = url;
    for (let hop = 0; ; hop++) {
      const res = await fetch(at, { ...init, signal: ctl.signal, redirect: 'manual' });
      if (res.status < 300 || res.status >= 400) return await ensureOk(res, host);
      const loc = res.headers.get('location');
      const next = loc ? new URL(loc, at) : null;
      if (!next || ![307, 308].includes(res.status) || next.origin !== new URL(at).origin || hop >= 3) throw new PublishError(res.status, `redirected to ${next?.href || '?'}`, host, 'config');
      at = next.href;
    }
  } catch (e: any) {
    if (e instanceof PublishError) throw e;
    throw new PublishError(0, e?.name === 'AbortError' ? 'timed out' : String(e?.cause?.code || e?.message || e), host, 'network');
  } finally { clearTimeout(t); }
}
export async function reqJson<T = any>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const r = await req(url, init);
  const txt = await r.text();
  try { return (txt ? JSON.parse(txt) : {}) as T; } catch { throw new PublishError(502, 'Invalid JSON response', new URL(url).host); }
}
export const jsonBody = (body: any, headers: Record<string, string> = {}): RequestInit => ({ body: JSON.stringify(body), headers: { 'content-type': 'application/json', accept: 'application/json', ...headers } });

/** Normalize a site URL the user typed ("fieldnote.app/" → "https://fieldnote.app"). */
export function siteBase(u: string): string {
  let s = (u || '').trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s.replace(/\/+$/, '');
}
