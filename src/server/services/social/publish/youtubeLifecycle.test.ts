import { afterEach, describe, expect, it, vi } from 'vitest';
import { youtubeAdapter, youtubeMe, youtubeRead } from './youtube';
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('YouTube authorization lifecycle classification', () => {
  it.each([['invalid_grant', 'revoked', true], ['invalid_client', 'configuration', false], ['unauthorized_client', 'configuration', false], ['invalid_request', 'retry', false]])('classifies %s without broad revocation or raw provider data', async (code, reason, definitive) => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: code, error_description: 'CANARY-PRIVATE-DATA' }, 400)));
    await expect(youtubeAdapter.refresh({ access_token: 'a', refresh_token: 'r' })).rejects.toMatchObject({ reason, definitive });
    try { await youtubeAdapter.refresh({ access_token: 'a', refresh_token: 'r' }); } catch (e: any) { expect(e.message).not.toContain('CANARY'); }
  });
  it('preserves profile age and hold across OAuth rotation without pretending profile was read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ access_token: 'new', expires_in: 3600 })));
    const youtube = { profileFetchedAt: 1234, authorizationCheckedAt: 1200, verificationHold: 'configuration' as const };
    const next = await youtubeAdapter.refresh({ access_token: 'a', refresh_token: 'r', youtube });
    expect(next.youtube).toMatchObject({ profileFetchedAt: 1234, verificationHold: 'configuration' }); expect(next.youtube!.authorizationCheckedAt).toBeGreaterThan(1200);
  });
  it.each([429, 500, 503])('treats HTTP %i as retry, without deleting an otherwise valid grant', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => response({}, status)));
    await expect(youtubeAdapter.refresh({ access_token: 'a', refresh_token: 'r' })).rejects.toMatchObject({ reason: 'retry', definitive: false });
  });
  it('classifies API-disabled and quota failures separately and requests no extra channel data', async () => {
    const fetch = vi.fn(async (_url: any) => response({ error: { errors: [{ reason: 'accessNotConfigured' }] } }, 403)); vi.stubGlobal('fetch', fetch);
    await expect(youtubeMe('a')).rejects.toMatchObject({ reason: 'configuration' });
    expect(String(fetch.mock.calls[0][0])).toContain('fields=items(id,snippet(title,customUrl))');
    fetch.mockImplementation(async () => response({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403));
    await expect(youtubeMe('a')).rejects.toMatchObject({ reason: 'retry' });
  });
  it.each(['invalid_token', 'invalid_grant'])('accepts revoke %s as already removed', async error => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error }, 400)));
    await expect(youtubeAdapter.revoke({ access_token: 'a' })).resolves.toBeUndefined();
  });
  it('bounds body consumption as well as response headers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => ({ status: 200, headers: new Headers(), text: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) })));
    const request = youtubeRead('https://www.googleapis.com/youtube/v3/channels', {}); const assertion = expect(request).rejects.toMatchObject({ reason: 'retry' });
    await vi.advanceTimersByTimeAsync(15_000); await assertion;
  });
});
