// Copy for the billing edges (BE-2, BE-3, BE-4): the trial chip's day count, the grace banner sentence and the two lines
// Settings → Billing adds. Dates are formatted in the viewer's zone, so each case names one.
import { describe, expect, it } from 'vitest';
import type { BillingOverview, BillingState } from '@/lib/types';
import { FEE_CENTS } from '@/lib/billing';
import { trialCopy } from './copy';
import { daysLeft, fmtDeadline, graceLine, graceMessage, SUPPORT_MAILTO, trialChargeLine, trialChipLabel } from './notice';

const LA = 'America/Los_Angeles', AKL = 'Pacific/Auckland';
const at = (iso: string) => Date.parse(iso);
/** Intl puts a narrow no-break space before AM/PM in newer ICU data. */
const plain = (s: string) => s.replace(/[  ]/g, ' ');
const base: BillingOverview = { provider: 'stripe', enforced: true, status: 'trialing', priceCents: 5000, currency: 'usd', interval: 'month', trialEnd: '2026-11-13T18:00:00Z', currentPeriodEnd: '2026-11-13T18:00:00Z', cancelAtPeriodEnd: false, canManage: true, everSubscribed: true };

describe('trial chip', () => {
  const end = '2026-11-13T18:00:00Z';   // Fri Nov 13, 10:00 in Los Angeles; Sat Nov 14, 07:00 in Auckland
  it('counts calendar days in the viewer’s zone, not 24-hour blocks', () => {
    expect(trialChipLabel(end, at('2026-11-10T18:00:01Z'), LA)).toBe('Trial · 3 days left');
    expect(trialChipLabel(end, at('2026-11-11T07:59:00Z'), LA)).toBe('Trial · 3 days left');   // still Nov 10 in LA
    expect(trialChipLabel(end, at('2026-11-11T08:01:00Z'), LA)).toBe('Trial · 2 days left');   // just past midnight
    expect(trialChipLabel(end, at('2026-11-12T20:00:00Z'), LA)).toBe('Trial · 1 day left');
    expect(trialChipLabel(end, at('2026-11-12T20:00:00Z'), AKL)).toBe('Trial · 1 day left');   // Nov 13 → Nov 14 there
    expect(daysLeft(end, at('2026-11-10T18:00:01Z'), AKL)).toBe(3);
  });
  it('says "ends today" on the last day and never goes negative after the end', () => {
    expect(trialChipLabel(end, at('2026-11-13T08:30:00Z'), LA)).toBe('Trial · ends today');
    expect(trialChipLabel(end, at('2026-11-13T17:59:00Z'), LA)).toBe('Trial · ends today');
    expect(trialChipLabel(end, at('2026-11-15T00:00:00Z'), LA)).toBe('Trial · ends today');    // the charge is late; no "-1 days"
    expect(daysLeft(end, at('2026-12-01T00:00:00Z'), LA)).toBe(0);
  });
});

describe('grace banner', () => {
  it('gives the day and time access ends in the viewer’s zone', () => {
    expect(plain(fmtDeadline('2026-11-12T23:05:00Z', LA))).toBe('Thu, Nov 12 at 3:05 PM');
    expect(plain(fmtDeadline('2026-11-12T23:05:00Z', AKL))).toBe('Fri, Nov 13 at 12:05 PM');
  });
  it('asks the payer to update the card and tells a member who can; neither promises the payment will be retried', () => {
    const payer = graceMessage(true, 'Thu, Nov 12 at 3:05 PM'), member = graceMessage(false, 'Thu, Nov 12 at 3:05 PM');
    expect(payer).toBe('Your last payment failed, and access to Radar ends on Thu, Nov 12 at 3:05 PM. Please update your card.');
    expect(member).toBe('The last payment for this business failed, and access to Radar ends on Thu, Nov 12 at 3:05 PM. Ask the account owner to update their card.');
    for (const m of [payer, member]) expect(m).not.toMatch(/retry|try again|automatic|will be charged|Stripe/i);
  });
  it('support is the existing address', () => { expect(SUPPORT_MAILTO).toBe('mailto:support@thally.io'); });
});

describe('Settings → Billing lines', () => {
  const day = (iso: string) => new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: LA }).format(new Date(iso));
  it('while trialing: the first charge, its date and the monthly price, from the same numbers as /start-trial', () => {
    expect(trialChargeLine(base, day)).toBe('Your card will be charged $49 on Nov 13, 2026 for your first month ($50 less the $1 card confirmation), then $50 a month. Cancel before then to avoid the charge.');
    // /start-trial's fine print states the same first bill; both come from priceCents and FEE_CENTS.
    const state: BillingState = { enforced: true, provider: 'stub', access: false, status: 'none', mode: 'trial', needsRestart: false, trialEnd: base.trialEnd!, trialEndIsPreview: true, currentPeriodEnd: null, dueTodayCents: FEE_CENTS, priceCents: base.priceCents, trialDays: 3, hasDraft: false, draft: null };
    expect(trialCopy(state, () => 'D', () => '').fine!.join('')).toContain('Your first monthly bill is $49 on');
    expect(trialChargeLine({ ...base, priceCents: 7900 }, day)).toContain('charged $78 on Nov 13, 2026');
    expect(trialCopy({ ...state, priceCents: 7900 }, () => 'D', () => '').fine!.join('')).toContain('Your first monthly bill is $78 on');
  });
  it('no charge line when no charge is coming: cancellation scheduled, not trialing, billing not enforced, no date', () => {
    expect(trialChargeLine({ ...base, cancelAtPeriodEnd: true }, day)).toBeNull();
    for (const status of ['active', 'past_due', 'canceled', 'comp', 'none'] as const) expect(trialChargeLine({ ...base, status }, day), status).toBeNull();
    expect(trialChargeLine({ ...base, enforced: false }, day)).toBeNull();
    expect(trialChargeLine({ ...base, trialEnd: null }, day)).toBeNull();
  });
  it('during grace: when access ends; nothing once the grace is over or for any other status', () => {
    const when = (iso: string) => plain(fmtDeadline(iso, LA));
    expect(graceLine({ ...base, status: 'past_due', graceEndsAt: '2026-11-12T23:05:00Z' }, when)).toBe('Your last payment failed. Access to Radar ends on Thu, Nov 12 at 3:05 PM. Please update your card.');
    expect(graceLine({ ...base, status: 'past_due' }, when)).toBeNull();
    expect(graceLine({ ...base, status: 'past_due', graceEndsAt: null }, when)).toBeNull();
    expect(graceLine({ ...base, status: 'active', graceEndsAt: '2026-11-12T23:05:00Z' }, when)).toBeNull();
  });
});
