// Blog connector OAuth providers — defineOAuth('webflow' | 'notion' | 'wix' | 'shopify' | 'wpcom' | 'github', …)
// The callback stores the tokens encrypted as a pending authorization and returns { oauthRef } to the popup opener;
// BlogConnect then lists targets for that oauthRef (blog.targets) and blog.saveConnection moves the tokens onto the connection.
// With RADAR_DEV_STUBS=1 the start step redirects straight to the callback with a fake code.
import crypto from 'node:crypto';
import { defineOAuth, type OAuthCallbackCtx, type OAuthStartCtx } from '@/server/oauth/registry';
import { env } from '@/server/env';
import { RadarError } from '@/server/errors';
import { savePending } from './store';
import { shopDomain, shopifyTokens } from './connectors/shopify';
import { NOTION_VERSION } from './connectors/notion';
import { reqJson } from './http';

const UNAVAILABLE = 'This connection isn’t available right now. Try again later.';
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

function stubStart(ctx: OAuthStartCtx, extra: Record<string, string> = {}) {
  return { url: `${ctx.redirectUri}?${q({ code: 'stub-code', state: ctx.state, ...extra })}` };
}
const isStub = (ctx: OAuthCallbackCtx) => env.devStubs && ctx.params.get('code') === 'stub-code';
const done = async (ctx: OAuthCallbackCtx, type: string, creds: Record<string, any>) => ({ ok: true, result: { oauthRef: await savePending(ctx.bid, ctx.user?.id || null, type, creds) } });
const need = (id: string, secret: string) => { if (!id || !secret) throw new RadarError(UNAVAILABLE, 503, 'oauth_unconfigured'); };

/* Webflow — Data API v2 (developers.webflow.com/data/reference/oauth-app). Radar reads sites (sites:read) and collections
   (cms:read) and writes and publishes items (cms:write); it never publishes the whole site, so no sites:write. */
defineOAuth('webflow', {
  async start(ctx) {
    if (env.devStubs) return stubStart(ctx);
    need(env.webflowClientId, env.webflowClientSecret);
    return { url: `https://webflow.com/oauth/authorize?${q({ response_type: 'code', client_id: env.webflowClientId, redirect_uri: ctx.redirectUri, scope: 'sites:read cms:read cms:write', state: ctx.state })}` };
  },
  async callback(ctx) {
    if (isStub(ctx)) return done(ctx, 'webflow', { access_token: 'stub-webflow-token' });
    const t = await reqJson<{ access_token: string }>('https://api.webflow.com/oauth/access_token', { method: 'POST', body: q({ client_id: env.webflowClientId, client_secret: env.webflowClientSecret, code: ctx.params.get('code') || '', grant_type: 'authorization_code', redirect_uri: ctx.redirectUri }), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } });
    if (!t.access_token) return { ok: false, error: 'denied' };
    return done(ctx, 'webflow', { access_token: t.access_token });
  },
});

