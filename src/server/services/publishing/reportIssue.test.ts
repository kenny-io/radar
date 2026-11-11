import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const M = vi.hoisted(() => ({ env: { resendKey: 'key', mailFrom: 'Radar <hello@example.com>', devStubs: false }, entry: null as any, job: null as any, rows: new Map<string, any>(), fetch: vi.fn(), enforce: vi.fn(), selection: [] as any[], insert: vi.fn(), tail: Promise.resolve() }));
vi.mock('@/server/env', () => ({ env: M.env }));
vi.mock('@/server/abuse/rateLimit', () => ({ enforce: M.enforce, HOUR: 3600, DAY: 86400 }));
vi.mock('@/server/db', async () => {
  const schema = await import('@/server/db/schema');
  const dialect = new PgDialect();
  const select = (fields?: any) => ({ from: (table: any) => {
    let params: any[] = [];
    const q: any = { where: (condition: any) => { params = dialect.sqlToQuery(condition).params; return q; }, orderBy: () => q, limit: async () => {
      M.selection.push({ table, fields, params });
      if (table === schema.calendarEntries) return M.entry && params.includes(M.entry.id) && params.includes(M.entry.businessId) ? [M.entry] : [];
      if (table === schema.jobs) return M.job && params.includes(M.job.businessId) && params.includes(M.entry.id) && params.includes('publish.entry') ? [{ id: M.job.id }] : [];
      if (table === schema.connections) return [{ id: 'connection-1', type: 'nextjs', url: 'https://github.com/team/site?token=private', targetId: 'team/site' }];
      if (table === schema.outboxEmails) return M.rows.has(params[0]) ? [M.rows.get(params[0])] : [];
      return [];
    } }; return q;
  } });
  const tx = {
    select, execute: vi.fn(async () => {}),
    update: () => ({ set: (values: any) => ({ where: async (condition: any) => Object.assign(M.rows.get(String(dialect.sqlToQuery(condition).params[0])), values) }) }),
  };
  return { schema, db: {
    select,
    insert: (...args: any[]) => { M.insert(...args); return { values: (value: any) => ({ onConflictDoNothing: async () => { if (!M.rows.has(value.id)) M.rows.set(value.id, { ...value, status: 'queued', createdAt: new Date() }); } }) }; },
    transaction: async (fn: any, options?: any) => {
      if (options?.accessMode === 'read only') return fn(tx);
      const before = M.tail; let release!: () => void;
      M.tail = new Promise(resolve => { release = resolve; });
      await before; try { return await fn(tx); } finally { release(); }
    },
  } };
});
import { schema } from '@/server/db';
import { RadarError } from '@/server/errors';
import { reportPublishingIssue, reportIncidentId, reportDiagnostic, ISSUE_TO, ISSUE_SUBJECT } from './reportIssue';
const ctx: any = { bid: 'business-1', user: { id: 'user-1', name: 'Owner', email: 'owner@example.com' }, biz: { id: 'business-1', domain: 'example.com', blog: {}, profile: { business: { name: 'Example' } } }, role: 'Viewer', actor: { guest: false } };
beforeEach(() => {
  vi.clearAllMocks(); M.rows.clear(); M.selection = []; M.tail = Promise.resolve();
  Object.assign(M.env, { resendKey: 'key', mailFrom: 'Radar <hello@example.com>', devStubs: false });
  M.entry = { id: 'entry-1', businessId: ctx.bid, title: 'Failed guide', mode: 'refresh', status: 'failed', url: '/guide?token=private#section', publishAttempts: 2, publishError: { http: 422, platform: 'GitHub', message: 'Validation failed', hint: 'Source integration incomplete', diagnostic: { code: 'plan-empty', stage: 'plan', reason: 'Missing renderer', path: 'src/renderer.ts' }, articleBody: 'NEVER INCLUDE BODY', credentials: 'NEVER INCLUDE CREDENTIALS' } };
  M.job = { id: 'job-1', businessId: ctx.bid };
  M.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'accepted-provider-id' }) });
  M.enforce.mockResolvedValue(undefined); vi.stubGlobal('fetch', M.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.REPORT_TEST_SECRET; });

