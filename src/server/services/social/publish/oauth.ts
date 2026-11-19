// OAuth providers for social channels (architecture.md §7): defineOAuth('x' | 'linkedin' | 'linkedin_page', …), role Editor.
// The callback exchanges the code at once (X codes last 30 s), fetches the identity, and stores both encrypted as a pending
// authorization (1 hour); social.connect (or social.pages first, for a page) finishes it. Nothing is connected until then.
// With RADAR_DEV_STUBS=1 start redirects straight to the callback with a stub code (`stub_as=other` signs in as someone else).
import crypto from 'node:crypto';
import { defineOAuth, type OAuthCallbackCtx, type OAuthStartCtx } from '../../../oauth/registry';
import { env } from '../../../env';
import { RadarError } from '../../../errors';
import { decrypt, encrypt, randomToken } from '../../../crypto';
import { requireRole } from '../../../access';
import { getBiz } from '../../../workspace';
import { socialOn } from '../../../flags';
import { COPY } from '@/lib/socialPublish';
import type { Profile, SocialChannel } from '@/lib/types';
import type { Identity, Tokens } from './api';
import { savePendingSocial } from './accounts';
import { X_AUTHORIZE, X_SCOPES, xExchange, xMe } from './x';
import { LI_AUTHORIZE, LI_PAGE_SCOPES, LI_PROFILE_SCOPES, liCreds, liExchange, liMe, liUserinfo } from './linkedin';
import { stubIdentity, stubTokens } from './stubs';
import { INSTAGRAM_AUTHORIZE, INSTAGRAM_SCOPES, INSTAGRAM_UNIFIED_SCOPES, instagramUnifiedConfigured, instagramUnifiedExchange, type InstagramOAuthState, instagramExchange, instagramMe } from './instagram';
import { TIKTOK_AUTHORIZE, TIKTOK_SCOPES, tiktokExchange, tiktokMe } from './tiktok';
import { YOUTUBE_AUTHORIZE, YOUTUBE_SCOPES, YouTubeConnectionError, youtubeExchange, youtubeMe } from './youtube';

const UNAVAILABLE = 'This connection isn’t available right now. Try again later.';
/** Shown when the user unticked a permission on the consent screen (§21 P6). Nothing is saved. */
export const SCOPE_ERROR = 'Radar needs permission to post. Try again and allow all permissions.';
const REQUIRED: Record<SocialChannel, string[]> = { x: X_SCOPES.split(' '), li_profile: LI_PROFILE_SCOPES.split(' '), li_page: ['w_organization_social', 'rw_organization_admin'], instagram: INSTAGRAM_SCOPES.split(','), tiktok: TIKTOK_SCOPES.split(','), youtube: YOUTUBE_SCOPES.split(' ') };
/** Every required scope was granted. A token response without a scope list is accepted (the API calls will tell). */
export const scopesOk = (ch: SocialChannel, granted: string | null | undefined, instagramMode?: 'instagram' | 'unified') => !granted || (ch === 'instagram' && instagramMode === 'unified' ? INSTAGRAM_UNIFIED_SCOPES.split(',') : REQUIRED[ch]).every(x => granted.split(/[\s,]+/).includes(x));
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
const isStub = (ctx: OAuthCallbackCtx) => env.devStubs && ctx.params.get('code') === 'stub-code';
const b64url = (b: Buffer) => b.toString('base64url');

