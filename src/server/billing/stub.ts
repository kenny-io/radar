// In-memory payment provider for dev and vitest (architecture §7.4): RADAR_DEV_STUBS=1 and no STRIPE_SECRET_KEY, never in
// production. Same interface as stripe.ts. Objects live in maps on globalThis (one process: the web server), so a dev
// server restart forgets them; unknown ids then answer 404 like Stripe. Idempotency keys replay the first response and
// reject a reused key with different parameters, as Stripe does, so key bugs show up in tests.
// PaymentMethods are not stored: `pm_stub_<scenario>_<last4>` (minted by the client stub) is parsed, fingerprint
// `fp_stub_<last4>`. Scenario `decline` always declines at confirmation.
import { env } from '../env';
import { PRICE_CENTS } from '@/lib/billing';
import type { SubStatus } from '@/lib/types';
import { ProviderError, type BillingProvider, type Invoice, type PaymentIntent, type PaymentMethod, type Subscription } from './provider';

if (env.isProd) throw new Error('The billing stub must never be loaded in production');

interface Cus { id: string; email: string; name: string; uid: string; defaultPm: string | null; balance: number }
interface SPI extends PaymentIntent { invoice: string | null; setup_future_usage: string | null }
interface SInv extends Invoice { customer: string; subscription: string | null; pi: string | null; applied: number }
interface SSub extends Subscription { seq: number }
interface Credit { customer: string; amount: number; description: string; key: string }
interface State {
  seq: number; customers: Map<string, Cus>; pmCustomer: Map<string, string>; pis: Map<string, SPI>; subs: Map<string, SSub>;
  invoices: Map<string, SInv>; credits: Credit[]; idem: Map<string, { args: string; result: unknown }>; calls: { method: string; key?: string }[];
}
const fresh = (): State => ({ seq: 0, customers: new Map(), pmCustomer: new Map(), pis: new Map(), subs: new Map(), invoices: new Map(), credits: [], idem: new Map(), calls: [] });
const g = globalThis as unknown as { __radarBillingStub?: State };
const S = () => (g.__radarBillingStub ||= fresh());
/** Tests: forget everything. */
export function stubReset() { g.__radarBillingStub = fresh(); }
/** Tests and dev: the raw store (calls, credits, objects). */
export const stubState = () => S();

