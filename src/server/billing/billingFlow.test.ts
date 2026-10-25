// The $1-then-trial flow end to end on the stub provider, through the real route handlers (architecture §16.10).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { Fixtures, clearLimits, type TUser } from '../testing/fixtures';
import { account, billing, card as stubCard, Deliveries, eventsOf, stubCalls, stubSubsOf } from '../testing/billing';
import { BIZ_COOKIE } from '../auth/users';
import { setProviderNameForTests } from './config';
import { stubReset, stubState } from './stub';
import { activateIn } from './activate';
import { withBillingLock } from './account';
import { stubProvider } from './stub';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const D = new Deliveries();
const SAVED = { step: 'save' as const, savedAt: new Date().toISOString(), tz: 'Europe/Lisbon' };
const as = async (u: TUser) => { H.jar.clear(); await F.signIn(u, H.jar); };
const biz = async (bid: string) => (await db.select().from(schema.businesses).where(eq(schema.businesses.id, bid)))[0];
const onboarded = async (bid: string) => (await db.select().from(schema.events).where(and(eq(schema.events.businessId, bid), eq(schema.events.kind, 'business.onboarded')))).length;
/** A signed-in user with a saved draft, billing on. */
async function payer() { const u = await F.user(); await as(u); const d = await F.biz(u, { status: 'onboarding', onboarding: SAVED }); return { u, d }; }
/** This file's stub cards: last4 in 1000–3999. */
const card = (scenario: 'succeed' | 'decline' | '3ds' = 'succeed') => stubCard(1000, 4000, scenario);
/** start → the stub confirms the card → (optionally) confirm. */
async function pay(pm?: string, o: { confirm?: boolean } = {}) {
  pm ||= await card();
  const s = await billing.start(pm); expect(s.status, JSON.stringify(s.j)).toBe(200);
  const c = await billing.confirmIntent(s.j.paymentIntentId); expect(c.j.paymentIntent?.status).toBe('succeeded');
  const r = o.confirm === false ? null : await billing.confirm({ paymentIntentId: s.j.paymentIntentId });
  return { s, r, pi: s.j.paymentIntentId as string };
}

beforeEach(() => { process.env.RADAR_BILLING = 'on'; stubReset(); });
afterEach(() => { delete process.env.RADAR_BILLING; setProviderNameForTests(null); H.jar.clear(); vi.restoreAllMocks(); });

