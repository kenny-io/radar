import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStubStripe, fmtExp, fmtNum, luhn, outcomeFor, scenarioOfPm, stubCardErrors, stubPmId, stubScenario } from './stubStripe';

describe('stub card scenarios (architecture §7.4)', () => {
  it('Luhn', () => {
    expect(luhn('4242 4242 4242 4242')).toBe(true);
    expect(luhn('4242424242424241')).toBe(false);
    expect(luhn('378282246310005')).toBe(true); // Amex, 15 digits
    expect(luhn('')).toBe(false);
  });
  it('picks the scenario from the number', () => {
    expect(stubScenario('4000 0000 0000 0002')).toBe('decline');
    expect(stubScenario('4000 0025 0000 3155')).toBe('3ds');
    expect(stubScenario('4242 4242 4242 4242')).toBe('succeed');
    expect(stubScenario('5555 5555 5555 4444')).toBe('succeed');
    expect(stubScenario('378282246310005')).toBe('succeed');
    expect(stubScenario('4242 4242 4242 4241')).toBeNull(); // fails Luhn
    expect(stubScenario('4242 4242 4242')).toBeNull(); // too short
  });
  it('encodes the scenario and last 4 in the PaymentMethod id, and reads it back', () => {
    expect(stubPmId('4000 0000 0000 0002', 'decline')).toBe('pm_stub_decline_0002');
    expect(scenarioOfPm('pm_stub_3ds_3155')).toBe('3ds');
    expect(scenarioOfPm('pm_1Nabc')).toBeNull();
  });
  it('maps the scenario and the simulated 3-D Secure answer to the dev confirm outcome', () => {
    expect(outcomeFor('succeed', null)).toBe('succeed');
    expect(outcomeFor('decline', null)).toBe('decline');
    expect(outcomeFor('3ds', true)).toBe('succeed');
    expect(outcomeFor('3ds', false)).toBe('auth_fail');
  });
  it('formats like the prototype fields', () => {
    expect(fmtNum('4242424242424242999')).toBe('4242 4242 4242 4242');
    expect(fmtExp('1228')).toBe('12 / 28');
    expect(fmtExp('1')).toBe('1');
  });
});

describe('stub field validation (handoff §4 table)', () => {
  const now = new Date(2026, 9, 25); // Oct 2026, local
  const good = { num: '4242 4242 4242 4242', exp: '12 / 28', cvc: '123', zip: '10001' };
  it('passes a complete card', () => { expect(stubCardErrors(good, now)).toEqual({}); });
  it('flags each field with its designed message', () => {
    expect(stubCardErrors({ num: '4242', exp: '13 / 28', cvc: '12', zip: '1' }, now)).toEqual({ num: 'Enter your card number', exp: 'Use MM / YY', cvc: '3 or 4 digits', zip: 'Enter your ZIP' });
  });
  it('rejects a number that fails Luhn', () => { expect(stubCardErrors({ ...good, num: '4242 4242 4242 4241' }, now).num).toBe('Enter your card number'); });
  it('treats last month as expired and this month as valid', () => {
    expect(stubCardErrors({ ...good, exp: '09 / 26' }, now).exp).toBe('This card has expired');
    expect(stubCardErrors({ ...good, exp: '12 / 25' }, now).exp).toBe('This card has expired');
    expect(stubCardErrors({ ...good, exp: '10 / 26' }, now).exp).toBeUndefined();
    expect(stubCardErrors({ ...good, exp: '1' }, now).exp).toBe('Use MM / YY');
  });
});

describe('stub stripe client', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const fetchReturning = (body: any, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

  it('confirms through the dev endpoint with the outcome for the card', async () => {
    const f = fetchReturning({ paymentIntent: { id: 'pi_stub_1', status: 'succeeded' } }); vi.stubGlobal('fetch', f);
    const s = createStubStripe({ authenticate: async () => true });
    const pm = await s.createPaymentMethod({ num: '4000 0025 0000 3155', exp: '12 / 28', cvc: '123', zip: '10001' });
    expect(pm.paymentMethod?.id).toBe('pm_stub_3ds_3155');
    const r = await s.confirmCardPayment('pi_stub_1_secret_abc', { payment_method: pm.paymentMethod!.id });
    expect(r.paymentIntent?.status).toBe('succeeded');
    expect(JSON.parse((f.mock.calls[0] as any)[1].body)).toEqual({ paymentIntentId: 'pi_stub_1', outcome: 'succeed' });
  });
  it('returns the declined card error from the dev endpoint', async () => {
    vi.stubGlobal('fetch', fetchReturning({ error: { type: 'card_error', code: 'card_declined' } }));
    const s = createStubStripe({ authenticate: async () => true });
    const r = await s.confirmCardPayment('pi_stub_2_secret_x', { payment_method: 'pm_stub_decline_0002' });
    expect(r.error).toEqual({ type: 'card_error', code: 'card_declined' });
  });
  it('a failed 3-D Secure step sends auth_fail and never asks twice', async () => {
    const f = fetchReturning({ error: { type: 'invalid_request_error', code: 'payment_intent_authentication_failure' } }); vi.stubGlobal('fetch', f);
    const auth = vi.fn(async () => false);
    const r = await createStubStripe({ authenticate: auth }).confirmCardPayment('pi_3_secret_y', { payment_method: 'pm_stub_3ds_3155' });
    expect(auth).toHaveBeenCalledTimes(1);
    expect(JSON.parse((f.mock.calls[0] as any)[1].body).outcome).toBe('auth_fail');
    expect(r.error?.code).toBe('payment_intent_authentication_failure');
  });
  it('a network failure is an error, not a success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const r = await createStubStripe({ authenticate: async () => true }).confirmCardPayment('pi_4_secret_z', { payment_method: 'pm_stub_succeed_4242' });
    expect(r.paymentIntent).toBeUndefined();
    expect(r.error?.type).toBe('api_connection_error');
  });
});
