// §21.5: queued work for an active business whose owner has no access is skipped; drafts, paid accounts, billing off and
// social.send still run.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; });

import { inArray } from 'drizzle-orm';
import { db, schema } from '../db';
import { Fixtures } from '../testing/fixtures';
import { defineJob, enqueue, getJob, runJobNow } from './queue';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const ran: string[] = [];
const KIND = 'test.billingSkip';
defineJob({ kind: KIND, run: async ctx => { ran.push(ctx.businessId!); return { ok: true }; } });
defineJob({ kind: 'social.send', run: async ctx => { ran.push('send:' + ctx.businessId); return { ok: true }; } });
const jobs: string[] = [];
const run = async (bid: string, kind = KIND) => { const id = await enqueue(kind, {}, { businessId: bid }); jobs.push(id); await runJobNow(id); return getJob(id); };
afterEach(() => { delete process.env.RADAR_BILLING; ran.length = 0; });

describe.skipIf(!ON)('job skip for lapsed businesses (database)', () => {
  afterAll(async () => { if (jobs.length) await db.delete(schema.jobs).where(inArray(schema.jobs.id, jobs)); await F.cleanup(); });

  it('skips with {skipped: no_access} when billing is on and the owner has no access', async () => {
    const u = await F.user(); const b = await F.biz(u);
    process.env.RADAR_BILLING = 'on';
    const j = await run(b.id);
    expect([j!.status, j!.result]).toEqual(['done', { skipped: 'no_access' }]);
    expect(ran).toEqual([]);
    expect((await run(b.id, 'social.send'))!.result).toEqual({ ok: true });   // already scheduled by the user
    await F.account(u.id, { status: 'trialing' });
    expect((await run(b.id))!.result).toEqual({ ok: true });
  });

  it('runs for drafts (guest analysis), with billing off, and for an email list that does not name the owner', async () => {
    const u = await F.user(); const d = await F.biz(u, { status: 'onboarding' }); const b = await F.biz(u);
    process.env.RADAR_BILLING = 'on';
    expect((await run(d.id))!.result).toEqual({ ok: true });
    delete process.env.RADAR_BILLING;
    expect((await run(b.id))!.result).toEqual({ ok: true });
    process.env.RADAR_BILLING = 'someone-else@test.local';
    expect((await run(b.id))!.result).toEqual({ ok: true });
    process.env.RADAR_BILLING = u.email;
    expect((await run(b.id))!.result).toEqual({ skipped: 'no_access' });
  });
});
