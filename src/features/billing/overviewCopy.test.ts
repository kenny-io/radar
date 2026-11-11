import { describe, expect, it } from 'vitest';
import type { BillingOverview } from '@/lib/types';
import { overviewCopy, periodLabel } from './overviewCopy';
const base: BillingOverview = { provider: 'stripe', enforced: true, status: 'active', priceCents: 5000, currency: 'usd', interval: 'month', trialEnd: null, currentPeriodEnd: '2026-12-03T12:00:00Z', cancelAtPeriodEnd: false, canManage: true, everSubscribed: true };
describe('billing account copy', () => {
  it('scheduled cancellation never promises an upcoming charge', () => {
    const s = { ...base, cancelAtPeriodEnd: true };
    expect(overviewCopy(s).label).toBe('Cancellation scheduled'); expect(periodLabel(s)).toBe('Access ends');
    expect(overviewCopy(s).description).not.toMatch(/renew/i);
  });
  it('does not claim account access ends when billing enforcement is off', () => {
    for (const status of ['active', 'trialing'] as const) {
      expect(periodLabel({ ...base, status, cancelAtPeriodEnd: true, enforced: false })).toBe('Subscription ends');
      expect(periodLabel({ ...base, status, cancelAtPeriodEnd: true, enforced: true })).toBe('Access ends');
    }
  });
  it('billing off is distinct from complimentary access', () => {
    expect(overviewCopy({ ...base, status: 'none', enforced: false })).toMatchObject({ label: 'No subscription', description: expect.stringContaining('not enabled') });
    expect(overviewCopy({ ...base, status: 'comp' })).toMatchObject({ label: 'Complimentary' });
    expect(overviewCopy({ ...base, status: 'comp' }).description).not.toMatch(/won.t be charged|no.*charges/i);
    expect(periodLabel({ ...base, status: 'comp', cancelAtPeriodEnd: true })).toBe('Stripe subscription ends');
  });
  it('historic canceled or overdue dates are not labeled as renewal dates', () => {
    for (const status of ['canceled', 'past_due', 'unpaid'] as const) expect(periodLabel({ ...base, status })).not.toBe('Next billing date');
    expect(periodLabel({ ...base, status: 'trialing' })).toBe('Trial ends');
  });
});
