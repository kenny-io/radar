// BillingState for /start-trial and GET /api/billing/state (architecture §5.2). Dates are server-computed (D7).
import { FEE_CENTS, PRICE_CENTS, TRIAL_DAYS } from '@/lib/billing';
import type { BillingState } from '@/lib/types';
import { accessSummary } from './access';
import { providerName } from './config';

const HOUR = 3600e3;
/** A pending trial end is reused for an hour (architecture §7.2 start step 6). */
export const pendingFresh = (a: { pendingTrialEnd: Date | null; pendingSetAt: Date | null } | null | undefined, now = Date.now()) =>
  !!a?.pendingTrialEnd && !!a.pendingSetAt && a.pendingSetAt.getTime() > now - HOUR;
/** now + 72h, to the second. */
export const trialEndFrom = (now = Date.now()) => new Date(Math.floor(now / 1000) * 1000 + TRIAL_DAYS * 24 * HOUR);

export async function billingState(u: { id: string }, o: { openInvoiceCents?: (subId: string) => Promise<number | null> } = {}): Promise<BillingState> {
  const s = await accessSummary(u.id);
  const a = s.account;
  const mode: BillingState['mode'] = s.own ? 'none' : a?.everSubscribed ? 'restart' : 'trial';
  let trialEnd: Date; let preview = false;
  if (a?.trialEnd && a.stripeSubscriptionId) trialEnd = a.trialEnd;
  else if (pendingFresh(a)) trialEnd = a!.pendingTrialEnd!;
  else { trialEnd = trialEndFrom(); preview = true; }
  let due = mode === 'trial' ? FEE_CENTS : mode === 'restart' ? PRICE_CENTS : 0;
  if (mode === 'restart' && a?.stripeSubscriptionId && (a.status === 'past_due' || a.status === 'unpaid') && o.openInvoiceCents) {
    try { const c = await o.openInvoiceCents(a.stripeSubscriptionId); if (c != null) due = c; } catch (e: any) { console.warn('[billing] open invoice lookup failed', e?.message || e); }
  }
  return {
    enforced: s.enforced, provider: providerName(), access: s.own, status: s.status, mode, needsRestart: mode === 'restart',
    trialEnd: trialEnd.toISOString(), trialEndIsPreview: preview,
    currentPeriodEnd: a?.currentPeriodEnd ? a.currentPeriodEnd.toISOString() : null,
    dueTodayCents: due, priceCents: PRICE_CENTS, trialDays: TRIAL_DAYS,
    hasDraft: !!s.draft, draft: s.draft?.summary || null,
  };
}