const nid = (p: string) => `${p}_stub_${(++S().seq).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const nowSec = () => Math.floor(Date.now() / 1000);
const MONTH = 30 * 86400;
const copy = <T>(v: T): T => structuredClone(v);
const missing = (what: string, id: string) => new ProviderError(`No such ${what}: '${id}'`, 404, 'invalid_request_error', 'resource_missing');
const log = (method: string, key?: string) => { S().calls.push({ method, key }); };

/** Replays the first response for a key; a reused key with other parameters is an error (Stripe `idempotency_error`). */
function idem<T>(method: string, key: string, args: unknown, run: () => T): T {
  const s = S(); log(method, key);
  const a = JSON.stringify(args); const hit = s.idem.get(key);
  if (hit) {
    if (hit.args !== a) throw new ProviderError('Keys for idempotent requests can only be used with the same parameters they were first used with.', 400, 'idempotency_error');
    return copy(hit.result) as T;
  }
  const result = run();
  s.idem.set(key, { args: a, result: copy(result) });
  return copy(result);
}

const PM_RE = /^pm_stub_([a-z0-9]+)_(\d{4})$/;
export const stubScenarioOf = (pm: string | null | undefined) => (pm && PM_RE.exec(pm)?.[1]) || null;
function pmOf(id: string): PaymentMethod {
  const m = PM_RE.exec(id);
  if (!m) throw missing('PaymentMethod', id);
  return { id, type: 'card', customer: S().pmCustomer.get(id) || null, card: { fingerprint: `fp_stub_${m[2]}` } };
}
/** Customers survive a dev server restart in the database but not here: a `cus_stub_*` id is recreated on first use. */
function cus(id: string): Cus {
  const s = S(); let c = s.customers.get(id);
  if (!c) { if (!id.startsWith('cus_stub_')) throw missing('customer', id); c = { id, email: '', name: '', uid: '', defaultPm: null, balance: 0 }; s.customers.set(id, c); }
  return c;
}
const sub = (id: string) => { const x = S().subs.get(id); if (!x) throw missing('subscription', id); return x; };
const pi = (id: string) => { const x = S().pis.get(id); if (!x) throw missing('payment_intent', id); return x; };
const inv = (id: string) => { const x = S().invoices.get(id); if (!x) throw missing('invoice', id); return x; };
const pubSub = (x: SSub): Subscription => { const { seq: _s, ...rest } = x; return copy(rest); };
const pubPI = (x: SPI): PaymentIntent => { const { invoice: _i, setup_future_usage: _f, ...rest } = x; return copy(rest); };

/** An invoice for one month of the price, the customer's credit balance applied first (the $1 credit, §21.3). */
function invoiceFor(s: SSub, pm: string | null): SInv {
  const c = cus(s.customer);
  const applied = Math.min(PRICE_CENTS, Math.max(0, -c.balance)); c.balance += applied;
  const i: SInv = { id: nid('in'), status: 'open', amount_due: PRICE_CENTS - applied, client_secret: null, customer: s.customer, subscription: s.id, pi: null, applied };
  if (i.amount_due === 0) i.status = 'paid';
  else {
    const p: SPI = { id: nid('pi'), status: 'requires_payment_method', amount: i.amount_due, currency: 'usd', customer: s.customer, payment_method: pm, client_secret: null, metadata: {}, last_payment_error: null, invoice: i.id, setup_future_usage: null };
    p.client_secret = `${p.id}_secret_stub`; S().pis.set(p.id, p); i.pi = p.id; i.client_secret = p.client_secret;
  }
  S().invoices.set(i.id, i); s.latest_invoice = i.id;
  return i;
}

export const stubProvider: BillingProvider = {
  name: 'stub',
  async createCustomer(p, key) {
    return idem('createCustomer', key, p, () => { const c: Cus = { id: nid('cus'), email: p.email, name: p.name, uid: p.uid, defaultPm: null, balance: 0 }; S().customers.set(c.id, c); return { id: c.id }; });
  },
  async setCustomerDefaultPaymentMethod(customer, pm, key) {
    idem('setCustomerDefaultPaymentMethod', key, { customer, pm }, () => { pmOf(pm); cus(customer).defaultPm = pm; return null; });
  },
  async attachPaymentMethod(pm, customer, key) {
    idem('attachPaymentMethod', key, { pm, customer }, () => { pmOf(pm); cus(customer); S().pmCustomer.set(pm, customer); return null; });
  },
  async getPaymentMethod(id) { log('getPaymentMethod'); return pmOf(id); },
  async createPaymentIntent(p, key) {
    return idem('createPaymentIntent', key, p, () => {
      cus(p.customer); pmOf(p.paymentMethod);
      const x: SPI = { id: nid('pi'), status: 'requires_confirmation', amount: p.amount, currency: p.currency, customer: p.customer, payment_method: p.paymentMethod, client_secret: null, metadata: { ...p.metadata }, last_payment_error: null, invoice: null, setup_future_usage: 'off_session' };
      x.client_secret = `${x.id}_secret_stub`; S().pis.set(x.id, x); return pubPI(x);
    });
  },
  async getPaymentIntent(id) { log('getPaymentIntent'); return pubPI(pi(id)); },
  async cancelPaymentIntent(id, key) {
    idem('cancelPaymentIntent', key, { id }, () => {
      const x = pi(id);
      if (x.status === 'succeeded' || x.status === 'processing') throw new ProviderError(`You cannot cancel this PaymentIntent because it has a status of ${x.status}.`, 400, 'invalid_request_error', 'payment_intent_unexpected_state');
      x.status = 'canceled'; return null;
    });
  },
  async listSubscriptions(customer) {
    log('listSubscriptions');
    return [...S().subs.values()].filter(x => x.customer === customer).sort((a, b) => b.seq - a.seq).slice(0, 20).map(pubSub);
  },
  async createSubscription(p, key) {
    return idem('createSubscription', key, p, () => {
      cus(p.customer); pmOf(p.defaultPaymentMethod);
      const x: SSub = { id: nid('sub'), status: 'active', customer: p.customer, trial_end: null, cancel_at_period_end: false, current_period_end: nowSec() + MONTH, metadata: { ...p.metadata }, latest_invoice: null, default_payment_method: p.defaultPaymentMethod, seq: ++S().seq };
      S().subs.set(x.id, x);
      let clientSecret: string | null = null;
      if (p.trialEnd) {
        x.status = 'trialing'; x.trial_end = p.trialEnd; x.current_period_end = p.trialEnd;
        const i: SInv = { id: nid('in'), status: 'paid', amount_due: 0, client_secret: null, customer: x.customer, subscription: x.id, pi: null, applied: 0 };
        S().invoices.set(i.id, i); x.latest_invoice = i.id;
      } else if (p.incomplete) {
        const i = invoiceFor(x, p.defaultPaymentMethod);
        if (i.status === 'open') { x.status = 'incomplete'; clientSecret = i.client_secret; }
      }
      return { sub: pubSub(x), clientSecret };
    });
  },
  async getSubscription(id) { log('getSubscription'); return pubSub(sub(id)); },
  async setSubscriptionPaymentMethod(id, pm, key) {
    idem('setSubscriptionPaymentMethod', key, { id, pm }, () => { pmOf(pm); sub(id).default_payment_method = pm; return null; });
  },
  async cancelSubscription(id) { log('cancelSubscription'); const x = sub(id); x.status = 'canceled'; x.cancel_at_period_end = false; },
  async getInvoice(id) { log('getInvoice'); const { customer: _c, subscription: _s, pi: _p, applied: _a, ...i } = inv(id); return copy(i); },
  async voidInvoice(id, key) {
    idem('voidInvoice', key, { id }, () => {
      const i = inv(id);
      if (i.status !== 'open') throw new ProviderError(`You can only void an open invoice; this one is ${i.status}.`, 400, 'invalid_request_error');
      i.status = 'void';
      cus(i.customer).balance -= i.applied; i.applied = 0;                 // the credit it used goes back, as on Stripe
      const x = i.pi ? S().pis.get(i.pi) : undefined;
      if (x && x.status !== 'succeeded') x.status = 'canceled';
      return null;
    });
  },
  async getCustomerBalance(customer) { log('getCustomerBalance'); return cus(customer).balance; },
  async creditBalance(customer, cents, description, key) {
    idem('creditBalance', key, { customer, cents, description }, () => { cus(customer).balance -= cents; S().credits.push({ customer, amount: -cents, description, key }); return null; });
  },
  async getPrice(id) { log('getPrice'); return { id, unit_amount: PRICE_CENTS, currency: 'usd', interval: 'month' }; },
};

export type StubOutcome = 'succeed' | 'decline' | 'auth_fail';
export interface StubEvent { id: string; type: string; data: { object: any } }
export const stubEvent = (type: string, object: any): StubEvent => ({ id: nid('evt'), type, data: { object: copy(object) } });
type ConfirmResult = { paymentIntent: { id: string; status: string } } | { error: { type: string; code?: string; decline_code?: string; message: string; payment_intent: { id: string; status: string } } };

/** stripe.confirmCardPayment, server side (POST /api/billing/dev/confirm-intent). Returns the stripe-js result shape and
 *  the webhook events Stripe would send, which the caller may deliver. A trial check that succeeds attaches its card to
 *  the customer (setup_future_usage); an invoice payment marks the invoice paid and the subscription active. */
export function stubConfirmIntent(id: string, outcome: StubOutcome): { result: ConfirmResult; events: StubEvent[] } {
  const x = pi(id);
  const brief = () => ({ id: x.id, status: x.status });
  if (x.status === 'succeeded' || x.status === 'canceled' || x.status === 'processing')
    return { result: { error: { type: 'invalid_request_error', code: 'payment_intent_unexpected_state', message: `This PaymentIntent's status is ${x.status}.`, payment_intent: brief() } }, events: [] };
  const i = x.invoice ? inv(x.invoice) : null;
  const s = i?.subscription ? sub(i.subscription) : null;
  const pm = x.payment_method || s?.default_payment_method || (x.customer ? cus(x.customer).defaultPm : null);
  const fail = (type: string, code: string, message: string, decline_code?: string) => {
    x.status = 'requires_payment_method'; x.last_payment_error = { type, code, decline_code };
    const events = [stubEvent('payment_intent.payment_failed', pubPI(x))];
    if (i) events.push(stubEvent('invoice.payment_failed', { id: i.id, customer: i.customer }));
    return { result: { error: { type, code, ...(decline_code ? { decline_code } : {}), message, payment_intent: brief() } }, events };
  };
  if (!pm) return fail('invalid_request_error', 'payment_intent_unexpected_state', 'This PaymentIntent has no payment method.');
  if (outcome === 'decline' || stubScenarioOf(pm) === 'decline') return fail('card_error', 'card_declined', 'Your card was declined.', 'generic_decline');
  if (outcome === 'auth_fail') return fail('invalid_request_error', 'payment_intent_authentication_failure', 'We are unable to authenticate your payment method.');
  x.status = 'succeeded'; x.payment_method = pm; x.last_payment_error = null;
  if (x.setup_future_usage && x.customer) S().pmCustomer.set(pm, x.customer);
  const events = [stubEvent('payment_intent.succeeded', pubPI(x))];
  if (i && s) {
    i.status = 'paid'; s.status = 'active'; s.current_period_end = nowSec() + MONTH; s.trial_end = null;
    events.push(stubEvent('invoice.paid', { id: i.id, customer: i.customer }), stubEvent('customer.subscription.updated', pubSub(s)));
  }
  return { result: { paymentIntent: brief() }, events };
}

/** POST /api/billing/dev/simulate: move a subscription as Stripe's clock and retries would. past_due / unpaid open a
 *  month's invoice (the credit applied); active pays it and starts a period; canceled ends it. */
export function stubSetStatus(id: string, status: SubStatus): Subscription {
  const x = sub(id);
  const open = x.latest_invoice ? S().invoices.get(x.latest_invoice) : undefined;
  if (status === 'past_due' || status === 'unpaid') { if (open?.status !== 'open') invoiceFor(x, x.default_payment_method); x.trial_end = null; }
  if (status === 'active') { if (open?.status === 'open') open.status = 'paid'; x.trial_end = null; x.current_period_end = nowSec() + MONTH; }
  if (status === 'canceled' || status === 'incomplete_expired') { x.cancel_at_period_end = false; if (open?.status === 'open') open.status = 'void'; }
  x.status = status as SubStatus;
  return pubSub(x);
}