async function gate(ctx: OAuthStartCtx) {
  const b = await getBiz(ctx.bid);
  if (!(await socialOn(b))) throw new RadarError(COPY.notEnabled, 404, 'not_enabled');
  return b;
}
function stubStart(ctx: OAuthStartCtx) {
  const as: Record<string, string> = ctx.params.get('stub_as') === 'other' ? { stub_as: 'other' } : {};
  return { url: `${ctx.redirectUri}?${q({ code: 'stub-code', state: ctx.state, ...as })}` };
}
/** Re-check the role, then store the pending authorization and hand the popup its reference. */
async function finish(ctx: OAuthCallbackCtx, ch: SocialChannel, tokens: Tokens, id: Identity, identities?: Identity[]) {
  const oauthRef = await savePendingSocial(ctx.bid, ctx.user!.id, ch, { tokens, id, ...(identities ? { identities } : {}), ...(ch === 'youtube' ? { authorizationStartedAt: ctx.data?.youtubeStartedAt } : {}) });
  console.log(`[social.oauth] ${ch} authorized for ${ctx.bid}`);
  return { ok: true, result: { oauthRef, ch, ...(identities ? { pickAccount: true } : {}) } };
}
async function callbackFor(ctx: OAuthCallbackCtx, ch: SocialChannel, real: () => Promise<{ tokens: Tokens; id: Identity; identities?: Identity[] }>) {
  if (!ctx.user) return { ok: false, error: 'session' };
  try { await requireRole(ctx.bid, ctx.user.id, 'Editor'); } catch { return { ok: false, error: 'forbidden' }; }
  if (!ctx.params.get('code')) return { ok: false, error: 'denied' };
  if (isStub(ctx)) {
    const b = await getBiz(ctx.bid);
    const tokens = stubTokens(ch); if (ch === 'youtube') tokens.youtube = { profileFetchedAt: Date.now(), authorizationCheckedAt: Date.now() };
    return finish(ctx, ch, tokens, stubIdentity(ch, { businessName: (b.profile as Profile)?.business?.name || b.domain, userName: ctx.user.name, userId: ctx.user.id, as: ctx.params.get('stub_as') }));
  }
  try {
    const r = await real();
    if (!scopesOk(ch, r.tokens.scope, r.tokens.instagram?.mode)) { console.warn(`[social.oauth] ${ch} missing scopes for ${ctx.bid}`); return { ok: false, error: SCOPE_ERROR }; }
    return finish(ctx, ch, r.tokens, r.id, r.identities);
  }
  catch (e: any) { console.error(`[social.oauth] ${ch} exchange failed: ${String(e?.message || e).slice(0, 300)}`); return { ok: false, error: ch === 'youtube' && e instanceof YouTubeConnectionError ? e.code : 'exchange_failed' }; }
}

/* X — OAuth 2.0 Authorization Code with PKCE (S256), confidential client */
defineOAuth('x', {
  role: 'Editor',
  async start(ctx) {
    await gate(ctx);
    if (env.devStubs) return stubStart(ctx);
    if (!env.xClientId || !env.xClientSecret) throw new RadarError(UNAVAILABLE, 503, 'oauth_unconfigured');
    const verifier = randomToken(48);
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    return { url: `${X_AUTHORIZE}?${q({ response_type: 'code', client_id: env.xClientId, redirect_uri: ctx.redirectUri, scope: X_SCOPES, state: ctx.state, code_challenge: challenge, code_challenge_method: 'S256' })}`, data: { v: encrypt(verifier) } };
  },
  callback: ctx => callbackFor(ctx, 'x', async () => {
    const verifier = decrypt<string>(ctx.data?.v);
    if (!verifier) throw new Error('missing PKCE verifier');
    const tokens = await xExchange(ctx.params.get('code') || '', verifier, ctx.redirectUri);
    return { tokens, id: await xMe(tokens.access_token) };
  }),
});

/* LinkedIn profile — the profile app (Sign In with LinkedIn using OpenID Connect + Share on LinkedIn) */
defineOAuth('linkedin', {
  role: 'Editor',
  async start(ctx) {
    await gate(ctx);
    if (env.devStubs) return stubStart(ctx);
    const c = liCreds('profile'); if (!c.id || !c.secret) throw new RadarError(UNAVAILABLE, 503, 'oauth_unconfigured');
    return { url: `${LI_AUTHORIZE}?${q({ response_type: 'code', client_id: c.id, redirect_uri: ctx.redirectUri, state: ctx.state, scope: LI_PROFILE_SCOPES })}` };
  },
  callback: ctx => callbackFor(ctx, 'li_profile', async () => {
    const tokens = await liExchange('profile', ctx.params.get('code') || '', ctx.redirectUri);
    return { tokens, id: await liUserinfo(tokens.access_token) };
  }),
});

/* LinkedIn page — the separate page app (Community Management API only). The page is picked in social.pages/social.connect. */
defineOAuth('linkedin_page', {
  role: 'Editor',
  async start(ctx) {
    await gate(ctx);
    if (env.devStubs) return stubStart(ctx);
    const c = liCreds('page'); if (!c.id || !c.secret) throw new RadarError(UNAVAILABLE, 503, 'oauth_unconfigured');
    return { url: `${LI_AUTHORIZE}?${q({ response_type: 'code', client_id: c.id, redirect_uri: ctx.redirectUri, state: ctx.state, scope: LI_PAGE_SCOPES })}` };
  },
  callback: ctx => callbackFor(ctx, 'li_page', async () => {
    const tokens = await liExchange('page', ctx.params.get('code') || '', ctx.redirectUri);
    return { tokens, id: await liMe(tokens.access_token) };
  }),
});

