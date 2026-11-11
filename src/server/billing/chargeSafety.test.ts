// Regression: the old fire-and-forget price check could create a customer and charge $1 before detecting a bad price.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ provider: null as any, customer: vi.fn(), lock: vi.fn() }));
vi.mock('./access', () => ({ ownAccess: async () => false, accountGrants: () => false, GRANTING: ['active', 'trialing'], TERMINAL: ['canceled', 'incomplete_expired'] }));
vi.mock('../abuse/rateLimit', () => ({ limitBilling: async () => {} }));
vi.mock('./account', async () => ({
  checkPriceOnce: (await import('./price')).checkPriceOnce,
  needProvider: async () => H.provider, priceId: () => 'price_radar', ensureCustomer: H.customer,
  withBillingLock: H.lock,
}));

import { start } from './activate';
import { restart } from './restart';

const user = { id: 'payer', email: 'payer@example.com', name: 'Payer' };
const valid = { id: 'price_radar', active: true, type: 'recurring', unit_amount: 5000, currency: 'usd',
  billing_scheme: 'per_unit', interval: 'month', interval_count: 1, usage_type: 'licensed', transform_quantity: null, custom_unit_amount: null };
beforeEach(() => {
  vi.clearAllMocks();
  H.provider = { name: 'stripe', getPrice: vi.fn(), createPaymentIntent: vi.fn(), createSubscription: vi.fn() };
  H.customer.mockImplementation(() => { throw new Error('customer boundary reached'); });
});

describe.each([['start', start], ['restart', restart]] as const)('%s price safety', (_name, act) => {
  it('refuses a wrong price before any customer, payment or subscription mutation', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    H.provider.getPrice.mockResolvedValue({ ...valid, interval_count: 3 });
    await expect(act(user, 'pm_card', '127.0.0.1')).rejects.toMatchObject({ status: 503, code: 'billing_unavailable' });
    expect(H.customer).not.toHaveBeenCalled(); expect(H.lock).not.toHaveBeenCalled();
    expect(H.provider.createPaymentIntent).not.toHaveBeenCalled(); expect(H.provider.createSubscription).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it('awaits a pending check and can retry after the provider is repaired', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    let reject!: (e: Error) => void;
    H.provider.getPrice.mockImplementationOnce(() => new Promise((_resolve, r) => { reject = r; })).mockResolvedValue(valid);
    const first = act(user, 'pm_card', '127.0.0.1');
    await vi.waitFor(() => expect(H.provider.getPrice).toHaveBeenCalledTimes(1));
    expect(H.customer).not.toHaveBeenCalled();
    reject(new Error('provider unavailable'));
    await expect(first).rejects.toMatchObject({ code: 'billing_unavailable' });
    await expect(act(user, 'pm_card', '127.0.0.1')).rejects.toThrow('customer boundary reached');
    expect(H.provider.getPrice).toHaveBeenCalledTimes(2); expect(H.customer).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
