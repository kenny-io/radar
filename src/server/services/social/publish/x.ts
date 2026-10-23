// X API v2 adapter (developer-apps-guide.md §3, architecture.md §7, §9). OAuth 2.0 + PKCE as a confidential client: the token
// endpoint takes HTTP Basic (client_secret_post is rejected). Access tokens last 2 hours; refresh tokens are single-use and rotate.
// Replies are never posted through the API (architecture.md §14): Reply now opens X's own reply box on the client.
import { env } from '../../../env';
import { normForMatch } from '@/lib/socialPublish';
import { type Adapter, type Identity, type Res, type Tokens, SendError, TokenError, basic, call, excerpt, form, mapCommon, refreshError } from './api';

export const X_SCOPES = 'tweet.read tweet.write users.read media.write offline.access';
export const X_AUTHORIZE = 'https://x.com/i/oauth2/authorize';
const API = 'https://api.x.com/2';
const TOKEN = `${API}/oauth2/token`;
const auth = () => basic(env.xClientId, env.xClientSecret);
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const tokensFrom = (j: any, prev?: Tokens): Tokens => ({
  access_token: j.access_token,
  // Single-use and rotating: always keep the new one (fall back to the old one only if X didn't send one).
  refresh_token: j.refresh_token || prev?.refresh_token || null,
  expires_at: Date.now() + Number(j.expires_in || 7200) * 1000,
  scope: j.scope || prev?.scope,
});

/** Exchange the authorization code at once: X codes expire after 30 seconds. */
export async function xExchange(code: string, verifier: string, redirectUri: string): Promise<Tokens> {
  const r = await call(TOKEN, { method: 'POST', headers: { authorization: auth(), 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier }) }, 'auth');
  if (r.status !== 200 || !r.json?.access_token) throw new Error(excerpt(r, 'x token'));
  return tokensFrom(r.json);
}
export async function xMe(token: string): Promise<Identity> {
  const r = await call(`${API}/users/me`, { headers: bearer(token) }, 'auth');
  const d = r.json?.data;
  if (r.status !== 200 || !d?.id) throw new Error(excerpt(r, 'x users/me'));
  return { remoteId: String(d.id), name: String(d.name || d.username), handle: '@' + d.username };
}
const statusUrl = (handle: string | null, id: string) => (handle ? `https://x.com/${handle.replace(/^@/, '')}/status/${id}` : `https://x.com/i/web/status/${id}`);
const resetAt = (r: Res) => { const s = Number(r.headers.get('x-rate-limit-reset')); return Number.isFinite(s) && s > 0 ? s * 1000 : null; };

/** X-specific bodies first, then the common mapping. */
export function xCreateError(r: Res): SendError {
  const d = excerpt(r, 'x tweets');
  if (r.status === 403 && /duplicate/i.test(r.text)) return new SendError('definitive', 'duplicate', d);
  if (r.status === 403) return new SendError('definitive', 'auth', d); // app permission / account restricted
  if (r.status === 400 && /too long|length|characters/i.test(r.text)) return new SendError('definitive', 'too_long', d);
  return mapCommon(r, 'create', 'x tweets', resetAt(r));
}

export const xAdapter: Adapter = {
  async refresh(t) {
    if (!t.refresh_token) throw new TokenError(true, 'x: no refresh token');
    let r: Res;
    try { r = await call(TOKEN, { method: 'POST', headers: { authorization: auth(), 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', refresh_token: t.refresh_token }) }, 'auth'); }
    catch (e: any) { throw new TokenError(false, `x refresh ${e?.detail || e?.message || 'network'}`); }
    if (r.status !== 200 || !r.json?.access_token) throw refreshError(r, 'x refresh');
    return tokensFrom(r.json, t);
  },
  async revoke(t) {
    await call(`${API}/oauth2/revoke`, { method: 'POST', headers: { authorization: auth(), 'content-type': 'application/x-www-form-urlencoded' }, body: form({ token: t.refresh_token || t.access_token, token_type_hint: t.refresh_token ? 'refresh_token' : 'access_token' }) }, 'auth').catch(() => null);
  },
  async upload(a, m) {
    const fd = new FormData();
    fd.append('media', new Blob([new Uint8Array(m.bytes)], { type: m.type }), 'image');
    fd.append('media_category', 'tweet_image');
    fd.append('media_type', m.type);
    const r = await call(`${API}/media/upload`, { method: 'POST', headers: bearer(a.token), body: fd }, 'media');
    const id = r.json?.data?.id || r.json?.media_id_string;
    if (r.status >= 200 && r.status < 300 && id) return String(id);
    throw mapCommon(r, 'media', 'x media/upload', resetAt(r));
  },
  async create(a, p) {
    const body: any = { text: p.text };
    if (p.mediaIds.length) body.media = { media_ids: p.mediaIds };
    const r = await call(`${API}/tweets`, { method: 'POST', headers: { ...bearer(a.token), 'content-type': 'application/json' }, body: JSON.stringify(body) }, 'create');
    const id = r.json?.data?.id;
    if (r.status >= 200 && r.status < 300 && id) return { remoteId: String(id), url: statusUrl(a.handle, String(id)) };
    throw xCreateError(r);
  },
  async verify(a, p) {
    const q = new URLSearchParams({ max_results: '10', start_time: new Date(p.sinceMs).toISOString(), 'tweet.fields': 'created_at' });
    const r = await call(`${API}/users/${encodeURIComponent(a.remoteId)}/tweets?${q}`, { headers: bearer(a.token) }, 'read');
    if (r.status !== 200) throw mapCommon(r, 'media', 'x users/tweets');
    const want = normForMatch(p.text);
    const hit = (r.json?.data || []).find((t: any) => normForMatch(String(t.text || '')) === want);
    return hit ? { remoteId: String(hit.id), url: statusUrl(a.handle, String(hit.id)) } : null;
  },
  verifyDelayMs: 20_000,
};
