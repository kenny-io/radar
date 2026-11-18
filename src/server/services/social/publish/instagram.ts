// Instagram Login for professional accounts (no Facebook Page dependency).
import { env } from '../../../env';
import { type Adapter, type AcctCtx, type Created, type Identity, type PublishInput, type Res, type Tokens, call, form, mapCommon, SendError, TokenError } from './api';
export const INSTAGRAM_AUTHORIZE = 'https://www.instagram.com/oauth/authorize';
export const INSTAGRAM_SCOPES = 'instagram_business_basic,instagram_business_content_publish';
const GRAPH = 'https://graph.instagram.com';
export const INSTAGRAM_UNIFIED_SCOPES = 'instagram_basic,instagram_content_publish';
export interface InstagramOAuthState { mode: 'instagram' | 'unified'; appId: string; configId?: string; apiVersion: string }
const api = (path: string, version = env.instagramApiVersion) => `${GRAPH}/${version}/${path}`;
export const instagramUnifiedConfigured = () => !!(env.metaAppId && env.metaAppSecret && env.instagramConfigId);
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const tokenOf = (j: any, scope?: string, version = env.instagramApiVersion): Tokens => ({ access_token: j.access_token, refresh_token: j.access_token, expires_at: Date.now() + Number(j.expires_in || 5184000) * 1000, scope, instagram: { mode: 'instagram', apiVersion: version } });
export async function instagramExchange(code: string, redirectUri: string, version = env.instagramApiVersion): Promise<Tokens> {
  const data = new FormData();
  Object.entries({ client_id: env.instagramClientId, client_secret: env.instagramClientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code }).forEach(([k, v]) => data.set(k, v));
  const short = await call('https://api.instagram.com/oauth/access_token', { method: 'POST', body: data }, 'auth');
  const j = short.json?.data ? (short.json.data.length === 1 ? short.json.data[0] : null) : short.json;
  if (short.status !== 200 || !j?.access_token) throw new Error(`instagram token ${short.status}`);
  const long = await call(`${GRAPH}/access_token?${form({ grant_type: 'ig_exchange_token', client_secret: env.instagramClientSecret, access_token: j.access_token })}`, {}, 'auth');
  if (long.status !== 200 || !long.json?.access_token) throw new Error(`instagram long token ${long.status}`);
  return tokenOf(long.json, typeof j.permissions === 'string' ? j.permissions : Array.isArray(j.permissions) ? j.permissions.join(',') : j.scope, version);
}
export async function instagramMe(token: string, version = env.instagramApiVersion): Promise<Identity> {
  const r = await call(api('me?fields=user_id,username,name', version), { headers: auth(token) }, 'auth');
  if (r.status !== 200 || !(r.json?.user_id || r.json?.id)) throw new Error(`instagram identity ${r.status}`);
  return { remoteId: String(r.json.user_id || r.json.id), name: String(r.json.name || r.json.username || 'Instagram creator'), handle: r.json.username ? '@' + r.json.username : null };
}

