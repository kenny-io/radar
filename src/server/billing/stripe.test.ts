// The Stripe REST client against a mocked fetch (architecture §16.1): encoding, headers, error mapping, retries.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formEncode, setStripeDepsForTests, stripeProvider, stripeRequest } from './stripe';
import { ProviderError } from './provider';

const KEY = 'sk_test_51FakeKeyForUnitTests';
type Call = { url: string; init: RequestInit };
let calls: Call[] = []; let replies: (() => Response | Promise<Response>)[] = []; const sleeps: number[] = [];
const reply = (status: number, body: any) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const headers = (c: Call) => c.init.headers as Record<string, string>;
const body = (c: Call) => decodeURIComponent(String(c.init.body));

beforeEach(() => {
  calls = []; replies = []; sleeps.length = 0;
  setStripeDepsForTests({
    secretKey: () => KEY, apiVersion: () => '2026-05-27.dahlia', sleep: async ms => { sleeps.push(ms); },
    fetch: (async (url: string, init: RequestInit) => { calls.push({ url, init }); const r = replies.shift(); if (!r) throw new Error('unexpected fetch'); return r(); }) as any,
  });
});

describe('formEncode', () => {
  it('encodes nested params with brackets: items[0][price], metadata[k], expand[]', () => {
    const s = formEncode({ customer: 'cus_1', items: [{ price: 'price_1' }], metadata: { radar_user_id: 'u-1', radar_pi: 'pi_1' }, expand: ['latest_invoice.confirmation_secret'],
      trial_settings: { end_behavior: { missing_payment_method: 'cancel' } }, trial_end: 1800000000, skip: undefined, none: null, flag: false });
    expect(s).toBe('customer=cus_1&items[0][price]=price_1&metadata[radar_user_id]=u-1&metadata[radar_pi]=pi_1&expand[]=latest_invoice.confirmation_secret'
      + '&trial_settings[end_behavior][missing_payment_method]=cancel&trial_end=1800000000&flag=false');
  });
  it('escapes values (an email with +, spaces) but keeps brackets readable', () => {
    expect(formEncode({ email: 'a+b@x.co', description: 'Radar card confirmation', payment_method_types: ['card'] }))
      .toBe('email=a%2Bb%40x.co&description=Radar%20card%20confirmation&payment_method_types[]=card');
  });
});

