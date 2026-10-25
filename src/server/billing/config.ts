// Which payment provider runs (architecture §7.4). 'stripe' when STRIPE_SECRET_KEY is set; 'stub' with RADAR_DEV_STUBS=1
// outside production; otherwise 'none' (billing then fails open, B19). This file never imports the stub.
import { env } from '../env';

export type ProviderName = 'stripe' | 'stub' | 'none';
const g = globalThis as unknown as { __radarBillingProvider?: ProviderName | null };

export function providerName(): ProviderName {
  if (g.__radarBillingProvider) return g.__radarBillingProvider;
  if (env.stripeSecretKey) return 'stripe';
  if (env.devStubs && !env.isProd) return 'stub';
  return 'none';
}
/** Tests only: force a provider name (null restores the env choice). */
export function setProviderNameForTests(p: ProviderName | null) { g.__radarBillingProvider = p; }
