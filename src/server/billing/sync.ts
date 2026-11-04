// Subscription state from the provider onto the account (architecture §7.3 syncSubscription). The webhook, the restart
// confirm and dev/simulate all land here. Fetched inside the lock, so out-of-order deliveries converge on current state.
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { schema } from '../db';
import { track } from '../events';
import { queueLifecycle } from '../services/lifecycle/queue';
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
  if (a.cancelAtPeriodEnd && !s.cancel_at_period_end) {
    const M = schema.lifecycleEmails, prefix = `cancel-scheduled:${s.id}:`;
    // A resumed cancellation can be scheduled again before the worker runs. Retire the old queued confirmation
    // now so only the new transition can be sent. An already in-flight provider request cannot be recalled.
    await tx.update(M).set({ status: 'suppressed', lastError: 'subscription_resumed' }).where(and(
      eq(M.userId, a.userId), eq(M.type, 'cancellation_scheduled'), eq(M.status, 'queued'),
      sql`left(${M.eventKey}, length(${prefix})) = ${prefix}`,
    ));
  }
  // The outbox write commits with billing state. A replay sees the already-persisted transition and cannot mail twice.
  // Each real cancel -> resume -> cancel transition gets its own identity, even within one billing period.
  const periodEnd = at(s.current_period_end || s.trial_end)?.toISOString();
  if (s.cancel_at_period_end && !a.cancelAtPeriodEnd && ['trialing', 'active'].includes(s.status) && periodEnd) {
    await queueLifecycle(tx, { type: 'cancellation_scheduled', userId: a.userId,
      eventKey: `cancel-scheduled:${s.id}:${randomUUID()}`, data: { subscriptionId: s.id, periodEnd } });
  }
  if (a.status !== s.status && TERMINAL.includes(s.status)) {
    await queueLifecycle(tx, { type: 'subscription_ended', userId: a.userId,
      eventKey: `subscription-ended:${s.id}:${s.status}:${randomUUID()}`, data: { subscriptionId: s.id, status: s.status, periodEnd } });
  }
  if (s.status === 'trialing' && !s.cancel_at_period_end && s.trial_end) {
    const trialEnd = new Date(s.trial_end * 1000);
    const reminderAt = new Date(trialEnd.getTime() - 864e5);
    // Don't issue historical or overdue reminders when adopting/reconciling an existing subscription.
    if (reminderAt.getTime() > Date.now()) await queueLifecycle(tx, { type: 'trial_ending', userId: a.userId,
      eventKey: `trial-ending:${s.id}:${trialEnd.toISOString()}`, sendAt: reminderAt,
      data: { subscriptionId: s.id, trialEnd: trialEnd.toISOString() } });
  }
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
