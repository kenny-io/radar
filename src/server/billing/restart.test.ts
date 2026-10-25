// Restarting a lapsed subscription on the stub provider (architecture §16.12).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { Fixtures, clearLimits, type TUser } from '../testing/fixtures';
import { account, billing, card as stubCard, Deliveries, stubCalls } from '../testing/billing';
import { processEvent } from './webhook';
import { stubConfirmIntent, stubReset, stubSetStatus, stubState } from './stub';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const D = new Deliveries();
const card = () => stubCard(7000, 10000);
const as = async (u: TUser) => { H.jar.clear(); await F.signIn(u, H.jar); };
const piOf = (clientSecret: string) => clientSecret.split('_secret_')[0];
/** The amount the stub would charge for a restart's client secret, and the invoice behind it. */
const charged = (clientSecret: string) => stubState().pis.get(piOf(clientSecret))!.amount;
const invoiceOf = (subId: string) => stubState().invoices.get(stubState().subs.get(subId)!.latest_invoice!)!;
const balanceOf = async (uid: string) => stubState().customers.get((await account(uid)).stripeCustomerId!)!.balance;
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
    // D1: canceled mid-trial, so the $1 credit is unused and month one is $49. Shown and charged agree at every step.
    expect(await balanceOf(u.id)).toBe(-100);
    expect((await billing.state()).j.dueTodayCents).toBe(4900);
    const pm = await card();
    const r1 = await billing.restart(pm);
    expect(r1.j.subscriptionId).not.toBe(old);
    expect(charged(r1.j.clientSecret)).toBe(4900);
    expect((await billing.state()).j.dueTodayCents).toBe(4900);              // the incomplete subscription's open invoice
    expect(stubState().subs.get(r1.j.subscriptionId)).toMatchObject({ status: 'incomplete', trial_end: null, metadata: { purpose: 'restart' } });
    expect(await account(u.id)).toMatchObject({ stripeSubscriptionId: r1.j.subscriptionId, status: 'incomplete' });
    const again = await billing.restart(pm);
    expect(again.j).toEqual(r1.j);
    const r2 = await billing.restart(await card());
    expect(r2.j.subscriptionId).not.toBe(r1.j.subscriptionId);
    expect(stubState().subs.get(r1.j.subscriptionId)!.status).toBe('incomplete_expired');   // its first invoice voided…
    expect(invoiceOf(r1.j.subscriptionId).status).toBe('void');               // …so its credit came back…
    expect(charged(r2.j.clientSecret)).toBe(4900);                           // …and the replacement still charges $49
    expect(stubConfirmIntent(piOf(r1.j.clientSecret), 'succeed').result).toMatchObject({ error: { code: 'payment_intent_unexpected_state' } });   // the old tab can't pay
    const back = await billing.restart(pm);                                  // back to the first card: a new one, never a replay
    expect([r1.j.subscriptionId, r2.j.subscriptionId]).not.toContain(back.j.subscriptionId);
    expect((await billing.confirm({ subscriptionId: back.j.subscriptionId })).j.code).toBe('payment_not_succeeded');
    expect(charged(back.j.clientSecret)).toBe(4900);
    await billing.confirmIntent(piOf(back.j.clientSecret));
    const c = await billing.confirm({ subscriptionId: back.j.subscriptionId });
    expect(c.j.state).toMatchObject({ access: true, status: 'active' });
    expect(await balanceOf(u.id)).toBe(0);                                   // the credit was used exactly once
    expect(new Date(c.j.state.currentPeriodEnd).getTime()).toBeGreaterThan(Date.now() + 29 * 864e5);
  });

  it('D1: once the credit paid a past_due invoice, a later canceled restart shows and charges the full $50', async () => {
    const { u, sub } = await lapsed('past_due');
    expect((await billing.state()).j.dueTodayCents).toBe(4900);
    const r = await billing.restart(await card());
    expect(charged(r.j.clientSecret)).toBe(4900);
    await billing.confirmIntent(piOf(r.j.clientSecret));
    expect((await billing.confirm({ subscriptionId: sub })).j.state.access).toBe(true);
    await processEvent(D.event('customer.subscription.deleted', stubSetStatus(sub, 'canceled')));
    expect(await balanceOf(u.id)).toBe(0);
    expect((await billing.state()).j).toMatchObject({ access: false, mode: 'restart', dueTodayCents: 5000 });
    const again = await billing.restart(await card());
    expect(charged(again.j.clientSecret)).toBe(5000);
  });

  it('an incomplete restart paid in another tab is not replaced: switching cards activates instead of canceling it', async () => {
    const { u } = await lapsed('canceled');
    const r1 = await billing.restart(await card());
    stubConfirmIntent(piOf(r1.j.clientSecret), 'succeed');                   // paid, but nobody confirmed or synced yet
    const r2 = await billing.restart(await card());
    expect(r2.j).toMatchObject({ ok: true, activated: true, state: { access: true, status: 'active' } });
    expect(stubState().subs.get(r1.j.subscriptionId)!.status).toBe('active');
    expect(await account(u.id)).toMatchObject({ stripeSubscriptionId: r1.j.subscriptionId, status: 'active' });
    expect(stubCalls('cancelSubscription')).toBe(0);
  });

  it('a failed void never blocks the restart: the unpaid one is canceled and replaced as before', async () => {
    const { stubProvider } = await import('./stub');
    const { ProviderError } = await import('./provider');
    await lapsed('canceled');
    const r1 = await billing.restart(await card());
    const spy = vi.spyOn(stubProvider, 'voidInvoice').mockRejectedValueOnce(new ProviderError('The provided key does not have the required permissions.', 403, 'invalid_request_error'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r2 = await billing.restart(await card());
      expect(r2.status).toBe(200);
      expect(r2.j.subscriptionId).not.toBe(r1.j.subscriptionId);
      expect(stubState().subs.get(r1.j.subscriptionId)!.status).toBe('canceled');
      expect(warn.mock.calls.some(c => String(c[0]).includes('restart continues'))).toBe(true);
    } finally { spy.mockRestore(); warn.mockRestore(); }
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
