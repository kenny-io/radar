// LinkedIn REST adapter (developer-apps-guide.md §4, architecture.md §7, §9). Two apps: the profile app (OpenID Connect + Share
// on LinkedIn; 60-day token, no refresh token) and the page app (Community Management only; refresh token for 365 days).
// Every REST call sends LinkedIn-Version and X-Restli-Protocol-Version 2.0.0. Member posts can't be read back, so an unknown
// outcome is never verified here.
import { env } from '../../../env';
import { liCommentary } from '@/lib/socialPublish';
import type { SocialChannel, SocialPage } from '@/lib/types';
import { type Adapter, type Identity, type Res, type Tokens, SendError, TokenError, call, excerpt, form, mapCommon, refreshError } from './api';

export const LI_AUTHORIZE = 'https://www.linkedin.com/oauth/v2/authorization';
export const LI_PROFILE_SCOPES = 'openid profile w_member_social';
export const LI_PAGE_SCOPES = 'w_organization_social rw_organization_admin r_basicprofile';
const TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken';
const REST = 'https://api.linkedin.com/rest';
export type LiApp = 'profile' | 'page';
export const liCreds = (app: LiApp) => (app === 'page' ? { id: env.linkedinPageClientId, secret: env.linkedinPageClientSecret } : { id: env.linkedinClientId, secret: env.linkedinClientSecret });
const rest = (token: string, json = true) => ({ authorization: `Bearer ${token}`, 'linkedin-version': env.linkedinApiVersion, 'x-restli-protocol-version': '2.0.0', ...(json ? { 'content-type': 'application/json' } : {}) });

const tokensFrom = (j: any, prev?: Tokens): Tokens => ({
  access_token: j.access_token,
  refresh_token: j.refresh_token || prev?.refresh_token || null,
  expires_at: Date.now() + Number(j.expires_in || 5184000) * 1000,
  // The refresh token's life is fixed from first consent: refreshing doesn't extend it.
  refresh_expires_at: j.refresh_token_expires_in ? Date.now() + Number(j.refresh_token_expires_in) * 1000 : prev?.refresh_expires_at ?? null,
  scope: j.scope || prev?.scope,
});

