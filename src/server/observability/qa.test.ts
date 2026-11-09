import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { reportFailure, sanitizeDiagnostic, withFailureContext } from './failures';
import { handle, requestJson } from '../http/handle';
import { RadarError } from '../errors';

// Independent acceptance checks intentionally use the real reporter and HTTP boundary.
// Database checks require an isolated migrated database and never contact a real email provider.
const databaseEnabled = !!process.env.DATABASE_URL;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('RADAR_FAILURE_ALERTS', databaseEnabled ? 'on' : 'off');
  vi.stubEnv('RADAR_DEV_STUBS', '0');
  vi.stubEnv('RESEND_API_KEY', 'qa-transport-only-never-real');
  vi.stubEnv('MAIL_FROM', 'Radar QA <qa@example.com>');
  vi.stubEnv('RADAR_BILLING', 'off');
  fetcher = vi.fn(async () => Response.json({ id: 'mock-email' }));
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(async () => { if (databaseEnabled) { const { pool } = await import('../db'); await pool.end(); } });

describe('independent API outcome and diagnostic acceptance', () => {
  it('keeps provider detail out of the user response and retains safe request correlation', async () => {
    const run = handle(async (_request: Request) => { throw Object.assign(new Error('HTTP 402: credits exhausted api_key=private-credential'), { status: 402 }); });
    const response = await run(new Request('http://radar.test/api/invites/private-invite-token?secret=private-query'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: 'Radar couldn’t finish this. Try again.', code: 'server' });
    const serializedLogs = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(serializedLogs).toContain('requestId');
    expect(serializedLogs).toContain('/api/invites/[token]');
    expect(serializedLogs).not.toMatch(/private-credential|private-invite-token|private-query/);
    if (databaseEnabled) expect(JSON.parse(fetcher.mock.calls[0][1].body).to).toEqual(['kenny@thally.io']);
  });

  it('does not alert for ordinary unauthorized or invalid field responses', async () => {
    const before = fetcher.mock.calls.length;
    for (const error of [new RadarError('Sign in', 401, 'unauthorized'), Object.assign(new Error('bad input'), { name: 'ZodError', issues: [] })]) {
      const response = await handle(async () => { throw error; })();
      expect([400, 401]).toContain(response.status);
    }
    expect(fetcher.mock.calls.length).toBe(before);
    expect(vi.mocked(console.error)).not.toHaveBeenCalled();
  });

  it('treats malformed or aborted request bodies as validation while still reporting provider JSON failures', async () => {
    const parse = handle(async (request: Request) => { await requestJson(request); return Response.json({ ok: true }); });
    const malformed = await parse(new Request('http://radar.test/api/b/example/act', { method: 'POST', body: '{' }));
    expect(malformed.status).toBe(400);
    expect(vi.mocked(console.error)).not.toHaveBeenCalled();
    const abort = { url: 'http://radar.test/api/example', method: 'POST', json: async () => { throw Object.assign(new Error('user aborted'), { name: 'AbortError' }); } } as unknown as Request;
    expect((await parse(abort)).status).toBe(400);
    expect(vi.mocked(console.error)).not.toHaveBeenCalled();
    const provider = await handle(async (_request: Request) => { throw new SyntaxError('Provider PRIVATE GENERATED OUTPUT is malformed JSON'); })(new Request('http://radar.test/api/example'));
    expect(provider.status).toBe(500);
    expect(vi.mocked(console.error)).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('PRIVATE GENERATED OUTPUT');
  });

  it('redacts signed URLs, basic auth, cookies, configured values and SyntaxError output', async () => {
    vi.stubEnv('CUSTOM_PROVIDER_SECRET', 'qa-secret-value');
    const raw = 'HTTP 503 Basic dXNlcjpwYXNz Cookie: radar_session=private-cookie';
    expect(sanitizeDiagnostic(raw)).not.toMatch(/dXNlcj|private-cookie/);
    expect(sanitizeDiagnostic('https://user:password@example.com/path?sig=private-sig#private-fragment qa-secret-value')).not.toMatch(/user:password|private-sig|private-fragment|qa-secret/);
    await reportFailure(new SyntaxError('Unexpected PRIVATE GENERATED OUTPUT'), { source: 'ai', operation: 'qa.output' });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('PRIVATE GENERATED OUTPUT');
  });
});

