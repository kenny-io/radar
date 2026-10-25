// Blog OAuth providers against a mocked fetch: authorize URLs, callbacks and token exchanges must match
// developer.wordpress.com/docs/api/oauth2/, developers.notion.com/docs/authorization, developers.webflow.com/data/reference/oauth-app,
// dev.wix.com/docs/build-apps/launch-your-app/app-distribution/install-your-app/{about,set-up}-the-external-install-flow,
// dev.wix.com/docs/build-apps/develop-your-app/auth/app-instances/parse-the-app-instance-query-parameter,
// shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant (+ …/offline-access-tokens) and
// docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps. Pending tokens are captured, not stored.
import crypto from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const saved: { type: string; creds: Record<string, any> }[] = [];
vi.mock('./store', () => ({ savePending: vi.fn(async (_bid: string, _uid: string | null, type: string, creds: Record<string, any>) => { saved.push({ type, creds }); return 'pend_test'; }) }));

import { env } from '@/server/env';
import { oauthProvider } from '@/server/oauth/registry';
import { shopifyHmacOk, wixInstanceOk } from './oauth';

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const reply = (status: number, body: any = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function mockFetch(fn: (url: string, init: RequestInit) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => { calls.push({ url: String(url), init }); return fn(String(url), init); }));
}
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];
const user = { id: 'u1' } as any;
const start = (p: string, params: Record<string, string> = {}) => oauthProvider(p)!.start({ user, bid: 'b1', state: 'st8', redirectUri: `https://radar.thally.io/api/oauth/${p}/callback`, params: new URLSearchParams(params) });
const callback = (p: string, code = 'the-code', params: Record<string, string> | null = null, data: any = {}) => oauthProvider(p)!.callback({ user, bid: 'b1', data, redirectUri: `https://radar.thally.io/api/oauth/${p}/callback`, params: new URLSearchParams(params || { code, state: 'st8' }) });

