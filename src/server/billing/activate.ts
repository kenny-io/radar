// The $1 card confirmation and the trial subscription (architecture §7.2 start and activate; §21.3 the $1 is credited to
// month one; §21.6 a card that already had a trial is refused). activateIn is the single path to a trial subscription.
import { eq } from 'drizzle-orm';
import { schema } from '../db';
import { track } from '../events';
import { limitBilling } from '../abuse/rateLimit';
import { FEE_CENTS } from '@/lib/billing';
import { accountGrants, ownAccess } from './access';
import { asInvalidCard, checkPriceOnce, ensureCustomer, lockAccount, needProvider, nullIfMissing, priceId, withBillingLock } from './account';
import { commitDraft, draftOf, type Later, type Tx } from './draft';
import { BillingError } from './errors';
import { ProviderError, type BillingProvider, type PaymentIntent, type Subscription } from './provider';
import { pendingFresh, trialEndFrom } from './state';
import { writeSubscription } from './sync';

const A = schema.billingAccounts, F = schema.trialFingerprints;
const UNCONFIRMED = ['requires_payment_method', 'requires_confirmation', 'requires_action'];
const unixIso = (s: string | number | undefined) => new Date(Number(s) * 1000).toISOString();
const nowSec = () => Math.floor(Date.now() / 1000);
type BillingUser = { id: string; email: string; name: string };

export type StartResult = { clientSecret: string; paymentIntentId: string; trialEnd: string } | { activated: true; committed: string | null };

/** POST /api/billing/start: create (or reuse) the $1 trial-check PaymentIntent for this card. */
export async function start(u: BillingUser, pmId: string, ip: string): Promise<StartResult> {
  const p = await needProvider();
  if (await ownAccess({ id: u.id, email: u.email, guest: false })) throw BillingError.alreadyActive();
  await limitBilling(u.id, ip);
  const price = priceId(p); await checkPriceOnce(p, price);
  const customer = await ensureCustomer(p, u);
  return withBillingLock(u.id, async (tx, later): Promise<StartResult> => {
    const a = await lockAccount(tx, u.id);
    if (accountGrants(a)) throw BillingError.alreadyActive();
    if (a.everSubscribed) throw BillingError.restartRequired();
    let replaced = 'first';
    if (a.trialPaymentIntentId) {
      const prev = await p.getPaymentIntent(a.trialPaymentIntentId).catch(nullIfMissing);
      // A $1 that already went through: activate, never charge again.
      if (prev?.status === 'succeeded') return { activated: true, committed: (await activateIn(p, tx, later, prev, 'start')).committed };
      if (prev?.status === 'processing') throw BillingError.paymentProcessing();
      // Same card within the hour, not confirmed yet (or declined, or 3-D Secure failed): the same PaymentIntent again.
      if (prev && UNCONFIRMED.includes(prev.status) && prev.client_secret && a.pendingPaymentMethodId === pmId && pendingFresh(a))
        return { clientSecret: prev.client_secret, paymentIntentId: prev.id, trialEnd: unixIso(prev.metadata.trial_end) };
      if (prev && UNCONFIRMED.includes(prev.status))
        await p.cancelPaymentIntent(prev.id, `radar:picancel:${prev.id}`).catch((e: any) => console.warn(`[billing] cancel ${prev.id} failed:`, e?.message));
      replaced = a.trialPaymentIntentId;
    }
    const pm = await p.getPaymentMethod(pmId).catch(asInvalidCard);
    if (pm.type !== 'card') throw BillingError.invalidPaymentMethod();
    const fp = pm.card?.fingerprint;
    if (fp && (await tx.select({ f: F.fingerprint }).from(F).where(eq(F.fingerprint, fp)).limit(1))[0]) throw BillingError.trialUsed();
    if (pm.customer && pm.customer !== customer) throw BillingError.invalidPaymentMethod();
    // A new trial end (now + 72h, to the second) for every new PaymentIntent; the key also names the one it replaces, so
    // a retry of this request replays it while a later attempt with the same card never replays a canceled one.
    const T = trialEndFrom(); const unix = Math.floor(T.getTime() / 1000);
    const pi = await p.createPaymentIntent({
      amount: FEE_CENTS, currency: 'usd', customer, paymentMethod: pmId, description: 'Radar card confirmation',
      metadata: { radar_user_id: u.id, purpose: 'trial_check', trial_end: String(unix) },
    }, `radar:pi:${u.id}:${pmId}:${unix}:${replaced}`).catch(asInvalidCard);
    await tx.update(A).set({ trialPaymentIntentId: pi.id, pendingTrialEnd: T, pendingPaymentMethodId: pmId, pendingSetAt: new Date(), updatedAt: new Date() }).where(eq(A.userId, u.id));
    console.info(`[billing] ${u.id} trial check ${pi.id} created`);
    if (!pi.client_secret) throw BillingError.unavailable();
    return { clientSecret: pi.client_secret, paymentIntentId: pi.id, trialEnd: unixIso(pi.metadata.trial_end) };
  });
}

