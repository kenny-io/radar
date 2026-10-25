import { describe, expect, it } from 'vitest';
import { elementErrors, elementMessage, firstError, zipMessage } from './elementErrors';

const ok = { empty: false, complete: true, error: null };
const err = (code: string) => ({ empty: false, complete: false, error: { code } });

describe('Stripe Element state → designed field messages (handoff §4)', () => {
  it('card number: empty, incomplete, invalid and unknown codes all read "Enter your card number"', () => {
    expect(elementMessage('num', undefined)).toBe('Enter your card number');
    expect(elementMessage('num', { empty: true, complete: false })).toBe('Enter your card number');
    for (const c of ['incomplete_number', 'invalid_number', 'something_new']) expect(elementMessage('num', err(c))).toBe('Enter your card number');
    expect(elementMessage('num', ok)).toBeNull();
  });
  it('expiry: format problems read "Use MM / YY", past dates read "This card has expired"', () => {
    for (const c of ['incomplete_expiry', 'invalid_expiry_month', 'invalid_expiry_year', 'unknown_code']) expect(elementMessage('exp', err(c))).toBe('Use MM / YY');
    expect(elementMessage('exp', { empty: true, complete: false })).toBe('Use MM / YY');
    expect(elementMessage('exp', err('invalid_expiry_month_past'))).toBe('This card has expired');
    expect(elementMessage('exp', err('invalid_expiry_year_past'))).toBe('This card has expired');
    expect(elementMessage('exp', ok)).toBeNull();
  });
  it('CVC: empty, incomplete and invalid read "3 or 4 digits"', () => {
    for (const c of ['incomplete_cvc', 'invalid_cvc']) expect(elementMessage('cvc', err(c))).toBe('3 or 4 digits');
    expect(elementMessage('cvc', { empty: true, complete: false })).toBe('3 or 4 digits');
    expect(elementMessage('cvc', ok)).toBeNull();
  });
  it('a complete flag never hides an error the Element still reports', () => {
    expect(elementMessage('exp', { empty: false, complete: true, error: { code: 'invalid_expiry_year_past' } })).toBe('This card has expired');
  });
  it('ZIP needs 3 or more characters after trimming', () => {
    expect(zipMessage('  1 ')).toBe('Enter your ZIP');
    expect(zipMessage('SW1')).toBeNull();
  });
  it('collects every field on submit, in form order', () => {
    const e = elementErrors({ num: ok, exp: err('invalid_expiry_year_past') }, '');
    expect(e).toEqual({ exp: 'This card has expired', cvc: '3 or 4 digits', zip: 'Enter your ZIP' });
    expect(firstError(e)).toBe('exp');
    expect(elementErrors({ num: ok, exp: ok, cvc: ok }, '10001')).toEqual({});
    expect(firstError({})).toBeNull();
  });
});
