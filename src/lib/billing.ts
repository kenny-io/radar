// Trial billing constants, shared by server and client (.factory/marketing-trial-gating/architecture.md §5.1).
export const TRIAL_DAYS = 3;
/** The card-confirmation payment. Credited against the first invoice (owner decision, 2026-10-25). */
export const FEE_CENTS = 100;
/** Displayed price; billing refuses a configured Stripe price that differs. */
export const PRICE_CENTS = 5000;
/** Stripe endpoint selection, shared with the standalone setup command. */
export const WEBHOOK_EVENTS = ['payment_intent.succeeded', 'payment_intent.payment_failed', 'customer.subscription.created', 'customer.subscription.updated',
  'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'] as const;
export const SUB_STATUSES = ['none', 'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused'] as const;