export async function liExchange(app: LiApp, code: string, redirectUri: string): Promise<Tokens> {
  const c = liCreds(app);
  const r = await call(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: c.id, client_secret: c.secret }) }, 'auth');
  if (r.status !== 200 || !r.json?.access_token) throw new Error(excerpt(r, 'linkedin token'));
  return tokensFrom(r.json);
}
/** Profile app: the OIDC `sub` is the member's person id for this app. */
export async function liUserinfo(token: string): Promise<Identity> {
  const r = await call('https://api.linkedin.com/v2/userinfo', { headers: { authorization: `Bearer ${token}` } }, 'auth');
  if (r.status !== 200 || !r.json?.sub) throw new Error(excerpt(r, 'linkedin userinfo'));
  return { remoteId: String(r.json.sub), name: String(r.json.name || [r.json.given_name, r.json.family_name].filter(Boolean).join(' ') || 'LinkedIn member') };
}
/** Page app: who connected (logs only; person ids differ per app). */
export async function liMe(token: string): Promise<Identity> {
  const r = await call('https://api.linkedin.com/v2/me', { headers: { authorization: `Bearer ${token}` } }, 'auth');
  if (r.status !== 200 || !r.json?.id) throw new Error(excerpt(r, 'linkedin me'));
  return { remoteId: String(r.json.id), name: [r.json.localizedFirstName, r.json.localizedLastName].filter(Boolean).join(' ') || 'LinkedIn member' };
}
export const PAGE_ROLES = ['ADMINISTRATOR', 'CONTENT_ADMINISTRATOR'];
const orgId = (urn: string) => /urn:li:organization:(\d+)/.exec(urn || '')?.[1] || null;
/** Pages the member administers. One organization lookup per page (Development tier forbids batch gets); followers best effort. */
export async function liPages(token: string): Promise<SocialPage[]> {
  // Administrators and content administrators can both post as the page (no role filter, then filter here).
  const r = await call(`${REST}/organizationAcls?q=roleAssignee&state=APPROVED&count=100`, { headers: rest(token, false) });
  if (r.status !== 200) throw new Error(excerpt(r, 'linkedin organizationAcls'));
  const ids = [...new Set<string>((r.json?.elements || []).filter((e: any) => PAGE_ROLES.includes(e.role) && (!e.state || e.state === 'APPROVED')).map((e: any) => orgId(e.organization || e.organizationTarget)).filter(Boolean))];
  const out: SocialPage[] = [];
  for (const id of ids) {
    const o = await call(`${REST}/organizations/${id}`, { headers: rest(token, false) });
    const name = o.status === 200 ? String(o.json?.localizedName || '') : '';
    let followers: number | null = null;
    try {
      const n = await call(`${REST}/networkSizes/${encodeURIComponent(`urn:li:organization:${id}`)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, { headers: rest(token, false) });
      if (n.status === 200 && Number.isFinite(Number(n.json?.firstDegreeSize))) followers = Number(n.json.firstDegreeSize);
    } catch { /* best effort */ }
    out.push({ id, name: name || `Page ${id}`, followers });
  }
  return out;
}

const authorUrn = (ch: SocialChannel, remoteId: string) => (ch === 'li_page' ? `urn:li:organization:${remoteId}` : `urn:li:person:${remoteId}`);
export function liCreateError(r: Res): SendError {
  const b = r.text; const d = excerpt(r, 'linkedin posts');
  if (r.status >= 400 && r.status < 500 && /duplicate/i.test(b)) return new SendError('definitive', 'duplicate', d);
  if ((r.status === 422 || r.status === 400) && /FIELD_LENGTH_TOO_LONG|too long/i.test(b)) return new SendError('definitive', 'too_long', d);
  // An image still processing: retry the post (a w_member_social token can't poll /rest/images).
  if (r.status >= 400 && r.status < 500 && /process|not (yet )?ready|WAITING_UPLOAD/i.test(b) && /image|media/i.test(b)) return new SendError('transient', 'unavailable', d);
  if (r.status === 403) return new SendError('definitive', 'auth', d);
  return liError(r, 'create', 'linkedin posts');
}
/** 426 NONEXISTENT_VERSION: LinkedIn retired LINKEDIN_API_VERSION (about 12 months after release). Not retried: an operator fix. */
export function liError(r: Res, stage: 'media' | 'create', where: string): SendError {
  if (r.status === 426 || /NONEXISTENT_VERSION/.test(r.text)) {
    console.error(`[social] LinkedIn API version ${env.linkedinApiVersion} retired (426). Set LINKEDIN_API_VERSION to a current version (see docs/LAUNCH.md).`);
    return new SendError('definitive', 'unavailable', excerpt(r, where));
  }
  return mapCommon(r, stage, where);
}
/** Image processing before the post is created (§21 P1). A profile token can't read /rest/images, so it waits a fixed time;
 *  a page polls until AVAILABLE (falling back to the fixed wait on a 403). Still processing after the cap → `media`. */
export const LI_MEDIA = { profileWaitMs: 15_000, pollMs: 2_000, capMs: 30_000 };
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

export function liAdapter(app: LiApp): Adapter {
  return {
    async refresh(t) {
      if (!t.refresh_token || (t.refresh_expires_at && t.refresh_expires_at <= Date.now())) throw new TokenError(true, 'linkedin: no usable refresh token');
      const c = liCreds(app);
      let r: Res;
      try { r = await call(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: c.id, client_secret: c.secret }) }, 'auth'); }
      catch (e: any) { throw new TokenError(false, `linkedin refresh ${e?.detail || e?.message || 'network'}`); }
      if (r.status !== 200 || !r.json?.access_token) throw refreshError(r, 'linkedin refresh');
      return tokensFrom(r.json, t);
    },
    async revoke(t) {
      const c = liCreds(app);
      await call('https://www.linkedin.com/oauth/v2/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ client_id: c.id, client_secret: c.secret, token: t.access_token }) }, 'auth').catch(() => null);
    },
    async upload(a, m) {
      const init = await call(`${REST}/images?action=initializeUpload`, { method: 'POST', headers: rest(a.token), body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn(a.ch, a.remoteId) } }) }, 'media');
      const v = init.json?.value;
      if (init.status !== 200 || !v?.uploadUrl || !v?.image) throw liError(init, 'media', 'linkedin images');
      const put = await call(v.uploadUrl, { method: 'PUT', headers: { authorization: `Bearer ${a.token}`, 'content-type': m.type }, body: new Uint8Array(m.bytes) }, 'media');
      if (put.status < 200 || put.status >= 300) throw liError(put, 'media', 'linkedin upload');
      return String(v.image);
    },
    async awaitMedia(a, ids) {
      if (!ids.length) return;
      if (a.ch !== 'li_page') { await sleep(LI_MEDIA.profileWaitMs); return; }
      const end = Date.now() + LI_MEDIA.capMs;
      for (const id of ids) {
        for (;;) {
          const r = await call(`${REST}/images/${encodeURIComponent(id)}`, { headers: rest(a.token, false) }, 'media');
          if (r.status === 403) { await sleep(LI_MEDIA.profileWaitMs); return; } // page scopes may not allow reading images
          const st = String(r.json?.status || '');
          if (r.status === 200 && st === 'AVAILABLE') break;
          if (r.status === 200 && /FAILED/.test(st)) throw new SendError('definitive', 'media', `linkedin image ${st}`);
          if (r.status !== 200 && r.status !== 404) throw liError(r, 'media', 'linkedin images get');
          if (Date.now() > end) throw new SendError('definitive', 'media', `linkedin image still ${st || r.status} after ${LI_MEDIA.capMs / 1000}s`);
          await sleep(LI_MEDIA.pollMs);
        }
      }
    },
    async create(a, p) {
      const body: any = {
        author: authorUrn(a.ch, a.remoteId), commentary: liCommentary(p.text), visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
      };
      if (p.mediaIds.length === 1) body.content = { media: { id: p.mediaIds[0] } };
      else if (p.mediaIds.length > 1) body.content = { multiImage: { images: p.mediaIds.map(id => ({ id })) } };
      const r = await call(`${REST}/posts`, { method: 'POST', headers: rest(a.token), body: JSON.stringify(body) }, 'create');
      const urn = r.headers.get('x-restli-id') || r.json?.id;
      if (r.status >= 200 && r.status < 300 && urn) return { remoteId: String(urn), url: `https://www.linkedin.com/feed/update/${urn}/` };
      throw liCreateError(r);
    },
  };
}
