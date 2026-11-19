// YouTube videos.insert. Unlike image-based networks, YouTube requires an actual video file.
import crypto from 'node:crypto';
import { env } from '../../../env';
import { type Adapter, type AcctCtx, type Created, type Identity, type Res, type Tokens, call, form, mapCommon, SendError, TokenError } from './api';
export const YOUTUBE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
export const YOUTUBE_SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
export class YouTubeConnectionError extends Error { constructor(public code: 'youtube_channel_missing' | 'scope_denied') { super(code); } }
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3';
/** Structured lifecycle classification; never include provider response bodies or identifiers. */
export class YouTubeTokenError extends TokenError {
  constructor(public reason: 'revoked' | 'configuration' | 'retry', public status?: number) { super(reason === 'revoked', `youtube authorization ${reason}${status ? ` HTTP ${status}` : ''}`); }
}
function tokenFailure(r: Res): YouTubeTokenError {
  const code = r.json?.error;
  return new YouTubeTokenError(code === 'invalid_grant' ? 'revoked' : code === 'invalid_client' || code === 'unauthorized_client' || r.status === 401 ? 'configuration' : 'retry', r.status);
}
/** Lifecycle I/O includes body consumption inside the 15 second abort budget. */
export async function youtubeRead(url: string, init: RequestInit, timeoutMs = 15_000): Promise<Res> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const r = await fetch(url, { ...init, signal: controller.signal }); const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch {} return { status: r.status, headers: r.headers, text: '', json }; }
  catch { throw new YouTubeTokenError('retry'); } finally { clearTimeout(timer); }
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const tokensFrom = (j: any, prev?: Tokens): Tokens => ({ access_token: j.access_token, refresh_token: j.refresh_token || prev?.refresh_token || null, expires_at: Date.now() + Number(j.expires_in || 3600) * 1000, scope: j.scope || prev?.scope, ...(prev?.youtube ? { youtube: { ...prev.youtube, authorizationCheckedAt: Date.now() } } : {}) });
export async function youtubeExchange(code: string, verifier: string, redirectUri: string): Promise<Tokens> {
  const r = await call(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ client_id: env.youtubeClientId, client_secret: env.youtubeClientSecret, grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }) }, 'auth');
  if (r.status !== 200 || !r.json?.access_token) throw new Error(`youtube token ${r.status}`);
  const tokens = tokensFrom(r.json);
  if (tokens.scope && !YOUTUBE_SCOPES.split(' ').every(scope => tokens.scope!.split(/\s+/).includes(scope))) throw new YouTubeConnectionError('scope_denied');
  return tokens;
}
export async function youtubeMe(token: string, timeoutMs = 15_000): Promise<Identity> {
  const r = await youtubeRead(`${API}/channels?part=snippet&mine=true&fields=items(id,snippet(title,customUrl))`, { headers: auth(token) }, timeoutMs);
  const ch = r.json?.items?.[0];
  if (r.status === 401) throw new YouTubeTokenError('revoked', 401);
  if (r.status !== 200) throw new YouTubeTokenError(r.status === 403 && !/quota|rateLimit/i.test(String(r.json?.error?.errors?.[0]?.reason || '')) ? 'configuration' : 'retry', r.status);
  if (!ch?.id) throw new YouTubeConnectionError('youtube_channel_missing');
  return { remoteId: String(ch.id), name: String(ch.snippet?.title || 'YouTube channel'), handle: ch.snippet?.customUrl || null };
}
function ytError(r: Res, stage: 'media' | 'create'): SendError {
  const reason = r.json?.error?.errors?.[0]?.reason || '';
  if (/quotaExceeded|dailyLimitExceeded|uploadLimitExceeded/.test(reason)) return new SendError('definitive', 'quota', `youtube provider refusal HTTP ${r.status}`);
  if (/forbidden|youtubeSignupRequired|insufficientPermissions/.test(reason)) return new SendError('definitive', 'auth', `youtube provider refusal HTTP ${r.status}`);
  if (stage === 'create' && r.status >= 500) return new SendError('unknown', 'unknown', `provider create ${r.status}`);
  return mapCommon({ ...r, text: '' }, stage, 'youtube');
}
async function resume(a: AcctCtx, id: string): Promise<Created> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new SendError('unknown', 'unknown', 'youtube invalid video reference');
  let r: Res;
  try { r = await youtubeRead(`${API}/videos?part=status,processingDetails&id=${encodeURIComponent(id)}`, { headers: auth(a.token) }); }
  catch { throw new SendError('transient', 'unavailable', 'youtube status network unavailable'); }
  if (r.status !== 200) {
    if (r.status === 401 || r.status === 403) throw new SendError('auth', 'auth', `youtube status read ${r.status}`);
    throw new SendError('transient', r.status === 429 ? 'rate_limit' : 'unavailable', `youtube status read ${r.status}`);
  }
  const v = r.json?.items?.find((i: any) => String(i.id) === id);
  const status = v?.status?.uploadStatus;
  if (['failed', 'rejected', 'deleted'].includes(status || '') || v?.processingDetails?.processingStatus === 'failed') throw Object.assign(new SendError('definitive', 'media', `youtube processing ${status || 'failed'}`), { confirmedUnpublished: true });
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  if (status === 'processed' || v?.processingDetails?.processingStatus === 'succeeded') return { remoteId: id, url };
  return { remoteId: id, url, pending: true };
}
export async function refreshYouTube(t: Tokens, timeoutMs = 15_000): Promise<Tokens> {
    if (!t.refresh_token) throw new YouTubeTokenError('revoked');
    const r = await youtubeRead(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ client_id: env.youtubeClientId, client_secret: env.youtubeClientSecret, grant_type: 'refresh_token', refresh_token: t.refresh_token }) }, timeoutMs);
    if (r.status !== 200 || !r.json?.access_token) throw tokenFailure(r);
    const next = tokensFrom(r.json, t);
    if (next.scope && !YOUTUBE_SCOPES.split(' ').every(scope => next.scope!.split(/\s+/).includes(scope))) throw new YouTubeTokenError('revoked');
    return next;
}

