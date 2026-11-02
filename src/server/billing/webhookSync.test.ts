// Webhook dedupe and subscription sync on the stub provider (architecture §16.11).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { env } from '../env';
import { Fixtures, clearLimits, type TUser } from '../testing/fixtures';
import { account, billing, card as stubCard, Deliveries, eventsOf, stubCalls } from '../testing/billing';
import { POST as WEBHOOK } from '@/app/api/billing/webhook/route';
import { processEvent } from './webhook';
import { signPayload } from './signature';
import { stubProvider, stubReset, stubSetStatus, stubState } from './stub';
import { setStripeDepsForTests, stripeProvider } from './stripe';
import { billingOverview } from './overview';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const D = new Deliveries();
const card = () => stubCard(4000, 7000);
const as = async (u: TUser) => { H.jar.clear(); await F.signIn(u, H.jar); };
const row = async (id: string) => (await db.select().from(schema.billingEvents).where(eq(schema.billingEvents.id, id)))[0];
/** A signed-in user on a stub trial. */
async function trialing() {
  const u = await F.user(); await as(u);
  const s = await billing.start(await card()); await billing.confirmIntent(s.j.paymentIntentId);
  expect((await billing.confirm({ paymentIntentId: s.j.paymentIntentId })).status).toBe(200);
  const a = await account(u.id);
  return { u, pi: s.j.paymentIntentId as string, sub: a.stripeSubscriptionId!, cus: a.stripeCustomerId! };
}
const subEvent = (type: string, id: string) => D.event(type, { id, object: 'subscription', customer: stubState().subs.get(id)!.customer, status: stubState().subs.get(id)!.status });
/** Pay the open invoice of `sub` the way the trial page would (stub confirm), returning its id. */
async function payOpenInvoice(sub: string) {
  const inv = stubState().invoices.get(stubState().subs.get(sub)!.latest_invoice!)!;
  expect(inv.status).toBe('open');
  expect((await billing.confirmIntent(inv.pi!)).j.paymentIntent?.status).toBe('succeeded');
  return inv.id;
}

beforeEach(() => { process.env.RADAR_BILLING = 'on'; stubReset(); });
afterEach(() => { delete process.env.RADAR_BILLING; H.jar.clear(); vi.restoreAllMocks(); });

