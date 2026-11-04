// Webhook dedupe and handlers (architecture §7.3). Fetch-on-event: the payload only says what to look at; state comes
// from the provider. Payloads and the signature header are never stored or logged.
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { track } from '../events';
import { accountByCustomer, lockAccount, withBillingLock } from './account';
import { activateIn } from './activate';
import { getProvider } from './provider';
import { syncById, syncIn } from './sync';
import { queueLifecycle } from '../services/lifecycle/queue';
import { WEBHOOK_EVENTS } from '@/lib/billing';

export interface StripeEvent { id: string; type: string; data: { object: any } }
export { WEBHOOK_EVENTS } from '@/lib/billing';
const E = schema.billingEvents;
const idOf = (v: any): string | null => (typeof v === 'string' ? v : v?.id || null);
const userExists = async (uid: string) => !!(await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.id, uid), eq(schema.users.guest, false))).limit(1))[0];

/** Record, skip if already processed, run, mark processed. A failure keeps the row unprocessed (with the message only)
 *  and rethrows so the route answers 500 and Stripe retries. Concurrent duplicates may both run: handlers are idempotent. */
export async function processEvent(ev: StripeEvent): Promise<'processed' | 'replay'> {
  await db.insert(E).values({ id: ev.id, type: ev.type }).onConflictDoNothing();
  const run = await db.update(E).set({ attempts: sql`${E.attempts} + 1` }).where(and(eq(E.id, ev.id), isNull(E.processedAt))).returning({ id: E.id });
  if (!run[0]) return 'replay';
  try { await dispatch(ev); }
  catch (e: any) { await db.update(E).set({ lastError: String(e?.message || e).slice(0, 300) }).where(eq(E.id, ev.id)); throw e; }
  await db.update(E).set({ processedAt: new Date(), lastError: null }).where(eq(E.id, ev.id));
  return 'processed';
}

export async function dispatch(ev: StripeEvent) {
  const o = ev.data?.object || {};
  if (!(WEBHOOK_EVENTS as readonly string[]).includes(ev.type)) return;
  const p = await getProvider();
  if (!p) throw new Error('no billing provider configured');
  switch (ev.type) {
    case 'payment_intent.succeeded': {
      if (o.metadata?.purpose !== 'trial_check') return;           // restart invoices arrive as invoice.paid
      const pi = await p.getPaymentIntent(o.id);
      const uid = pi.metadata?.radar_user_id;
      if (!uid || pi.status !== 'succeeded' || !(await userExists(uid))) return;
      await withBillingLock(uid, (tx, later) => activateIn(p, tx, later, pi, 'webhook'));
      return;
    }
    case 'payment_intent.payment_failed': {
      if (o.metadata?.purpose !== 'trial_check') return;
      const pi = await p.getPaymentIntent(o.id);
      const uid = pi.metadata?.radar_user_id;
      if (!uid || !(await userExists(uid))) return;
      const err = pi.last_payment_error || {};
      await track('trial.payment_failed', { uid, ref: pi.id, props: { code: err.code || null, decline_code: err.decline_code || null } });
      return;
    }
    case 'customer.subscription.created': case 'customer.subscription.updated': case 'customer.subscription.deleted':
      await syncById(p, o.id, idOf(o.customer));
      return;
    case 'invoice.paid': case 'invoice.payment_failed': {
      // Follow the current subscription, but never use webhook payload amounts or assume this invoice belongs to it.
      const cus = idOf(o.customer); if (!cus) return;
      const a = await accountByCustomer(cus);
      if (!a?.stripeSubscriptionId) return;
      await withBillingLock(a.userId, async (tx, later) => {
        const current = await lockAccount(tx, a.userId);
        if (!current.stripeSubscriptionId || current.stripeCustomerId !== cus) return;
        const sub = await p.getSubscription(current.stripeSubscriptionId);
        await syncIn(tx, later, current, sub);
        if (typeof o.id !== 'string') return;
        const invoice = await p.getInvoice(o.id);
        if (invoice.customer !== cus || invoice.subscription !== current.stripeSubscriptionId || sub.customer !== cus) return;
        const paid = ev.type === 'invoice.paid';
        if (paid ? invoice.status !== 'paid' : invoice.status !== 'open' || sub.latest_invoice !== invoice.id) return;
        const amount = paid ? invoice.amount_paid : invoice.amount_due;
        // Zero-dollar trial invoices are not payments. Missing facts never become a fabricated $50 receipt.
        if (!Number.isSafeInteger(amount) || amount! <= 0 || !/^[a-z]{3}$/i.test(invoice.currency || '')) return;
        await queueLifecycle(tx, { type: paid ? 'invoice_paid' : 'payment_failed', userId: current.userId,
          eventKey: `${paid ? 'invoice-paid' : 'payment-failed'}:${invoice.id}`,
          data: { subscriptionId: sub.id, invoiceId: invoice.id, invoiceNumber: invoice.number || undefined,
            amountCents: amount, currency: invoice.currency, periodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : undefined } });
      });
      return;
    }
  }
}