/* Notion — public integration (developers.notion.com/docs/authorization) */
defineOAuth('notion', {
  async start(ctx) {
    if (env.devStubs) return stubStart(ctx);
    need(env.notionClientId, env.notionClientSecret);
    return { url: `https://api.notion.com/v1/oauth/authorize?${q({ client_id: env.notionClientId, response_type: 'code', owner: 'user', redirect_uri: ctx.redirectUri, state: ctx.state })}` };
  },
  async callback(ctx) {
    if (isStub(ctx)) return done(ctx, 'notion', { access_token: 'stub-notion-token', workspace: 'Fieldnote' });
    // HTTP Basic client auth; redirect_uri is required because the authorize URL carried one.
    const t = await reqJson<{ access_token: string; refresh_token?: string | null; workspace_name?: string; workspace_id?: string; bot_id?: string }>('https://api.notion.com/v1/oauth/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: ctx.params.get('code'), redirect_uri: ctx.redirectUri }), headers: { authorization: 'Basic ' + Buffer.from(`${env.notionClientId}:${env.notionClientSecret}`).toString('base64'), 'content-type': 'application/json', accept: 'application/json', 'notion-version': NOTION_VERSION } });
    return done(ctx, 'notion', { access_token: t.access_token, refresh_token: t.refresh_token || null, workspace: t.workspace_name || null, workspace_id: t.workspace_id || null, bot_id: t.bot_id || null });
  },
});

/* Wix — external install flow (dev.wix.com/docs/build-apps/launch-your-app/app-distribution/install-your-app/
   about-the-external-install-flow). Wix installs the app on the site the user picks, then redirects to postInstallationUrl
   (our callback, with our state kept) adding appId, tenantId, instanceId and signedInstance. There is no code to exchange:
   API calls mint tokens from the app's client credentials + instanceId (connectors/wix.ts). The legacy installer/install +
   oauth/access code flow is "custom authentication (legacy)", no longer available to new apps. */
/** signedInstance = base64url(HMAC-SHA256(app secret, data)) + "." + data, where data is base64url JSON with the instanceId
 *  (dev.wix.com/docs/build-apps/develop-your-app/auth/app-instances/parse-the-app-instance-query-parameter). */
export function wixInstanceOk(signed: string, instanceId: string): boolean {
  const [sig, data] = String(signed || '').split('.');
  if (!sig || !data || !env.wixClientSecret) return false;
  const want = crypto.createHmac('sha256', env.wixClientSecret).update(data).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return false;
  try {
    const j = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return j.instanceId === instanceId && (!j.appDefId || j.appDefId === env.wixClientId);
  } catch { return false; }
}
defineOAuth('wix', {
  async start(ctx) {
    if (env.devStubs) return stubStart(ctx, { instanceId: 'stub-instance' });
    need(env.wixClientId, env.wixClientSecret);
    const back = `${ctx.redirectUri}?${q({ state: ctx.state })}`;
    return { url: `https://www.wix.com/app-installer?${q({ appId: env.wixClientId, ...(env.wixShareUrlId ? { shareUrlId: env.wixShareUrlId } : {}), postInstallationUrl: back })}` };
  },
  async callback(ctx) {
    if (isStub(ctx)) return done(ctx, 'wix', { instanceId: 'stub-instance' });
    const instanceId = ctx.params.get('instanceId') || '';
    const appId = ctx.params.get('appId');
    // Query parameters can be forged: only a valid signedInstance proves this install (and this site) is ours.
    if (!instanceId || (appId && appId !== env.wixClientId) || !wixInstanceOk(ctx.params.get('signedInstance') || '', instanceId)) return { ok: false, error: 'no_instance' };
    return done(ctx, 'wix', { instanceId });
  },
});

/* Shopify — needs ?shop= (the store field). Authorization code grant with expiring offline tokens
   (shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant): the callback is checked
   for state (the registry's callback route), hmac and shop; the code is exchanged form-encoded with expiring=1, and the
   access token (1 h), rotating refresh token (90 days) and their expiries are stored. */
/** Shopify's callback hmac: HMAC-SHA256 (client secret, hex) over the decoded params minus hmac, sorted by key and joined
 *  "k=v&…". Sorted by code unit (byte order for ASCII keys), not localeCompare, which orders case and punctuation differently. */
export function shopifyHmacOk(params: URLSearchParams, secret = env.shopifyClientSecret): boolean {
  const hmac = params.get('hmac') || '';
  const msg = [...params.entries()].filter(([k]) => k !== 'hmac' && k !== 'signature').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
  const dig = crypto.createHmac('sha256', secret).update(msg).digest('hex');
  return hmac.length === dig.length && crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(dig));
}
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
defineOAuth('shopify', {
  async start(ctx) {
    const shop = shopDomain(ctx.params.get('shop') || '');
    if (env.devStubs) return { ...stubStart(ctx, { shop }), data: { shop } };
    need(env.shopifyClientId, env.shopifyClientSecret);
    if (!SHOP_RE.test(shop)) throw new RadarError('Enter your store’s myshopify.com domain.', 400, 'bad_shop');
    return { url: `https://${shop}/admin/oauth/authorize?${q({ client_id: env.shopifyClientId, scope: 'read_content,write_content', redirect_uri: ctx.redirectUri, state: ctx.state })}`, data: { shop } };
  },
  async callback(ctx) {
    const shop = shopDomain(ctx.params.get('shop') || '');
    if (isStub(ctx)) return done(ctx, 'shopify', { access_token: 'stub-shopify-token', shop: shop || ctx.data?.shop });
    if (!SHOP_RE.test(shop) || shop !== ctx.data?.shop || !shopifyHmacOk(ctx.params)) return { ok: false, error: 'invalid_shop' };
    const t = await reqJson<{ access_token: string; scope?: string; expires_in?: number; refresh_token?: string; refresh_token_expires_in?: number }>(`https://${shop}/admin/oauth/access_token`, { method: 'POST', body: q({ client_id: env.shopifyClientId, client_secret: env.shopifyClientSecret, code: ctx.params.get('code') || '', expiring: '1' }), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } });
    if (!t.access_token) return { ok: false, error: 'denied' };
    // Merchants can't deselect scopes, but check what was granted before storing a token that can't publish.
    if (t.scope && !t.scope.split(',').includes('write_content')) return { ok: false, error: 'scope' };
    return done(ctx, 'shopify', { ...shopifyTokens(t), shop });
  },
});

