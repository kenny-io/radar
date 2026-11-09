import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
const deliver = vi.hoisted(() => vi.fn(async (..._args: any[]) => {}));
vi.mock('../observability/delivery', () => ({ persistAndDeliverAlert: deliver }));
import { handle, json, requestJson } from './handle';
import { RadarError } from '../errors';
import { reportFailure, withFailureContext } from '../observability/failures';
beforeEach(() => { vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('RADAR_FAILURE_ALERTS', 'on'); vi.stubEnv('RADAR_DEV_STUBS', '0'); deliver.mockClear(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('HTTP failure boundary', () => {
  it('preserves generic client errors while reporting operational details without URL tokens', async () => {
    const response = await handle(async (_req: Request) => { throw new Error('database unavailable'); })(new Request('https://radar.test/api/invites/PRIVATE_TOKEN?token=PRIVATE_QUERY', { method: 'POST' }));
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ ok: false, error: 'Radar couldn’t finish this. Try again.', code: 'server' });
    expect(deliver).toHaveBeenCalledTimes(1);
    const event = deliver.mock.calls[0][0] as any; expect(event.context.requestId).toBeTruthy(); expect(event.context.operation).toBe('POST /api/invites/[token]');
    expect(JSON.stringify(event)).not.toContain('PRIVATE');
  });
  it('retains expected auth and validation responses without paging', async () => {
    const auth = await handle(async () => { throw new RadarError('Sign in', 401, 'unauthorized'); })();
    expect(auth.status).toBe(401); expect(await auth.json()).toMatchObject({ error: 'Sign in' });
    const validation = await handle(async () => { z.string().parse(42); return json({}); })();
    expect(validation.status).toBe(400); expect(deliver).not.toHaveBeenCalled();
  });
  it('deduplicates provider errors at HTTP parent while preserving action correlation', async () => {
    const error = new Error('provider unavailable');
    await handle(async () => withFailureContext({ source: 'action', operation: 'article.generate', businessId: 'authorized-biz' }, async () => {
      await reportFailure(error, { source: 'ai', operation: 'article.draft', provider: 'openrouter' }); throw error;
    }))();
    expect(deliver).toHaveBeenCalledTimes(1); expect((deliver.mock.calls[0][0] as any).context).toMatchObject({ businessId: 'authorized-biz', provider: 'openrouter' });
    expect((deliver.mock.calls[0][0] as any).rootOperation).toBe('article.generate');
  });
  it('returns a quiet 400 for malformed or aborted request JSON, preserving provider parse alerts', async () => {
    const parse = handle(async (req: Request) => { await requestJson(req); return json({ ok: true }); });
    const malformed = await parse(new Request('https://radar.test/api/act', { method: 'POST', body: '{broken' }));
    expect(malformed.status).toBe(400); expect(await malformed.json()).toMatchObject({ ok: false, code: 'invalid' });
    const aborted = await parse({ json: async () => { throw new DOMException('Client disconnected', 'AbortError'); } } as unknown as Request);
    expect(aborted.status).toBe(400); expect(deliver).not.toHaveBeenCalled();
    const provider = await handle(async () => { throw new SyntaxError('PRIVATE provider response is not valid JSON'); })();
    expect(provider.status).toBe(500); expect(deliver).toHaveBeenCalledTimes(1);
    expect((deliver.mock.calls[0][0] as any).error.message).toBe('Invalid JSON response');
  });
  it('does not hide internal request-body programming errors', async () => {
    const response = await handle(async () => { await requestJson({ json: async () => { throw new TypeError('Body already consumed'); } } as unknown as Request); return json({}); })();
    expect(response.status).toBe(500); expect(deliver).toHaveBeenCalledTimes(1);
  });
  it('reports operational RadarErrors without exposing providers to the client', async () => {
    const response = await handle(async () => { throw new RadarError('Try again', 502, 'ai_failed'); })();
    expect(response.status).toBe(502); expect(await response.json()).toEqual({ ok: false, error: 'Try again', code: 'ai_failed' }); expect(deliver).toHaveBeenCalledTimes(1);
  });
});
