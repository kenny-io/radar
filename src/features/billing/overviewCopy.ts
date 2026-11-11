import type { BillingOverview } from '@/lib/types';

export function overviewCopy(s: BillingOverview): { label: string; tone: 'ok' | 'warn' | 'bad' | 'mute'; description: string } {
  if (s.status === 'comp') return { label: 'Complimentary', tone: 'ok', description: 'Your account has complimentary access. No subscription is required.' };
  if (s.cancelAtPeriodEnd && (s.status === 'active' || s.status === 'trialing'))
    return { label: 'Cancellation scheduled', tone: 'warn', description: 'Your subscription will end after the current period. You can manage cancellation in Stripe.' };
  switch (s.status) {
    case 'trialing': return { label: 'Trial', tone: 'ok', description: 'Your three-day trial is active. The $1 card confirmation is credited to your first month.' };
    case 'active': return { label: 'Active', tone: 'ok', description: 'Every Radar feature is included in your subscription.' };
    case 'past_due': case 'unpaid': return { label: 'Payment overdue', tone: 'bad', description: 'Your latest payment needs attention. Manage your payment method and invoices in Stripe.' };
    case 'canceled': return { label: 'Canceled', tone: 'mute', description: 'Your subscription has ended. Restart it to restore access to the businesses you own.' };
    case 'paused': return { label: 'Paused', tone: 'warn', description: 'Your subscription is paused. Restart it to restore access to the businesses you own.' };
    case 'incomplete': return { label: 'Payment pending', tone: 'warn', description: 'Your subscription payment has not completed. Finish the payment to restore access.' };
    case 'incomplete_expired': return { label: 'Payment expired', tone: 'mute', description: 'Your subscription payment expired. Restart your subscription when you’re ready.' };
    default: return { label: 'No subscription', tone: 'mute', description: s.enforced ? 'There is no subscription on your account yet.' : 'Billing is not enabled for your account. No subscription is required right now.' };
  }
}

/** A historic period end on canceled/overdue accounts is not an upcoming renewal. */
export function periodLabel(s: BillingOverview): string | null {
  if (s.status === 'comp') return s.canManage && s.currentPeriodEnd ? s.cancelAtPeriodEnd ? 'Stripe subscription ends' : 'Stripe billing period end' : null;
  if (s.cancelAtPeriodEnd && (s.status === 'active' || s.status === 'trialing')) return s.enforced ? 'Access ends' : 'Subscription ends';
  if (s.status === 'trialing') return 'Trial ends';
  if (s.status === 'active') return 'Next billing date';
  return s.currentPeriodEnd ? 'Billing period end' : null;
}
