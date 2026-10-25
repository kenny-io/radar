// Placeholder until M2/M3 (the provider is implemented in the next commit).
import type { BillingProvider } from './provider';
const todo = (): never => { throw new Error('billing provider not implemented yet'); };
export const stubProvider: BillingProvider = new Proxy({ name: 'stub' } as any, { get: (t, k) => (k in t ? t[k] : todo) });
