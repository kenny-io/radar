// The payment provider interface (architecture §7). stripe.ts implements it over REST; stub.ts in memory for dev and tests.
// Only the subset of each Stripe object Radar reads. The stub is imported dynamically, so production never loads it.
import { PRICE_CENTS } from '@/lib/billing';
import type { SubStatus } from '@/lib/types';
import { providerName } from './config';

export type PIStatus = 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'requires_capture' | 'canceled' | 'succeeded';
export interface PaymentIntent {
  id: string; status: PIStatus; amount: number; currency: string; customer: string | null; payment_method: string | null;
  client_secret: string | null; metadata: Record<string, string>;
  last_payment_error?: { type?: string; code?: string; decline_code?: string } | null;
}
export interface PaymentMethod { id: string; type: string; customer: string | null; card: { fingerprint: string | null } | null }
export interface Subscription {
  id: string; status: SubStatus; customer: string; trial_end: number | null; cancel_at_period_end: boolean;
  /** items.data[0].current_period_end (Basil and later) */
  current_period_end: number | null; metadata: Record<string, string>; latest_invoice: string | null; default_payment_method: string | null;
}
export interface Invoice { id: string; status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void'; amount_due: number; client_secret: string | null }
export interface Price { id: string; unit_amount: number | null; currency: string; interval: string | null }
/** The stub's monthly price, used when STRIPE_PRICE_ID is unset and the provider is the stub. */
export const STUB_PRICE_ID = 'price_stub_monthly';

/** A provider error, mapped from Stripe's `{error: {type, code, decline_code}}`. Messages never include secrets. */
export class ProviderError extends Error {
  constructor(message: string, public status: number, public type = 'api_error', public code?: string, public declineCode?: string) { super(message); }
}

export interface CreatePI { amount: number; currency: string; customer: string; paymentMethod: string; description: string; metadata: Record<string, string> }
export interface CreateSub {
  customer: string; price: string; defaultPaymentMethod: string; metadata: Record<string, string>;
  /** Trial subscription: trial_end (unix) with end_behavior missing_payment_method=cancel. */
  trialEnd?: number;
  /** Restart: payment_behavior=default_incomplete, save the card on the subscription, expand the invoice's confirmation secret. */
  incomplete?: boolean;
}

export interface BillingProvider {
  name: 'stripe' | 'stub';
  createCustomer(p: { email: string; name: string; uid: string }, key: string): Promise<{ id: string }>;
  setCustomerDefaultPaymentMethod(customer: string, pm: string, key: string): Promise<void>;
  attachPaymentMethod(pm: string, customer: string, key: string): Promise<void>;
  getPaymentMethod(id: string): Promise<PaymentMethod>;
  createPaymentIntent(p: CreatePI, key: string): Promise<PaymentIntent>;
  getPaymentIntent(id: string): Promise<PaymentIntent>;
  cancelPaymentIntent(id: string, key: string): Promise<void>;
  /** status=all, newest first, up to 20 */
  listSubscriptions(customer: string): Promise<Subscription[]>;
  createSubscription(p: CreateSub, key: string): Promise<{ sub: Subscription; clientSecret: string | null }>;
  getSubscription(id: string): Promise<Subscription>;
  setSubscriptionPaymentMethod(id: string, pm: string, key: string): Promise<void>;
  cancelSubscription(id: string): Promise<void>;
  /** With the confirmation secret expanded (`client_secret`). */
  getInvoice(id: string): Promise<Invoice>;
  /** Void an open invoice: it can't be paid any more and any customer balance it used goes back to the customer. */
  voidInvoice(id: string, key: string): Promise<void>;
  /** The customer's invoice balance in cents (negative is a credit the next finalized invoice uses first); null if deleted. */
  getCustomerBalance(customer: string): Promise<number | null>;
  /** A negative customer balance transaction: credited to the next invoice. */
  creditBalance(customer: string, cents: number, description: string, key: string): Promise<void>;
  getPrice(id: string): Promise<Price>;
}

export async function getProvider(): Promise<BillingProvider | null> {
  const n = providerName();
  if (n === 'stripe') return (await import('./stripe')).stripeProvider;
  if (n === 'stub') return (await import('./stub')).stubProvider;
  return null;
}

/** amount_due of the subscription's open latest invoice (past_due/unpaid restart), else null. */
export async function openInvoiceCents(subId: string): Promise<number | null> {
  const p = await getProvider();
  if (!p) return null;
  const s = await p.getSubscription(subId);
  if (!s.latest_invoice) return null;
  const inv = await p.getInvoice(s.latest_invoice);
  return inv.status === 'open' ? inv.amount_due : null;
}

/** Statuses whose latest invoice is the one a restart pays (restart.ts reuses it, or voids it and the credit comes back). */
const INVOICED = ['past_due', 'unpaid', 'incomplete'];
/** What a restart charges today, for /start-trial (D1): the open invoice's amount_due when there is one; otherwise a new
 *  month at the price less the customer's balance, which Stripe applies to the next invoice (an unused $1 credit makes
 *  it $49). Null when the provider can't say; the state then shows the price. */
export async function restartDueCents(a: { stripeCustomerId: string | null; stripeSubscriptionId: string | null; status: string }): Promise<number | null> {
  if (a.stripeSubscriptionId && INVOICED.includes(a.status)) {
    const open = await openInvoiceCents(a.stripeSubscriptionId);
    if (open != null) return open;
  }
  const p = a.stripeCustomerId ? await getProvider() : null;
  if (!p) return null;
  const balance = await p.getCustomerBalance(a.stripeCustomerId!);
  return balance == null ? null : Math.max(0, PRICE_CENTS + balance);
}
