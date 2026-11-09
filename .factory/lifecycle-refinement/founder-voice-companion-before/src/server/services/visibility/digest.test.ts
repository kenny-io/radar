import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const m = vi.hoisted(() => ({ rows: [] as any[], run: null as any, cron: null as any, send: vi.fn(), summary: vi.fn(), payloads: [] as any[], marks: new Set<string>(), leftJoin: vi.fn(), conditions: [] as any[] }));
vi.mock('@/server/jobs/queue', () => ({ defineJob: (j: any) => { m.run = j.run; } }));
vi.mock('@/server/jobs/cron', () => ({ defineCron: (_: string, run: any) => { m.cron = run; } }));
vi.mock('@/server/services/mail', () => ({ sendMail: m.send }));
vi.mock('./history', () => ({ visibilitySummary: m.summary }));
vi.mock('@/server/db', async () => {
  const schema = await import('@/server/db/schema');
  const query = () => {
    const q: any = { from: () => q, innerJoin: () => q, leftJoin: (...a: any[]) => { m.leftJoin(...a); return q; }, where: (condition: any) => { m.conditions.push(condition); return q; }, limit: () => q, then: (resolve: any) => Promise.resolve(m.rows).then(resolve) };
    return q;
  };
  const tx: any = { select: query, insert: (table: any) => ({ values: (value: any) => {
    if (table === schema.jobs) m.payloads.push(value.payload);
    return { onConflictDoNothing: () => ({ returning: async () => { if (m.marks.has(value.key)) return []; m.marks.add(value.key); return [value]; } }) };
  } }) };
  return { schema, db: { ...tx, transaction: (fn: any) => fn(tx) } };
});
import './digest';
const owner = { weekly: null, email: 'owner@example.test', guest: false };
const payload = { bid: 'b', ownerId: 'u', to: owner.email, subject: 'subject', text: 'old frozen text', key: 'existing-key' };
beforeEach(() => { m.rows = []; m.conditions = []; m.payloads = []; m.marks.clear(); m.send.mockClear(); m.leftJoin.mockClear(); m.summary.mockClear(); m.summary.mockResolvedValue({ weekly: { start: '2026-11-02', end: '2026-11-09', current: { share: 0.5, mentioned: 1, collected: 2 }, previous: { share: null, mentioned: 0, collected: 0 }, delta: null }, weeklyBiggestMiss: null }); });
describe('weekly report default-on dispatch', () => {
  it('allows missing preferences and preserves old retry payload and key', async () => {
    m.rows = [owner]; await m.run({ payload });
    expect(m.send).toHaveBeenCalledWith(payload.to, payload.subject, payload.text, undefined, { idempotencyKey: payload.key });
    expect(m.leftJoin).toHaveBeenCalledOnce();
    const where = new PgDialect().sqlToQuery(m.conditions[0]);
    expect(where.sql).toContain('"businesses"."owner_id"');
    expect(where.params).toEqual(['b', 'u', 'active']);
  });
  it.each([[{ ...owner, weekly: false }], [{ ...owner, guest: true }], [{ ...owner, email: 'new@example.test' }], []])('suppresses explicit optout, guest, recipient or ownership change: %j', async (...rows) => {
    m.rows = rows[0] ? rows : []; await m.run({ payload }); expect(m.send).not.toHaveBeenCalled();
  });
  it('uses default-on query, freezes both bodies and dedupes repeated Monday ticks', async () => {
    m.rows = [{ id: 'b', ownerId: 'u', domain: 'example.test', email: owner.email, guest: false }];
    await m.cron(new Date('2026-11-09T08:00:00Z')); await m.cron(new Date('2026-11-09T09:00:00Z'));
    expect(new PgDialect().sqlToQuery(m.conditions[0]).sql).toContain('coalesce("visibility_preferences"."weekly_email", true)');
    expect(m.leftJoin).toHaveBeenCalledTimes(2); expect(m.payloads).toHaveLength(1);
    expect(m.payloads[0].text).toContain('Email preferences:'); expect(m.payloads[0].html).toContain('>Email preferences</a>');
    m.rows = [owner]; await m.run({ payload: m.payloads[0] });
    expect(m.send.mock.calls[0][3]).toBe(m.payloads[0].html);
  });
  it('does not queue without collected answers or before Monday cadence', async () => {
    m.rows = [{ id: 'b', ownerId: 'u', domain: 'test', email: owner.email, guest: false }];
    await m.cron(new Date('2026-11-09T07:00:00Z')); expect(m.summary).not.toHaveBeenCalled();
    m.summary.mockResolvedValueOnce({ weekly: { current: { collected: 0 } } });
    await m.cron(new Date('2026-11-09T08:00:00Z')); expect(m.payloads).toEqual([]);
  });
});
