import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { decrypt } from '../crypto';
import { Fixtures, clearLimits } from '../testing/fixtures';
import { account, billing, card as stubCard, Deliveries } from '../testing/billing';
import { stubProvider, stubReset, stubSetStatus, stubState } from './stub';
import { processEvent } from './webhook';
import { commitDraft } from './draft';
import * as lifecycle from '../services/lifecycle/queue';
import type { LifecyclePayload } from '../services/lifecycle/queue';
import { setStripeDepsForTests, stripeProvider } from './stripe';

const F = new Fixtures();
const D = new Deliveries();
const rows = (uid: string, type: string) => db.select().from(schema.lifecycleEmails).where(and(eq(schema.lifecycleEmails.userId, uid), eq(schema.lifecycleEmails.type, type)));
const payload = (r: typeof schema.lifecycleEmails.$inferSelect) => decrypt<LifecyclePayload>(r.payloadEnc)!;
const card = () => stubCard(8100, 8999);
const event = (type: string, sub: string) => D.event(type, { id: sub, customer: stubState().subs.get(sub)!.customer });

async function trial(withDraft = false) {
  const u = await F.user(); await F.signIn(u, H.jar);
  const draft = withDraft ? await F.biz(u, { status: 'onboarding', onboarding: { savedAt: new Date().toISOString() } }) : null;
  const start = await billing.start(await card()); expect(start.status).toBe(200);
  await billing.confirmIntent(start.j.paymentIntentId);
  const confirmed = await billing.confirm({ paymentIntentId: start.j.paymentIntentId }); expect(confirmed.status).toBe(200);
  const a = await account(u.id);
  return { u, draft, pi: start.j.paymentIntentId as string, sub: a.stripeSubscriptionId!, cus: a.stripeCustomerId! };
}

beforeEach(() => { process.env.RADAR_BILLING = 'on'; H.jar.clear(); stubReset(); });
afterEach(() => { delete process.env.RADAR_BILLING; H.jar.clear(); vi.restoreAllMocks(); });

