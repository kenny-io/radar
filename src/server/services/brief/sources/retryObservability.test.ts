import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ report: vi.fn(async (_error: unknown, _context: unknown) => {}), fetch: vi.fn() }));
vi.mock('@/server/observability/failures', () => ({ reportFailure: H.report }));
vi.mock('@/server/ai/adapters/http', () => ({ fetchJson: H.fetch }));
vi.mock('@/server/env', () => ({ env: { redditClientId: 'test-id', redditClientSecret: 'test-secret', redditUserAgent: 'test-agent' } }));
import { withRetry } from './types';
import { redditSource } from './reddit';

beforeEach(() => { H.report.mockClear(); H.fetch.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('configured Brief source retry observability', () => {
  it('reports a transient provider failure before backoff, even when its next attempt succeeds', async () => {
    vi.useFakeTimers();
    const failure = Object.assign(new Error('HTTP 503 unavailable'), { status: 503 });
    const request = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({ results: [] });
    const context = { source: 'brief' as const, operation: 'brief.search', businessId: 'business-1', provider: 'Perplexity' };
    const result = withRetry(request, 2, context);
    await vi.advanceTimersByTimeAsync(0);
    expect(H.report).toHaveBeenCalledExactlyOnceWith(failure, { ...context, attempt: 1, maxAttempts: 2, retrying: true });
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(699);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ results: [] });
    expect(request).toHaveBeenCalledTimes(2);
    expect(H.report).toHaveBeenCalledTimes(1);
  });

  it('reports a swallowed Reddit rules failure with provider/business context while retaining the safe empty result', async () => {
    const failure = Object.assign(new Error('HTTP 403 provider account denied'), { status: 403, permanent: true });
    H.fetch.mockImplementation(async (url: string) => {
      if (url.includes('/access_token')) return { access_token: 'test-access-token', expires_in: 3600 };
      if (url.includes('/about/rules')) throw failure;
      return { data: { children: [] } };
    });
    const result = await redditSource({ bid: 'business-1', profile: { audience: { segments: [] } }, plan: { subreddits: ['test'], terms: [], queries: [] }, sinceMs: Date.now(), onRead: vi.fn(), setSub: vi.fn() } as any);
    expect(result).toEqual([]);
    expect(H.report).toHaveBeenCalledExactlyOnceWith(failure, { source: 'brief', operation: 'brief.redditRequest', businessId: 'business-1', provider: 'Reddit', degraded: true, attempt: 1, maxAttempts: 2, retrying: false });
    expect(JSON.stringify(H.report.mock.calls[0][1])).not.toMatch(/oauth\.reddit|raw_json|access.token|test-secret/);
  });
});
