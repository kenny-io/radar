// TikTok Content Posting API: direct photo/video posts, never the inbox-upload flow.
import { env } from '../../../env';
import type { TikTokCreatorInfo } from '@/lib/types';
import { type Adapter, type AcctCtx, type Created, type Identity, type PublishInput, type Res, type Tokens, call, form, mapCommon, refreshError, SendError, TokenError } from './api';

export const TIKTOK_AUTHORIZE = 'https://www.tiktok.com/v2/auth/authorize/';
export const TIKTOK_SCOPES = 'user.info.basic,video.publish';
const API = 'https://open.tiktokapis.com/v2';
const TOKEN = `${API}/oauth/token/`;
const headers = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' });
const tokensFrom = (j: any, prev?: Tokens): Tokens => ({ access_token: j.access_token, refresh_token: j.refresh_token || prev?.refresh_token || null, expires_at: Date.now() + Number(j.expires_in || 7200) * 1000, refresh_expires_at: j.refresh_expires_in ? Date.now() + Number(j.refresh_expires_in) * 1000 : prev?.refresh_expires_at ?? null, scope: j.scope || prev?.scope });
export async function tiktokExchange(code: string, redirectUri: string): Promise<Tokens> {
  const r = await call(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ client_key: env.tiktokClientKey, client_secret: env.tiktokClientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }) }, 'auth');
  if (r.status !== 200 || !r.json?.access_token) throw new Error(`tiktok token ${r.status}`);
  return tokensFrom(r.json);
}
function tiktokError(r: Res, stage: 'media' | 'create', where: string): SendError {
  const code = String(r.json?.error?.code || '');
  if (/access_token_invalid|scope_not_authorized/.test(code)) return new SendError('auth', 'auth', `${where} ${r.status} ${code}`);
  if (/rate_limit|spam_risk_too_many/.test(code)) return new SendError('transient', 'rate_limit', `${where} ${code}`);
  if (/internal_error/.test(code)) return new SendError(stage === 'create' ? 'unknown' : 'transient', stage === 'create' ? 'unknown' : 'unavailable', `${where} ${code}`);
  if (stage === 'create' && r.status >= 500) return new SendError('unknown', 'unknown', `provider create ${r.status}`);
  return mapCommon(r, stage, where);
}
async function request(token: string, path: string, body: unknown, stage: 'media' | 'create' | 'status' = 'media'): Promise<any> {
  const r = await call(`${API}${path}`, { method: 'POST', headers: headers(token), body: JSON.stringify(body) }, stage === 'status' ? 'read' : stage);
  if (r.status !== 200 || r.json?.error?.code !== 'ok' || !r.json?.data) {
    if (stage === 'status') {
      const code = String(r.json?.error?.code || '');
      if (r.status === 401 || r.status === 403 || /access_token_invalid|scope_not_authorized/.test(code)) throw new SendError('auth', 'auth', `tiktok status ${r.status} ${code}`);
      throw new SendError('transient', r.status === 429 ? 'rate_limit' : 'unavailable', `tiktok status ${r.status} ${code}`);
    }
    throw tiktokError(r, stage, `tiktok ${path}`);
  }
  return r.json.data;
}
export async function tiktokMe(token: string): Promise<Identity> {
  const r = await call(`${API}/user/info/?fields=open_id,display_name`, { headers: headers(token) }, 'auth');
  const u = r.json?.data?.user;
  if (r.status !== 200 || !u?.open_id || r.json?.error?.code !== 'ok') throw new Error(`tiktok identity ${r.status}`);
  const creator = await request(token, '/post/publish/creator_info/query/', {});
  return { remoteId: String(u.open_id), name: String(u.display_name || creator.creator_nickname || 'TikTok creator'), handle: creator.creator_username ? '@' + creator.creator_username : null };
}
export async function tiktokCreatorInfo(token: string): Promise<TikTokCreatorInfo> {
  if (env.devStubs && token.startsWith('stub-')) return { username: 'radar', nickname: 'Radar creator', avatarUrl: '', privacyLevels: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'], commentDisabled: false, duetDisabled: false, stitchDisabled: false, maxVideoDurationSec: 600 };
  const d = await request(token, '/post/publish/creator_info/query/', {});
  return { username: String(d.creator_username || ''), avatarUrl: String(d.creator_avatar_url || ''), nickname: String(d.creator_nickname || d.creator_username || 'TikTok creator'), privacyLevels: Array.isArray(d.privacy_level_options) ? d.privacy_level_options.map(String) : [], commentDisabled: !!d.comment_disabled, duetDisabled: !!d.duet_disabled, stitchDisabled: !!d.stitch_disabled, maxVideoDurationSec: Number(d.max_video_post_duration_sec || 0) };
}
const profile = (a: AcctCtx) => a.handle ? `https://www.tiktok.com/@${encodeURIComponent(a.handle.replace(/^@/, ''))}` : 'https://www.tiktok.com/';
function publicUrl(url?: string): string {
  if (!url || !/^https:\/\//.test(url)) throw new SendError('definitive', 'media', 'TikTok requires a public HTTPS URL on the app’s verified media domain.');
  return url;
}
async function status(a: AcctCtx, ref: string): Promise<Created> {
  const d = await request(a.token, '/post/publish/status/fetch/', { publish_id: ref }, 'status');
  if (d.status === 'FAILED') throw Object.assign(new SendError('definitive', 'media', `tiktok processing ${String(d.fail_reason || 'failed').slice(0, 100)}`), { confirmedUnpublished: true });
  if (d.status === 'PUBLISH_COMPLETE') {
    const id = (d.publicaly_available_post_id || d.publicly_available_post_id || [])[0];
    return { remoteId: String(id || ref), url: profile(a) };
  }
  return { remoteId: ref, url: profile(a), pending: true };
}
async function publish(a: AcctCtx, p: PublishInput): Promise<Created> {
  const o = p.options?.tiktok;
  if (!o?.consent || !o.privacyLevel) throw new SendError('definitive', 'rejected', 'TikTok privacy and explicit creator consent are required.');
  const creator = await tiktokCreatorInfo(a.token);
  if (!creator.privacyLevels.includes(o.privacyLevel)) throw new SendError('definitive', 'rejected', 'TikTok privacy setting is no longer available. Review the post.');
  if (p.video?.durationSec && creator.maxVideoDurationSec && p.video.durationSec > creator.maxVideoDurationSec) throw new SendError('definitive', 'media', 'Video exceeds this TikTok creator’s duration limit.');
  if ((o.allowComment && creator.commentDisabled) || (p.video && ((o.allowDuet && creator.duetDisabled) || (o.allowStitch && creator.stitchDisabled)))) throw new SendError('definitive', 'rejected', 'TikTok interaction settings changed. Review the post.');
  if (o.commercialContent && !o.brandOrganic && !o.brandedContent) throw new SendError('definitive', 'rejected', 'Choose which brand the TikTok post promotes.');
  if (o.brandedContent && o.privacyLevel === 'SELF_ONLY') throw new SendError('definitive', 'rejected', 'TikTok branded content cannot be private.');
  const post = { privacy_level: o.privacyLevel, disable_comment: !o.allowComment, brand_organic_toggle: !!(o.commercialContent && o.brandOrganic), brand_content_toggle: !!(o.commercialContent && o.brandedContent) };
  let d: any;
  await a.beforeCreate?.();
  if (p.video) {
    d = await request(a.token, '/post/publish/video/init/', { post_info: { ...post, title: p.text, disable_duet: !o.allowDuet, disable_stitch: !o.allowStitch, is_aigc: !!p.aiMedia }, source_info: { source: 'PULL_FROM_URL', video_url: publicUrl(p.video.url) } }, 'create');
  } else {
    if (!p.images.length || p.images.length > 35) throw new SendError('definitive', 'media', 'TikTok requires 1–35 photos or a video.');
    d = await request(a.token, '/post/publish/content/init/', { media_type: 'PHOTO', post_mode: 'DIRECT_POST', post_info: { ...post, title: p.options?.title || '', description: p.text, auto_add_music: false }, source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: p.images.map(i => publicUrl(i.url)) }, is_aigc: !!p.aiMedia }, 'create');
  }
  if (!d.publish_id) throw new SendError('unknown', 'unknown', 'tiktok accepted response missing publish_id');
  const ref = String(d.publish_id);
  try { await p.progress?.(ref); } catch { throw new SendError('unknown', 'unknown', 'tiktok tracking reference could not be saved'); }
  // One immediate observation keeps requests bounded. The worker resumes the saved reference if still processing.
  try { return await status(a, ref); }
  catch (e) { if (e instanceof SendError && (e.kind === 'transient' || e.kind === 'auth')) return { remoteId: ref, url: profile(a), pending: true }; throw e; }
}
export const tiktokAdapter: Adapter = {
  publish, resume: status,
  async refresh(t) {
    if (!t.refresh_token) throw new TokenError(true, 'tiktok: no refresh token');
    let r: Res;
    try { r = await call(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ client_key: env.tiktokClientKey, client_secret: env.tiktokClientSecret, grant_type: 'refresh_token', refresh_token: t.refresh_token }) }, 'auth'); }
    catch { throw new TokenError(false, 'tiktok refresh network'); }
    if (r.status !== 200 || !r.json?.access_token) throw refreshError(r, 'tiktok refresh');
    return tokensFrom(r.json, t);
  },
  async revoke(t) { const r = await call(`${API}/oauth/revoke/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ client_key: env.tiktokClientKey, client_secret: env.tiktokClientSecret, token: t.access_token }) }, 'auth'); if (r.status >= 400) throw new Error(`tiktok revoke ${r.status}`); },
  async upload() { throw new SendError('definitive', 'media', 'TikTok uses direct media publishing.'); },
  async create() { throw new SendError('definitive', 'rejected', 'TikTok uses direct media publishing.'); },
};