const TEST_ENV = {
  devStubs: false, wpcomClientId: '12345', wpcomClientSecret: 'wp-secret', notionClientId: 'ntn-client', notionClientSecret: 'ntn-secret',
  webflowClientId: 'wf-client', webflowClientSecret: 'wf-secret', wixClientId: 'wix-app', wixClientSecret: 'wix-secret', wixShareUrlId: '',
  shopifyClientId: 'shp-client', shopifyClientSecret: 'hush', githubClientId: 'gh-client', githubClientSecret: 'gh-secret',
};
const ENV = Object.fromEntries(Object.keys(TEST_ENV).map(k => [k, (env as any)[k]]));
beforeAll(() => { Object.assign(env, TEST_ENV); });
beforeEach(() => { calls = []; saved.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(() => { Object.assign(env, ENV); });

describe('WordPress.com OAuth', () => {
  it('authorize URL: public-api.wordpress.com/oauth2/authorize, response_type=code, scope=global, state and redirect', async () => {
    const u = new URL((await start('wpcom')).url);
    expect(u.origin + u.pathname).toBe('https://public-api.wordpress.com/oauth2/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: '12345', redirect_uri: 'https://radar.thally.io/api/oauth/wpcom/callback', response_type: 'code', scope: 'global', state: 'st8' });
  });
  it('token exchange: form-encoded POST to /oauth2/token with the client secret; keeps the access token', async () => {
    mockFetch(() => reply(200, { access_token: 'wp-at', token_type: 'bearer', blog_id: '0', blog_url: '' }));
    const r = await callback('wpcom');
    expect(calls[0].url).toBe('https://public-api.wordpress.com/oauth2/token');
    expect(calls[0].init.method).toBe('POST');
    expect(hdr(calls[0], 'content-type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(String(calls[0].init.body)))).toEqual({ client_id: '12345', client_secret: 'wp-secret', redirect_uri: 'https://radar.thally.io/api/oauth/wpcom/callback', code: 'the-code', grant_type: 'authorization_code' });
    expect(r).toEqual({ ok: true, result: { oauthRef: 'pend_test' } });
    expect(saved).toEqual([{ type: 'wpcom', creds: { access_token: 'wp-at' } }]);
  });
  it('a refused exchange fails (the callback route turns it into "exchange_failed")', async () => {
    mockFetch(() => reply(400, { error: 'invalid_grant', error_description: 'Invalid authorization code' }));
    await expect(callback('wpcom')).rejects.toMatchObject({ http: 400 });
    expect(saved).toHaveLength(0);
  });
});

describe('Notion OAuth', () => {
  it('authorize URL: api.notion.com/v1/oauth/authorize with owner=user and response_type=code', async () => {
    const u = new URL((await start('notion')).url);
    expect(u.origin + u.pathname).toBe('https://api.notion.com/v1/oauth/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: 'ntn-client', response_type: 'code', owner: 'user', redirect_uri: 'https://radar.thally.io/api/oauth/notion/callback', state: 'st8' });
  });
  it('token exchange: HTTP Basic client auth, JSON body with the redirect_uri, current Notion-Version; keeps the refresh token', async () => {
    mockFetch(() => reply(200, { access_token: 'ntn-at', token_type: 'bearer', refresh_token: 'ntn-rt', bot_id: 'bot1', workspace_id: 'ws1', workspace_name: 'Fieldnote', owner: { type: 'user' }, duplicated_template_id: null }));
    await callback('notion');
    const c = calls[0];
    expect(c.url).toBe('https://api.notion.com/v1/oauth/token');
    expect(hdr(c, 'authorization')).toBe('Basic ' + Buffer.from('ntn-client:ntn-secret').toString('base64'));
    expect(hdr(c, 'content-type')).toBe('application/json');
    expect(hdr(c, 'notion-version')).toBe('2026-03-11');
    expect(JSON.parse(String(c.init.body))).toEqual({ grant_type: 'authorization_code', code: 'the-code', redirect_uri: 'https://radar.thally.io/api/oauth/notion/callback' });
    expect(saved).toEqual([{ type: 'notion', creds: { access_token: 'ntn-at', refresh_token: 'ntn-rt', workspace: 'Fieldnote', workspace_id: 'ws1', bot_id: 'bot1' } }]);
  });
  it('an unconfigured app refuses to start with the "not available" copy', async () => {
    Object.assign(env, { notionClientId: '' });
    try { await expect(start('notion')).rejects.toMatchObject({ status: 503, code: 'oauth_unconfigured' }); } finally { Object.assign(env, { notionClientId: 'ntn-client' }); }
  });
});

describe('Webflow OAuth', () => {
  it('authorize URL asks only for the scopes Radar uses (no sites:write)', async () => {
    const u = new URL((await start('webflow')).url);
    expect(u.origin + u.pathname).toBe('https://webflow.com/oauth/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({ response_type: 'code', client_id: 'wf-client', redirect_uri: 'https://radar.thally.io/api/oauth/webflow/callback', scope: 'sites:read cms:read cms:write', state: 'st8' });
  });
  it('token exchange: form POST to api.webflow.com/oauth/access_token with the client secret and code', async () => {
    mockFetch(() => reply(200, { access_token: 'wf-at', token_type: 'bearer' }));
    await callback('webflow');
    expect(calls[0].url).toBe('https://api.webflow.com/oauth/access_token');
    expect(hdr(calls[0], 'content-type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(String(calls[0].init.body)))).toEqual({ client_id: 'wf-client', client_secret: 'wf-secret', code: 'the-code', grant_type: 'authorization_code', redirect_uri: 'https://radar.thally.io/api/oauth/webflow/callback' });
    expect(saved).toEqual([{ type: 'webflow', creds: { access_token: 'wf-at' } }]);
  });
  it('a refused exchange (invalid_grant) fails without storing anything', async () => {
    mockFetch(() => reply(400, { error: 'invalid_grant' }));
    await expect(callback('webflow')).rejects.toMatchObject({ http: 400 });
    expect(saved).toHaveLength(0);
  });
});

describe('Wix install flow', () => {
  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sign = (data: string, secret = 'wix-secret') => crypto.createHmac('sha256', secret).update(data).digest('base64url') + '.' + data;
  const ok = (o: any = {}) => sign(b64({ instanceId: 'inst-1', appDefId: 'wix-app', signDate: '2026-10-25T10:00:00.000Z', ...o }));
  const cb = (p: Record<string, string>) => callback('wix', '', { state: 'st8', appId: 'wix-app', tenantId: 'site-1', instanceId: 'inst-1', ...p });
  it('start sends the user to www.wix.com/app-installer with appId and postInstallationUrl = our callback carrying the state', async () => {
    const u = new URL((await start('wix')).url);
    expect(u.origin + u.pathname).toBe('https://www.wix.com/app-installer');
    expect(Object.fromEntries(u.searchParams)).toEqual({ appId: 'wix-app', postInstallationUrl: 'https://radar.thally.io/api/oauth/wix/callback?state=st8' });
    expect(new URL(u.searchParams.get('postInstallationUrl')!).searchParams.get('state')).toBe('st8');
    Object.assign(env, { wixShareUrlId: 'share-guid' });
    try { expect(new URL((await start('wix')).url).searchParams.get('shareUrlId')).toBe('share-guid'); } finally { Object.assign(env, { wixShareUrlId: '' }); }
  });
  it('a verified signedInstance stores the instanceId; no code exchange is made', async () => {
    mockFetch(() => reply(500));
    expect(await cb({ signedInstance: ok() })).toEqual({ ok: true, result: { oauthRef: 'pend_test' } });
    expect(saved).toEqual([{ type: 'wix', creds: { instanceId: 'inst-1' } }]);
    expect(calls).toHaveLength(0);
  });
  it('forged or mismatched callbacks are refused (instanceId alone is not proof of an install)', async () => {
    for (const p of <Record<string, string>[]>[
      { signedInstance: '' },
      { signedInstance: sign(b64({ instanceId: 'inst-1', appDefId: 'wix-app' }), 'other-secret') },
      { signedInstance: ok({ instanceId: 'someone-elses-site' }) },
      { signedInstance: ok({ appDefId: 'another-app' }) },
      { signedInstance: ok(), appId: 'another-app' },
      { signedInstance: ok(), instanceId: '' },
      { signedInstance: 'garbage' },
    ]) expect(await cb(p)).toEqual({ ok: false, error: 'no_instance' });
    expect(saved).toHaveLength(0);
  });
  it('wixInstanceOk checks the HMAC over the data segment with the app secret (base64url, no padding)', () => {
    expect(wixInstanceOk(ok(), 'inst-1')).toBe(true);
    const [s, d] = ok().split('.');
    expect(wixInstanceOk(s + '.' + d.slice(0, -2), 'inst-1')).toBe(false);
  });
});

describe('Shopify OAuth', () => {
  it('the HMAC check matches Shopify’s documented worked example (secret "hush")', () => {
    // From Shopify's OAuth guide (legacy shopify.dev/apps/auth/oauth; mirrored in hexdocs.pm/shopify_oauth); digest recomputed locally.
    const p = new URLSearchParams('code=0907a61c0c8d55e99db179b68161bc00&hmac=700e2dadb827fcc8609e9d5ce208b2e9cdaab9df07390d2cbca10d7c328fc4bf&shop=some-shop.myshopify.com&state=0.6784241404160823&timestamp=1337178173');
    expect(shopifyHmacOk(p, 'hush')).toBe(true);
    p.set('shop', 'other-shop.myshopify.com');
    expect(shopifyHmacOk(p, 'hush')).toBe(false);
  });
  it('params are sorted by code unit, not localeCompare (regression: uppercase/punctuation keys)', () => {
    const base: [string, string][] = [['code', 'c0de'], ['shop', 'fieldnote.myshopify.com'], ['state', 'st8'], ['timestamp', '1761386400'], ['X-extra', '1']];
    const mac = (pairs: [string, string][]) => crypto.createHmac('sha256', 'hush').update(pairs.map(([k, v]) => `${k}=${v}`).join('&')).digest('hex');
    const bytes = [...base].sort(([a], [b]) => (a < b ? -1 : 1)); const locale = [...base].sort(([a], [b]) => a.localeCompare(b));
    expect(bytes.map(x => x[0])).not.toEqual(locale.map(x => x[0]));
    expect(shopifyHmacOk(new URLSearchParams([...base, ['hmac', mac(bytes)]]), 'hush')).toBe(true);
    expect(shopifyHmacOk(new URLSearchParams([...base, ['hmac', mac(locale)]]), 'hush')).toBe(false);
  });
  it('start validates the myshopify.com domain (anchored) and asks for read_content,write_content', async () => {
    const r = await start('shopify', { shop: 'https://Fieldnote.myshopify.com/admin' });
    const u = new URL(r.url);
    expect(u.origin + u.pathname).toBe('https://fieldnote.myshopify.com/admin/oauth/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: 'shp-client', scope: 'read_content,write_content', redirect_uri: 'https://radar.thally.io/api/oauth/shopify/callback', state: 'st8' });
    expect(r.data).toEqual({ shop: 'fieldnote.myshopify.com' });
    for (const shop of ['fieldnote.com', 'fieldnote.myshopify.com.attacker.example', '-x.myshopify.com', ''])
      await expect(start('shopify', { shop })).rejects.toMatchObject({ status: 400, code: 'bad_shop' });
  });
  const signed = (o: Record<string, string>) => { const p = new URLSearchParams(o); p.set('hmac', crypto.createHmac('sha256', 'hush').update([...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&')).digest('hex')); return Object.fromEntries(p); };
  const P = { code: 'the-code', shop: 'fieldnote.myshopify.com', state: 'st8', timestamp: '1761386400', host: 'YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvZmllbGRub3Rl' };
  it('exchange: form-encoded with expiring=1; stores the access token, rotating refresh token, expiries, scope and shop', async () => {
    mockFetch(() => reply(200, { access_token: 'shpat_a', scope: 'read_content,write_content', expires_in: 3600, refresh_token: 'shprt_r', refresh_token_expires_in: 7776000 }));
    const now = Date.now();
    expect(await callback('shopify', '', signed(P), { shop: 'fieldnote.myshopify.com' })).toEqual({ ok: true, result: { oauthRef: 'pend_test' } });
    expect(calls[0].url).toBe('https://fieldnote.myshopify.com/admin/oauth/access_token');
    expect(hdr(calls[0], 'content-type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(String(calls[0].init.body)))).toEqual({ client_id: 'shp-client', client_secret: 'hush', code: 'the-code', expiring: '1' });
    const c = saved[0].creds;
    expect(c).toMatchObject({ access_token: 'shpat_a', refresh_token: 'shprt_r', scope: 'read_content,write_content', shop: 'fieldnote.myshopify.com' });
    expect(c.expires_at).toBeGreaterThanOrEqual(now + 3600e3);
    expect(c.refresh_expires_at).toBeGreaterThanOrEqual(now + 7776000e3);
  });
  it('a bad hmac, a different shop than the one started, or an invalid shop is refused before any exchange', async () => {
    mockFetch(() => reply(200, { access_token: 'x' }));
    expect(await callback('shopify', '', { ...signed(P), hmac: 'f'.repeat(64) }, { shop: 'fieldnote.myshopify.com' })).toEqual({ ok: false, error: 'invalid_shop' });
    expect(await callback('shopify', '', signed(P), { shop: 'other.myshopify.com' })).toEqual({ ok: false, error: 'invalid_shop' });
    expect(await callback('shopify', '', signed({ ...P, shop: 'fieldnote.myshopify.com.attacker.example' }), { shop: 'fieldnote.myshopify.com.attacker.example' })).toEqual({ ok: false, error: 'invalid_shop' });
    expect(calls).toHaveLength(0);
  });
  it('a grant without write_content is refused rather than stored', async () => {
    mockFetch(() => reply(200, { access_token: 'shpat_a', scope: 'read_content', expires_in: 3600, refresh_token: 'r' }));
    expect(await callback('shopify', '', signed(P), { shop: 'fieldnote.myshopify.com' })).toEqual({ ok: false, error: 'scope' });
    expect(saved).toHaveLength(0);
  });
});

describe('GitHub OAuth', () => {
  it('authorize URL: github.com/login/oauth/authorize with scope repo, state and no sign-up', async () => {
    const u = new URL((await start('github')).url);
    expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: 'gh-client', redirect_uri: 'https://radar.thally.io/api/oauth/github/callback', scope: 'repo', state: 'st8', allow_signup: 'false' });
  });
  it('token exchange asks for JSON and stores the token for the Next.js connector', async () => {
    mockFetch(() => reply(200, { access_token: 'gho_x', scope: 'repo', token_type: 'bearer' }));
    await callback('github');
    expect(calls[0].url).toBe('https://github.com/login/oauth/access_token');
    expect(hdr(calls[0], 'accept')).toBe('application/json');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ client_id: 'gh-client', client_secret: 'gh-secret', code: 'the-code', redirect_uri: 'https://radar.thally.io/api/oauth/github/callback' });
    expect(saved).toEqual([{ type: 'nextjs', creds: { access_token: 'gho_x' } }]);
  });
  it('GitHub reports exchange errors as 200 with an error field: refused, nothing stored', async () => {
    mockFetch(() => reply(200, { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' }));
    expect(await callback('github')).toEqual({ ok: false, error: 'bad_verification_code' });
    expect(saved).toHaveLength(0);
  });
});
