// Postgres rate limits (architecture §8, §16.9): windows, analysis limits for guests and users without access, the global
// breaker, guest creation. Each test uses its own IPs and domains and removes its rows.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { Fixtures, clearLimits, uniq, type TUser } from '../testing/fixtures';
import { POST as ACT } from '@/app/api/b/[bid]/act/route';
import { POST as CREATE } from '@/app/api/b/route';
import { COPY, DAY, HOUR, hit } from './rateLimit';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const RUN = uniq();
const ipBase = `10.66.${Math.floor(Math.random() * 250)}`;
let n = 0;
const freshIp = () => `${ipBase}.${(n++ % 250) + 1}`;
const as = async (u: TUser) => { H.jar.clear(); await F.signIn(u, H.jar); };
const analyze = async (bid: string, ip: string) => {
  const r = await ACT(new Request('http://t/act', { method: 'POST', body: JSON.stringify({ action: 'onboarding.analyze', input: {} }), headers: { 'x-forwarded-for': ip } }), { params: Promise.resolve({ bid }) });
  return { status: r.status, j: await r.json() as any };
};
const draftFor = async (u: TUser) => F.biz(u, { status: 'onboarding', domain: `rl-${RUN}-${uniq()}.test` });
afterEach(() => { delete process.env.RADAR_BILLING; delete process.env.RADAR_ANALYSIS_GLOBAL_PER_HOUR; H.jar.clear(); });

describe.skipIf(!ON)('rate limits (database)', () => {
  afterAll(async () => { await clearLimits(ipBase + '.'); await clearLimits(RUN); await F.cleanup(); });

  it('fixed windows: counts within a window, a new window starts at 1, hour and day never share a row', async () => {
    const k = `test:${RUN}:w`;
    expect(await hit(k, 2)).toBe(1); expect(await hit(k, 2)).toBeGreaterThanOrEqual(1);
    await new Promise(r => setTimeout(r, 2100));
    expect(await hit(k, 2)).toBe(1);
    expect([await hit(k, HOUR), await hit(k, HOUR), await hit(k, DAY)]).toEqual([1, 2, 1]);
    const rows = (await db.execute(sql`SELECT key, extract(epoch from window_start)::bigint AS s FROM rate_limits WHERE key LIKE ${k + '@%'} ORDER BY key`)).rows as any[];
    for (const r of rows) { const w = Number(r.key.split('@')[1]); expect(Number(r.s) % w).toBe(0); }
  });

  it('a guest is limited per IP per hour, with the flag off too; the 6th analysis is refused with copy', async () => {
    const g = await F.user({ guest: true }); await as(g);
    const d = await draftFor(g); const ip = freshIp();
    for (let i = 0; i < 5; i++) expect((await analyze(d.id, ip)).status).toBe(200);
    const r = await analyze(d.id, ip);
    expect([r.status, r.j.code, r.j.error]).toEqual([429, 'rate_limited', COPY.ipHour]);
    expect((await analyze(d.id, freshIp())).status).toBe(200);              // another address is fine
  });

  it('a signed-in user without access is limited the same way; with access not at all', async () => {
    process.env.RADAR_BILLING = 'on';
    const u = await F.user(); await as(u);
    const d = await draftFor(u); const ip = freshIp();
    for (let i = 0; i < 5; i++) expect((await analyze(d.id, ip)).status).toBe(200);
    expect((await analyze(d.id, ip)).j.code).toBe('rate_limited');
    await F.account(u.id, { status: 'trialing' });
    for (let i = 0; i < 3; i++) expect((await analyze(d.id, ip)).status).toBe(200);
    delete process.env.RADAR_BILLING; await F.account(u.id, { status: 'none' });
    expect((await analyze(d.id, ip)).status).toBe(200);                       // billing off: users have access
  });

  it('20 per IP per day, and 10 per domain per day across addresses', async () => {
    const g = await F.user({ guest: true }); await as(g);
    const d = await draftFor(g); const ip = freshIp();
    await db.execute(sql`INSERT INTO rate_limits (key, window_start, count) VALUES (${`analysis:ip:${ip}@${DAY}`}, to_timestamp(floor(extract(epoch from now()) / ${DAY}) * ${DAY}), 20)`);
    const day = await analyze(d.id, ip);
    expect([day.status, day.j.error]).toEqual([429, COPY.ipDay]);
    const d2 = await draftFor(g);
    await db.delete(schema.businesses).where(eq(schema.businesses.id, d.id));
    for (let i = 0; i < 10; i++) expect((await analyze(d2.id, freshIp())).status, `analysis ${i + 1}`).toBe(200);
    const dom = await analyze(d2.id, freshIp());
    expect([dom.status, dom.j.error]).toEqual([429, COPY.domain(d2.domain)]);
  });

  it('the global breaker answers 503 busy', async () => {
    const g = await F.user({ guest: true }); await as(g);
    const d = await draftFor(g);
    const cur = Number(((await db.execute(sql`SELECT count FROM rate_limits WHERE key = ${`analysis:global@${HOUR}`} AND window_start = to_timestamp(floor(extract(epoch from now()) / ${HOUR}) * ${HOUR})`)).rows[0] as any)?.count || 0);
    process.env.RADAR_ANALYSIS_GLOBAL_PER_HOUR = String(cur + 1);
    let last: any = null;
    for (let i = 0; i < 4 && last?.status !== 503; i++) last = await analyze(d.id, freshIp());
    expect([last.status, last.j.code, last.j.error]).toEqual([503, 'busy', COPY.busy]);
  });

  it('creating guests is limited to 10 per IP per hour', async () => {
    const ip = freshIp(); const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      H.jar.clear();
      const r = await CREATE(new Request('http://t/api/b', { method: 'POST', body: JSON.stringify({ domain: `rlg-${RUN}-${i}.test` }), headers: { 'x-forwarded-for': ip } }));
      const j = await r.json() as any; statuses.push(r.status);
      if (j.id) F.track((await db.select({ o: schema.businesses.ownerId }).from(schema.businesses).where(eq(schema.businesses.id, j.id)))[0].o);
      if (r.status === 429) expect(j.code).toBe('rate_limited');
    }
    expect(statuses).toEqual([...Array(10).fill(200), 429]);
  });
});