describe.skipIf(!ON)('webhook sync (stub, database)', () => {
  afterAll(async () => { await D.cleanup(); await clearLimits('10.88.'); for (const id of F.users) await clearLimits(id); await F.cleanup(); });

  it('past_due → no access (restart, $49 due after the credit); invoice.paid → active; deleted → canceled', async () => {
    const { u, sub, cus } = await trialing();
    stubSetStatus(sub, 'past_due');
    await processEvent(subEvent('customer.subscription.updated', sub));
    expect((await account(u.id)).status).toBe('past_due');
    expect((await billing.state()).j).toMatchObject({ access: false, mode: 'restart', needsRestart: true, dueTodayCents: 4900 });
    const inv = await payOpenInvoice(sub);
    await processEvent(D.event('invoice.paid', { id: inv, customer: cus }));
    expect(await account(u.id)).toMatchObject({ status: 'active', trialEnd: null });
    expect((await account(u.id)).currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now() + 29 * 864e5);
    stubSetStatus(sub, 'canceled');
    await processEvent(subEvent('customer.subscription.deleted', sub));
    expect((await account(u.id)).status).toBe('canceled');
    expect((await billing.state()).j.access).toBe(false);
    const changes = (await eventsOf(u.id, 'sub.status_changed')).map(e => `${e.props.from}>${e.props.to}`);
    expect(changes).toEqual(['none>trialing', 'trialing>past_due', 'past_due>active', 'active>canceled']);
  });

  it('a replayed event id is a no-op', async () => {
    const { u, sub } = await trialing();
    stubSetStatus(sub, 'past_due');
    const ev = subEvent('customer.subscription.updated', sub);
    expect(await processEvent(ev)).toBe('processed');
    expect(await processEvent(ev)).toBe('replay');
    expect(await row(ev.id)).toMatchObject({ type: 'customer.subscription.updated', attempts: 1, lastError: null });
    expect((await row(ev.id)).processedAt).not.toBeNull();
    expect((await eventsOf(u.id, 'sub.status_changed')).filter(e => e.props.to === 'past_due')).toHaveLength(1);
  });

  it('a handler that throws leaves processed_at null with the message; the retry processes it', async () => {
    const { u, sub } = await trialing();
    stubSetStatus(sub, 'past_due');
    const ev = subEvent('customer.subscription.updated', sub);
    vi.spyOn(stubProvider, 'getSubscription').mockRejectedValueOnce(new Error('provider down'));
    await expect(processEvent(ev)).rejects.toThrow('provider down');
    expect(await row(ev.id)).toMatchObject({ processedAt: null, attempts: 1, lastError: 'provider down' });
    expect((await account(u.id)).status).toBe('trialing');
    expect(await processEvent(ev)).toBe('processed');
    expect(await row(ev.id)).toMatchObject({ attempts: 2, lastError: null });
    expect((await account(u.id)).status).toBe('past_due');
  });

  it('out-of-order deliveries converge on the provider’s current state', async () => {
    const { u, sub } = await trialing();
    stubSetStatus(sub, 'past_due'); const older = subEvent('customer.subscription.updated', sub);
    await payOpenInvoice(sub); const newer = subEvent('customer.subscription.updated', sub);
    await processEvent(newer); await processEvent(older);
    expect((await account(u.id)).status).toBe('active');
  });

  it('persists the real Dahlia portal cancel_at shape through webhook sync without changing the billing date', async () => {
    const { u, sub, cus } = await trialing();
    let current: { id: string; customer: string; status: string; cancel_at_period_end: boolean; cancel_at: number | null;
      canceled_at: number; ended_at: null; created: number; trial_end: number;
      items: { data: { current_period_start: number; current_period_end: number }[] } } = { id: sub, customer: cus, status: 'trialing', cancel_at_period_end: false, cancel_at: 1793911362,
      canceled_at: 1793652415, ended_at: null, created: 1793652168, trial_end: 1793911362,
      items: { data: [{ current_period_start: 1793652168, current_period_end: 1793911362 }] } };
    setStripeDepsForTests({ secretKey: () => 'sk_test_mapping_fixture', apiVersion: () => '2026-05-27.dahlia',
      fetch: async () => new Response(JSON.stringify(current), { headers: { 'content-type': 'application/json' } }) });
    vi.spyOn(stubProvider, 'getSubscription').mockImplementation(id => stripeProvider.getSubscription(id));
    const event = D.event('customer.subscription.updated', { id: sub, object: 'subscription', customer: cus });
    expect(await processEvent(event)).toBe('processed');
    expect(await billingOverview(u)).toMatchObject({ status: 'trialing', cancelAtPeriodEnd: true, currentPeriodEnd: '2026-11-05T20:42:42.000Z' });
    expect(await processEvent(event)).toBe('replay');
    // Clearing the schedule and later terminal state clear the persisted warning; canceled_at is historical only.
    current = { ...current, cancel_at: null };
    await processEvent(D.event('customer.subscription.updated', { id: sub, customer: cus }));
    expect((await account(u.id)).cancelAtPeriodEnd).toBe(false);
    current = { ...current, status: 'canceled', cancel_at: 1793911362, cancel_at_period_end: true };
    await processEvent(D.event('customer.subscription.deleted', { id: sub, customer: cus }));
    expect(await billingOverview(u)).toMatchObject({ status: 'canceled', cancelAtPeriodEnd: false, currentPeriodEnd: '2026-11-05T20:42:42.000Z' });
  });

  it('an event for an old subscription (or the old trial $1) never regresses a restarted account', async () => {
    const { u, pi, sub: old } = await trialing();
    stubSetStatus(old, 'canceled');
    await processEvent(subEvent('customer.subscription.deleted', old));
    const r = await billing.restart(await card());
    expect(r.status).toBe(200);
    expect(r.j.subscriptionId).not.toBe(old);
    await billing.confirmIntent(r.j.clientSecret.split('_secret_')[0]);
    expect((await billing.confirm({ subscriptionId: r.j.subscriptionId })).j.state).toMatchObject({ access: true, status: 'active' });
    const subs = stubCalls('createSubscription');
    await processEvent(subEvent('customer.subscription.deleted', old));
    await processEvent(subEvent('customer.subscription.updated', old));
    await processEvent(D.event('payment_intent.succeeded', D.pi(pi)));
    expect((await billing.confirm({ paymentIntentId: pi })).status).toBe(200);    // an old tab confirming the trial $1
    expect(await account(u.id)).toMatchObject({ stripeSubscriptionId: r.j.subscriptionId, status: 'active' });
    expect(stubCalls('createSubscription')).toBe(subs);
    expect(await eventsOf(u.id, 'trial.started')).toHaveLength(1);
    expect(stubState().credits).toHaveLength(1);
  });

  it('the route verifies the signature, refuses without a secret, and answers 200 / 400', async () => {
    const { u, sub } = await trialing();
    stubSetStatus(sub, 'past_due');
    const ev = subEvent('customer.subscription.updated', sub); const raw = JSON.stringify(ev);
    const send = (sig: string | null, body = raw) => WEBHOOK(new Request('http://t/api/billing/webhook', { method: 'POST', body, headers: sig ? { 'stripe-signature': sig } : {} }));
    const saved = env.stripeWebhookSecret;
    try {
      env.stripeWebhookSecret = '';
      expect((await send(signPayload(raw, ''))).status).toBe(400);              // never verified against an empty secret
      env.stripeWebhookSecret = 'whsec_test_route';
      expect((await send(null)).status).toBe(400);
      expect((await send(signPayload(raw, 'whsec_wrong'))).status).toBe(400);
      expect((await send(signPayload(raw, 'whsec_test_route'), raw.replace('past_due', 'active'))).status).toBe(400);
      expect((await account(u.id)).status).toBe('trialing');
      const ok = await send(signPayload(raw, 'whsec_test_route'));
      expect([ok.status, await ok.json()]).toEqual([200, { received: true }]);
      expect((await account(u.id)).status).toBe('past_due');
      expect((await send(signPayload(raw, 'whsec_test_route'))).status).toBe(200);   // replay
      vi.spyOn(stubProvider, 'getSubscription').mockRejectedValueOnce(new Error('down'));
      const ev2 = subEvent('customer.subscription.updated', sub); const raw2 = JSON.stringify(ev2);
      expect((await send(signPayload(raw2, 'whsec_test_route'), raw2)).status).toBe(500);
    } finally { env.stripeWebhookSecret = saved; }
  });
});
