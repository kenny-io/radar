import type { PublishDiagnostic } from '@/lib/types';
import { sanitizeDiagnostic } from '@/server/observability/failures';
import dns from 'node:dns/promises';
import net from 'node:net';
import { env } from '@/server/env';
import { assertPublicUrl, publicDispatcher } from '@/server/http/publicNetwork';
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
  constructor(public http: number, public detail = '', public host = '', public kind: 'http' | 'network' | 'auth-expired' | 'config' | 'ambiguous-write' = 'http', public diagnostic?: PublishDiagnostic) {
    super(http ? statusLine(http) + (detail ? `: ${detail}` : '') : detail || 'Network error');
  }
  get source(): 'radar' | undefined { return this.diagnostic ? 'radar' : undefined; }
  /** "401 Unauthorized" — what the article banner and the dashboard show after "{platform} returned". */
  get line() { return this.kind === 'ambiguous-write' ? this.detail : this.http ? statusLine(this.http) : this.host ? `no response from ${this.host}` : 'no response'; }
  /** Retry only transient failures (network, timeouts, rate limits, 5xx). 4xx won't fix themselves. */
  get retryable() { return this.kind !== 'ambiguous-write' && (this.kind === 'network' || this.http === 0 || this.http === 408 || this.http === 409 || this.http === 429 || this.http >= 500); }
  /** A setup problem the connector explains in a sentence (a required field, a taken slug, Blog not installed, no push access). */
  get hint() { return this.diagnostic ? this.detail : this.kind === 'config' && (this.http === 422 || this.http === 403) && this.detail ? this.detail : null; }
}

/** Model review text is untrusted. Retain a short reason, never credentials, URLs or source excerpts. */
export function publishingDiagnosticText(value: string, limit = 300): string {
  return sanitizeDiagnostic(value
    .replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?(?:-----END [\s\S]*?PRIVATE KEY-----|$)/g, '[redacted]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+|\bgithub_pat_[A-Za-z0-9_]+|\bAKIA[A-Z0-9]{16}/g, '[redacted]')
    .replace(/(?:https?|postgres(?:ql)?):\/\/[^\s<>"']+/gi, '[URL omitted]')
    .replace(/```[\s\S]*?(?:```|$)/g, '[source omitted]')
    .replace(/`[^`]*`/g, '[source omitted]')
    .replace(/(["']?(?:token|key|pass|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[redacted]'))
    .replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/** Host-owned repository checks must not be attributed to a remote GitHub rejection. */
export function repositoryPublishingError(reason: string, code = 'repository-invalid'): PublishError {
  const safe = publishingDiagnosticText(reason, 1200);
  return new PublishError(422, safe, '', 'config', { code, stage: 'validation', reason: safe });
}

/** Absolute deadline shared by repository planning and GitHub requests, below the job timeout. */
export function publishingDeadlineError(stage: PublishDiagnostic['stage']): PublishError {
  const reason = 'Repository publishing reached its time limit. Retry the article; Radar will check its saved branch and pull request before continuing.';
  return new PublishError(422, reason, '', 'config', { code: 'publishing-deadline', stage, reason });
}
export function publishingTimeRemaining(deadlineAt: number | undefined, stage: PublishDiagnostic['stage']): number {
  if (deadlineAt === undefined) return 180_000;
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw publishingDeadlineError(stage);
  return remaining;
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
  if (v.startsWith('::ffff:')) {
    const mapped = v.slice(7);
    if (net.isIPv4(mapped)) return privateIp(mapped);
    const parts = mapped.split(':');
    if (parts.length === 2 && parts.every(x => /^[a-f0-9]{1,4}$/.test(x))) {
      const value = parseInt(parts[0], 16) * 65536 + parseInt(parts[1], 16);
      return privateIp([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.'));
    }
  }
  return v === '::1' || v === '::' || /^(fc|fd|fe[89ab]|ff)/.test(v);
}
export async function assertPublicHost(host: string) {
  if (!env.isProd || env.allowPrivateHosts) return;
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  const addrs = net.isIP(name) ? [{ address: name }] : await dns.lookup(name, { all: true }).catch(() => []);
  if (!addrs.length) throw new PublishError(0, 'DNS lookup failed', host, 'network');
  if (addrs.some(a => privateIp(a.address))) throw new PublishError(0, 'Private address', host, 'network');
}

const networkError = (error: any, host: string, acceptedWrite = false) => new PublishError(0,
  acceptedWrite ? 'The platform may have saved this post. Check your blog before trying again.'
    : ['AbortError', 'TimeoutError'].includes(error?.name) ? 'timed out' : String(error?.cause?.code || error?.message || error),
  host, acceptedWrite ? 'ambiguous-write' : 'network');

/** Keep the deadline on the actual transport body, and preserve safe error mapping for every consumption method. */
function guardedBody(response: Response, host: string, write: boolean): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) { reader.releaseLock(); controller.close(); }
        else controller.enqueue(chunk.value);
      } catch (error) { reader.releaseLock(); controller.error(networkError(error, host, write)); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { reader.releaseLock(); } },
  });
  const guarded = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  Object.defineProperties(guarded, { url: { value: response.url }, redirected: { value: response.redirected }, type: { value: response.type } });
  return guarded;
}

/** fetch that turns network failures into PublishError(0) and enforces a timeout. */
export async function req(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  // Native timeout signals are unrefed and remain attached after headers, including while callers consume the body.
  const signal = AbortSignal.timeout(init.timeoutMs ?? 30000);
  try {
    const checkedUrl = (value: string, base?: URL) => {
      const parsed = new URL(value, base);
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password)
        throw new PublishError(0, 'Only HTTP(S) URLs without credentials are supported', host, 'config');
      if (env.isProd && !env.allowPrivateHosts) assertPublicUrl(parsed);
      return parsed;
    };
    const write = !['GET', 'HEAD'].includes(String(init.method || 'GET').toUpperCase());
    const headers = new Headers(init.headers);
    let at = checkedUrl(url);
    for (let hop = 0; ; hop++) {
      // Never let native follow contact an unchecked destination, including when a caller explicitly asks to follow.
      await assertPublicHost(at.host);
      const options = { ...init, headers: Object.fromEntries(headers), signal, redirect: 'manual' as const,
        ...(env.isProd && !env.allowPrivateHosts ? { dispatcher: publicDispatcher() } : {}) };
      const res = await fetch(at.href, options);
      if (![301, 302, 303, 307, 308].includes(res.status)) return guardedBody(await ensureOk(res, host), host, write);
      if (init.redirect === 'manual') return await ensureOk(res, host);
      if (init.redirect === 'error') {
        await res.body?.cancel();
        throw new PublishError(0, 'Unexpected redirect', host, 'network');
      }
      const loc = res.headers.get('location');
      await res.body?.cancel();
      const next = loc ? checkedUrl(loc, at) : null;
      // Preserve writes verbatim only for same-origin 307/308; never turn publishing into a successful GET.
      if (!next || (write && (![307, 308].includes(res.status) || next.origin !== at.origin || hop >= 3)))
        throw new PublishError(res.status, `redirected to ${next?.href || '?'}`, host, 'config');
      if (!write && hop >= 5) throw new PublishError(res.status, 'Too many redirects', host, 'config');
      if (next.origin !== at.origin) {
        // Match fetch's cross-origin credential stripping. These headers must never follow a CMS URL elsewhere.
        for (const name of ['authorization', 'proxy-authorization', 'cookie', 'host']) headers.delete(name);
      }
      at = next;
    }
  } catch (e: any) {
    if (e instanceof PublishError) throw e;
    throw networkError(e, host);
  }
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
