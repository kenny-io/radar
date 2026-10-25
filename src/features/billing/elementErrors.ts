// Card field validation → the designed messages (handoff §4 table, architecture §10). Validation runs on submit only.
// Real Stripe Elements report `{empty, complete, error?: {code}}` from their `change` events; the stub fields report
// raw strings. Both end up here so the copy lives in one place.
//
// The Element error codes below come from Stripe.js behaviour (the published types only say `code: string`), so any
// code we don't know falls back to the field's first message.

export type CardField = 'num' | 'exp' | 'cvc' | 'zip';
export type CardErrors = Partial<Record<CardField, string>>;
export const FIELD_ORDER: CardField[] = ['num', 'exp', 'cvc', 'zip'];

export const MSG = {
  num: 'Enter your card number',
  exp: 'Use MM / YY',
  expired: 'This card has expired',
  cvc: '3 or 4 digits',
  zip: 'Enter your ZIP',
} as const;

/** Element `change` state we keep per split Element. */
export interface ElementState { empty: boolean; complete: boolean; error?: { code?: string } | null }

const EXPIRED = new Set(['invalid_expiry_month_past', 'invalid_expiry_year_past']);

/** The message for one split Element on submit, or null when it is complete and valid. */
export function elementMessage(field: Exclude<CardField, 'zip'>, s: ElementState | undefined): string | null {
  const code = s?.error?.code || null;
  if (s && s.complete && !code) return null;
  if (field === 'exp') return code && EXPIRED.has(code) ? MSG.expired : MSG.exp;
  // num: empty, incomplete_number, invalid_number, anything else → "Enter your card number"; cvc likewise.
  return field === 'num' ? MSG.num : MSG.cvc;
}

export function zipMessage(zip: string): string | null { return zip.trim().length < 3 ? MSG.zip : null; }

/** Errors for the real Elements form. */
export function elementErrors(st: Partial<Record<'num' | 'exp' | 'cvc', ElementState>>, zip: string): CardErrors {
  const e: CardErrors = {};
  for (const f of ['num', 'exp', 'cvc'] as const) { const m = elementMessage(f, st[f]); if (m) e[f] = m; }
  const z = zipMessage(zip); if (z) e.zip = z;
  return e;
}

export const firstError = (e: CardErrors): CardField | null => FIELD_ORDER.find(k => e[k]) || null;
