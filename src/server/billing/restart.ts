// Restart a lapsed subscription (architecture §7.2 restart; not designed, copy in §10). No trial: past_due / unpaid pay
// the open invoice on the same subscription; canceled, expired or paused start a new subscription charged today.
import { limitBilling } from '../abuse/rateLimit';
import { accountGrants, GRANTING, ownAccess, TERMINAL } from './access';
import { asInvalidCard, checkPriceOnce, ensureCustomer, lockAccount, needProvider, nullIfMissing, priceId, withBillingLock } from './account';
import { BillingError } from './errors';
import type { BillingProvider, Subscription } from './provider';
import { syncIn, writeSubscription } from './sync';

type BillingUser = { id: string; email: string; name: string };
export type RestartResult = { clientSecret: string; subscriptionId: string } | { activated: true };
/** Setting a default card is naturally idempotent; the minute in the key lets a later switch back to a card apply again. */
const minute = () => Math.floor(Date.now() / 60000);

/** An unpaid restart (`incomplete`) that another card replaces: void its open first invoice, so another tab can no longer
 *  pay it and a credit it used returns to the customer (the new invoice then charges what /start-trial showed). Stripe
 *  expires an incomplete subscription when its first invoice is voided. Only `incomplete`: voiding a past_due invoice
 *  can make Stripe mark the subscription active. Never fatal: if the void fails, the restart goes on as before (cancel,
 *  new subscription), unless the subscription turned out to be paid, which then wins. */
async function voidUnpaidRestart(p: BillingProvider, cur: Subscription): Promise<{ paid: Subscription | null }> {
  if (cur.status !== 'incomplete' || !cur.latest_invoice) return { paid: null };
  try {
    const inv = await p.getInvoice(cur.latest_invoice);
    if (inv.status === 'open') await p.voidInvoice(inv.id, `radar:void:${inv.id}`);
    return { paid: null };
  } catch (e: any) {
    const now = await p.getSubscription(cur.id).catch(() => null);
    if (now && GRANTING.includes(now.status)) return { paid: now };
    console.warn(`[billing] void of ${cur.id}'s open invoice failed (restart continues): ${e?.message || e}`);
    return { paid: null };
  }
}

export async function restart(u: BillingUser, pmId: string, ip: string): Promise<RestartResult> {
  const p = await needProvider();
  if (await ownAccess({ id: u.id, email: u.email, guest: false })) throw BillingError.alreadyActive();
  await limitBilling(u.id, ip);
  const price = priceId(p); void checkPriceOnce(p, price);
  const customer = await ensureCustomer(p, u);
  return withBillingLock(u.id, async (tx, later): Promise<RestartResult> => {
    const a = await lockAccount(tx, u.id);
    if (!a.everSubscribed) throw BillingError.notLapsed();
    if (accountGrants(a)) throw BillingError.alreadyActive();
    const cur = a.stripeSubscriptionId ? await p.getSubscription(a.stripeSubscriptionId).catch(nullIfMissing) : null;
    if (cur && GRANTING.includes(cur.status)) { await syncIn(tx, later, a, cur); return { activated: true }; }   // paid in another tab
    const pm = await p.getPaymentMethod(pmId).catch(asInvalidCard);
    if (pm.type !== 'card' || (pm.customer && pm.customer !== customer)) throw BillingError.invalidPaymentMethod();
    await p.attachPaymentMethod(pmId, customer, `radar:attach:${pmId}:${customer}`).catch(asInvalidCard);
    await p.setCustomerDefaultPaymentMethod(customer, pmId, `radar:cusdpm:${u.id}:${pmId}:${minute()}`);
    if (cur && (cur.status === 'past_due' || cur.status === 'unpaid') && cur.latest_invoice) {
      const inv = await p.getInvoice(cur.latest_invoice);
      if (inv.status === 'open' && inv.client_secret) {
        await p.setSubscriptionPaymentMethod(cur.id, pmId, `radar:subpm:${cur.id}:${pmId}:${minute()}`);
        await syncIn(tx, later, a, cur);
        console.info(`[billing] ${u.id} restart: paying open invoice ${inv.id} on ${cur.id}`);
        return { clientSecret: inv.client_secret, subscriptionId: cur.id };
      }
    }
    // An unpaid restart subscription for the same card: its invoice again rather than another subscription.
    if (cur && cur.status === 'incomplete' && cur.metadata?.purpose === 'restart' && cur.default_payment_method === pmId && cur.latest_invoice) {
      const inv = await p.getInvoice(cur.latest_invoice);
      if (inv.status === 'open' && inv.client_secret) return { clientSecret: inv.client_secret, subscriptionId: cur.id };
    }
    if (cur && !TERMINAL.includes(cur.status)) {
      const { paid } = await voidUnpaidRestart(p, cur);
      if (paid) { await syncIn(tx, later, a, paid); return { activated: true }; }
      const now = cur.status === 'incomplete' ? await p.getSubscription(cur.id).catch(nullIfMissing) : cur;
      if (now && !TERMINAL.includes(now.status)) await p.cancelSubscription(cur.id);   // a voided first invoice already expired it
    }
    // The key names the subscription being replaced, so switching back to an earlier card never replays a canceled one.
    const { sub, clientSecret } = await p.createSubscription({ customer, price, defaultPaymentMethod: pmId, incomplete: true, metadata: { radar_user_id: u.id, purpose: 'restart' } },
      `radar:restart:${u.id}:${pmId}:${a.stripeSubscriptionId || 'none'}`).catch(asInvalidCard);
    await writeSubscription(tx, later, a, sub);
    if (!clientSecret || GRANTING.includes(sub.status)) return { activated: true };
    return { clientSecret, subscriptionId: sub.id };
  });
}