describe.skipIf(!databaseEnabled)('independent durable failure delivery against PostgreSQL', () => {
  it('persists a failed operation before sending, retries the same immutable envelope, and never recursively alerts on email failure', async () => {
    const { pool } = await import('../db');
    const { defineJob, enqueue, runJobNow } = await import('../jobs/queue');
    await import('./jobs');
    const kind = 'qa.failure.' + randomUUID();
    defineJob({ kind, maxAttempts: 3, run: async () => { throw new Error('Operation broke'); } });
    const original = await enqueue(kind, { privateInput: 'CUSTOMER SECRET INPUT' }, { maxAttempts: 3 });
    await pool.query("UPDATE jobs SET attempts=1,status='running' WHERE id=$1", [original]);
    fetcher.mockImplementation(async () => {
      const pending = await pool.query("SELECT id FROM jobs WHERE kind='observability.alert' AND payload->'event'->>'rootOperation'=$1", [kind]);
      expect(pending.rows).toHaveLength(1);
      return new Response('mock unavailable', { status: 503 });
    });
    await runJobNow(original);
    const first = await pool.query('SELECT status,attempts,error FROM jobs WHERE id=$1', [original]);
    expect(first.rows[0]).toMatchObject({ status: 'queued', attempts: 1, error: 'Radar couldn’t finish this. Try again.' });
    const pending = await pool.query("SELECT * FROM jobs WHERE kind='observability.alert' AND payload->'event'->>'rootOperation'=$1", [kind]);
    expect(pending.rows).toHaveLength(1);
    const alert = pending.rows[0];
    expect(alert.business_id).toBeNull();
    expect(alert.status).toBe('queued');
    expect(alert.payload.event.context.jobId).toBe(original);
    expect(alert.payload.event.context.attempt).toBe(1);
    expect(alert.payload.event.context.retrying).toBe(true);
    expect(JSON.stringify(alert.payload)).not.toContain('CUSTOMER SECRET INPUT');
    const originalBody = fetcher.mock.calls[0][1].body;
    const originalKey = fetcher.mock.calls[0][1].headers['Idempotency-Key'];
    fetcher.mockResolvedValue(new Response('again unavailable', { status: 503 }));
    await pool.query("UPDATE jobs SET attempts=1,status='running' WHERE id=$1", [alert.id]);
    await runJobNow(alert.id);
    const noRecursion = await pool.query("SELECT id FROM jobs WHERE kind='observability.alert' AND payload->'event'->>'rootOperation'=$1", [kind]);
    expect(noRecursion.rows).toHaveLength(1);
    expect(fetcher.mock.calls[1][1].body).toBe(originalBody);
    expect(fetcher.mock.calls[1][1].headers['Idempotency-Key']).toBe(originalKey);
    fetcher.mockResolvedValue(Response.json({ id: 'mock-accepted' }));
    vi.stubEnv('MAIL_FROM', 'Changed QA <changed@example.com>');
    await pool.query("UPDATE jobs SET attempts=2,status='running' WHERE id=$1", [alert.id]);
    await runJobNow(alert.id);
    const done = await pool.query('SELECT status,result FROM jobs WHERE id=$1', [alert.id]);
    expect(done.rows[0]).toMatchObject({ status: 'done', result: { accepted: true } });
    expect(fetcher.mock.calls[2][1].body).toBe(originalBody);
    expect(fetcher.mock.calls[2][1].headers['Idempotency-Key']).toBe(originalKey);
  });

  it('recovers queued alerts after missing sender configuration is repaired, then freezes the valid payload', async () => {
    const { pool } = await import('../db');
    const { runJobNow } = await import('../jobs/queue');
    await import('./jobs');
    const operation = 'qa.sender.' + randomUUID();
    vi.stubEnv('MAIL_FROM', '');
    await reportFailure(new Error('Operation failed while mail was unconfigured'), { source: 'system', operation });
    expect(fetcher).not.toHaveBeenCalled();
    const pending = await pool.query("SELECT * FROM jobs WHERE kind='observability.alert' AND payload->'event'->>'rootOperation'=$1", [operation]);
    const alert = pending.rows[0];
    expect(alert.status).toBe('queued');
    vi.stubEnv('MAIL_FROM', 'Fixed QA <fixed@example.com>');
    await pool.query("UPDATE jobs SET attempts=1,status='running' WHERE id=$1", [alert.id]);
    await runJobNow(alert.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).from).toBe('Fixed QA <fixed@example.com>');
    const repaired = await pool.query('SELECT status,payload FROM jobs WHERE id=$1', [alert.id]);
    expect(repaired.rows[0].status).toBe('done');
    expect(repaired.rows[0].payload.from).toBe('Fixed QA <fixed@example.com>');
    expect(repaired.rows[0].payload.key).toBe(alert.payload.key);
    expect(repaired.rows[0].payload.text).toBe(alert.payload.text);
  });

  it('preserves inherited business and request context and distinguishes separate failures in one action', async () => {
    const { pool } = await import('../db');
    const action = 'qa.context.' + randomUUID();
    await withFailureContext({ source: 'action', operation: action, businessId: 'business-test', requestId: 'request-test' }, async () => {
      const error = new Error('Provider credits exhausted');
      await reportFailure(error, { source: 'ai', operation: 'article.research', provider: 'openrouter', model: 'model-test', status: 402 });
      await reportFailure(Object.assign(new RadarError('Try again', 502), { cause: error }), { source: 'action', operation: action });
      await reportFailure(new Error('Storage failed separately'), { source: 'image', operation: 'image.store', businessId: undefined });
    });
    const rows = await pool.query("SELECT payload FROM jobs WHERE kind='observability.alert' AND payload->'event'->>'rootOperation'=$1", [action]);
    expect(rows.rows).toHaveLength(2);
    for (const { payload } of rows.rows) expect(payload.event.context).toMatchObject({ businessId: 'business-test', requestId: 'request-test' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('captures scheduler hook failures while allowing later hooks to run', async () => {
    const { pool } = await import('../db');
    const { defineCron, tick } = await import('../jobs/cron');
    const operation = 'qa.cron.' + randomUUID();
    const later = vi.fn(async () => {});
    defineCron(operation, async () => { throw new Error('Scheduler stage failed'); });
    defineCron(operation + '.later', later);
    await tick();
    expect(later).toHaveBeenCalledTimes(1);
    const rows = await pool.query("SELECT payload FROM jobs WHERE kind='observability.alert' AND payload->'event'->>'rootOperation'=$1", [operation]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].payload.event.context.source).toBe('cron');
  });
});
