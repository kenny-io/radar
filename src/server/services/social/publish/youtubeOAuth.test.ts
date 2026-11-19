import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ save: vi.fn(), role: vi.fn() }));
vi.mock('./accounts', () => ({ savePendingSocial: mocks.save }));
vi.mock('../../../access', () => ({ requireRole: mocks.role }));
vi.mock('../../../workspace', () => ({ getBiz: vi.fn() }));
vi.mock('../../../flags', () => ({ socialOn: vi.fn() }));
import { env } from '../../../env';
import { encrypt } from '../../../crypto';
import { oauthProvider } from '../../../oauth/registry';
import './oauth';
import { YOUTUBE_SCOPES } from './youtube';
const saved = { ...env }; const response = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
let calls: string[];
const callback = () => oauthProvider('youtube')!.callback({ user: { id: 'owner' } as any, bid: 'owned-business', data: { v: encrypt('pkce-verifier') }, redirectUri: 'https://radar.test/api/oauth/youtube/callback', params: new URLSearchParams({ code: 'provider-code' }) });
function endpoints(token: Response, channel: Response) { vi.stubGlobal('fetch', vi.fn(async (url: any) => { calls.push(String(url)); return calls.length === 1 ? token : channel; })); }
beforeEach(() => { calls = []; env.devStubs = false; env.secretKey = '11'.repeat(32); mocks.role.mockResolvedValue('Owner'); mocks.save.mockResolvedValue('opaque-pending-ref'); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Object.assign(env, saved); vi.clearAllMocks(); });
describe('YouTube callback actionable failure and pending grant', () => {
  it('returns only the opaque grant reference after token, scopes and channel succeed', async () => {
    endpoints(response({ access_token: 'private-access', refresh_token: 'private-refresh', scope: YOUTUBE_SCOPES }), response({ items: [{ id: 'channel-id', snippet: { title: 'My channel', customUrl: '@mine' } }] }));
    expect(await callback()).toEqual({ ok: true, result: { oauthRef: 'opaque-pending-ref', ch: 'youtube' } });
    expect(mocks.save).toHaveBeenCalledWith('owned-business', 'owner', 'youtube', expect.objectContaining({ id: { remoteId: 'channel-id', name: 'My channel', handle: '@mine' } }));
  });
  it('reports an exchange failure without saving any pending authorization', async () => {
    endpoints(response({ error: 'invalid_grant' }, 400), response({}));
    expect(await callback()).toEqual({ ok: false, error: 'exchange_failed' }); expect(mocks.save).not.toHaveBeenCalled(); expect(calls).toHaveLength(1);
  });
  it('reports a missing channel distinctly without saving an authorization', async () => {
    endpoints(response({ access_token: 'private-access', scope: YOUTUBE_SCOPES }), response({ items: [] }));
    expect(await callback()).toEqual({ ok: false, error: 'youtube_channel_missing' }); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('rejects partial known scopes before trying channel discovery or storing a grant', async () => {
    endpoints(response({ access_token: 'private-access', scope: 'https://www.googleapis.com/auth/youtube.upload' }), response({ items: [{ id: 'channel' }] }));
    expect(await callback()).toEqual({ ok: false, error: 'scope_denied' }); expect(mocks.save).not.toHaveBeenCalled(); expect(calls).toHaveLength(1);
  });
  it('does not mislabel a provider HTTP failure as a missing channel', async () => {
    endpoints(response({ access_token: 'private-access', scope: YOUTUBE_SCOPES }), response({ error: 'forbidden' }, 403));
    expect(await callback()).toEqual({ ok: false, error: 'exchange_failed' }); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('still requires the owner session role before exchanging any provider code', async () => {
    mocks.role.mockRejectedValue(new Error('not a member')); endpoints(response({}), response({}));
    expect(await callback()).toEqual({ ok: false, error: 'forbidden' }); expect(calls).toHaveLength(0); expect(mocks.save).not.toHaveBeenCalled();
  });
});