describe.skipIf(!process.env.DATABASE_URL)('billing lifecycle (database, no external sends)', () => {
  afterAll(async () => { await D.cleanup(); for (const uid of F.users) await clearLimits(uid); await clearLimits('10.88.'); await F.cleanup(); });

  it('durably queues one trial, one future reminder and one saved workspace across confirm/webhook replays', async () => {
    const { u, draft, pi, sub } = await trial(true);
    await processEvent(D.event('payment_intent.succeeded', D.pi(pi)));
    expect((await billing.confirm({ paymentIntentId: pi })).status).toBe(200);
    const starts = await rows(u.id, 'trial_started'), reminders = await rows(u.id, 'trial_ending'), ready = await rows(u.id, 'workspace_ready');
    expect([starts.length, reminders.length, ready.length]).toEqual([1, 1, 1]);
    const a = await account(u.id);
    expect(payload(starts[0]).data).toMatchObject({ subscriptionId: sub, trialEnd: a.trialEnd!.toISOString() });
    expect(reminders[0].nextAttemptAt.getTime()).toBe(a.trialEnd!.getTime() - 864e5);
    expect(reminders[0].nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(payload(ready[0]).data).toMatchObject({ businessId: draft!.id, businessName: 'Fieldnote' });
    expect(stubState().credits).toHaveLength(1);
  });

  it('supports cancel → resume → cancel in one period, while unchanged/replayed updates create no extra notices', async () => {
    const { u, sub } = await trial();
    const raw = stubState().subs.get(sub)!;
    raw.cancel_at_period_end = true;
    const first = event('customer.subscription.updated', sub);
    await processEvent(first); await processEvent(first); await processEvent(event('customer.subscription.updated', sub));
    expect(await rows(u.id, 'cancellation_scheduled')).toHaveLength(1);
    raw.cancel_at_period_end = false; await processEvent(event('customer.subscription.updated', sub));
    expect((await rows(u.id, 'cancellation_scheduled'))[0]).toMatchObject({ status: 'suppressed', lastError: 'subscription_resumed' });
    raw.cancel_at_period_end = true; await processEvent(event('customer.subscription.updated', sub));
    const cancellations = await rows(u.id, 'cancellation_scheduled');
    expect(cancellations).toHaveLength(2);
    expect(new Set(cancellations.map(r => r.eventKey)).size).toBe(2);
    expect(cancellations.filter(r => r.status === 'queued')).toHaveLength(1);
    expect(payload(cancellations[1]).data.periodEnd).toBe(new Date(raw.current_period_end! * 1000).toISOString());
    stubSetStatus(sub, 'unpaid'); await processEvent(event('customer.subscription.updated', sub));
    expect(await rows(u.id, 'subscription_ended')).toHaveLength(0); // outstanding payment is not a cancellation
    stubSetStatus(sub, 'canceled'); await processEvent(event('customer.subscription.deleted', sub));
    await processEvent(event('customer.subscription.updated', sub));
    const ended = await rows(u.id, 'subscription_ended');
    expect(ended).toHaveLength(1);
    expect(payload(ended[0]).data.status).toBe('canceled');
  });

  it('does not commit a billing transition if its durable email cannot be persisted', async () => {
    const { u, sub } = await trial();
    stubState().subs.get(sub)!.cancel_at_period_end = true;
    const ev = event('customer.subscription.updated', sub);
    vi.spyOn(lifecycle, 'queueLifecycle').mockRejectedValueOnce(new Error('outbox unavailable'));
    await expect(processEvent(ev)).rejects.toThrow('outbox unavailable');
    expect((await account(u.id)).cancelAtPeriodEnd).toBe(false);
    expect(await rows(u.id, 'cancellation_scheduled')).toHaveLength(0);
    expect(await processEvent(ev)).toBe('processed');
    expect((await account(u.id)).cancelAtPeriodEnd).toBe(true);
    expect(await rows(u.id, 'cancellation_scheduled')).toHaveLength(1);
  });

  it('rolls trial and workspace mail back with a failed credit, then adopts the same subscription and queues once', async () => {
    const u = await F.user(); await F.signIn(u, H.jar);
    const b = await F.biz(u, { status: 'onboarding', onboarding: { savedAt: new Date().toISOString() } });
    const start = await billing.start(await card()); await billing.confirmIntent(start.j.paymentIntentId);
    vi.spyOn(stubProvider, 'creditBalance').mockRejectedValueOnce(new Error('credit unavailable'));
    expect((await billing.confirm({ paymentIntentId: start.j.paymentIntentId })).status).toBe(502); // existing activation_failed contract
    expect(await rows(u.id, 'trial_started')).toHaveLength(0);
    expect(await rows(u.id, 'trial_ending')).toHaveLength(0);
    expect(await rows(u.id, 'workspace_ready')).toHaveLength(0);
    expect((await db.select().from(schema.businesses).where(eq(schema.businesses.id, b.id)))[0].status).toBe('onboarding');
    expect((await billing.confirm({ paymentIntentId: start.j.paymentIntentId })).status).toBe(200);
    expect(await rows(u.id, 'trial_started')).toHaveLength(1);
    expect(await rows(u.id, 'trial_ending')).toHaveLength(1);
    expect(await rows(u.id, 'workspace_ready')).toHaveLength(1);
    expect(stubState().subs.size).toBe(1);
    expect(stubState().credits).toHaveLength(1);
  });

  it('uses fetched $49 paid facts, dedupes invoice IDs and skips zero-dollar trial invoices', async () => {
    const { u, sub, cus } = await trial();
    const zero = stubState().subs.get(sub)!.latest_invoice!;
    await processEvent(D.event('invoice.paid', { id: zero, customer: cus, amount_paid: 999999 }));
    expect(await rows(u.id, 'invoice_paid')).toHaveLength(0);
    stubSetStatus(sub, 'past_due');
    const inv = stubState().invoices.get(stubState().subs.get(sub)!.latest_invoice!)!;
    await billing.confirmIntent(inv.pi!);
    const ev = D.event('invoice.paid', { id: inv.id, customer: cus, amount_paid: 999999, currency: 'eur' });
    await Promise.all([processEvent(ev), processEvent(ev)]);
    await processEvent(D.event('invoice.paid', { id: inv.id, customer: cus }));
    const paid = await rows(u.id, 'invoice_paid'); expect(paid).toHaveLength(1);
    expect(payload(paid[0]).data).toMatchObject({ invoiceId: inv.id, amountCents: 4900, currency: 'usd', subscriptionId: sub });
    expect(payload(paid[0]).envelope.text).toContain('$49.00');
  });

  it('fetches failed invoices and ignores delayed failure after payment or an invoice for an old subscription', async () => {
    const { u, sub, cus } = await trial();
    stubSetStatus(sub, 'past_due');
    const inv = stubState().invoices.get(stubState().subs.get(sub)!.latest_invoice!)!;
    await processEvent(D.event('invoice.payment_failed', { id: inv.id, customer: cus }));
    await processEvent(D.event('invoice.payment_failed', { id: inv.id, customer: cus }));
    expect(await rows(u.id, 'payment_failed')).toHaveLength(1);
    expect(payload((await rows(u.id, 'payment_failed'))[0]).data.amountCents).toBe(4900);
    await billing.confirmIntent(inv.pi!);
    await db.delete(schema.lifecycleEmails).where(and(eq(schema.lifecycleEmails.userId, u.id), eq(schema.lifecycleEmails.type, 'payment_failed')));
    await processEvent(D.event('invoice.payment_failed', { id: inv.id, customer: cus }));
    expect(await rows(u.id, 'payment_failed')).toHaveLength(0);
    // A provider-verified invoice for the same customer but another subscription is still not this account's invoice.
    const other = await stubProvider.createSubscription({ customer: cus, price: 'price_stub_monthly', defaultPaymentMethod: await card(), incomplete: true, metadata: {} }, 'other-sub-for-lifecycle');
    const oldInvoice = stubState().subs.get(other.sub.id)!.latest_invoice!;
    await processEvent(D.event('invoice.payment_failed', { id: oldInvoice, customer: cus }));
    expect(await rows(u.id, 'payment_failed')).toHaveLength(0);
    expect((await account(u.id)).stripeSubscriptionId).toBe(sub);
  });

  it('workspace activation and ready mail commit together and concurrent activation sends once', async () => {
    const u = await F.user(); const b = await F.biz(u, { status: 'onboarding' });
    vi.spyOn(lifecycle, 'queueLifecycle').mockRejectedValueOnce(new Error('outbox unavailable'));
    await expect(commitDraft(b.id)).rejects.toThrow('outbox unavailable');
    expect((await db.select().from(schema.businesses).where(eq(schema.businesses.id, b.id)))[0].status).toBe('onboarding');
    expect(await rows(u.id, 'workspace_ready')).toHaveLength(0);
    const results = await Promise.all([commitDraft(b.id), commitDraft(b.id)]);
    expect(results.filter(Boolean)).toEqual([b.id]);
    expect(await rows(u.id, 'workspace_ready')).toHaveLength(1);
    const guest = await F.user({ guest: true }); const guestDraft = await F.biz(guest, { status: 'onboarding' });
    await commitDraft(guestDraft.id);
    expect(await rows(guest.id, 'workspace_ready')).toHaveLength(0);
  });

  it('maps authoritative Basil/Dahlia parent subscription and receipt fields without exposing client secrets to emails', async () => {
    setStripeDepsForTests({ secretKey: () => 'sk_test_lifecycle_mapping', apiVersion: () => '2026-05-27.dahlia',
      fetch: async () => new Response(JSON.stringify({ id: 'in_mapping', status: 'paid', amount_due: 4900, amount_paid: 4900, currency: 'usd', number: 'RADAR-001', customer: { id: 'cus_mapping' }, parent: { type: 'subscription_details', subscription_details: { subscription: { id: 'sub_mapping' } } }, confirmation_secret: { client_secret: 'not-for-email' } })) });
    expect(await stripeProvider.getInvoice('in_mapping')).toMatchObject({ customer: 'cus_mapping', subscription: 'sub_mapping', amount_paid: 4900, currency: 'usd', number: 'RADAR-001' });
  });
});
