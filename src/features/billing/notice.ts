// Copy for the billing edges (first-five architecture §5): the trial chip, the grace banner and the two lines Settings →
// Billing adds. Pure, so the wording and the day arithmetic are tested without a browser.
import { FEE_CENTS } from '@/lib/billing';
import type { BillingOverview } from '@/lib/types';
import { money } from './copy';

export const SUPPORT_MAILTO = 'mailto:support@thally.io';

/** Whole calendar days from now to `iso` in the viewer's zone (0 = today or already past). `timeZone` is for tests. */
export function daysLeft(iso: string, now: number, timeZone?: string): number {
  const day = (ms: number) => { const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); return Date.UTC(+p.slice(0, 4), +p.slice(5, 7) - 1, +p.slice(8, 10)); };
  return Math.max(0, Math.round((day(Date.parse(iso)) - day(now)) / 86400e3));
}
/** "Trial · 3 days left" · "Trial · 1 day left" · "Trial · ends today". */
export function trialChipLabel(trialEndsAt: string, now: number, timeZone?: string): string {
  const n = daysLeft(trialEndsAt, now, timeZone);
  return n === 0 ? 'Trial · ends today' : `Trial · ${n} day${n === 1 ? '' : 's'} left`;
}

/** "Thu, Nov 12 at 4:05 PM": the grace end is an instant, so the banner shows the time too. */
export function fmtDeadline(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(d);
  return `${day} at ${time}`;
}
/** The banner sentence. It asks for a card update and states when access ends; it does not say the payment will be
 *  taken again by itself (not confirmed for the hosted portal, architecture §5). */
export function graceMessage(payer: boolean, when: string): string {
  return payer
    ? `Your last payment failed, and access to Radar ends on ${when}. Please update your card.`
    : `The last payment for this business failed, and access to Radar ends on ${when}. Ask the account owner to update their card.`;
}

/** Settings → Billing while trialing: the amount and the date of the first charge (the $1 confirmation is credited to it).
 *  Null when no charge is coming: not trialing, a scheduled cancellation, or billing not enforced for the account. */
export function trialChargeLine(s: BillingOverview, fmt: (iso: string) => string): string | null {
  if (s.status !== 'trialing' || !s.trialEnd || s.cancelAtPeriodEnd || !s.enforced) return null;
  const first = money(Math.max(0, s.priceCents - FEE_CENTS)), price = money(s.priceCents);
  return `Your card will be charged ${first} on ${fmt(s.trialEnd)} for your first month (${price} less the ${money(FEE_CENTS)} card confirmation), then ${price} a month. Cancel before then to avoid the charge.`;
}
/** Settings → Billing during the past-due grace: when access ends. */
export function graceLine(s: BillingOverview, fmt: (iso: string) => string): string | null {
  return s.status === 'past_due' && s.graceEndsAt ? `Your last payment failed. Access to Radar ends on ${fmt(s.graceEndsAt)}. Please update your card.` : null;
}
