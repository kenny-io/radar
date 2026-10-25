// Client stub for the subset of Stripe.js the trial page uses (architecture §7.4). Only used when the server reports
// `provider: 'stub'` (RADAR_DEV_STUBS=1 and no STRIPE_SECRET_KEY; never in production). Card numbers pick a scenario:
//   4000 0000 0000 0002 → declined            4000 0025 0000 3155 → simulated 3-D Secure (Complete / Fail)
//   any other Luhn-valid number → succeeds
// PaymentMethod ids are `pm_stub_<scenario>_<last4>`; the server stub derives the fingerprint (`fp_stub_<last4>`) from it.
import { MSG, zipMessage, type CardErrors } from './elementErrors';

export type StubScenario = 'succeed' | 'decline' | '3ds';
export type StubOutcome = 'succeed' | 'decline' | 'auth_fail';
export interface StubCardValue { num: string; exp: string; cvc: string; zip: string }

export const digits = (v: string) => v.replace(/\D/g, '');

export function luhn(num: string): boolean {
  const d = digits(num); if (!d.length) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) { let n = d.charCodeAt(d.length - 1 - i) - 48; if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; }
  return sum % 10 === 0;
}

const SPECIAL: Record<string, StubScenario> = { '4000000000000002': 'decline', '4000002500003155': '3ds' };

/** The scenario for a card number, or null when it isn't a usable number (too short or fails Luhn). */
export function stubScenario(num: string): StubScenario | null {
  const d = digits(num);
  if (d.length < 15 || d.length > 16 || !luhn(d)) return null;
  return SPECIAL[d] || 'succeed';
}
export const stubPmId = (num: string, s: StubScenario) => `pm_stub_${s}_${digits(num).slice(-4)}`;
export function scenarioOfPm(pm: string): StubScenario | null { const m = /^pm_stub_(succeed|decline|3ds)_\d{4}$/.exec(pm); return m ? (m[1] as StubScenario) : null; }

/** Input formatting, as the prototype's raw fields: the number in groups of four (max 16 digits), expiry "MM / YY". */
export const fmtNum = (v: string) => digits(v).slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
export const fmtExp = (v: string) => { const d = digits(v).slice(0, 4); return d.length > 2 ? d.slice(0, 2) + ' / ' + d.slice(2) : d; };
export const fmtCvc = (v: string) => digits(v).slice(0, 4);

/** Submit-time validation for the stub fields: the handoff §4 table, plus Luhn (as Stripe's `invalid_number`). */
export function stubCardErrors(f: StubCardValue, now: Date): CardErrors {
  const e: CardErrors = {};
  if (!stubScenario(f.num)) e.num = MSG.num;
  const [m, y] = f.exp.split('/').map(s => parseInt(s, 10)); const ty = now.getFullYear() % 100, tm = now.getMonth() + 1;
  if (!m || !y || m < 1 || m > 12 || digits(f.exp).length !== 4) e.exp = MSG.exp;
  else if (y < ty || (y === ty && m < tm)) e.exp = MSG.expired;
  if (!/^\d{3,4}$/.test(f.cvc)) e.cvc = MSG.cvc;
  const z = zipMessage(f.zip); if (z) e.zip = z;
  return e;
}

export const outcomeFor = (s: StubScenario | null, authenticated: boolean | null): StubOutcome =>
  s === 'decline' ? 'decline' : s === '3ds' ? (authenticated ? 'succeed' : 'auth_fail') : 'succeed';

export interface StubError { type: string; code?: string; decline_code?: string; message?: string }

/** `stripe.createPaymentMethod` / `stripe.confirmCardPayment`, stub edition. `authenticate` shows the simulated
 *  3-D Secure step and resolves true (Complete) or false (Fail). */
export function createStubStripe({ authenticate }: { authenticate: () => Promise<boolean> }) {
  return {
    async createPaymentMethod(card: StubCardValue): Promise<{ paymentMethod: { id: string }; error?: undefined } | { paymentMethod?: undefined; error: StubError }> {
      const s = stubScenario(card.num);
      if (!s) return { error: { type: 'validation_error', code: 'invalid_number', message: MSG.num } };
      return { paymentMethod: { id: stubPmId(card.num, s) } };
    },
    async confirmCardPayment(clientSecret: string, { payment_method }: { payment_method: string }): Promise<{ paymentIntent?: { id: string; status: string }; error?: StubError }> {
      const s = scenarioOfPm(payment_method);
      const outcome = outcomeFor(s, s === '3ds' ? await authenticate() : null);
      const paymentIntentId = clientSecret.split('_secret_')[0];
      let j: any = null; let ok = false;
      try {
        const r = await fetch('/api/billing/dev/confirm-intent', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ paymentIntentId, outcome }) });
        ok = r.ok; j = await r.json().catch(() => null);
      } catch { /* network */ }
      if (j && j.paymentIntent) return { paymentIntent: j.paymentIntent };
      if (j && j.error && typeof j.error === 'object') return { error: j.error };
      return { error: { type: ok ? 'api_error' : 'api_connection_error' } };
    },
  };
}