describe('stripeRequest', () => {
  it('POST carries the secret, the pinned Stripe-Version, the Idempotency-Key and a form body', async () => {
    replies.push(reply(200, { id: 'cus_9' }));
    expect(await stripeProvider.createCustomer({ email: 'a@x.co', name: 'Ada', uid: 'u-1' }, 'radar:cus:u-1')).toEqual({ id: 'cus_9' });
    expect(calls[0].url).toBe('https://api.stripe.com/v1/customers');
    expect(calls[0].init.method).toBe('POST');
    expect(headers(calls[0])).toEqual({ Authorization: `Bearer ${KEY}`, 'Stripe-Version': '2026-05-27.dahlia', 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': 'radar:cus:u-1' });
    expect(body(calls[0])).toBe('email=a@x.co&name=Ada&metadata[radar_user_id]=u-1');
  });
  it('GET has a query string and no Idempotency-Key; a POST without a key is refused before any request', async () => {
    replies.push(reply(200, { id: 'in_1', status: 'open', amount_due: 4900, confirmation_secret: { client_secret: 'pi_1_secret_x', type: 'payment_intent' } }));
    expect(await stripeProvider.getInvoice('in_1')).toEqual({ id: 'in_1', status: 'open', amount_due: 4900, client_secret: 'pi_1_secret_x' });
    expect(decodeURIComponent(calls[0].url)).toBe('https://api.stripe.com/v1/invoices/in_1?expand[]=confirmation_secret');
    expect(headers(calls[0])['Idempotency-Key']).toBeUndefined();
    expect(calls[0].init.body).toBeUndefined();
    await expect(stripeRequest('POST', '/customers', { params: {} })).rejects.toThrow('without an Idempotency-Key');
    expect(calls).toHaveLength(1);
  });
  it('maps a card error to ProviderError(type, code, decline_code) and never puts the key in the message', async () => {
    replies.push(reply(402, { error: { type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds', message: 'Your card has insufficient funds.' } }));
    const e = await stripeProvider.createPaymentIntent({ amount: 100, currency: 'usd', customer: 'cus_1', paymentMethod: 'pm_1', description: 'Radar card confirmation', metadata: { purpose: 'trial_check' } }, 'radar:pi:k').catch(x => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e).toMatchObject({ status: 402, type: 'card_error', code: 'card_declined', declineCode: 'insufficient_funds', message: 'Your card has insufficient funds.' });
    expect(String(e.message)).not.toContain(KEY);
    expect(body(calls[0])).toBe('amount=100&currency=usd&customer=cus_1&payment_method=pm_1&payment_method_types[]=card&setup_future_usage=off_session&description=Radar card confirmation&metadata[purpose]=trial_check');
    replies.push(reply(404, { error: { type: 'invalid_request_error', code: 'resource_missing', message: "No such payment_method: 'pm_x'" } }));
    await expect(stripeProvider.getPaymentMethod('pm_x')).rejects.toMatchObject({ status: 404, code: 'resource_missing' });
  });
  it('retries a 409 (key in flight) 1s × 3, then gives up with the 409', async () => {
    replies.push(reply(409, { error: { type: 'idempotency_error' } }), reply(409, { error: { type: 'idempotency_error' } }), reply(200, { id: 'sub_1', status: 'trialing', customer: 'cus_1', items: { data: [{ current_period_end: 1800003600 }] }, metadata: {}, latest_invoice: 'in_0', trial_end: 1800003600 }));
    const r = await stripeProvider.createSubscription({ customer: 'cus_1', price: 'price_1', defaultPaymentMethod: 'pm_1', trialEnd: 1800003600, metadata: { radar_pi: 'pi_1' } }, 'radar:sub:pi_1:1800003600');
    expect(r.sub).toMatchObject({ id: 'sub_1', current_period_end: 1800003600, latest_invoice: 'in_0', trial_end: 1800003600 });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 1000]);
    expect(new Set(calls.map(c => headers(c)['Idempotency-Key']))).toEqual(new Set(['radar:sub:pi_1:1800003600']));
    expect(body(calls[0])).toBe('customer=cus_1&items[0][price]=price_1&default_payment_method=pm_1&metadata[radar_pi]=pi_1&trial_end=1800003600&trial_settings[end_behavior][missing_payment_method]=cancel');
    calls = []; sleeps.length = 0;
    for (let i = 0; i < 4; i++) replies.push(reply(409, { error: { type: 'idempotency_error', message: 'in flight' } }));
    await expect(stripeRequest('POST', '/subscriptions', { params: {}, key: 'k' })).rejects.toMatchObject({ status: 409 });
    expect(calls).toHaveLength(4);
  });
  it('retries a dropped connection twice; a 500 is not retried (Stripe saved that result)', async () => {
    replies.push(() => { throw new TypeError('fetch failed'); }, reply(200, { id: 'pi_1', status: 'succeeded', amount: 100, currency: 'usd', customer: { id: 'cus_1' }, payment_method: { id: 'pm_1' }, metadata: { purpose: 'trial_check' }, client_secret: 'pi_1_secret_y' }));
    expect(await stripeProvider.getPaymentIntent('pi_1')).toMatchObject({ customer: 'cus_1', payment_method: 'pm_1', client_secret: 'pi_1_secret_y', last_payment_error: null });
    calls = [];
    replies.push(reply(500, { error: { type: 'api_error', message: 'boom' } }));
    await expect(stripeProvider.getSubscription('sub_1')).rejects.toMatchObject({ status: 500, type: 'api_error' });
    expect(calls).toHaveLength(1);
  });
  it('restart subscriptions ask for default_incomplete and return the invoice’s confirmation secret', async () => {
    replies.push(reply(200, { id: 'sub_2', status: 'incomplete', customer: 'cus_1', items: { data: [{ current_period_end: 1802592000 }] }, metadata: { purpose: 'restart' }, latest_invoice: { id: 'in_2', confirmation_secret: { client_secret: 'pi_2_secret_z' } } }));
    const r = await stripeProvider.createSubscription({ customer: 'cus_1', price: 'price_1', defaultPaymentMethod: 'pm_2', incomplete: true, metadata: { purpose: 'restart' } }, 'radar:restart:k');
    expect(r).toEqual({ sub: expect.objectContaining({ id: 'sub_2', status: 'incomplete', latest_invoice: 'in_2' }), clientSecret: 'pi_2_secret_z' });
    expect(body(calls[0])).toBe('customer=cus_1&items[0][price]=price_1&default_payment_method=pm_2&metadata[purpose]=restart&payment_behavior=default_incomplete&payment_settings[save_default_payment_method]=on_subscription&expand[]=latest_invoice.confirmation_secret');
  });
  it('the $1 credit is a negative USD balance transaction; cancel is a DELETE; list asks for every status', async () => {
    replies.push(reply(200, { id: 'cbtxn_1' }), reply(200, { id: 'sub_1', status: 'canceled' }), reply(200, { data: [{ id: 'sub_1', status: 'canceled', customer: 'cus_1', metadata: { radar_pi: 'pi_1' } }] }));
    await stripeProvider.creditBalance('cus_1', 100, 'Card confirmation credit', 'radar:credit:pi_1');
    expect(calls[0].url).toBe('https://api.stripe.com/v1/customers/cus_1/balance_transactions');
    expect(body(calls[0])).toBe('amount=-100&currency=usd&description=Card confirmation credit');
    await stripeProvider.cancelSubscription('sub_1');
    expect([calls[1].init.method, calls[1].url, headers(calls[1])['Idempotency-Key']]).toEqual(['DELETE', 'https://api.stripe.com/v1/subscriptions/sub_1', undefined]);
    expect((await stripeProvider.listSubscriptions('cus_1'))[0]).toMatchObject({ id: 'sub_1', metadata: { radar_pi: 'pi_1' }, current_period_end: null });
    expect(calls[2].url).toBe('https://api.stripe.com/v1/subscriptions?customer=cus_1&status=all&limit=20');
  });
  it('voiding an invoice is a keyed POST; the customer balance is read from GET /customers (credit negative, deleted → null)', async () => {
    replies.push(reply(200, { id: 'in_3', status: 'void' }), reply(200, { id: 'cus_1', object: 'customer', balance: -100 }), reply(200, { id: 'cus_1', object: 'customer' }), reply(200, { id: 'cus_2', deleted: true }));
    await stripeProvider.voidInvoice('in_3', 'radar:void:in_3');
    expect([calls[0].init.method, calls[0].url, headers(calls[0])['Idempotency-Key'], body(calls[0])]).toEqual(['POST', 'https://api.stripe.com/v1/invoices/in_3/void', 'radar:void:in_3', '']);
    expect(await stripeProvider.getCustomerBalance('cus_1')).toBe(-100);
    expect([calls[1].init.method, calls[1].url]).toEqual(['GET', 'https://api.stripe.com/v1/customers/cus_1']);
    expect(await stripeProvider.getCustomerBalance('cus_1')).toBe(0);         // no balance field: nothing owed either way
    expect(await stripeProvider.getCustomerBalance('cus_2')).toBeNull();
  });
  it('without STRIPE_SECRET_KEY nothing is sent', async () => {
    setStripeDepsForTests({ secretKey: () => '' });
    await expect(stripeProvider.getPrice('price_1')).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(0);
  });
});
