// Trial billing constants, shared by server and client (.factory/marketing-trial-gating/architecture.md §5.1).
export const TRIAL_DAYS = 3;
/** The card-confirmation payment. Credited against the first invoice (owner decision, 2026-10-25). */
export const FEE_CENTS = 100;
/** Display only; must match STRIPE_PRICE_ID (billing start logs an error on mismatch). */
export const PRICE_CENTS = 5000;
export const SUB_STATUSES = ['none', 'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused'] as const;
