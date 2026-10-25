// Stripe over REST with fetch (architecture §7.2); no SDK dependency. Bodies are application/x-www-form-urlencoded
// with bracket keys (items[0][price], metadata[k], expand[]), Stripe-Version is pinned (STRIPE_API_VERSION), and every
// POST carries the caller's deterministic Idempotency-Key (radar:…), so a retry within 24h replays the first response.
// A 409 (the same key still in flight) is retried 1s × 3; a network failure twice. Other errors are not retried: Stripe
// saves the result of a request that ran, so resending the key would replay it. Errors become ProviderError; request
// bodies, headers and secrets are never logged.
import { env } from '../env';
import { ProviderError, type BillingProvider, type Invoice, type PaymentIntent, type PaymentMethod, type Price, type Subscription } from './provider';

const API = 'https://api.stripe.com/v1';
type Params = { [k: string]: unknown };

const encKey = (k: string) => encodeURIComponent(k).replace(/%5B/gi, '[').replace(/%5D/gi, ']');
/** `{items: [{price: 'p'}], metadata: {k: 'v'}, expand: ['a']}` → `items[0][price]=p&metadata[k]=v&expand[]=a`. */
export function formEncode(params: Params): string {
  const out: string[] = [];
  const walk = (v: unknown, key: string) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, x !== null && typeof x === 'object' ? `${key}[${i}]` : `${key}[]`)); return; }
    if (typeof v === 'object') { for (const [k, x] of Object.entries(v as Params)) walk(x, key ? `${key}[${k}]` : k); return; }
    out.push(`${encKey(key)}=${encodeURIComponent(String(v))}`);
  };
  walk(params, '');
  return out.join('&');
}

export interface StripeDeps { fetch: typeof fetch; sleep: (ms: number) => Promise<void>; secretKey: () => string; apiVersion: () => string }
const deps: StripeDeps = {
  fetch: (...a) => fetch(...a), sleep: ms => new Promise(r => setTimeout(r, ms)),
  secretKey: () => env.stripeSecretKey, apiVersion: () => env.stripeApiVersion,
};
/** Tests: a mocked fetch, no real waits. */
export function setStripeDepsForTests(d: Partial<StripeDeps>) { Object.assign(deps, d); }

export async function stripeRequest<T = any>(method: 'GET' | 'POST' | 'DELETE', path: string, o: { params?: Params; key?: string } = {}): Promise<T> {
  const secret = deps.secretKey();
  if (!secret) throw new ProviderError('Stripe is not configured', 503, 'api_error');
  if (method === 'POST' && !o.key) throw new Error(`Stripe POST ${path} without an Idempotency-Key`);
  const qs = method === 'GET' && o.params ? formEncode(o.params) : '';
  const body = method === 'POST' ? formEncode(o.params || {}) : undefined;
  const headers: Record<string, string> = { Authorization: `Bearer ${secret}`, 'Stripe-Version': deps.apiVersion() };
  if (method === 'POST') { headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers['Idempotency-Key'] = o.key!; }
  const url = `${API}${path}${qs ? '?' + qs : ''}`;
  for (let conflicts = 0, drops = 0; ;) {
    let res: Response;
    try { res = await deps.fetch(url, { method, headers, body }); }
    catch (e: any) {
      if (drops++ < 2) { await deps.sleep(500); continue; }
      throw new ProviderError(`Stripe ${method} ${path.split('/')[1]} failed: ${e?.message || 'network error'}`, 502, 'api_connection_error');
    }
    const j: any = await res.json().catch(() => ({}));
    if (res.ok) return j as T;
    if (res.status === 409 && conflicts++ < 3) { await deps.sleep(1000); continue; }
    const err = j?.error || {};
    throw new ProviderError(err.message || `Stripe ${method} ${path.split('/')[1]} answered ${res.status}`, res.status, err.type || 'api_error', err.code, err.decline_code);
  }
}

const seg = (id: string) => encodeURIComponent(id);
const idOf = (v: any): string | null => (v == null ? null : typeof v === 'string' ? v : v.id ?? null);
const toSub = (s: any): Subscription => ({
  id: s.id, status: s.status, customer: idOf(s.customer)!, trial_end: s.trial_end ?? null, cancel_at_period_end: !!s.cancel_at_period_end,
  current_period_end: s.items?.data?.[0]?.current_period_end ?? null, metadata: s.metadata || {},
  latest_invoice: idOf(s.latest_invoice), default_payment_method: idOf(s.default_payment_method),
});
const toPI = (p: any): PaymentIntent => ({
  id: p.id, status: p.status, amount: p.amount, currency: p.currency, customer: idOf(p.customer), payment_method: idOf(p.payment_method),
  client_secret: p.client_secret ?? null, metadata: p.metadata || {},
  last_payment_error: p.last_payment_error ? { type: p.last_payment_error.type, code: p.last_payment_error.code, decline_code: p.last_payment_error.decline_code } : null,
});
const toPM = (m: any): PaymentMethod => ({ id: m.id, type: m.type, customer: idOf(m.customer), card: m.card ? { fingerprint: m.card.fingerprint ?? null } : null });
/** Basil and later: the invoice's PaymentIntent secret is `confirmation_secret.client_secret` (expanded). */
const toInvoice = (i: any): Invoice => ({ id: i.id, status: i.status, amount_due: i.amount_due, client_secret: i.confirmation_secret?.client_secret ?? null });