describe('explicit publication issue reports', () => {
  it('sends server-read context to the fixed recipient and exact subject, without article/body/credentials', async () => {
    process.env.REPORT_TEST_SECRET = 'actual-secret-value';
    M.entry.publishError.hint = 'Bearer token-value secret=actual-secret-value ghp_' + 'A'.repeat(36);
    const result = await reportPublishingIssue(ctx, 'entry-1');
    expect(result.delivered).toBe(true);
    const [url, options] = M.fetch.mock.calls[0]; const body = JSON.parse(options.body);
    expect(url).toBe('https://api.resend.com/emails'); expect(options.signal).toBeTruthy();
    expect(body).toMatchObject({ to: ['kenny@thally.io'], subject: 'User Reported Issue on Radar', reply_to: 'owner@example.com' });
    expect(body.text).toContain('plan-empty'); expect(body.text).toContain('src/renderer.ts');
    expect(body.text).toContain('job-1'); expect(body.text).toContain('Failed guide');
    for (const text of ['NEVER INCLUDE BODY', 'NEVER INCLUDE CREDENTIALS', 'actual-secret-value', 'token-value', 'private', 'ghp_']) expect(body.text).not.toContain(text);
    expect(body.html).toBeUndefined(); expect(body.text.length).toBeLessThanOrEqual(10000);
    expect(M.selection.find(read => read.table === schema.connections)?.fields).not.toHaveProperty('credentialsEnc');
    expect(M.selection.find(read => read.table === schema.calendarEntries)?.fields).not.toHaveProperty('publishRemote');
    expect(M.selection.find(read => read.table === schema.jobs)?.fields).toEqual({ id: schema.jobs.id });
    expect(options.headers['Idempotency-Key']).toBe('radar-publishing-report-' + result.reference);
    expect(M.rows.get(result.reference).status).toBe('sent');
    const limits = M.enforce.mock.calls[0][0]; expect(limits.map((limit: any) => [limit.limit, limit.windowSec])).toEqual([[5, 3600], [10, 86400], [15, 3600]]);
  });

  it('never sends on a cross-business or missing/nonfailed entry, or for guests', async () => {
    await expect(reportPublishingIssue({ ...ctx, bid: 'other-business' }, 'entry-1')).rejects.toMatchObject({ status: 404 });
    await expect(reportPublishingIssue(ctx, 'other-entry')).rejects.toMatchObject({ status: 404 });
    await expect(reportPublishingIssue({ ...ctx, actor: { guest: true } }, 'entry-1')).rejects.toMatchObject({ status: 404 });
    M.entry.status = 'published'; await expect(reportPublishingIssue(ctx, 'entry-1')).rejects.toMatchObject({ status: 409 });
    M.entry.status = 'failed'; M.entry.publishError = null; await expect(reportPublishingIssue(ctx, 'entry-1')).rejects.toMatchObject({ status: 409 });
    expect(M.insert).not.toHaveBeenCalled(); expect(M.fetch).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent clicks, reloads and teammates while acknowledging confirmed reports without new quota', async () => {
    const teammate = { ...ctx, user: { id: 'user-2', name: 'Teammate', email: 'teammate@example.com' } };
    const [one, two] = await Promise.all([reportPublishingIssue(ctx, 'entry-1'), reportPublishingIssue(teammate, 'entry-1')]);
    expect(two).toEqual(one); expect(M.fetch).toHaveBeenCalledTimes(1); expect(M.enforce).toHaveBeenCalledTimes(1);
    M.env.resendKey = ''; M.env.mailFrom = '';
    expect(await reportPublishingIssue(teammate, 'entry-1')).toEqual(one);
    expect(M.fetch).toHaveBeenCalledTimes(1); expect(M.rows.get(one.reference).text).toContain('Contact name: Owner');
  });

  it('freezes sender and first reporter payload across ambiguous retries and changed article metadata', async () => {
    M.fetch.mockRejectedValueOnce(new Error('secret provider response'));
    await expect(reportPublishingIssue(ctx, 'entry-1')).rejects.toMatchObject({ status: 502 });
    const row = [...M.rows.values()][0]; expect(row.error).toBe('Issue report delivery could not be confirmed');
    M.entry.title = 'Later edit'; M.env.mailFrom = 'New sender <new@example.com>';
    await reportPublishingIssue({ ...ctx, user: { ...ctx.user, email: 'teammate@example.com', name: 'Teammate' } }, 'entry-1');
    const first = M.fetch.mock.calls[0][1]; const retry = M.fetch.mock.calls[1][1];
    expect(retry.body).toBe(first.body); expect(retry.headers['Idempotency-Key']).toBe(first.headers['Idempotency-Key']);
    expect(JSON.parse(retry.body)).toMatchObject({ from: 'Radar <hello@example.com>', reply_to: 'owner@example.com' });
  });

  it('creates a distinct incident for a fresh failed publishing job even if the failure is identical', async () => {
    const first = await reportPublishingIssue(ctx, 'entry-1'); M.job.id = 'job-2';
    const next = await reportPublishingIssue(ctx, 'entry-1');
    expect(next.reference).not.toBe(first.reference); expect(M.fetch).toHaveBeenCalledTimes(2);
    expect(reportIncidentId('b', 'e', null, 1, {})).toBe(reportIncidentId('b', 'e', null, 1, {}));
  });

  it('captures stubs without network with a real key and never claims delivery', async () => {
    M.env.devStubs = true;
    const result = await reportPublishingIssue(ctx, 'entry-1');
    expect(result.delivered).toBe(false); expect(M.rows.get(result.reference).status).toBe('logged');
    await reportPublishingIssue(ctx, 'entry-1'); expect(M.fetch).not.toHaveBeenCalled(); expect(M.enforce).not.toHaveBeenCalled();
  });

  it.each([{ resendKey: '' }, { mailFrom: '' }, { mailFrom: 'bad' }, { mailFrom: 'Radar <hello@radar.local>' }, { mailFrom: 'Radar <a@b.test>\nBcc:attacker@b.test' }])('fails before freezing an unusable new mail configuration %j', async change => {
    Object.assign(M.env, change);
    await expect(reportPublishingIssue(ctx, 'entry-1')).rejects.toMatchObject({ status: 503 });
    expect(M.insert).not.toHaveBeenCalled(); expect(M.fetch).not.toHaveBeenCalled();
  });

  it.each([{}, { id: '' }, { id: '  ' }])('never confirms an empty provider acceptance %j', async receipt => {
    M.fetch.mockResolvedValueOnce({ ok: true, json: async () => receipt });
    await expect(reportPublishingIssue(ctx, 'entry-1')).rejects.toMatchObject({ status: 502 });
    expect([...M.rows.values()][0].status).toBe('failed');
    expect(await reportPublishingIssue(ctx, 'entry-1')).toMatchObject({ delivered: true });
  });

  it('holds an uncertain report beyond 23 hours but acknowledges old confirmed reports', async () => {
    M.fetch.mockResolvedValueOnce({ ok: false });
    await expect(reportPublishingIssue(ctx, 'entry-1')).rejects.toMatchObject({ status: 502 });
    const row = [...M.rows.values()][0]; row.createdAt = new Date(Date.now() - 24 * 3600_000);
    await expect(reportPublishingIssue(ctx, 'entry-1')).rejects.toMatchObject({ status: 409, code: 'report_expired' });
    expect(M.fetch).toHaveBeenCalledTimes(1);
    row.status = 'sent'; expect(await reportPublishingIssue(ctx, 'entry-1')).toMatchObject({ delivered: true });
  });

  it('does not expose storage/provider output and rate-limit failures do not send', async () => {
    M.enforce.mockRejectedValueOnce(new RadarError('Several reports. Try later.', 429, 'rate_limited'));
    await expect(reportPublishingIssue(ctx, 'entry-1')).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
    M.insert.mockImplementationOnce(() => { throw new Error('SQL contains private report text'); });
    await expect(reportPublishingIssue(ctx, 'entry-1')).rejects.toMatchObject({ status: 502, message: expect.not.stringContaining('private report text') });
    expect(M.fetch).not.toHaveBeenCalled();
  });

  it('bounds and allowlists technical diagnostics', () => {
    const diagnostic = reportDiagnostic({ hint: 'x'.repeat(5000), body: 'secret', diagnostic: { code: 'test', stage: 'plan', reason: 'x'.repeat(5000), source: 'private source', issues: Array(20).fill('x'.repeat(2000)) } });
    expect(diagnostic.hint.length).toBeLessThanOrEqual(1200);
    expect(diagnostic.diagnostic?.issues).toHaveLength(3);
    expect(JSON.stringify(diagnostic)).not.toContain('private source');
  });
});
