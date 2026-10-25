// Subscription state from the provider onto the account (architecture §7.3 syncSubscription). The webhook, the restart
// confirm and dev/simulate all land here. Fetched inside the lock, so out-of-order deliveries converge on current state.
import { eq } from 'drizzle-orm';
import { schema } from '../db';
import { track } from '../events';
import type { Account } from './access';
import { TERMINAL } from './access';
import { accountByCustomer, lockAccount, withBillingLock } from './account';
import type { Later, Tx } from './draft';
import type { BillingProvider, Subscription } from './provider';

const A = schema.billingAccounts;
const at = (s: number | null) => (s ? new Date(s * 1000) : null);

/** Write a subscription as the account's current one (status, dates, everSubscribed). Tracks a status change. */
export async function writeSubscription(tx: Tx, later: Later, a: Account, s: Subscription, extra: Partial<typeof A.$inferInsert> = {}) {
  await tx.update(A).set({
    stripeSubscriptionId: s.id, status: s.status, trialEnd: at(s.trial_end), currentPeriodEnd: at(s.current_period_end),
    cancelAtPeriodEnd: !!s.cancel_at_period_end, everSubscribed: true, updatedAt: new Date(), ...extra,
  }).where(eq(A.userId, a.userId));
  if (a.status !== s.status) later.push(() => track('sub.status_changed', { uid: a.userId, ref: s.id, props: { from: a.status, to: s.status } }));
  console.info(`[billing] ${a.userId} subscription ${s.id} ${a.status} → ${s.status}`);
}

/** Apply `s` to the locked account. A subscription that isn't the account's current one is adopted only when the
 *  account has none or its current one has ended; an old (ended) subscription never regresses a restarted account. */
export async function syncIn(tx: Tx, later: Later, a: Account, s: Subscription): Promise<'updated' | 'adopted' | 'ignored'> {
  if (s.customer !== a.stripeCustomerId) return 'ignored';
  if (s.id !== a.stripeSubscriptionId) {
    const currentLive = !!a.stripeSubscriptionId && !TERMINAL.includes(a.status);
    if (TERMINAL.includes(s.status) || currentLive) { console.info(`[billing] ignoring subscription ${s.id} (${s.status}): ${a.userId} follows ${a.stripeSubscriptionId}`); return 'ignored'; }
    await writeSubscription(tx, later, a, s);
    return 'adopted';
  }
  await writeSubscription(tx, later, a, s);
  return 'updated';
}

/** Webhook path: the account by customer (the event's, else one fetch), then lock, fetch, apply. Returns the user id. */
export async function syncById(p: BillingProvider, subId: string, customer?: string | null): Promise<string | null> {
  const cus = customer || (await p.getSubscription(subId)).customer;
  const acct = await accountByCustomer(cus);
  if (!acct) { console.info(`[billing] no account for customer ${cus}; subscription ${subId} ignored`); return null; }
  await withBillingLock(acct.userId, async (tx, later) => syncIn(tx, later, await lockAccount(tx, acct.userId), await p.getSubscription(subId)));
  return acct.userId;
}
