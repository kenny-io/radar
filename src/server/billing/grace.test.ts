// Past-due grace (first-five architecture §5, BE-1) and the notice the banner and trial chip read (BE-2, BE-3).
// The clock starts only on active → past_due, lasts RADAR_PAST_DUE_GRACE_HOURS (48 h by default) and is the same
// predicate under every gate and the job queue. Database tests run on the stub provider through the real routes.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { Fixtures, clearLimits, type TUser } from '../testing/fixtures';
import { account, billing, card as stubCard, Deliveries } from '../testing/billing';
import { PAST_DUE_GRACE_HOURS } from '@/lib/billing';
import { accountGrants, bizAccess, graceEndsAt, graceMs, inGrace, ownAccess } from './access';
import { billingNoticeOf } from './notice';
import { billingOverview } from './overview';
import { stubReset, stubSetStatus, stubState } from './stub';
import { gateBusiness } from '../access';
import { defineJob, enqueue, getJob, runJobNow } from '../jobs/queue';
import { POST as ACT } from '@/app/api/b/[bid]/act/route';
import { GET as WORKSPACE } from '@/app/api/b/[bid]/workspace/route';

const ON = !!process.env.DATABASE_URL;
const HOUR = 3600e3;
const F = new Fixtures();
const D = new Deliveries();
const as = async (u: TUser) => { H.jar.clear(); await F.signIn(u, H.jar); };
const card = () => stubCard(7000, 8500);
const p = (bid: string) => ({ params: Promise.resolve({ bid }) });
const ws = async (bid: string) => { const r = await WORKSPACE(new Request('http://t/w'), p(bid)); return { status: r.status, j: await r.json() as any }; };
const act = async (bid: string, action: string, input: any = {}) => { const r = await ACT(new Request('http://t/act', { method: 'POST', body: JSON.stringify({ action, input }) }), p(bid)); return { status: r.status, j: await r.json() as any }; };
const backdate = (uid: string, hours: number) => db.update(schema.billingAccounts).set({ pastDueAt: new Date(Date.now() - hours * HOUR) }).where(eq(schema.billingAccounts.userId, uid));

afterEach(() => { delete process.env.RADAR_PAST_DUE_GRACE_HOURS; delete process.env.RADAR_BILLING; H.jar.clear(); });

describe('the grace predicate (no database)', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const row = (hoursAgo: number | null, o: Partial<{ comp: boolean; status: any }> = {}) => ({ comp: false, status: 'past_due' as const, pastDueAt: hoursAgo == null ? null : new Date(now - hoursAgo * HOUR), ...o });

  it('keeps access for 48 hours after the payment failed: yes at 47 h, no at 49 h, no at exactly 48 h', () => {
    expect(PAST_DUE_GRACE_HOURS).toBe(48);
    expect(accountGrants(row(47), now)).toBe(true);
    expect(accountGrants(row(49), now)).toBe(false);
    expect(accountGrants(row(48), now)).toBe(false);
    expect(accountGrants(row(47.999), now)).toBe(true);
    expect(graceEndsAt(row(47))!.getTime()).toBe(now + HOUR);
  });

  it('RADAR_PAST_DUE_GRACE_HOURS is read at call time; 0 restores the immediate lock; anything unusable means 48', () => {
    process.env.RADAR_PAST_DUE_GRACE_HOURS = '72';
    expect(accountGrants(row(49), now)).toBe(true);
    expect(accountGrants(row(73), now)).toBe(false);
    process.env.RADAR_PAST_DUE_GRACE_HOURS = '1';
    expect(accountGrants(row(2), now)).toBe(false);
    process.env.RADAR_PAST_DUE_GRACE_HOURS = '0';
    expect(graceMs()).toBe(0);
    expect(accountGrants(row(0), now)).toBe(false);
    expect(inGrace(row(0), now)).toBe(false);
    for (const junk of ['', '  ', 'two days', '-5', 'NaN']) { process.env.RADAR_PAST_DUE_GRACE_HOURS = junk; expect(graceMs(), junk).toBe(48 * HOUR); }
  });

  it('only a past-due account with a clock is in grace; every other state answers as before', () => {
    expect(accountGrants(row(null), now)).toBe(false);                        // a failed first charge, or past due before this shipped
    expect(graceEndsAt(row(null))).toBeNull();
    for (const status of ['unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused', 'none'])
      expect(accountGrants(row(1, { status }), now), status).toBe(false);     // a stale timestamp never grants
    expect(accountGrants(row(null, { status: 'active' }), now)).toBe(true);
    expect(accountGrants(row(null, { status: 'trialing' }), now)).toBe(true);
    expect(accountGrants(row(500, { comp: true }), now)).toBe(true);
    expect(accountGrants(null, now)).toBe(false);
  });
});

