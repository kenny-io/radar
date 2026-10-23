// Shared plumbing for the X and LinkedIn adapters (architecture.md §7, §9): token shapes, the adapter interface, the
// error taxonomy the sender acts on, and a fetch wrapper with a 30 s timeout. Nothing here logs tokens or post text.
import type { PubErrCode, SocialChannel, SocialPage } from '@/lib/types';

/** Decrypted `social_accounts.tokens_enc`. Times are epoch ms. `stub` tokens come from the dev OAuth stub only. */
export interface Tokens {
  access_token: string; refresh_token?: string | null; expires_at?: number | null; refresh_expires_at?: number | null; scope?: string;
  stub?: boolean; /** dev stubs: the next refresh fails definitively (social.devSimulate 'expire') */ refreshFails?: boolean;
}
/** Identity of the signed-in remote account (pending authorization). */
export interface Identity { remoteId: string; name: string; handle?: string | null }
/** What the sender knows about the account when it calls the platform. */
export interface AcctCtx { ch: SocialChannel; remoteId: string; handle: string | null; token: string }
export interface Media { bytes: Buffer; type: string }
export interface Created { remoteId: string; url: string }

/**
 * How a send step failed:
 * - `transient`: nothing was published and a later attempt may work (rate limit, outage, connection refused).
 * - `definitive`: the platform refused it; retrying won't help.
 * - `unknown`: the create request may have been published (timeout, reset, 5xx after send). Never resent automatically.
 * - `auth`: 401 on an API call; the sender runs one forced token refresh.
 * `detail` is the provider status/body excerpt for logs and `err_detail` only.
 */
export class SendError extends Error {
  constructor(public kind: 'transient' | 'definitive' | 'unknown' | 'auth', public code: PubErrCode, public detail: string, public retryAt: number | null = null) { super(`${kind}/${code}: ${detail}`); }
}
/** A token refresh failed. `definitive` (400 invalid_grant/invalid_request, 401, no usable refresh token) marks the account expired. */
export class TokenError extends Error { constructor(public definitive: boolean, public detail: string) { super(detail); } }

export interface Adapter {
  refresh(t: Tokens): Promise<Tokens>;
  revoke(t: Tokens): Promise<void>;
  upload(a: AcctCtx, m: Media): Promise<string>;
  create(a: AcctCtx, p: { text: string; mediaIds: string[] }): Promise<Created>;
  /** Read the account's recent posts back after an unknown outcome (X only). null = not found. Absent = can't verify (LinkedIn). */
  verify?(a: AcctCtx, p: { text: string; sinceMs: number }): Promise<Created | null>;
  /** How long to wait before reading back (X indexes new posts within seconds). */
  verifyDelayMs?: number;
}
export interface PagesApi { pages(token: string): Promise<SocialPage[]> }

export const FETCH_TIMEOUT_MS = 30_000;
const BEFORE_SEND = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'ENETUNREACH', 'EHOSTUNREACH']);
export interface Res { status: number; headers: Headers; text: string; json: any }

/** fetch with a timeout. Network errors become SendError: transient when nothing reached the platform, `unknown` when the
 *  request may have been received during the `create` stage. */
export async function call(url: string, init: RequestInit, stage: 'auth' | 'media' | 'create' | 'read' = 'read', timeoutMs = FETCH_TIMEOUT_MS): Promise<Res> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  let r: Response;
  try { r = await fetch(url, { ...init, signal: ctl.signal }); }
  catch (e: any) {
    const code = e?.cause?.code || e?.code || '';
    const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
    const detail = `${host} network ${ctl.signal.aborted ? 'timeout' : code || e?.name || 'error'}`;
    if (BEFORE_SEND.has(code) || stage !== 'create') throw new SendError('transient', 'unavailable', detail);
    throw new SendError('unknown', 'unknown', detail);
  } finally { clearTimeout(t); }
  const text = await r.text().catch(() => '');
  let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: r.status, headers: r.headers, text, json };
}
/** Status + a short body excerpt for err_detail / logs (never shown, never in events). */
export const excerpt = (r: Res, where: string) => `${where} ${r.status} ${r.text.replace(/\s+/g, ' ').slice(0, 300)}`;

/** The common part of the mapping (architecture.md §9.4); adapters handle their platform-specific bodies first. */
export function mapCommon(r: Res, stage: 'media' | 'create', where: string, retryAt: number | null = null): SendError {
  const d = excerpt(r, where);
  if (r.status === 401) return new SendError('auth', 'auth', d);
  if (r.status === 429) return new SendError('transient', 'rate_limit', d, retryAt);
  if (r.status === 503) return new SendError('transient', 'unavailable', d);
  if (r.status >= 500) return stage === 'create' ? new SendError('unknown', 'unknown', d) : new SendError('transient', 'unavailable', d);
  if (stage === 'media') return new SendError('definitive', 'media', d);
  return new SendError('definitive', 'rejected', d);
}
/** Refresh responses: 400 invalid_grant/invalid_request and 401 are definitive; 5xx and network errors are transient. */
export function refreshError(r: Res, where: string): TokenError {
  const err = String(r.json?.error || '');
  const definitive = r.status === 401 || (r.status === 400 && (!err || /invalid_grant|invalid_request|unauthorized_client/.test(err))) || r.status === 403;
  return new TokenError(definitive, excerpt(r, where));
}
export const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
export const basic = (id: string, secret: string) => 'Basic ' + Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64');