async function adopt(p: BillingProvider, customer: string, piId: string): Promise<Subscription | null> {
  return (await p.listSubscriptions(customer)).find(s => s.metadata?.radar_pi === piId) || null;
}

export interface Activated { subId: string | null; committed: string | null }

/** A succeeded trial check → the trial subscription. Runs inside withBillingLock(metadata.radar_user_id); confirm, the
 *  webhook and start may all call it for the same PaymentIntent, in any order, any number of times.
 *  - Once the account has a subscription on record (everSubscribed), nothing is created, adopted or overwritten from a
 *    trial PaymentIntent: a late replay after a restart can't regress the account, and a stray $1 can't add a second
 *    subscription. Only the account's own trial check finishes its once-only steps.
 *  - Otherwise adopt a subscription made for this PaymentIntent (a crash after creation), else create it.
 *  - Once only (trialStartedAt): the card fingerprint, the saved draft committed, trial.started.
 *  - Until it succeeds (trialCreditedAt): the $1 credited to the next invoice. */
export async function activateIn(p: BillingProvider, tx: Tx, later: Later, pi: PaymentIntent, via: 'confirm' | 'webhook' | 'start'): Promise<Activated> {
  if (pi.metadata?.purpose !== 'trial_check' || pi.amount !== FEE_CENTS || pi.currency !== 'usd' || !pi.metadata.radar_user_id) throw BillingError.notYours();
  if (pi.status !== 'succeeded' || !pi.payment_method) throw BillingError.notSucceeded();
  const uid = pi.metadata.radar_user_id;
  const a = await lockAccount(tx, uid);
  const customer = a.stripeCustomerId;
  if (!customer || pi.customer !== customer) {
    if (via === 'confirm') throw BillingError.notYours();
    console.warn(`[billing] trial check ${pi.id} is not for ${uid}'s customer; ignored`);
    return { subId: null, committed: null };
  }
  let subId = a.stripeSubscriptionId;
  if (a.everSubscribed) {
    if (pi.id !== a.trialPaymentIntentId) { console.warn(`[billing] trial check ${pi.id} ignored: ${uid} already has subscription ${subId}`); return { subId, committed: null }; }
  } else {
    const t0 = Number(pi.metadata.trial_end) || 0;
    // Late activation (a webhook retried days later): a fresh 72h, and a key that differs because T does.
    const T = t0 - nowSec() < 3600 ? Math.floor(trialEndFrom().getTime() / 1000) : t0;
    let sub = await adopt(p, customer, pi.id);
    if (!sub) {
      await checkPriceOnce(p, priceId(p));
      try {
        sub = (await p.createSubscription({ customer, price: priceId(p), defaultPaymentMethod: pi.payment_method, trialEnd: T, metadata: { radar_user_id: uid, radar_pi: pi.id } }, `radar:sub:${pi.id}:${T}`)).sub;
      } catch (e) {
        // 409: the same key is in flight elsewhere (the client already retried it); whoever finishes made it.
        if (!(e instanceof ProviderError && e.status === 409) || !(sub = await adopt(p, customer, pi.id))) throw e;
      }
    }
    await p.setCustomerDefaultPaymentMethod(customer, pi.payment_method, `radar:cusdpm:${pi.id}`)
      .catch((e: any) => console.warn(`[billing] customer default card for ${uid} not set:`, e?.message));
    await writeSubscription(tx, later, a, sub, { trialPaymentIntentId: pi.id, pendingTrialEnd: null, pendingPaymentMethodId: null, pendingSetAt: null });
    subId = sub.id;
  }
  let committed: string | null = null;
  if (!a.trialStartedAt) {
    const fp = (await p.getPaymentMethod(pi.payment_method)).card?.fingerprint;
    if (fp) await tx.insert(F).values({ fingerprint: fp, userId: uid, paymentIntentId: pi.id }).onConflictDoNothing();
    await tx.update(A).set({ trialStartedAt: new Date() }).where(eq(A.userId, uid));
    const d = await draftOf(uid, tx);
    if (d?.onboarding?.savedAt) committed = await commitDraft(d.id, tx, later);
    later.push(() => track('trial.started', { uid, ref: subId, props: { via } }));
  }
  if (!a.trialCreditedAt) {
    try {
      await p.creditBalance(customer, FEE_CENTS, 'Card confirmation credit', `radar:credit:${pi.id}`);
      await tx.update(A).set({ trialCreditedAt: new Date() }).where(eq(A.userId, uid));
    } catch (e: any) { console.error(`[billing] card confirmation credit for ${pi.id} failed; retried on the next activation:`, e?.message); }
  }
  return { subId, committed };
}
