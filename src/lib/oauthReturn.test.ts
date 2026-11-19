import { describe, expect, it } from 'vitest';
import { oauthErrorCopy, oauthFlow, OAUTH_RETURN_TTL_MS, validOAuthReturn } from './oauthReturn';
const flow = 'a9c0b6db-5909-4c67-b057-10446a375136';
describe('OAuth return validation and feedback', () => {
  it('accepts only a fresh nonce-correlated public result', () => {
    const result = { type: 'radar-oauth', provider: 'youtube', flow, ok: true, at: 2000 };
    expect(validOAuthReturn(result, 'youtube', flow, 1000, 3000)).toBe(true);
    for (const change of [{ at: NaN }, { at: Infinity }, { at: 999 }, { at: 4001 }, { ok: 'yes' }, { type: 'other' }, { provider: 'tiktok' }, { flow: 'other' }]) expect(validOAuthReturn({ ...result, ...change }, 'youtube', flow, 1000, 3000)).toBe(false);
    expect(validOAuthReturn(result, 'youtube', flow, 1000, 2001 + OAUTH_RETURN_TTL_MS)).toBe(false);
    expect(oauthFlow(flow)).toBe(flow); expect(oauthFlow('untrusted')).toBeUndefined();
  });
  it('gives read-only guidance for Search Console and specific YouTube recovery', () => {
    expect(oauthErrorCopy('Google Search Console', 'scope_denied')).toContain('read-only Search Console');
    expect(oauthErrorCopy('Google Search Console', 'scope_denied')).not.toContain('publish');
    expect(oauthErrorCopy('YouTube', 'scope_denied')).toContain('all requested permissions');
    expect(oauthErrorCopy('YouTube', 'youtube_channel_missing')).toContain('Choose an account with a channel');
    expect(oauthErrorCopy('YouTube', 'timeout')).toContain('10 minutes');
    expect(oauthErrorCopy('YouTube', 'blocked')).toContain('Allow pop-up windows');
    expect(oauthErrorCopy('YouTube', 'private error with credentials')).not.toContain('credentials');
  });
});