/** Unified Login returns a system-user grant, not an Instagram Login user token. */
export async function instagramUnifiedExchange(code: string, redirectUri: string, state: InstagramOAuthState): Promise<{ tokens: Tokens; identities: Identity[] }> {
  if (state.mode !== 'unified' || !/^\d+$/.test(state.appId) || !/^\d+$/.test(state.configId || '') || !/^v\d+\.\d+$/.test(state.apiVersion) || state.appId !== env.metaAppId || !env.metaAppSecret) throw new Error('instagram unified authorization configuration changed');
  const root = `https://graph.facebook.com/${state.apiVersion}`;
  const r = await call(`${root}/oauth/access_token?${form({ client_id: state.appId, client_secret: env.metaAppSecret, redirect_uri: redirectUri, code })}`, {}, 'auth');
  if (r.status !== 200 || typeof r.json?.access_token !== 'string' || !r.json.access_token) throw new Error(`instagram unified token ${r.status}`);
  const scope = typeof r.json.scope === 'string' ? r.json.scope : undefined;
  const tokens: Tokens = { access_token: r.json.access_token, refresh_token: null, expires_at: Number(r.json.expires_in) > 0 ? Date.now() + Number(r.json.expires_in) * 1000 : null, refresh_expires_at: null, scope, instagram: { mode: 'unified', configId: state.configId, apiVersion: state.apiVersion } };
  const me = await call(`${root}/me?fields=client_business_id`, { headers: auth(tokens.access_token) }, 'auth');
  if (me.status !== 200 || !/^\d+$/.test(String(me.json?.client_business_id || ''))) throw new Error(`instagram unified business identity ${me.status}`);
  tokens.instagram!.clientBusinessId = String(me.json.client_business_id);
  const identities: Identity[] = []; const ids = new Set<string>(); const seen = new Set<string>(); let cursor = '';
  for (let page = 0; page < 20; page++) {
    const query = form({ fields: 'id,username', limit: '100', ...(cursor ? { after: cursor } : {}) });
    const accounts = await call(`${root}/me/assigned_instagram_accounts?${query}`, { headers: auth(tokens.access_token) }, 'auth');
    if (accounts.status !== 200 || !Array.isArray(accounts.json?.data)) throw new Error(`instagram unified accounts ${accounts.status}`);
    for (const a of accounts.json.data) {
      const id = String(a?.id || ''); if (!/^\d+$/.test(id)) throw new Error('instagram unified invalid account identity');
      if (ids.has(id)) continue; ids.add(id);
      const username = typeof a.username === 'string' ? a.username.slice(0, 100) : '';
      identities.push({ remoteId: id, name: username || 'Instagram account', handle: username ? '@' + username : null });
    }
    if (!accounts.json.paging?.next) return { tokens, identities };
    // Rebuild our own URL: never follow provider-supplied URLs containing access tokens or unexpected hosts.
    const after = accounts.json.paging?.cursors?.after;
    if (typeof after !== 'string' || !after || after.length > 2000 || seen.has(after)) throw new Error('instagram unified invalid pagination');
    cursor = after; seen.add(after);
  }
  throw new Error('instagram unified account pagination limit');
}

