import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../../env';
import { instagramAdapter, instagramAdapterFor, instagramUnifiedExchange } from './instagram';
import { instagramStart, scopesOk } from './oauth';
import { adapterFor, channelsAvailable } from './accounts';
import type { AcctCtx, Tokens } from './api';

const saved = { ...env };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const state = { mode: 'unified' as const, appId: '1610310810347180', configId: '1509864327716679', apiVersion: 'v27.0' };
const unified = (): Tokens => ({ access_token: 'system-token', refresh_token: null, expires_at: null, instagram: { mode: 'unified', apiVersion: 'v27.0', configId: state.configId, clientBusinessId: '1234' } });
const acct: AcctCtx = { ch: 'instagram', remoteId: '9002', handle: '@second', token: 'system-token' };
let calls: { url: string; init: RequestInit }[];
function mock(fn: (url: string, init: RequestInit) => Response) { vi.stubGlobal('fetch', vi.fn(async (url: any, init: RequestInit = {}) => { calls.push({ url: String(url), init }); return fn(String(url), init); })); }
beforeEach(() => { calls = []; Object.assign(env, { devStubs: false, metaAppId: state.appId, metaAppSecret: 'meta-test-secret', instagramConfigId: state.configId, metaGraphApiVersion: 'v27.0', instagramClientId: 'legacy-id', instagramClientSecret: 'legacy-secret' }); });
afterEach(() => { Object.assign(env, saved); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Instagram Unified Login authorization', () => {
  const context = { bid: 'business', user: { id: 'user' } as any, state: 'csrf-state', redirectUri: 'https://radar.example/api/oauth/instagram/callback', params: new URLSearchParams({ config_id: 'untrusted-query' }) };
  it('gates the new channel on all Meta credentials/config and pins mode/config in server-owned state', () => {
    const start = instagramStart(context); const url = new URL(start.url);
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v27.0/dialog/oauth');
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: state.appId, config_id: state.configId, redirect_uri: context.redirectUri, response_type: 'code', state: context.state, display: 'popup', prompt: 'login', override_default_response_type: 'true' });
    expect(start.data.instagram).toEqual(state); expect(start.url).not.toContain('secret'); expect(url.searchParams.has('scope')).toBe(false);
    Object.assign(env, { instagramClientId: '', instagramClientSecret: '' }); expect(channelsAvailable()).toContain('instagram');
    env.instagramConfigId = ''; expect(channelsAvailable()).not.toContain('instagram'); expect(() => instagramStart(context)).toThrow();
  });
  it('retains legacy starts when Unified Login is not configured and validates the right scope family', () => {
    env.instagramConfigId = '';
    const start = instagramStart(context);
    expect(new URL(start.url).host).toBe('www.instagram.com'); expect(start.data.instagram.mode).toBe('instagram');
    expect(scopesOk('instagram', 'instagram_basic,instagram_content_publish', 'unified')).toBe(true);
    expect(scopesOk('instagram', 'instagram_basic', 'unified')).toBe(false);
    expect(scopesOk('instagram', 'instagram_business_basic,instagram_business_content_publish', 'unified')).toBe(false);
    expect(scopesOk('instagram', 'instagram_basic,instagram_content_publish')).toBe(false);
  });
  it('exchanges with Meta credentials, keeps Never SUAT metadata and discovers every shared account without choosing the first', async () => {
    mock(url => {
      const u = new URL(url);
      if (u.pathname.endsWith('/oauth/access_token')) { expect(u.searchParams.get('client_id')).toBe(state.appId); expect(u.searchParams.get('client_secret')).toBe('meta-test-secret'); expect(u.searchParams.get('redirect_uri')).toBe(context.redirectUri); return reply({ access_token: 'system-token', expires_in: 0, scope: 'instagram_basic,instagram_content_publish' }); }
      if (u.pathname.endsWith('/me')) return reply({ id: 'system-user-not-ig-account', client_business_id: '1234' });
      expect(u.pathname.endsWith('/me/assigned_instagram_accounts')).toBe(true);
      return u.searchParams.has('after') ? reply({ data: [{ id: '9002', username: 'second' }] }) : reply({ data: [{ id: '9001', username: 'first' }], paging: { next: 'https://untrusted.example/not-followed', cursors: { after: 'next-cursor' } } });
    });
    const result = await instagramUnifiedExchange('auth-code', context.redirectUri, state);
    expect(result.tokens).toEqual({ ...unified(), refresh_expires_at: null, scope: 'instagram_basic,instagram_content_publish' });
    expect(result.identities.map(a => a.remoteId)).toEqual(['9001', '9002']);
    expect(calls).toHaveLength(4); expect(calls.every(c => new URL(c.url).host === 'graph.facebook.com')).toBe(true);
    expect(calls.filter(c => c.url.includes('/assigned_')).every(c => c.init.headers && new Headers(c.init.headers).get('authorization') === 'Bearer system-token')).toBe(true);
    expect(calls.some(c => c.url.includes('ig_exchange_token') || c.url.includes('graph.instagram.com'))).toBe(false);
  });
  it('preserves expiring configurations and refuses missing business identity, invalid pagination or changed app credentials', async () => {
    mock(url => url.includes('/oauth/access_token') ? reply({ access_token: 'system-token', expires_in: 3600 }) : reply({ id: 'only-system-user' }));
    await expect(instagramUnifiedExchange('code', context.redirectUri, state)).rejects.toThrow('business identity');
    calls = []; env.metaAppId = 'different-app';
    await expect(instagramUnifiedExchange('code', context.redirectUri, state)).rejects.toThrow('configuration changed'); expect(calls).toHaveLength(0);
    env.metaAppId = state.appId;
    mock(url => url.includes('/oauth/access_token') ? reply({ access_token: 'system-token', expires_in: 3600 }) : url.includes('assigned_') ? reply({ data: [], paging: { next: 'https://example.test', cursors: {} } }) : reply({ client_business_id: '1234' }));
    await expect(instagramUnifiedExchange('code', context.redirectUri, state)).rejects.toThrow('pagination');
  });
});

