// Trial page copy (handoff §4) and the undesigned states (architecture §10). Amounts and the trial length come from
// BillingState so the page can't drift from what the server charges; dates are passed in as rendered nodes because
// they are formatted after mount in the browser's zone (dates.ts).
import type { ReactNode } from 'react';
import type { BillingState } from '@/lib/types';
import { FEE_CENTS } from '@/lib/billing';

export const money = (cents: number) => '$' + (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));

export const DECLINE = 'Your card was declined. Try another card, or check the details with your bank.';
export const CONFIRM_FAILED = 'Radar couldn’t confirm your card. Try again.';
export const TRIAL_USED = 'This card has already been used for a free trial. Try a different card.';
export const ACTIVATION_DELAYED = 'Your card is confirmed, but your trial didn’t start yet. Try again in a minute. You won’t be charged twice.';
export const BILLING_RATE_LIMITED = 'Too many attempts. Try again in an hour.';
// Not in the §10 table; the server's copy for these codes (src/server/billing/errors.ts), so the person isn't told to retry a
// card that can't work.
export const INVALID_CARD = 'Radar couldn’t use this card. Try a different card.';
export const PAYMENT_PROCESSING = 'Your card is still being confirmed. Try again in a minute.';
export const BILLING_UNAVAILABLE = 'Payments aren’t available right now. Try again in a few minutes.';

/** `D(iso, weekday?)` renders a date ("Oct 28" / "Wed, Oct 28"). */
export type DateNode = (iso: string | null, weekday?: boolean) => ReactNode;
export interface TrialCopy {
  h1: string; sub: string;
  steps: [color: string, title: ReactNode[], body: string][];
  button: string; busy: string; fine: ReactNode[] | null;
  doneH1: string; doneBody: (s: BillingState) => ReactNode[];
  /** Where "Open dashboard" goes: the trial toast only makes sense after a trial. */
  doneHref: string;
}

export function trialCopy(s: BillingState, D: DateNode, now: () => string): TrialCopy {
  const price = money(s.priceCents); const busy = 'Confirming your card…';
  if (s.mode === 'restart') {
    const due = money(s.dueTodayCents || s.priceCents);
    // Not designed (architecture §10). Before payment: past_due / unpaid pay the open invoice on the same subscription, so
    // the next charge is its current period end (when still ahead). Anything else (canceled, expired, paused) starts a new
    // subscription charged today, so a month from today, even when the old period end is still ahead (canceled mid-trial).
    const keepsPeriod = (s.status === 'past_due' || s.status === 'unpaid') && !!s.currentPeriodEnd && Date.parse(s.currentPeriodEnd) > Date.now();
    const next = keepsPeriod ? s.currentPeriodEnd : now();
    return {
      h1: 'Restart your subscription', sub: `${price}/month. Every feature included.`,
      steps: [['var(--signal)', [`Today · ${due}`], 'Your subscription restarts.'], ['var(--faint)', [D(next), ` · ${price}/month`], 'Then every month.']],
      button: `Pay ${due} and restart`, busy, fine: null,
      doneH1: 'Your subscription has restarted.',
      doneBody: st => ['Your card is confirmed. Your next payment of ', price, ' is on ', D(st.currentPeriodEnd, true), '.'],
      doneHref: '/dashboard',
    };
  }
  const fee = money(s.dueTodayCents || FEE_CENTS);
  return {
    h1: 'Start your free trial', sub: `${s.trialDays} days free, then ${price}/month. Every feature included.`,
    steps: [
      ['var(--signal)', [`Today · ${fee}`], `A ${fee} payment confirms your card works.`],
      ['var(--ok)', [`Days 1–${s.trialDays} · Free`], 'Every feature, with your Business Profile.'],
      ['var(--faint)', [D(s.trialEnd), ` · ${price}/month`], 'Your subscription begins.'],
    ],
    button: `Pay ${fee} and start trial`, busy,
    fine: [`The ${fee} payment confirms your card works. Your trial starts once it goes through, and ${price}/month begins on `, D(s.trialEnd, true), '.'],
    doneH1: 'Your free trial has started.',
    // The confirmed subscription's trial_end, never the preview (architecture §7.1 step 5).
    doneBody: st => ['Your card is confirmed. Everything is free until ', D(st.trialEnd, true), `, then ${price}/month.`],
    doneHref: '/dashboard?started=trial',
  };
}

/** A Stripe.js (or stub) error from `createPaymentMethod` / `confirmCardPayment`. */
export function cardErrorMessage(e: { type?: string; code?: string } | null | undefined): string {
  if (!e) return CONFIRM_FAILED;
  if (e.type === 'card_error' || e.code === 'payment_intent_authentication_failure' || e.code === 'authentication_failure') return DECLINE;
  return CONFIRM_FAILED;
}

/** What to do with a failed `/api/billing/*` call: show a message, or leave for a page that fits the account now. */
export function billingErrorOutcome(e: { status?: number; code?: string } | null | undefined): { message: string } | { go: string } {
  const code = e?.code;
  if (e?.status === 401) return { go: '/signup' };
  if (code === 'already_active') return { go: '/dashboard' };
  if (code === 'restart_required' || code === 'not_lapsed') return { go: '/start-trial' }; // the guard re-renders the right mode
  if (code === 'trial_used') return { message: TRIAL_USED };
  if (code === 'activation_failed') return { message: ACTIVATION_DELAYED };
  if (code === 'rate_limited') return { message: BILLING_RATE_LIMITED };
  if (code === 'invalid_payment_method') return { message: INVALID_CARD };
  if (code === 'payment_processing') return { message: PAYMENT_PROCESSING };
  if (code === 'billing_unavailable') return { message: BILLING_UNAVAILABLE };
  return { message: CONFIRM_FAILED };
}