describe.skipIf(!ON)('trial billing flow (stub, database)', () => {
  afterAll(async () => { await D.cleanup(); await clearLimits('10.88.'); for (const id of F.users) await clearLimits(id); await F.cleanup(); });

  it('start then confirm: trialing, trial_end is the pending second, draft committed once, $1 credited once', async () => {
    const { u, d } = await payer();
    const pm = await card(); const last4 = pm.slice(-4);
    const s = await billing.start(pm);
    expect(s.status).toBe(200);
    expect(s.j).toMatchObject({ ok: true, paymentIntentId: expect.stringMatching(/^pi_stub_/), clientSecret: expect.stringContaining('_secret_') });
    const pending = (await account(u.id)).pendingTrialEnd!;
    expect(s.j.trialEnd).toBe(pending.toISOString());
    expect(Math.abs(pending.getTime() - (Date.now() + 72 * 3600e3))).toBeLessThan(5000);
    expect(pending.getMilliseconds()).toBe(0);
    expect((await billing.confirmIntent(s.j.paymentIntentId)).j).toEqual({ paymentIntent: { id: s.j.paymentIntentId, status: 'succeeded' } });
    const r = await billing.confirm({ paymentIntentId: s.j.paymentIntentId });
    expect(r.status).toBe(200);
    expect(r.j.state).toMatchObject({ access: true, status: 'trialing', mode: 'none', trialEndIsPreview: false, trialEnd: pending.toISOString(), hasDraft: false });
    const a = await account(u.id);
    expect(a).toMatchObject({ status: 'trialing', everSubscribed: true, pendingTrialEnd: null, pendingPaymentMethodId: null });
    expect(a.trialEnd!.toISOString()).toBe(pending.toISOString());          // computed once (D7)
    expect(a.trialStartedAt).not.toBeNull(); expect(a.trialCreditedAt).not.toBeNull();
    const subs = stubSubsOf(a.stripeCustomerId);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ id: a.stripeSubscriptionId, status: 'trialing', trial_end: pending.getTime() / 1000, default_payment_method: pm, metadata: { radar_pi: s.j.paymentIntentId } });
    expect((await biz(d.id))).toMatchObject({ status: 'active', timezone: 'Europe/Lisbon' });
    expect(await onboarded(d.id)).toBe(1);
    expect(await eventsOf(u.id, 'trial.started')).toHaveLength(1);
    expect(stubState().credits).toEqual([{ customer: a.stripeCustomerId, amount: -100, description: 'Card confirmation credit', key: `radar:credit:${s.j.paymentIntentId}` }]);
    expect((await db.select().from(schema.trialFingerprints).where(eq(schema.trialFingerprints.userId, u.id)))[0]).toMatchObject({ fingerprint: `fp_stub_${last4}`, paymentIntentId: s.j.paymentIntentId });
    expect(H.jar.get(BIZ_COOKIE)).toBe(d.id);
  });

  it('confirm twice, racing the webhook: one subscription, one trial.started, the draft committed once', async () => {
    const { u, d } = await payer();
    const { pi } = await pay(undefined, { confirm: false });
    const ev = D.pi(pi);
    const [r1, r2] = await Promise.all([billing.confirm({ paymentIntentId: pi }), D.deliver('payment_intent.succeeded', ev), billing.confirm({ paymentIntentId: pi })].map(p => p as Promise<any>)).then(x => [x[0], x[2]]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect((await billing.confirm({ paymentIntentId: pi })).status).toBe(200);
    expect(await D.deliver('payment_intent.succeeded', ev)).toBe('processed');   // a second delivery (new event id) is harmless
    const a = await account(u.id);
    expect(stubSubsOf(a.stripeCustomerId)).toHaveLength(1);
    expect(stubCalls('createSubscription')).toBe(1);
    expect(await eventsOf(u.id, 'trial.started')).toHaveLength(1);
    expect(await onboarded(d.id)).toBe(1);
    expect(stubState().credits).toHaveLength(1);
  });

  it('the webhook alone (tab closed after paying) activates and commits the draft', async () => {
    const { u, d } = await payer();
    const { pi } = await pay(undefined, { confirm: false });
    expect(await D.deliver('payment_intent.succeeded', D.pi(pi))).toBe('processed');
    expect(await account(u.id)).toMatchObject({ status: 'trialing', everSubscribed: true });
    expect((await biz(d.id)).status).toBe('active');
    expect(await eventsOf(u.id, 'trial.started')).toHaveLength(1);
    expect((await billing.state()).j).toMatchObject({ access: true, status: 'trialing' });
  });

  it('a decline leaves no subscription and status none; confirm answers 409 payment_not_succeeded', async () => {
    const { u, d } = await payer();
    const s = await billing.start('pm_stub_decline_0002');            // a decline never records a fingerprint
    const c = await billing.confirmIntent(s.j.paymentIntentId, 'decline');
    expect(c.status).toBe(200);
    expect(c.j.error).toMatchObject({ type: 'card_error', code: 'card_declined', decline_code: 'generic_decline' });
    const r = await billing.confirm({ paymentIntentId: s.j.paymentIntentId });
    expect([r.status, r.j.code]).toEqual([409, 'payment_not_succeeded']);
    expect(await account(u.id)).toMatchObject({ status: 'none', stripeSubscriptionId: null, everSubscribed: false });
    expect(stubCalls('createSubscription')).toBe(0);
    expect((await biz(d.id)).status).toBe('onboarding');
    // A declining card never succeeds, whatever the client claims.
    expect((await billing.confirmIntent(s.j.paymentIntentId, 'succeed')).j.error.type).toBe('card_error');
    // The failure webhook is tracked with codes only.
    await D.deliver('payment_intent.payment_failed', D.pi(s.j.paymentIntentId));
    expect((await eventsOf(u.id, 'trial.payment_failed'))[0]).toMatchObject({ ref: s.j.paymentIntentId, props: { code: 'card_declined', decline_code: 'generic_decline' } });
  });

  it('3-D Secure failed, then the same card again: the same PaymentIntent is reused and activates', async () => {
    const { u } = await payer();
    const tds = await card('3ds');
    const s1 = await billing.start(tds);
    expect((await billing.confirmIntent(s1.j.paymentIntentId, 'auth_fail')).j.error).toMatchObject({ code: 'payment_intent_authentication_failure' });
    const s2 = await billing.start(tds);
    expect(s2.j.paymentIntentId).toBe(s1.j.paymentIntentId);
    expect(s2.j.trialEnd).toBe(s1.j.trialEnd);
    await billing.confirmIntent(s2.j.paymentIntentId, 'succeed');
    expect((await billing.confirm({ paymentIntentId: s2.j.paymentIntentId })).j.state.access).toBe(true);
    // Another card replaces (and cancels) an unconfirmed PaymentIntent with a new one.
    const v = await payer();
    const a1 = await billing.start(await card());
    const a2 = await billing.start(await card());
    expect(a2.j.paymentIntentId).not.toBe(a1.j.paymentIntentId);
    expect(stubState().pis.get(a1.j.paymentIntentId)!.status).toBe('canceled');
    expect((await account(v.u.id)).trialPaymentIntentId).toBe(a2.j.paymentIntentId);
    expect((await account(u.id)).status).toBe('trialing');
  });

  it('a card that already had a trial gets 409 trial_used, before any $1', async () => {
    const used = await card();
    await payer(); await pay(used);
    const b = await payer();
    const r = await billing.start(used);
    expect([r.status, r.j.code]).toEqual([409, 'trial_used']);
    expect(r.j.error).toBe('This card has already been used for a free trial. Try a different card.');
    expect((await account(b.u.id)).trialPaymentIntentId).toBeNull();
  });

  it('an account that subscribed before gets 409 restart_required; one with access 409 already_active', async () => {
    const u = await F.user(); await as(u);
    await F.account(u.id, { everSubscribed: true, status: 'canceled' });
    expect((await billing.start('pm_stub_succeed_4242')).j.code).toBe('restart_required');
    await F.account(u.id, { status: 'trialing' });
    expect((await billing.start('pm_stub_succeed_4242')).j.code).toBe('already_active');
    await F.account(u.id, { status: 'none', everSubscribed: false, comp: true });
    expect((await billing.start('pm_stub_succeed_4242')).j.code).toBe('already_active');
    delete process.env.RADAR_BILLING;                                   // billing off: everyone has access
    await F.account(u.id, { comp: false });
    expect((await billing.start('pm_stub_succeed_4242')).j.code).toBe('already_active');
  });

  it('start when the previous $1 succeeded activates with no new charge and does not hang (one lock)', async () => {
    const { u, d } = await payer();
    const { pi } = await pay(undefined, { confirm: false });
    const r = await Promise.race([billing.start(await card()), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('start hung')), 5000))]);
    expect(r.status).toBe(200);
    expect(r.j).toMatchObject({ ok: true, activated: true, state: { access: true, status: 'trialing' } });
    expect(stubCalls('createPaymentIntent')).toBe(1);
    expect((await account(u.id)).trialPaymentIntentId).toBe(pi);
    expect((await biz(d.id)).status).toBe('active');
    expect(H.jar.get(BIZ_COOKIE)).toBe(d.id);
  });

  it('confirm with another user’s PaymentIntent gets 403 not_yours', async () => {
    await payer(); const { pi } = await pay(undefined, { confirm: false });
    const other = await payer();
    const r = await billing.confirm({ paymentIntentId: pi });
    expect([r.status, r.j.code]).toEqual([403, 'not_yours']);
    expect((await billing.confirm({ paymentIntentId: 'pi_stub_nope' })).status).toBe(403);
    expect((await billing.confirmIntent(pi)).status).toBe(404);          // the dev endpoint can't touch it either
    expect((await account(other.u.id))?.status ?? 'none').toBe('none');
  });

  it('late activation (trial_end under an hour away) uses a fresh 72h and is safe to retry', async () => {
    const { u } = await payer();
    const { pi } = await pay(undefined, { confirm: false });
    stubState().pis.get(pi)!.metadata.trial_end = String(Math.floor(Date.now() / 1000) + 600);
    const fetched = await stubProvider.getPaymentIntent(pi);
    // The first attempt dies after creating the subscription (as a crash would): the transaction rolls back.
    vi.spyOn(stubProvider, 'getPaymentMethod').mockRejectedValueOnce(new Error('network'));
    await expect(withBillingLock(u.id, (tx, later) => activateIn(stubProvider, tx, later, fetched, 'webhook'))).rejects.toThrow('network');
    expect((await account(u.id)).stripeSubscriptionId).toBeNull();
    expect(stubSubsOf((await account(u.id)).stripeCustomerId)).toHaveLength(1);
    const r = await billing.confirm({ paymentIntentId: pi });            // the retry adopts it
    expect(r.status).toBe(200);
    const a = await account(u.id);
    expect(stubSubsOf(a.stripeCustomerId)).toHaveLength(1);
    expect(a.trialEnd!.getTime()).toBeGreaterThan(Date.now() + 71 * 3600e3);
    expect(await eventsOf(u.id, 'trial.started')).toHaveLength(1);
  });

  it('auth and provider checks: 401 signed out; dev endpoints 404 unless the stub runs; 503 with no provider', async () => {
    H.jar.clear();
    expect((await billing.start('pm_stub_succeed_4242')).status).toBe(401);
    expect((await billing.state()).status).toBe(401);
    const { u } = await payer();
    setProviderNameForTests('none');
    expect((await billing.confirmIntent('pi_x')).status).toBe(404);
    expect((await billing.simulate('past_due')).status).toBe(404);
    // RADAR_BILLING on without a provider: access fails open (B19), and the billing endpoints answer 503.
    expect((await billing.start('pm_stub_succeed_1000')).j.code).toBe('billing_unavailable');
    process.env.RADAR_BILLING = 'off'; setProviderNameForTests(null);
    expect((await billing.state()).j).toMatchObject({ enforced: false, access: true, mode: 'none' });
    expect((await account(u.id))?.stripeCustomerId ?? null).toBeNull();
  });

  it('an unusable payment method gets 400 invalid_payment_method', async () => {
    await payer();
    const r = await billing.start('pm_not_a_stub_card');
    expect([r.status, r.j.code]).toEqual([400, 'invalid_payment_method']);
  });
});