export async function revokeYouTube(t: Tokens, timeoutMs = 15_000): Promise<void> {
    const r = await youtubeRead('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ token: t.refresh_token || t.access_token }) }, timeoutMs);
    if (r.status === 200 || (r.status === 400 && ['invalid_token', 'invalid_grant'].includes(r.json?.error))) return;
    throw new YouTubeTokenError(r.status === 400 || r.status === 401 || r.status === 403 ? 'configuration' : 'retry', r.status);
}

export const youtubeAdapter: Adapter = {
  resume,
  async publish(a, p) {
    if (!p.video || !/^video\//.test(p.video.type)) throw new SendError('definitive', 'media', 'YouTube requires a video.');
    const o = p.options;
    if (!o?.title?.trim() || !o.privacy || typeof o.madeForKids !== 'boolean') throw new SendError('definitive', 'rejected', 'Choose a YouTube title, visibility and audience.');
    if ([...o.title.trim()].length > 100 || Buffer.byteLength(p.text, 'utf8') > 5000 || /[<>]/.test(o.title + p.text)) throw new SendError('definitive', 'too_long', 'YouTube titles allow 100 characters and descriptions 5000 UTF-8 bytes; angle brackets are not allowed.');
    const metadata = { snippet: { title: o.title.trim(), description: p.text }, status: { privacyStatus: o.privacy, selfDeclaredMadeForKids: o.madeForKids, containsSyntheticMedia: !!p.aiMedia } };
    const boundary = 'radar_' + crypto.randomBytes(18).toString('hex');
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${p.video.type}\r\n\r\n`), p.video.bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    await a.beforeCreate?.();
    const r = await call('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', { method: 'POST', headers: { ...auth(a.token), 'content-type': `multipart/related; boundary=${boundary}`, 'content-length': String(body.length) }, body: new Uint8Array(body) }, 'create', 90_000);
    if (r.status < 200 || r.status >= 300) throw ytError(r, 'create');
    if (!r.json?.id) throw new SendError('unknown', 'unknown', 'youtube accepted response missing video id');
    const id = String(r.json.id);
    try { await p.progress?.(id); } catch { throw new SendError('unknown', 'unknown', 'youtube tracking reference could not be saved'); }
    try { return await resume(a, id); }
    catch (e) { if (e instanceof SendError && (e.kind === 'transient' || e.kind === 'auth')) return { remoteId: id, url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`, pending: true }; throw e; }
  },
  refresh: t => refreshYouTube(t),
  revoke: t => revokeYouTube(t),
  async upload() { throw new SendError('definitive', 'media', 'YouTube uses direct video publishing.'); },
  async create() { throw new SendError('definitive', 'rejected', 'YouTube uses direct video publishing.'); },
};
