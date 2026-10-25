// Restarting a lapsed subscription on the stub provider (architecture §16.12).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { Fixtures, clearLimits, type TUser } from '../testing/fixtures';
import { account, billing, card as stubCard, Deliveries, stubCalls } from '../testing/billing';
import { processEvent } from './webhook';
import { stubReset, stubSetStatus, stubState } from './stub';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const D = new Deliveries();
const card = () => stubCard(7000, 10000);
const as = async (u: TUser) => { H.jar.clear(); await F.signIn(u, H.jar); };
const piOf = (clientSecret: string) => clientSecret.split('_secret_')[0];
async function lapsed(status: 'past_due' | 'unpaid' | 'canceled') {
  const u = await F.user(); await as(u);
  const s = await billing.start(await card()); await billing.confirmIntent(s.j.paymentIntentId);
  await billing.confirm({ paymentIntentId: s.j.paymentIntentId });
  const sub = (await account(u.id)).stripeSubscriptionId!;
  const x = stubSetStatus(sub, status);
  await processEvent(D.event(status === 'canceled' ? 'customer.subscription.deleted' : 'customer.subscription.updated', x));
  expect((await billing.state()).j).toMatchObject({ access: false, mode: 'restart' });
  return { u, sub };
}

beforeEach(() => { process.env.RADAR_BILLING = 'on'; stubReset(); });
afterEach(() => { delete process.env.RADAR_BILLING; H.jar.clear(); });

describe.skipIf(!ON)('restart (stub, database)', () => {
  afterAll(async () => { await D.cleanup(); await clearLimits('10.88.'); for (const id of F.users) await clearLimits(id); await F.cleanup(); });

  it('past_due pays the open invoice on the same subscription; access after the confirm', async () => {
    const { u, sub } = await lapsed('past_due');
    expect((await billing.start(await card())).j.code).toBe('restart_required');
    const pm = await card();
    const r = await billing.restart(pm);
    expect(r.status).toBe(200);
    const open = stubState().invoices.get(stubState().subs.get(sub)!.latest_invoice!)!;
    expect(r.j).toEqual({ ok: true, clientSecret: open.client_secret, subscriptionId: sub });
    expect(open.amount_due).toBe(4900);                                     // the $1 credit applied to month one
    expect(stubState().subs.get(sub)!.default_payment_method).toBe(pm);
    expect((await billing.confirm({ subscriptionId: sub })).j.code).toBe('payment_not_succeeded');
    await billing.confirmIntent(piOf(r.j.clientSecret));
    const c = await billing.confirm({ subscriptionId: sub });
    expect(c.status).toBe(200);
    expect(c.j.state).toMatchObject({ access: true, status: 'active', mode: 'none' });
    expect(stubCalls('createSubscription')).toBe(1);                         // no new subscription
    expect((await account(u.id)).stripeSubscriptionId).toBe(sub);
  });

  it('canceled starts a new subscription with no trial, charged today; the same card reuses it, another card replaces it', async () => {
    const { u, sub: old } = await lapsed('canceled');
    expect((await billing.state()).j.dueTodayCents).toBe(5000);
    const pm = await card();
    const r1 = await billing.restart(pm);
    expect(r1.j.subscriptionId).not.toBe(old);
    expect(stubState().subs.get(r1.j.subscriptionId)).toMatchObject({ status: 'incomplete', trial_end: null, metadata: { purpose: 'restart' } });
    expect(await account(u.id)).toMatchObject({ stripeSubscriptionId: r1.j.subscriptionId, status: 'incomplete' });
    const again = await billing.restart(pm);
    expect(again.j).toEqual(r1.j);
    const r2 = await billing.restart(await card());
    expect(r2.j.subscriptionId).not.toBe(r1.j.subscriptionId);
    expect(stubState().subs.get(r1.j.subscriptionId)!.status).toBe('canceled');
    const back = await billing.restart(pm);                                  // back to the first card: a new one, never a replay
    expect([r1.j.subscriptionId, r2.j.subscriptionId]).not.toContain(back.j.subscriptionId);
    expect((await billing.confirm({ subscriptionId: back.j.subscriptionId })).j.code).toBe('payment_not_succeeded');
    await billing.confirmIntent(piOf(back.j.clientSecret));
    const c = await billing.confirm({ subscriptionId: back.j.subscriptionId });
    expect(c.j.state).toMatchObject({ access: true, status: 'active' });
    expect(new Date(c.j.state.currentPeriodEnd).getTime()).toBeGreaterThan(Date.now() + 29 * 864e5);
  });

  it('gates: never subscribed → not_lapsed; active → already_active; another account’s subscription → 403', async () => {
    const fresh = await F.user(); await as(fresh);
    expect((await billing.restart(await card())).j.code).toBe('not_lapsed');
    const { sub } = await lapsed('unpaid');
    const r = await billing.restart(await card());
    await billing.confirmIntent(piOf(r.j.clientSecret));
    expect((await billing.confirm({ subscriptionId: sub })).status).toBe(200);
    expect((await billing.restart(await card())).j.code).toBe('already_active');
    await as(fresh);
    expect((await billing.confirm({ subscriptionId: sub })).j.code).toBe('not_yours');
  });
});
