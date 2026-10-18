// Blog connector OAuth providers — defineOAuth('webflow' | 'notion' | 'wix' | 'shopify' | 'wpcom' | 'github', …)
// The callback stores the tokens encrypted as a pending authorization and returns { oauthRef } to the popup opener;
// BlogConnect then lists targets for that oauthRef (blog.targets) and blog.saveConnection moves the tokens onto the connection.
// With RADAR_DEV_STUBS=1 the start step redirects straight to the callback with a fake code.
import crypto from 'node:crypto';
import { defineOAuth, type OAuthCallbackCtx, type OAuthStartCtx } from '@/server/oauth/registry';
import { env } from '@/server/env';
import { RadarError } from '@/server/errors';
import { savePending } from './store';
import { shopDomain } from './connectors/shopify';
import { reqJson } from './http';

const UNAVAILABLE = 'This connection isn’t available right now. Try again later.';
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

function stubStart(ctx: OAuthStartCtx, extra: Record<string, string> = {}) {
  return { url: `${ctx.redirectUri}?${q({ code: 'stub-code', state: ctx.state, ...extra })}` };
}
const isStub = (ctx: OAuthCallbackCtx) => env.devStubs && ctx.params.get('code') === 'stub-code';
const done = async (ctx: OAuthCallbackCtx, type: string, creds: Record<string, any>) => ({ ok: true, result: { oauthRef: await savePending(ctx.bid, ctx.user?.id || null, type, creds) } });
const need = (id: string, secret: string) => { if (!id || !secret) throw new RadarError(UNAVAILABLE, 503, 'oauth_unconfigured'); };

/* Webflow — Data API v2 scopes */
defineOAuth('webflow', {
  async start(ctx) {
    if (env.devStubs) return stubStart(ctx);
    need(env.webflowClientId, env.webflowClientSecret);
    return { url: `https://webflow.com/oauth/authorize?${q({ response_type: 'code', client_id: env.webflowClientId, redirect_uri: ctx.redirectUri, scope: 'sites:read sites:write cms:read cms:write', state: ctx.state })}` };
  },
  async callback(ctx) {
    if (isStub(ctx)) return done(ctx, 'webflow', { access_token: 'stub-webflow-token' });
    const t = await reqJson<{ access_token: string }>('https://api.webflow.com/oauth/access_token', { method: 'POST', body: q({ client_id: env.webflowClientId, client_secret: env.webflowClientSecret, code: ctx.params.get('code') || '', grant_type: 'authorization_code', redirect_uri: ctx.redirectUri }), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } });
    return done(ctx, 'webflow', { access_token: t.access_token });
  },
});

/* Notion — public integration */
defineOAuth('notion', {
  async start(ctx) {
    if (env.devStubs) return stubStart(ctx);
    need(env.notionClientId, env.notionClientSecret);
    return { url: `https://api.notion.com/v1/oauth/authorize?${q({ client_id: env.notionClientId, response_type: 'code', owner: 'user', redirect_uri: ctx.redirectUri, state: ctx.state })}` };
  },
  async callback(ctx) {
    if (isStub(ctx)) return done(ctx, 'notion', { access_token: 'stub-notion-token', workspace: 'Fieldnote' });
    const t = await reqJson<{ access_token: string; workspace_name?: string; bot_id?: string }>('https://api.notion.com/v1/oauth/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: ctx.params.get('code'), redirect_uri: ctx.redirectUri }), headers: { authorization: 'Basic ' + Buffer.from(`${env.notionClientId}:${env.notionClientSecret}`).toString('base64'), 'content-type': 'application/json', 'notion-version': '2022-06-28' } });
    return done(ctx, 'notion', { access_token: t.access_token, workspace: t.workspace_name || null, bot_id: t.bot_id || null });
  },
});

/* Wix — app install flow; API calls use client credentials + the site's instanceId */
defineOAuth('wix', {
  async start(ctx) {
    if (env.devStubs) return stubStart(ctx, { instanceId: 'stub-instance' });
    need(env.wixClientId, env.wixClientSecret);
    return { url: `https://www.wix.com/installer/install?${q({ appId: env.wixClientId, redirectUrl: ctx.redirectUri, state: ctx.state })}` };
  },
  async callback(ctx) {
    if (isStub(ctx)) return done(ctx, 'wix', { instanceId: 'stub-instance' });
    let instanceId = ctx.params.get('instanceId') || '';
    let refresh: string | null = null;
    const code = ctx.params.get('code');
    if (code) {
      const t = await reqJson<{ access_token: string; refresh_token: string }>('https://www.wixapis.com/oauth/access', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', client_id: env.wixClientId, client_secret: env.wixClientSecret, code }), headers: { 'content-type': 'application/json' } }).catch(() => null);
      refresh = t?.refresh_token || null;
      if (!instanceId && t?.access_token) {
        const inst = await reqJson<{ instance?: { instanceId: string } }>('https://www.wixapis.com/apps/v1/instance', { headers: { authorization: t.access_token } }).catch(() => null);
        instanceId = inst?.instance?.instanceId || '';
      }
    }
    if (!instanceId) return { ok: false, error: 'no_instance' };
    return done(ctx, 'wix', { instanceId, refresh_token: refresh });
  },
});

/* Shopify — needs ?shop= (the store field) */
function shopifyHmacOk(params: URLSearchParams): boolean {
  const hmac = params.get('hmac') || '';
  const msg = [...params.entries()].filter(([k]) => k !== 'hmac' && k !== 'signature').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  const dig = crypto.createHmac('sha256', env.shopifyClientSecret).update(msg).digest('hex');
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
    const t = await reqJson<{ access_token: string; scope: string }>(`https://${shop}/admin/oauth/access_token`, { method: 'POST', body: JSON.stringify({ client_id: env.shopifyClientId, client_secret: env.shopifyClientSecret, code: ctx.params.get('code') }), headers: { 'content-type': 'application/json', accept: 'application/json' } });
    return done(ctx, 'shopify', { access_token: t.access_token, shop });
  },
});

/* WordPress.com — scope "global" so Radar can list every site the account can publish to */
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

/* GitHub (Next.js blog) — OAuth app, scope "repo" */
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