export const stripeProvider: BillingProvider = {
  name: 'stripe',
  async createCustomer(p, key) { return { id: (await stripeRequest('POST', '/customers', { params: { email: p.email, name: p.name, metadata: { radar_user_id: p.uid } }, key })).id }; },
  async setCustomerDefaultPaymentMethod(customer, pm, key) { await stripeRequest('POST', `/customers/${seg(customer)}`, { params: { invoice_settings: { default_payment_method: pm } }, key }); },
  async attachPaymentMethod(pm, customer, key) { await stripeRequest('POST', `/payment_methods/${seg(pm)}/attach`, { params: { customer }, key }); },
  async getPaymentMethod(id) { return toPM(await stripeRequest('GET', `/payment_methods/${seg(id)}`)); },
  async createPaymentIntent(p, key) {
    return toPI(await stripeRequest('POST', '/payment_intents', { key, params: {
      amount: p.amount, currency: p.currency, customer: p.customer, payment_method: p.paymentMethod, payment_method_types: ['card'],
      setup_future_usage: 'off_session', description: p.description, metadata: p.metadata,
    } }));
  },
  async getPaymentIntent(id) { return toPI(await stripeRequest('GET', `/payment_intents/${seg(id)}`)); },
  async cancelPaymentIntent(id, key) { await stripeRequest('POST', `/payment_intents/${seg(id)}/cancel`, { key }); },
  async listSubscriptions(customer) { return ((await stripeRequest('GET', '/subscriptions', { params: { customer, status: 'all', limit: 20 } })).data || []).map(toSub); },
  async createSubscription(p, key) {
    const params: Params = { customer: p.customer, items: [{ price: p.price }], default_payment_method: p.defaultPaymentMethod, metadata: p.metadata };
    if (p.trialEnd) Object.assign(params, { trial_end: p.trialEnd, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } });
    if (p.incomplete) Object.assign(params, { payment_behavior: 'default_incomplete', payment_settings: { save_default_payment_method: 'on_subscription' }, expand: ['latest_invoice.confirmation_secret'] });
    const s = await stripeRequest('POST', '/subscriptions', { params, key });
    return { sub: toSub(s), clientSecret: s.latest_invoice?.confirmation_secret?.client_secret ?? null };
  },
  async getSubscription(id) { return toSub(await stripeRequest('GET', `/subscriptions/${seg(id)}`)); },
  async setSubscriptionPaymentMethod(id, pm, key) { await stripeRequest('POST', `/subscriptions/${seg(id)}`, { params: { default_payment_method: pm }, key }); },
  async cancelSubscription(id) { await stripeRequest('DELETE', `/subscriptions/${seg(id)}`); },
  async getInvoice(id) { return toInvoice(await stripeRequest('GET', `/invoices/${seg(id)}`, { params: { expand: ['confirmation_secret'] } })); },
  // Voiding returns any applied customer balance to the customer (https://docs.stripe.com/changelog/2019-12-03/customer-balances-returned-voided-invoices).
  async voidInvoice(id, key) { await stripeRequest('POST', `/invoices/${seg(id)}/void`, { key }); },
  async getCustomerBalance(customer) {
    const c = await stripeRequest('GET', `/customers/${seg(customer)}`);
    return c?.deleted ? null : typeof c?.balance === 'number' ? c.balance : 0;
  },
  async creditBalance(customer, cents, description, key) {
    // A negative amount is a credit, applied to the customer's next invoice (https://docs.stripe.com/billing/customer/balance).
    await stripeRequest('POST', `/customers/${seg(customer)}/balance_transactions`, { params: { amount: -Math.abs(cents), currency: 'usd', description }, key });
  },
  async getPrice(id): Promise<Price> { const p = await stripeRequest('GET', `/prices/${seg(id)}`); return { id: p.id, unit_amount: p.unit_amount ?? null, currency: p.currency, interval: p.recurring?.interval ?? null }; },
};
