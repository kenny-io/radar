import { describe, expect, it } from 'vitest';
import type { BillingState } from '@/lib/types';
import { billingErrorOutcome, cardErrorMessage, DECLINE, money, trialCopy } from './copy';

const base: BillingState = {
  enforced: true, provider: 'stub', access: false, status: 'none', mode: 'trial', needsRestart: false,
  trialEnd: '2026-10-28T15:00:00Z', trialEndIsPreview: true, currentPeriodEnd: null,
  dueTodayCents: 100, priceCents: 5000, trialDays: 3, hasDraft: true, draft: null,
};
// Render dates as tagged strings so the test reads the sentence and which instant each date came from.
const D = (iso: string | null, w?: boolean) => `[${w ? 'DW' : 'D'}:${iso}]`;
const text = (parts: any[] | null) => (parts || []).join('');

describe('trial page copy (handoff §4)', () => {
  it('trial mode reads exactly as designed, with every date from trial_end', () => {
    const c = trialCopy(base, D, () => 'x');
    expect(c.h1).toBe('Start your free trial');
    expect(c.sub).toBe('3 days free, then $50/month. Every feature included.');
    expect(c.steps.map(([col, t, b]) => [col, text(t), b])).toEqual([
      ['var(--signal)', 'Today · $1', 'A $1 payment confirms your card works.'],
      ['var(--ok)', 'Days 1–3 · Free', 'Every feature, with your Business Profile.'],
      ['var(--faint)', '[D:2026-10-28T15:00:00Z] · $50/month', 'Your subscription begins.'],
    ]);
    expect(c.button).toBe('Pay $1 and start trial');
    expect(c.busy).toBe('Confirming your card…');
    expect(text(c.fine)).toBe('The $1 payment confirms your card works. Your trial starts once it goes through, and $50/month begins on [DW:2026-10-28T15:00:00Z].');
    expect(c.fine!.join('')).not.toContain('sample card');
    expect(c.doneH1).toBe('Your free trial has started.');
    expect(c.doneHref).toBe('/dashboard?started=trial');
  });
  it('the success sentence uses the confirmed trial_end, not the preview the page loaded with', () => {
    const c = trialCopy(base, D, () => 'x');
    expect(text(c.doneBody({ ...base, trialEnd: '2026-10-28T15:00:07Z', trialEndIsPreview: false }))).toBe('Your card is confirmed. Everything is free until [DW:2026-10-28T15:00:07Z], then $50/month.');
  });
  it('restart mode uses the §10 copy, charges what is due, and never offers a trial', () => {
    const s: BillingState = { ...base, mode: 'restart', needsRestart: true, status: 'canceled', dueTodayCents: 5000, currentPeriodEnd: '2020-01-01T00:00:00Z' };
    const c = trialCopy(s, D, () => '2026-11-25T00:00:00Z');
    expect(c.h1).toBe('Restart your subscription');
    expect(c.sub).toBe('$50/month. Every feature included.');
    // A past period end isn't the next charge: the preview is a month from today.
    expect(c.steps.map(([, t, b]) => [text(t), b])).toEqual([['Today · $50', 'Your subscription restarts.'], ['[D:2026-11-25T00:00:00Z] · $50/month', 'Then every month.']]);
    expect(c.button).toBe('Pay $50 and restart');
    expect(c.fine).toBeNull();
    expect(c.doneH1).toBe('Your subscription has restarted.');
    expect(text(c.doneBody({ ...s, currentPeriodEnd: '2026-11-25T10:00:00Z' }))).toBe('Your card is confirmed. Your next payment of $50 is on [DW:2026-11-25T10:00:00Z].');
    expect(c.doneHref).toBe('/dashboard');
  });
  it('a subscription canceled mid-trial restarts a month from today, not at the old period end', () => {
    const future = new Date(Date.now() + 3 * 864e5).toISOString();
    const c = trialCopy({ ...base, mode: 'restart', needsRestart: true, status: 'canceled', dueTodayCents: 5000, currentPeriodEnd: future }, D, () => '2026-11-25T00:00:00Z');
    expect(text(c.steps[1][1])).toBe('[D:2026-11-25T00:00:00Z] · $50/month');
  });
  it('a past_due restart shows the open invoice amount and the current period end', () => {
    const future = new Date(Date.now() + 10 * 864e5).toISOString();
    const c = trialCopy({ ...base, mode: 'restart', needsRestart: true, status: 'past_due', dueTodayCents: 4950, currentPeriodEnd: future }, D, () => 'x');
    expect(text(c.steps[0][1])).toBe('Today · $49.50');
    expect(text(c.steps[1][1])).toBe(`[D:${future}] · $50/month`);
    expect(c.button).toBe('Pay $49.50 and restart');
  });
});

describe('failure copy (architecture §10)', () => {
  it('money', () => { expect(money(100)).toBe('$1'); expect(money(5000)).toBe('$50'); expect(money(4950)).toBe('$49.50'); });
  it('card errors and authentication failures read as a decline; anything else is the generic failure', () => {
    expect(cardErrorMessage({ type: 'card_error', code: 'card_declined' })).toBe(DECLINE);
    expect(cardErrorMessage({ type: 'invalid_request_error', code: 'payment_intent_authentication_failure' })).toBe(DECLINE);
    expect(cardErrorMessage({ type: 'api_connection_error' })).toBe('Radar couldn’t confirm your card. Try again.');
    expect(cardErrorMessage(null)).toBe('Radar couldn’t confirm your card. Try again.');
  });
  it('maps billing endpoint codes to copy or a page that fits the account', () => {
    expect(billingErrorOutcome({ status: 409, code: 'trial_used' })).toEqual({ message: 'This card has already been used for a free trial. Try a different card.' });
    expect(billingErrorOutcome({ status: 502, code: 'activation_failed' })).toEqual({ message: 'Your card is confirmed, but your trial didn’t start yet. Try again in a minute. You won’t be charged twice.' });
    expect(billingErrorOutcome({ status: 429, code: 'rate_limited' })).toEqual({ message: 'Too many attempts. Try again in an hour.' });
    expect(billingErrorOutcome({ status: 409, code: 'already_active' })).toEqual({ go: '/dashboard' });
    expect(billingErrorOutcome({ status: 409, code: 'restart_required' })).toEqual({ go: '/start-trial' });
    expect(billingErrorOutcome({ status: 401 })).toEqual({ go: '/signup' });
    expect(billingErrorOutcome({ status: 503, code: 'billing_unavailable' })).toEqual({ message: 'Payments aren’t available right now. Try again in a few minutes.' });
    // A card the server can't use (e.g. attached to another customer): don't tell them to retry the same card.
    expect(billingErrorOutcome({ status: 400, code: 'invalid_payment_method' })).toEqual({ message: 'Radar couldn’t use this card. Try a different card.' });
    expect(billingErrorOutcome({ status: 409, code: 'payment_processing' })).toEqual({ message: 'Your card is still being confirmed. Try again in a minute.' });
    expect(billingErrorOutcome({ status: 500, code: 'internal' })).toEqual({ message: 'Radar couldn’t confirm your card. Try again.' });
  });
});