function igError(r: Res, stage: 'media' | 'create'): SendError {
  if (Number(r.json?.error?.code) === 190) return new SendError('auth', 'auth', `instagram ${r.status} token invalid`);
  if ([4, 17, 32, 613].includes(Number(r.json?.error?.code))) return new SendError('transient', 'rate_limit', `instagram ${r.status} rate limit`);
  if (stage === 'create' && r.status >= 500) return new SendError('unknown', 'unknown', `provider create ${r.status}`);
  return mapCommon(r, stage, 'instagram');
}
const profile = (a: AcctCtx) => a.handle ? `https://www.instagram.com/${encodeURIComponent(a.handle.replace(/^@/, ''))}/` : 'https://www.instagram.com/';
const publicUrl = (url?: string) => { if (!url || !/^https:\/\//.test(url)) throw new SendError('definitive', 'media', 'Instagram requires a publicly accessible HTTPS media URL.'); return url; };
function buildInstagramAdapter(mode: 'instagram' | 'unified', version?: string): Adapter {
  const api = (path: string) => mode === 'unified' ? `https://graph.facebook.com/${version || env.metaGraphApiVersion}/${path}` : `${GRAPH}/${version || env.instagramApiVersion}/${path}`;
async function createContainer(a: AcctCtx, body: Record<string, string>): Promise<string> {
  await a.beforeCreate?.();
  const r = await call(api(`${a.remoteId}/media`), { method: 'POST', headers: { ...auth(a.token), 'content-type': 'application/x-www-form-urlencoded' }, body: form(body) }, 'media');
  if (r.status !== 200 || !r.json?.id) throw igError(r, 'media');
  return String(r.json.id);
}
async function resume(a: AcctCtx, ref: string): Promise<Created> {
  if (!/^\d+$/.test(ref)) throw new SendError('unknown', 'unknown', 'instagram invalid container reference');
  const r = await call(api(`${ref}?fields=status_code,status`), { headers: auth(a.token) });
  if (r.status !== 200) {
    const e = igError(r, 'media');
    if (e.kind === 'definitive') throw new SendError(r.status === 403 ? 'auth' : 'transient', r.status === 403 ? 'auth' : 'unavailable', `instagram status read ${r.status}`);
    throw e;
  }
  const status = String(r.json?.status_code || '');
  // A container can be published only once. Its PUBLISHED state confirms publication after a lost response.
  if (status === 'PUBLISHED') return { remoteId: ref, url: profile(a) };
  if (status === 'ERROR' || status === 'EXPIRED') throw Object.assign(new SendError('definitive', 'media', `instagram container ${status}`), { confirmedUnpublished: true });
  if (status !== 'FINISHED') return { remoteId: ref, url: profile(a), pending: true };
  await a.beforeCreate?.();
  const pub = await call(api(`${a.remoteId}/media_publish`), { method: 'POST', headers: { ...auth(a.token), 'content-type': 'application/x-www-form-urlencoded' }, body: form({ creation_id: ref }) }, 'create');
  if (pub.status !== 200) {
    const e = igError(pub, 'create');
    // A previous media_publish may have succeeded: only a container status can establish a terminal failure.
    if (e.kind === 'definitive') throw new SendError(pub.status === 403 ? 'auth' : 'unknown', pub.status === 403 ? 'auth' : 'unknown', `instagram media_publish ${pub.status}`);
    throw e;
  }
  if (!pub.json?.id) throw new SendError('unknown', 'unknown', 'instagram accepted response missing media id');
  const id = String(pub.json.id);
  let url = profile(a);
  // Permalink retrieval is best effort only after publication is confirmed.
  try { const link = await call(api(`${id}?fields=permalink`), { headers: auth(a.token) }); if (link.status === 200 && typeof link.json?.permalink === 'string' && link.json.permalink.startsWith('https://www.instagram.com/')) url = link.json.permalink; } catch { /* already published */ }
  return { remoteId: id, url };
}
async function publish(a: AcctCtx, p: PublishInput): Promise<Created> {
  let id: string;
  if (p.video) id = await createContainer(a, { media_type: 'REELS', video_url: publicUrl(p.video.url), caption: p.text, share_to_feed: 'true' });
  else {
    if (!p.images.length || p.images.length > 10) throw new SendError('definitive', 'media', 'Instagram requires 1–10 JPEG images or a video.');
    if (p.images.some(i => i.type !== 'image/jpeg')) throw new SendError('definitive', 'media', 'Instagram accepts JPEG images only.');
    if (p.images.length === 1) id = await createContainer(a, { image_url: publicUrl(p.images[0].url), caption: p.text });
    else {
      const children: string[] = [];
      for (const image of p.images) children.push(await createContainer(a, { image_url: publicUrl(image.url), is_carousel_item: 'true' }));
      id = await createContainer(a, { media_type: 'CAROUSEL', children: children.join(','), caption: p.text });
    }
  }
  try { await p.progress?.(id); } catch { throw new SendError('unknown', 'unknown', 'instagram tracking reference could not be saved'); }
  return resume(a, id);
}
return {
  publish, resume,
  async refresh(t) {
    if (mode === 'unified' || t.instagram?.mode === 'unified') throw new TokenError(true, 'instagram unified grant requires reconnect; no Instagram Login refresh');
    if (!t.access_token || (t.expires_at && t.expires_at <= Date.now())) throw new TokenError(true, 'instagram token expired');
    let r: Res;
    try { r = await call(`${GRAPH}/refresh_access_token?${form({ grant_type: 'ig_refresh_token', access_token: t.access_token })}`, {}, 'auth'); }
    catch { throw new TokenError(false, 'instagram refresh network'); }
    if (r.status !== 200 || !r.json?.access_token) throw new TokenError(r.status === 400 || r.status === 401 || r.status === 403, `instagram refresh ${r.status}`);
    return tokenOf(r.json, t.scope, t.instagram?.apiVersion || version || env.instagramApiVersion);
  },
  async revoke(t) {
    // Unified system-user grant revocation is managed in Meta Business Integrations. Local disconnect deletes Radar’s copy.
    if (mode === 'unified' || t.instagram?.mode === 'unified') return;
    const r = await call(api('me/permissions'), { method: 'DELETE', headers: auth(t.access_token) }, 'auth'); if (r.status >= 400) throw new Error(`instagram revoke ${r.status}`); },
  async upload() { throw new SendError('definitive', 'media', 'Instagram uses direct media publishing.'); },
  async create() { throw new SendError('definitive', 'rejected', 'Instagram uses direct media publishing.'); },
};

}
/** Missing metadata is a pre-existing Instagram Login token. */
export const instagramAdapter: Adapter = buildInstagramAdapter('instagram');
export function instagramAdapterFor(t: Pick<Tokens, 'instagram'> | null): Adapter {
  if (t?.instagram?.mode === 'unified') return buildInstagramAdapter('unified', t.instagram.apiVersion);
  return t?.instagram?.apiVersion ? buildInstagramAdapter('instagram', t.instagram.apiVersion) : instagramAdapter;
}
