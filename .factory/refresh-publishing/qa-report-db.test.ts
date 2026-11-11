import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://postgres:radar@localhost:54329/radar_refresh_report_qa';
  return { env: { resendKey: 'qa-only-mocked-key', mailFrom: 'Radar QA <qa@fixture.example>', devStubs: false }, send: vi.fn() };
});
vi.mock('@/server/env', () => ({ env: M.env }));
vi.mock('@/server/abuse/rateLimit', () => ({ enforce: vi.fn(async () => {}), HOUR: 3600, DAY: 86400 }));
import { pool } from '../../src/server/db';
import { reportPublishingIssue } from '../../src/server/services/publishing/reportIssue';
const fixture = JSON.parse(fs.readFileSync('.data/refresh-publishing/report-ui/fixture.json', 'utf8'));
let ctx: any;
let attempt = 100;
beforeEach(async () => {
  M.send.mockReset(); Object.assign(M.env, { resendKey: 'qa-only-mocked-key', mailFrom: 'Radar QA <qa@fixture.example>', devStubs: false });
  const business = (await pool.query('SELECT * FROM businesses WHERE id=$1', [fixture.businessId])).rows[0];
  ctx = { bid: fixture.businessId, biz: { ...business, profile: business.profile }, user: { ...fixture.users.Owner, name: 'Synthetic QA Owner' }, role: 'Owner', actor: { guest: false } };
  await pool.query("UPDATE calendar_entries SET status='failed',publish_attempts=$2 WHERE id=$1", [fixture.entries.local, ++attempt]);
  await pool.query("INSERT INTO jobs(id,business_id,kind,ref,status,error,finished_at) VALUES($1,$2,'publish.entry',$3,'failed','Synthetic local failure',now())", [randomUUID(), fixture.businessId, fixture.entries.local]);
  M.send.mockImplementation(async (url: string) => { expect(url).toBe('https://api.resend.com/emails'); return { ok: true, json: async () => ({ id: 'synthetic-provider-receipt' }) }; });
  vi.stubGlobal('fetch', M.send);
});
afterAll(async () => { vi.unstubAllGlobals(); await pool.end(); });

describe('independent real-PostgreSQL reporting integration with mocked mail transport only', () => {
  it('serializes concurrent teammates into one confirmed provider attempt and immutable outbox row', async () => {
    const viewer = { ...ctx, user: { ...fixture.users.Viewer, name: 'Synthetic QA Viewer' }, role: 'Viewer' };
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => reportPublishingIssue(i % 2 ? viewer : ctx, fixture.entries.local)));
    expect(new Set(responses.map(r => r.reference)).size).toBe(1); expect(responses.every(r => r.delivered)).toBe(true); expect(M.send).toHaveBeenCalledTimes(1);
    const row = (await pool.query('SELECT * FROM outbox_emails WHERE id=$1', [responses[0].reference])).rows[0];
    expect(row).toMatchObject({ to: 'kenny@thally.io', subject: 'User Reported Issue on Radar', status: 'sent' }); expect(row.sent_at).toBeTruthy();
    expect(row.text).not.toContain('complete synthetic article stays available'); expect(row.text).not.toContain('QA_PRIVATE_UNKNOWN_FIELD');
    M.env.resendKey = ''; expect(await reportPublishingIssue(viewer, fixture.entries.local)).toEqual(responses[0]); expect(M.send).toHaveBeenCalledTimes(1);
  });
  it('reuses identical persisted body and idempotency key after an uncertain send across teammates', async () => {
    M.send.mockRejectedValueOnce(new Error('Synthetic timeout containing private-provider-output'));
    await expect(reportPublishingIssue(ctx, fixture.entries.local)).rejects.toMatchObject({ status: 502 });
    const first = M.send.mock.calls[0][1];
    const next = await reportPublishingIssue({ ...ctx, user: { ...fixture.users.Viewer, name: 'Later teammate' } }, fixture.entries.local);
    expect(next.delivered).toBe(true); expect(M.send.mock.calls[1][1].body).toBe(first.body); expect(M.send.mock.calls[1][1].headers['Idempotency-Key']).toBe(first.headers['Idempotency-Key']);
    expect((await pool.query('SELECT error,status FROM outbox_emails WHERE id=$1', [next.reference])).rows[0]).toEqual({ error: null, status: 'sent' });
  });
  it('does not confirm an empty receipt and permits a retry using the same outbox record', async () => {
    M.send.mockResolvedValueOnce({ ok: true, json: async () => ({ id: '  ' }) });
    await expect(reportPublishingIssue(ctx, fixture.entries.local)).rejects.toMatchObject({ status: 502 });
    const key = M.send.mock.calls[0][1].headers['Idempotency-Key']; const reference = key.replace('radar-publishing-report-', '');
    expect((await pool.query('SELECT status FROM outbox_emails WHERE id=$1', [reference])).rows[0].status).toBe('failed');
    expect(await reportPublishingIssue(ctx, fixture.entries.local)).toEqual({ delivered: true, reference }); expect(M.send.mock.calls[1][1].headers['Idempotency-Key']).toBe(key);
  });
  it('with stubs enabled logs locally without calling mail even when a key exists', async () => {
    M.env.devStubs = true;
    const result = await reportPublishingIssue(ctx, fixture.entries.local); expect(result.delivered).toBe(false); expect(M.send).not.toHaveBeenCalled();
    expect((await pool.query('SELECT status,sent_at FROM outbox_emails WHERE id=$1', [result.reference])).rows[0]).toEqual({ status: 'logged', sent_at: null });
  });
});
