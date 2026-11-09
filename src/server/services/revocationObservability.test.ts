import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const report = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}));
vi.mock('@/server/observability/failures', () => ({ reportFailure: report }));
import { revoke } from './gsc/client';
import { xAdapter } from './social/publish/x';
import { liAdapter } from './social/publish/linkedin';

beforeEach(() => { report.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('remote token cleanup failures keep disconnect available', () => {
  for (const [provider, run] of [
    ['Google', () => revoke({ access_token: 'private-access-token' } as any)],
    ['X', () => xAdapter.revoke({ access_token: 'private-access-token' })],
    ['LinkedIn', () => liAdapter('profile').revoke({ access_token: 'private-access-token' })],
  ] as const) {
    it(`reports ${provider} HTTP revocation failure without rejecting local disconnect or copying tokens`, async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('private-response', { status: 503 })));
      await expect(run()).resolves.toBeUndefined();
      expect(report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ provider, status: 503, degraded: true }));
      expect(JSON.stringify(report.mock.calls)).not.toMatch(/private-access-token|private-response/);
    });
    it(`reports ${provider} network failure without rejecting local disconnect`, async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network unavailable'); }));
      await expect(run()).resolves.toBeUndefined();
      expect(report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ provider, degraded: true }));
    });
  }
  it('keeps absent and development Google tokens quiet', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await revoke(null); await revoke({ stub: true, access_token: 'private-access-token' } as any);
    expect(fetch).not.toHaveBeenCalled(); expect(report).not.toHaveBeenCalled();
  });
});