/* WordPress.com — scope "global" so Radar can list every site the account can publish to (a narrower scope gives a
   single-blog token chosen on WordPress.com's consent screen). Code-flow tokens come with no refresh token; when one stops
   working the connection shows "Needs reconnecting". developer.wordpress.com/docs/api/oauth2/ */
defineOAuth('wpcom', {
  async start(ctx) {
    if (env.devStubs) return stubStart(ctx);
    need(env.wpcomClientId, env.wpcomClientSecret);
    return { url: `https://public-api.wordpress.com/oauth2/authorize?${q({ client_id: env.wpcomClientId, redirect_uri: ctx.redirectUri, response_type: 'code', scope: 'global', state: ctx.state })}` };
  },
  async callback(ctx) {
    if (isStub(ctx)) return done(ctx, 'wpcom', { access_token: 'stub-wpcom-token' });
    const t = await reqJson<{ access_token: string; blog_id?: string }>('https://public-api.wordpress.com/oauth2/token', { method: 'POST', body: q({ client_id: env.wpcomClientId, client_secret: env.wpcomClientSecret, redirect_uri: ctx.redirectUri, code: ctx.params.get('code') || '', grant_type: 'authorization_code' }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    return done(ctx, 'wpcom', { access_token: t.access_token });
  },
});

/* GitHub (Next.js blog) — OAuth app, scope "repo" (docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).
   Token errors (bad_verification_code, redirect_uri_mismatch, incorrect_client_credentials) come back as 200 with `error`. */
defineOAuth('github', {
  async start(ctx) {
    if (env.devStubs) return stubStart(ctx);
    need(env.githubClientId, env.githubClientSecret);
    return { url: `https://github.com/login/oauth/authorize?${q({ client_id: env.githubClientId, redirect_uri: ctx.redirectUri, scope: 'repo', state: ctx.state, allow_signup: 'false' })}` };
  },
  async callback(ctx) {
    if (isStub(ctx)) return done(ctx, 'nextjs', { access_token: 'stub-github-token', login: 'fieldnote' });
    const t = await reqJson<{ access_token?: string; error?: string }>('https://github.com/login/oauth/access_token', { method: 'POST', body: JSON.stringify({ client_id: env.githubClientId, client_secret: env.githubClientSecret, code: ctx.params.get('code'), redirect_uri: ctx.redirectUri }), headers: { 'content-type': 'application/json', accept: 'application/json' } });
    if (!t.access_token) return { ok: false, error: t.error || 'denied' };
    return done(ctx, 'nextjs', { access_token: t.access_token });
  },
});
