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

/** Before a subscription is replaced, its open invoice is voided: another tab can no longer pay it, and a credit it used
 *  returns to the customer, so the new invoice charges what /start-trial showed (restartDueCents). Returns the
 *  subscription instead when that invoice was paid in the meantime: access, nothing to replace. */
async function voidOpenInvoice(p: BillingProvider, cur: Subscription): Promise<Subscription | null> {
  if (!cur.latest_invoice) return null;
  const inv = await p.getInvoice(cur.latest_invoice);
  if (inv.status !== 'open') return null;
  try { await p.voidInvoice(inv.id, `radar:void:${inv.id}`); return null; } catch (e) {
    const now = await p.getSubscription(cur.id);
    if (GRANTING.includes(now.status)) return now;
    throw e;
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
      const paid = await voidOpenInvoice(p, cur);
      if (paid) { await syncIn(tx, later, a, paid); return { activated: true }; }
      await p.cancelSubscription(cur.id);
    }
    // The key names the subscription being replaced, so switching back to an earlier card never replays a canceled one.
    const { sub, clientSecret } = await p.createSubscription({ customer, price, defaultPaymentMethod: pmId, incomplete: true, metadata: { radar_user_id: u.id, purpose: 'restart' } },
      `radar:restart:${u.id}:${pmId}:${a.stripeSubscriptionId || 'none'}`).catch(asInvalidCard);
    await writeSubscription(tx, later, a, sub);
    if (!clientSecret || GRANTING.includes(sub.status)) return { activated: true };
    return { clientSecret, subscriptionId: sub.id };
  });
}
