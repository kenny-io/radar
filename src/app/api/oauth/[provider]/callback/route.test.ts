import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ state: null as any, actor: { id: 'user' } as any, callback: vi.fn(), deleted: vi.fn(), report: vi.fn() }));
vi.mock('@/server/db', () => ({ schema: { oauthStates: { state: 'state' } }, db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.state ? [mocks.state] : [] }) }) }),
  delete: () => ({ where: async () => { mocks.deleted(); mocks.state = null; } }),
} }));
vi.mock('@/server/auth/session', () => ({ currentActor: async () => mocks.actor }));
vi.mock('@/server/env', () => ({ oauthRedirect: (provider: string) => `https://radar.test/api/oauth/${provider}/callback` }));
vi.mock('@/server/oauth/registry', () => ({ oauthProvider: () => ({ callback: mocks.callback }) }));
vi.mock('@/server/oauth/providers', () => ({}));
vi.mock('@/server/observability/failures', () => ({ reportFailure: mocks.report }));
import { GET } from './route';
const flow = 'a9c0b6db-5909-4c67-b057-10446a375136', other = 'c95210b5-76ef-4e69-ab23-c4aee612a0b2';
const request = (query = '', provider = 'youtube') => GET(new Request(`https://radar.test/api/oauth/${provider}/callback?state=csrf&code=provider-code${query}`), { params: Promise.resolve({ provider }) });
beforeEach(() => { vi.clearAllMocks(); mocks.state = { provider: 'youtube', businessId: 'business', userId: 'user', data: { v: 'encrypted-verifier', q: { radar_flow: flow } } }; mocks.actor = { id: 'user' }; mocks.callback.mockResolvedValue({ ok: true, result: { oauthRef: 'opaque-ref' } }); });
describe('OAuth callback flow binding', () => {
  it('derives the return nonce from consumed saved state, never callback parameters', async () => {
    const html = await (await request(`&radar_flow=${other}`)).text();
    expect(html).toContain(flow); expect(html).not.toContain(other); expect(mocks.deleted).toHaveBeenCalledOnce();
    expect(mocks.callback).toHaveBeenCalledWith(expect.objectContaining({ bid: 'business', user: { id: 'user' }, redirectUri: 'https://radar.test/api/oauth/youtube/callback', data: expect.objectContaining({ v: 'encrypted-verifier' }) }));
    const replay = await (await request(`&radar_flow=${other}`)).text();
    expect(replay).toContain('invalid_state'); expect(replay).not.toContain(other); expect(mocks.callback).toHaveBeenCalledOnce();
  });
  it('does not bind an invalid or wrong-provider state to a supplied nonce', async () => {
    const html = await (await request(`&radar_flow=${other}`, 'instagram')).text();
    expect(html).toContain('invalid_state'); expect(html).not.toContain(other); expect(html).not.toContain(flow);
    expect(mocks.deleted).not.toHaveBeenCalled(); expect(mocks.callback).not.toHaveBeenCalled();
  });
  it('rejects a changed session, consumes state, and returns the saved nonce for actionable failure', async () => {
    mocks.actor = { id: 'different-user' };
    const html = await (await request()).text();
    expect(html).toContain('session'); expect(html).toContain(flow); expect(mocks.callback).not.toHaveBeenCalled(); expect(mocks.deleted).toHaveBeenCalledOnce();
  });
  it('returns a correlated denial without exchanging or trusting a supplied nonce', async () => {
    const html = await (await request(`&error=access_denied&radar_flow=${other}`)).text();
    expect(html).toContain('access_denied'); expect(html).toContain(flow); expect(html).not.toContain(other); expect(mocks.callback).not.toHaveBeenCalled();
  });
  it('returns a correlated generic failure without exposing provider exceptions', async () => {
    mocks.callback.mockRejectedValue(new Error('private provider diagnostic')); vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = await (await request()).text();
    expect(html).toContain('exchange_failed'); expect(html).toContain(flow); expect(html).not.toContain('private provider diagnostic'); expect(mocks.report).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