describe.skipIf(!ON)('past-due grace (stub, database)', () => {
  beforeEach(() => { process.env.RADAR_BILLING = 'on'; stubReset(); });
  afterAll(async () => { await D.cleanup(); await clearLimits('10.88.'); for (const id of F.users) await clearLimits(id); await F.cleanup(); });

  /** A signed-in user on a stub trial. */
  async function trialing() {
    const u = await F.user(); await as(u);
    const s = await billing.start(await card()); await billing.confirmIntent(s.j.paymentIntentId);
    expect((await billing.confirm({ paymentIntentId: s.j.paymentIntentId })).status).toBe(200);
    return u;
  }
  /** …whose first charge went through. */
  async function paying() { const u = await trialing(); expect((await billing.simulate('active')).j.state).toMatchObject({ access: true, status: 'active' }); return u; }

  it('active → past_due starts the clock and keeps access; 49 hours later the account is locked as before', async () => {
    const u = await paying();
    expect((await account(u.id)).pastDueAt).toBeNull();
    const before = Date.now();
    const r = await billing.simulate('past_due');
    expect(r.j.state).toMatchObject({ access: true, status: 'past_due', mode: 'none', needsRestart: false });
    const a = await account(u.id);
    expect(a.pastDueAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(a.pastDueAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(await ownAccess(u)).toBe(true);
    await backdate(u.id, 47);
    expect((await billing.state()).j).toMatchObject({ access: true, mode: 'none' });
    await backdate(u.id, 49);
    expect((await billing.state()).j).toMatchObject({ access: false, status: 'past_due', mode: 'restart', needsRestart: true });
    expect(await ownAccess(u)).toBe(false);
  });

  it('a first charge that fails at the end of the trial (trialing → past_due) gets no grace', async () => {
    const u = await trialing();
    const r = await billing.simulate('past_due');
    expect(r.j.state).toMatchObject({ access: false, status: 'past_due', mode: 'restart' });
    expect((await account(u.id)).pastDueAt).toBeNull();
    // The dev backdating knob only moves a clock that exists: it cannot hand out a grace.
    expect((await billing.simulate('past_due', 1)).j.state).toMatchObject({ access: false });
    expect((await account(u.id)).pastDueAt).toBeNull();
  });

  it('an account that was already past due (no clock) stays locked when a later webhook syncs it', async () => {
    const u = await paying();
    const sub = (await account(u.id)).stripeSubscriptionId!;
    // As it was before this shipped: past due on the account and at the provider, past_due_at NULL.
    stubSetStatus(sub, 'past_due');
    await db.update(schema.billingAccounts).set({ status: 'past_due', pastDueAt: null }).where(eq(schema.billingAccounts.userId, u.id));
    const s = stubState().subs.get(sub)!;
    expect(await D.deliver('customer.subscription.updated', { id: sub, object: 'subscription', customer: s.customer, status: s.status })).toBe('processed');
    expect(await account(u.id)).toMatchObject({ status: 'past_due', pastDueAt: null });
    expect((await billing.state()).j).toMatchObject({ access: false, mode: 'restart' });
  });

  it('a later sync while still past due keeps the original clock (a webhook cannot extend the grace)', async () => {
    const u = await paying();
    await billing.simulate('past_due'); await backdate(u.id, 30);
    const at = (await account(u.id)).pastDueAt!.getTime();
    await billing.simulate('past_due');
    expect((await account(u.id)).pastDueAt!.getTime()).toBe(at);
  });

  it('active → past_due → active → past_due starts a new grace; paying clears the clock', async () => {
    const u = await paying();
    await billing.simulate('past_due'); await backdate(u.id, 49);
    expect((await billing.state()).j.access).toBe(false);
    expect((await billing.simulate('active')).j.state).toMatchObject({ access: true, status: 'active' });
    expect((await account(u.id)).pastDueAt).toBeNull();
    const before = Date.now();
    expect((await billing.simulate('past_due')).j.state).toMatchObject({ access: true, status: 'past_due' });
    expect((await account(u.id)).pastDueAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('unpaid and canceled clear the clock and lock at once', async () => {
    for (const end of ['unpaid', 'canceled'] as const) {
      const u = await paying();
      await billing.simulate('past_due');
      expect((await billing.simulate(end)).j.state).toMatchObject({ access: false, status: end });
      expect((await account(u.id)).pastDueAt).toBeNull();
    }
  });

  it('RADAR_PAST_DUE_GRACE_HOURS=0: a fresh failure locks immediately', async () => {
    process.env.RADAR_PAST_DUE_GRACE_HOURS = '0';
    await paying();
    expect((await billing.simulate('past_due')).j.state).toMatchObject({ access: false, status: 'past_due', mode: 'restart' });
  });

  it('the dev backdating knob moves an existing clock so expiry can be tested', async () => {
    const u = await paying();
    expect((await billing.simulate('past_due', 47)).j.state).toMatchObject({ access: true });
    expect(Math.abs(Date.now() - 47 * HOUR - (await account(u.id)).pastDueAt!.getTime())).toBeLessThan(5000);
    expect((await billing.simulate('past_due', 49)).j.state).toMatchObject({ access: false, mode: 'restart' });
  });

  it('the app gates let the owner and a member in during grace and answer 402 after it', async () => {
    const owner = await paying(); const member = await F.user();
    const b = await F.biz(owner); await F.member(b.id, member, 'Editor');
    await as(owner); await billing.simulate('past_due');
    for (const who of [owner, member]) {
      await as(who);
      await expect(gateBusiness({ ...who, guest: false }, b.id)).resolves.toMatchObject({ id: b.id });
      expect((await ws(b.id)).status).toBe(200);
      expect((await act(b.id, 'feature.request', { text: 'Grace check' })).status).toBe(200);
    }
    expect(await bizAccess(b)).toBe(true);
    await backdate(owner.id, 49);
    for (const who of [owner, member]) {
      await as(who);
      await expect(gateBusiness({ ...who, guest: false }, b.id)).rejects.toMatchObject({ status: 402, code: 'subscription_required' });
      expect(await ws(b.id)).toMatchObject({ status: 402, j: { code: 'subscription_required' } });
      expect(await act(b.id, 'feature.request', { text: 'Locked' })).toMatchObject({ status: 402, j: { code: 'subscription_required' } });
    }
    expect(await bizAccess(b)).toBe(false);
  });

  it('background jobs run during grace and are skipped after it', async () => {
    const owner = await paying(); const b = await F.biz(owner);
    await billing.simulate('past_due');
    const kind = 'test.grace.' + F.tag; let ran = 0;
    defineJob({ kind, maxAttempts: 1, run: async () => { ran++; return { ok: true }; } });
    const during = await enqueue(kind, {}, { businessId: b.id });
    await runJobNow(during);
    expect(ran).toBe(1);
    expect(await getJob(during)).toMatchObject({ status: 'done', result: { ok: true } });
    await backdate(owner.id, 49);
    const after = await enqueue(kind, {}, { businessId: b.id });
    await runJobNow(after);
    expect(ran).toBe(1);
    expect(await getJob(after)).toMatchObject({ status: 'done', result: { skipped: 'no_access' } });
  });

  it('the workspace carries the notice: grace end for payer and member, trial end for the payer only', async () => {
    const owner = await trialing(); const member = await F.user();
    const b = await F.biz(owner); await F.member(b.id, member, 'Viewer');
    const trialEnd = (await account(owner.id)).trialEnd!.toISOString();
    // Trialing: the payer sees when the trial ends; a member is told nothing about it.
    expect(await billingNoticeOf(b, owner.id)).toEqual({ payer: true, trialEndsAt: trialEnd });
    expect(await billingNoticeOf(b, member.id)).toEqual({ payer: false });
    await as(owner); expect((await ws(b.id)).j.billing).toEqual({ payer: true, trialEndsAt: trialEnd });
    await as(member); expect((await ws(b.id)).j.billing).toEqual({ payer: false });
    // Paying: nothing to show.
    await as(owner); await billing.simulate('active');
    expect(await billingNoticeOf(b, owner.id)).toEqual({ payer: true });
    // In grace: both see the same end, only the owner is the payer.
    await billing.simulate('past_due', 10);
    const end = new Date((await account(owner.id)).pastDueAt!.getTime() + 48 * HOUR).toISOString();
    expect(await billingNoticeOf(b, owner.id)).toEqual({ payer: true, graceEndsAt: end });
    expect(await billingNoticeOf(b, member.id)).toEqual({ payer: false, graceEndsAt: end });
    await as(member); expect((await ws(b.id)).j.billing).toEqual({ payer: false, graceEndsAt: end });
    expect((await billingOverview(owner)).graceEndsAt).toBe(end);
    // The override moves the date everyone is shown.
    process.env.RADAR_PAST_DUE_GRACE_HOURS = '24';
    expect((await billingNoticeOf(b, owner.id))!.graceEndsAt).toBe(new Date((await account(owner.id)).pastDueAt!.getTime() + 24 * HOUR).toISOString());
    delete process.env.RADAR_PAST_DUE_GRACE_HOURS;
    // After it: no date left to show (and the workspace itself is locked).
    await backdate(owner.id, 49);
    expect(await billingNoticeOf(b, owner.id)).toEqual({ payer: true });
    expect((await billingOverview(owner)).graceEndsAt).toBeUndefined();
  });

  it('no notice for a complimentary owner, a grandfathered owner, or with billing off', async () => {
    const comp = await F.user(); const cb = await F.biz(comp); await F.account(comp.id, { comp: true, compReason: 'manual', status: 'trialing', trialEnd: new Date(Date.now() + 2 * 24 * HOUR) });
    expect(await billingNoticeOf(cb, comp.id)).toBeUndefined();
    const old = await F.user(); const ob = await F.biz(old);            // no billing row at all: nothing to say
    expect(await billingNoticeOf(ob, old.id)).toBeUndefined();
    const owner = await trialing(); const b = await F.biz(owner);
    expect(await billingNoticeOf(b, owner.id)).toMatchObject({ payer: true, trialEndsAt: expect.any(String) });
    delete process.env.RADAR_BILLING;
    expect(await billingNoticeOf(b, owner.id)).toBeUndefined();
    await as(owner); expect((await ws(b.id)).j.billing).toBeUndefined();
    // A list of emails turns billing on for those owners only.
    process.env.RADAR_BILLING = 'someone-else@test.local';
    expect(await billingNoticeOf(b, owner.id)).toBeUndefined();
    process.env.RADAR_BILLING = owner.email;
    expect(await billingNoticeOf(b, owner.id)).toMatchObject({ payer: true });
  });
});
