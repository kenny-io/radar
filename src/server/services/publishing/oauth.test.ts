// WordPress.com and Notion OAuth providers against a mocked fetch: authorize URLs and token exchanges must match
// developer.wordpress.com/docs/api/oauth2/ and developers.notion.com/docs/authorization. Pending tokens are captured, not stored.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const saved: { type: string; creds: Record<string, any> }[] = [];
vi.mock('./store', () => ({ savePending: vi.fn(async (_bid: string, _uid: string | null, type: string, creds: Record<string, any>) => { saved.push({ type, creds }); return 'pend_test'; }) }));

import { env } from '@/server/env';
import { oauthProvider } from '@/server/oauth/registry';
import './oauth';

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const reply = (status: number, body: any = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function mockFetch(fn: (url: string, init: RequestInit) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => { calls.push({ url: String(url), init }); return fn(String(url), init); }));
}
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];
const user = { id: 'u1' } as any;
const start = (p: string) => oauthProvider(p)!.start({ user, bid: 'b1', state: 'st8', redirectUri: `https://radar.thally.io/api/oauth/${p}/callback`, params: new URLSearchParams() });
const callback = (p: string, code = 'the-code') => oauthProvider(p)!.callback({ user, bid: 'b1', data: {}, redirectUri: `https://radar.thally.io/api/oauth/${p}/callback`, params: new URLSearchParams({ code, state: 'st8' }) });

const ENV = { devStubs: env.devStubs, wpcomClientId: env.wpcomClientId, wpcomClientSecret: env.wpcomClientSecret, notionClientId: env.notionClientId, notionClientSecret: env.notionClientSecret };
beforeAll(() => { Object.assign(env, { devStubs: false, wpcomClientId: '12345', wpcomClientSecret: 'wp-secret', notionClientId: 'ntn-client', notionClientSecret: 'ntn-secret' }); });
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
