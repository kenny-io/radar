import { PRICE_CENTS } from '@/lib/billing';
import { BillingError } from './errors';
import type { BillingProvider } from './provider';

// Cache only a successful check for this provider and price. Concurrent callers await the same validation;
// a rejected check is removed so repairing configuration can be retried without restarting the process.
const checks = new WeakMap<BillingProvider, Map<string, Promise<void>>>();
export async function checkPriceOnce(p: BillingProvider, id: string): Promise<void> {
  let byId = checks.get(p);
  if (!byId) { byId = new Map(); checks.set(p, byId); }
  const existing = byId.get(id);
  if (existing) return existing;
  const check = (async () => {
    try {
      const v = await p.getPrice(id);
      if (!v.active || v.type !== 'recurring' || v.unit_amount !== PRICE_CENTS || v.currency !== 'usd'
        || v.billing_scheme !== 'per_unit' || v.interval !== 'month' || v.interval_count !== 1 || v.usage_type !== 'licensed'
        || v.transform_quantity != null || v.custom_unit_amount != null)
        throw BillingError.unavailable();
    } catch {
      console.error('[billing] Configured price could not be verified as active, licensed $50 USD per month; payment refused');
      throw BillingError.unavailable();
    }
  })();
  byId.set(id, check);
  try { await check; } catch (e) { byId.delete(id); throw e; }
}