describe('Instagram per-grant publishing compatibility', () => {
  it('uses the saved Unified graph host/version and selected IG id for container/status/publish/permalink', async () => {
    env.metaGraphApiVersion = 'v99.0';
    const progress = vi.fn(async () => {});
    mock(url => {
      if (url.endsWith('/9002/media')) return reply({ id: '123' });
      if (url.includes('status_code')) { expect(progress).toHaveBeenCalledWith('123'); return reply({ status_code: 'FINISHED' }); }
      if (url.endsWith('/9002/media_publish')) return reply({ id: '456' });
      return reply({ permalink: 'https://www.instagram.com/p/published/' });
    });
    const result = await adapterFor('instagram', unified()).publish!(acct, { text: 'caption', images: [{ bytes: Buffer.from('jpeg'), type: 'image/jpeg', url: 'https://media.example/pic.jpg' }], progress });
    expect(result).toEqual({ remoteId: '456', url: 'https://www.instagram.com/p/published/' });
    expect(calls.every(c => c.url.startsWith('https://graph.facebook.com/v27.0/'))).toBe(true);
  });
  it('preserves an existing legacy grant’s API version through token renewal', async () => {
    env.instagramApiVersion = 'v99.0';
    const legacy: Tokens = { access_token: 'old-legacy', refresh_token: 'old-legacy', instagram: { mode: 'instagram', apiVersion: 'v24.0' } };
    mock(() => reply({ access_token: 'renewed-legacy', expires_in: 5184000 }));
    const refreshed = await instagramAdapterFor(legacy).refresh(legacy);
    expect(refreshed.instagram).toEqual({ mode: 'instagram', apiVersion: 'v24.0' });
    calls = []; mock(() => reply({ status_code: 'IN_PROGRESS' }));
    await instagramAdapterFor(refreshed).resume!(acct, '123');
    expect(calls[0].url).toContain('https://graph.instagram.com/v24.0/');
  });
  it('does not send Unified grants through legacy refresh/revocation and preserves legacy adapters', async () => {
    mock(() => { throw new Error('unexpected network'); });
    const adapter = instagramAdapterFor(unified());
    await expect(adapter.refresh(unified())).rejects.toMatchObject({ definitive: true });
    await adapter.revoke(unified()); expect(calls).toHaveLength(0);
    expect(adapterFor('instagram', { access_token: 'old-token' } as Tokens)).toBe(instagramAdapter);
    mock(() => reply({ status_code: 'IN_PROGRESS' }));
    await instagramAdapter.resume!(acct, '123'); expect(calls.at(-1)!.url).toContain('https://graph.instagram.com/');
  });
});