/** Save mode/configuration in server-owned OAuth state; callback query strings never select the token host. */
export function instagramStart(ctx: OAuthStartCtx) {
  if (instagramUnifiedConfigured()) {
    const state: InstagramOAuthState = { mode: 'unified', appId: env.metaAppId, configId: env.instagramConfigId, apiVersion: env.metaGraphApiVersion };
    if (!/^v\d+\.\d+$/.test(state.apiVersion) || !/^\d+$/.test(state.appId) || !/^\d+$/.test(state.configId!)) throw new RadarError(UNAVAILABLE, 503, 'oauth_unconfigured');
    return { url: `https://www.facebook.com/${state.apiVersion}/dialog/oauth?${q({ client_id: state.appId, config_id: state.configId!, redirect_uri: ctx.redirectUri, response_type: 'code', state: ctx.state, display: 'popup', prompt: 'login', override_default_response_type: 'true' })}`, data: { instagram: state } };
  }
  if (!env.instagramClientId || !env.instagramClientSecret) throw new RadarError(UNAVAILABLE, 503, 'oauth_unconfigured');
  const state: InstagramOAuthState = { mode: 'instagram', appId: env.instagramClientId, apiVersion: env.instagramApiVersion };
  return { url: `${INSTAGRAM_AUTHORIZE}?${q({ client_id: env.instagramClientId, redirect_uri: ctx.redirectUri, response_type: 'code', scope: INSTAGRAM_SCOPES, state: ctx.state, enable_fb_login: 'false', force_reauth: 'true' })}`, data: { instagram: state } };
}
/* Unified Login for new Meta apps, with existing Instagram Login grants retained. */
defineOAuth('instagram', {
  role: 'Editor',
  async start(ctx) {
    await gate(ctx); if (env.devStubs) return stubStart(ctx);
    return instagramStart(ctx);
  },
  callback: ctx => callbackFor(ctx, 'instagram', async () => {
    const state = ctx.data?.instagram as InstagramOAuthState | undefined;
    if (state?.mode === 'unified') {
      const result = await instagramUnifiedExchange(ctx.params.get('code') || '', ctx.redirectUri, state);
      // /me is the business system user, never an Instagram account. Nothing is selected until social.connect.
      return { ...result, id: { remoteId: '', name: 'Instagram account' } };
    }
    if (state && state.mode !== 'instagram') throw new Error('instagram invalid authorization mode');
    if (state?.appId && state.appId !== env.instagramClientId) throw new Error('instagram authorization configuration changed');
    const version = state?.apiVersion || env.instagramApiVersion;
    if (!/^v\d+\.\d+$/.test(version)) throw new Error('instagram invalid authorization version');
    const tokens = await instagramExchange(ctx.params.get('code') || '', ctx.redirectUri, version);
    return { tokens, id: await instagramMe(tokens.access_token, version) };
  }),
});
/* TikTok Login Kit Web, direct-post scope (not inbox upload). */
defineOAuth('tiktok', {
  role: 'Editor',
  async start(ctx) {
    await gate(ctx); if (env.devStubs) return stubStart(ctx);
    if (!env.tiktokClientKey || !env.tiktokClientSecret) throw new RadarError(UNAVAILABLE, 503, 'oauth_unconfigured');
    return { url: `${TIKTOK_AUTHORIZE}?${q({ client_key: env.tiktokClientKey, redirect_uri: ctx.redirectUri, response_type: 'code', scope: TIKTOK_SCOPES, state: ctx.state })}` };
  },
  callback: ctx => callbackFor(ctx, 'tiktok', async () => { const tokens = await tiktokExchange(ctx.params.get('code') || '', ctx.redirectUri); return { tokens, id: await tiktokMe(tokens.access_token) }; }),
});
/* Dedicated Google OAuth client for YouTube; search API key and sign-in grants stay separate. */
defineOAuth('youtube', {
  role: 'Editor',
  async start(ctx) {
    await gate(ctx); if (env.devStubs) return { ...stubStart(ctx), data: { youtubeStartedAt: Date.now() } };
    if (!env.youtubeClientId || !env.youtubeClientSecret) throw new RadarError(UNAVAILABLE, 503, 'oauth_unconfigured');
    const verifier = randomToken(48); const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    return { url: `${YOUTUBE_AUTHORIZE}?${q({ client_id: env.youtubeClientId, redirect_uri: ctx.redirectUri, response_type: 'code', scope: YOUTUBE_SCOPES, state: ctx.state, access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256' })}`, data: { v: encrypt(verifier), youtubeStartedAt: Date.now() } };
  },
  callback: ctx => callbackFor(ctx, 'youtube', async () => {
    const verifier = decrypt<string>(ctx.data?.v); if (!verifier) throw new Error('missing PKCE verifier');
    const tokens = await youtubeExchange(ctx.params.get('code') || '', verifier, ctx.redirectUri); const id = await youtubeMe(tokens.access_token);
    tokens.youtube = { profileFetchedAt: Date.now(), authorizationCheckedAt: Date.now() }; return { tokens, id };
  }),
});
