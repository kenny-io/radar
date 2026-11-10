import { PRICE_CENTS } from '@/lib/billing';
import type { BillingOverview } from '@/lib/types';
import { accountOf, billingEnforced, graceEndsAt, inGrace } from './access';
import { providerName } from './config';

/** Read this user's own persisted account even when the payment gate is off. Never use the selected business. */
export async function billingOverview(u: { id: string; email: string }): Promise<BillingOverview> {
  const a = await accountOf(u.id);
  const provider = providerName();
  const enforced = billingEnforced(u.email);
  return {
    provider, enforced, status: a?.comp ? 'comp' : a?.status || 'none',
    priceCents: PRICE_CENTS, currency: 'usd', interval: 'month',
    trialEnd: a?.trialEnd?.toISOString() || null,
    currentPeriodEnd: a?.currentPeriodEnd?.toISOString() || null,
    cancelAtPeriodEnd: a?.cancelAtPeriodEnd || false,
    canManage: provider === 'stripe' && !!a?.stripeCustomerId,
    everSubscribed: a?.everSubscribed || false,
    // Only while access really depends on it: the gate is on for this user, they aren't comp, and the grace hasn't ended.
    // Absent otherwise, so the response is unchanged for every account that is not in grace.
    ...(enforced && a && !a.comp && inGrace(a) ? { graceEndsAt: graceEndsAt(a)!.toISOString() } : {}),
  };
}
