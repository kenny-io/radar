import { describe, expect, it, vi } from 'vitest';
import { checkPriceOnce } from './price';
import type { BillingProvider, Price } from './provider';

const price: Price = { id: 'price_month', unit_amount: 5000, currency: 'usd', interval: 'month', active: true,
  type: 'recurring', billing_scheme: 'per_unit', interval_count: 1, usage_type: 'licensed', transform_quantity: null, custom_unit_amount: null };
const provider = (getPrice: ReturnType<typeof vi.fn>) => ({ name: 'stripe', getPrice }) as unknown as BillingProvider;

describe('charge preflight', () => {
  it.each([{ unit_amount: 5100 }, { currency: 'eur' }, { interval_count: 3 }, { active: false }, { type: 'one_time' }, { billing_scheme: 'tiered' }, { usage_type: 'metered' }, { interval: 'year' }, { transform_quantity: { divide_by: 10, round: 'up' } }, { custom_unit_amount: { enabled: true } }])('refuses a price differing from the promised monthly plan: %j', async mismatch => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = provider(vi.fn().mockResolvedValue({ ...price, ...mismatch }));
    await expect(checkPriceOnce(p, 'price_month')).rejects.toMatchObject({ status: 503, code: 'billing_unavailable' });
    log.mockRestore();
  });
  it('caches valid results per provider and price while concurrent callers await one check', async () => {
    let resolve!: (p: Price) => void;
    const getPrice = vi.fn().mockImplementationOnce(() => new Promise<Price>(r => { resolve = r; })).mockResolvedValue(price);
    const p = provider(getPrice);
    let completed = false;
    const a = checkPriceOnce(p, 'price_month').then(() => { completed = true; });
    const b = checkPriceOnce(p, 'price_month');
    await Promise.resolve(); expect(completed).toBe(false); expect(getPrice).toHaveBeenCalledTimes(1);
    resolve(price); await Promise.all([a, b]); await checkPriceOnce(p, 'price_month');
    expect(getPrice).toHaveBeenCalledTimes(1);
    await checkPriceOnce(p, 'price_other'); expect(getPrice).toHaveBeenCalledTimes(2);
    const q = provider(vi.fn().mockResolvedValue(price)); await checkPriceOnce(q, 'price_month'); expect(q.getPrice).toHaveBeenCalledTimes(1);
  });
  it('failed lookups are retryable and do not retain raw provider errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const getPrice = vi.fn().mockRejectedValueOnce(new Error('secret key is invalid')).mockResolvedValue(price);
    const p = provider(getPrice);
    await expect(checkPriceOnce(p, 'price_month')).rejects.not.toThrow('secret');
    await checkPriceOnce(p, 'price_month'); expect(getPrice).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret'); log.mockRestore();
  });
});
