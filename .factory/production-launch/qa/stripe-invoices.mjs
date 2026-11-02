// Explicitly authorized sandbox acceptance only. Never print credentials, client secrets or webhook payloads.
// Run: node --env-file=.data/production-launch/stripe-sandbox.env --import tsx .factory/production-launch/qa/stripe-invoices.mjs
// --verify-only reads the retained successful fixture without creating or charging anything.
// The reserved debit fingerprint is used once; subsequent runs must use --verify-only.
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { eq, inArray } from 'drizzle-orm';
import { db, pool, schema } from '../../../src/server/db/index.ts';
import { stripeRequest } from '../../../src/server/billing/stripe.ts';
import { start } from '../../../src/server/billing/activate.ts';
import { confirmTrial } from '../../../src/server/billing/confirm.ts';

const EXPECTED_ACCOUNT = 'acct_1TsnjEGaLrbBBaPs';
const path = '.data/production-launch/stripe-invoices-e3.json';
const verifyOnly = process.argv.includes('--verify-only');
if (!verifyOnly) {
  try { await access(path); throw new Error('E3 evidence already exists; preserve the fixture and use --verify-only.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeError = e => ({ name: e?.name, status: e?.status, type: e?.type, code: e?.code,
  message: String(e?.message || e).replace(/(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|[A-Za-z0-9_]+_secret_[A-Za-z0-9]+/g, '[redacted]').slice(0, 500) });
let evidence = { run: `E3-${Date.now()}`, stage: 'preflight', account: EXPECTED_ACCOUNT, sandbox: true };
let verificationPhase = 'preflight';
const save = async () => {
  assert(!verifyOnly, 'Verification must never write retained evidence');
  await writeFile(path, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
};
const stage = async value => { evidence.stage = value; await save(); console.log(JSON.stringify({ stage: value, run: evidence.run })); };
const testResource = value => {
  if (Array.isArray(value?.data)) value.data.forEach(testResource);
  if (value && Object.hasOwn(value, 'livemode')) assert.equal(value.livemode, false, `Refusing live resource ${value.id || value.object}`);
  return value;
};
const get = async (route, params) => testResource(await stripeRequest('GET', route, { params }));
const post = async (route, params, suffix) => {
  assert(!verifyOnly, 'Verification must never mutate Stripe');
  return testResource(await stripeRequest('POST', route, { params, key: `radar:e3:${evidence.run}:${suffix}` }));
};
const idOf = value => typeof value === 'string' ? value : value?.id;
const customer = () => get(`/customers/${evidence.customer}`);
const subscription = () => get(`/subscriptions/${evidence.subscription}`);
const invoices = async () => (await get('/invoices', { customer: evidence.customer, limit: 100 })).data;
const invoiceSummary = value => ({ id: value.id, status: value.status, amount_due: value.amount_due, amount_paid: value.amount_paid,
  total: value.total, currency: value.currency, billing_reason: value.billing_reason, starting_balance: value.starting_balance, ending_balance: value.ending_balance });

async function ready() {
  const until = Date.now() + 180000;
  while (Date.now() < until) {
    const clock = await get(`/test_helpers/test_clocks/${evidence.clock}`);
    if (clock.status === 'ready') return clock;
    assert.equal(clock.status, 'advancing', 'Unexpected test clock status');
    await sleep(2000);
  }
  throw new Error('Test clock did not become ready within three minutes');
}
async function advance(target, suffix) {
  const clock = await ready();
  if (clock.frozen_time < target) await post(`/test_helpers/test_clocks/${evidence.clock}/advance`, { frozen_time: target }, suffix);
  return ready();
}
async function paidInvoice(expectedCents) {
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    const list = await invoices();
    const paid = list.find(i => i.status === 'paid' && i.amount_paid === expectedCents);
    if (paid) return paid;
    evidence.observedInvoices = list.map(invoiceSummary); await save();
    await sleep(2000);
  }
  throw new Error(`No automatically paid ${expectedCents}-cent invoice within 90 seconds`);
}
async function webhookProof() {
  const events = (await get('/events', { limit: 100 })).data.filter(ev => {
    const object = ev.data?.object;
    return object?.id === evidence.paymentIntent || object?.id === evidence.subscription || idOf(object?.customer) === evidence.customer;
  }).filter(ev => ['payment_intent.succeeded', 'customer.subscription.created', 'customer.subscription.updated', 'invoice.paid'].includes(ev.type));
  const until = Date.now() + 60000;
  let rows = [];
  while (Date.now() < until) {
    rows = events.length ? await db.select().from(schema.billingEvents).where(inArray(schema.billingEvents.id, events.map(e => e.id))) : [];
    if (events.length && rows.length === events.length && rows.every(row => row.processedAt)) break;
    await sleep(1000);
  }
  const byId = new Map(rows.map(row => [row.id, row]));
  evidence.webhooks = events.map(ev => ({ id: ev.id, type: ev.type, processed: !!byId.get(ev.id)?.processedAt, attempts: byId.get(ev.id)?.attempts || 0 }));
  assert(events.length > 0, 'No real Stripe events found');
  assert(evidence.webhooks.every(event => event.processed), 'Some real Stripe events have not been processed by the local listener');
}

async function verifyRetained() {
  assert.equal(evidence.stage, 'passed', 'A successful retained fixture is required');
  const own = await customer(); assert.equal(own.metadata.radar_fixture, 'E3-invoices'); assert.equal(own.metadata.radar_user_id, evidence.user);
  const first = await get(`/invoices/${evidence.firstInvoice.id}`), second = await get(`/invoices/${evidence.secondInvoice.id}`);
  for (const invoice of [first, second]) {
    assert.equal(idOf(invoice.customer), evidence.customer); assert.equal(invoice.status, 'paid'); assert.equal(invoice.currency, 'usd'); assert.equal(invoice.total, 5000);
  }
  assert.equal(first.amount_paid, 4900); assert.equal(first.starting_balance, -100); assert.equal(first.ending_balance, 0);
  assert.equal(second.amount_paid, 5000); assert.equal(second.starting_balance, 0); assert.equal(second.ending_balance, 0);
  const payments = (await get('/payment_intents', { customer: evidence.customer, limit: 100 })).data;
  assert.deepEqual(payments.map(payment => payment.amount).sort((a, b) => a - b), [100, 4900, 5000]);
  assert(payments.every(payment => payment.status === 'succeeded' && payment.currency === 'usd'));
  const credits = (await get(`/customers/${evidence.customer}/balance_transactions`, { limit: 100 })).data.filter(value => value.description === 'Card confirmation credit');
  assert.equal(credits.length, 1); assert.equal(credits[0].amount, -100);
  const sub = await subscription(); const [local] = await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId, evidence.user));
  assert.equal(local.status, 'active'); assert.equal(local.stripeSubscriptionId, sub.id);
  assert.equal(local.currentPeriodEnd.getTime() / 1000, sub.items.data[0].current_period_end);
  const rows = await db.select().from(schema.billingEvents).where(inArray(schema.billingEvents.id, evidence.webhooks.map(value => value.id)));
  assert.equal(rows.length, evidence.webhooks.length); assert(rows.every(row => row.processedAt && row.attempts === 1));
  const postflight = { verifiedAt: new Date().toISOString(), paymentAmounts: [100, 4900, 5000], oneCredit: true, periodEndMatches: true,
    currentPeriodEnd: local.currentPeriodEnd.toISOString(), processedEvents: rows.length };
  console.log(JSON.stringify({ result: 'retained-read-only-verified', postflight }));
}

try {
  // Load retained evidence first; verification errors must never replace it with a fresh preflight record.
  if (verifyOnly) {
    evidence = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(evidence.account, EXPECTED_ACCOUNT); assert.equal(evidence.sandbox, true);
  }
  assert.match(process.env.STRIPE_SECRET_KEY || '', /^sk_test_/, 'Sandbox test key required');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/radar_launch_stripe_sandbox');
  assert(['http://localhost:3902', 'https://localhost:3903'].includes(process.env.APP_URL), 'Only the authorized local HTTP/HTTPS fixture origins are allowed');
  assert.equal(process.env.RADAR_DEV_STUBS, '0'); assert.equal(process.env.RADAR_BILLING, 'on');
  const account = await get('/account'); assert.equal(account.id, EXPECTED_ACCOUNT);
  const price = await get(`/prices/${process.env.STRIPE_PRICE_ID}`);
  assert.equal(price.livemode, false); assert.equal(price.unit_amount, 5000); assert.equal(price.currency, 'usd');
  if (verifyOnly) {
    verificationPhase = 'retained-verification';
    await verifyRetained();
  } else {
  evidence.charges_enabled = account.charges_enabled; evidence.price = price.id;
  delete evidence.failure;
  if (!evidence.clock) {
    await stage('create-clock-and-user');
    const clock = await post('/test_helpers/test_clocks', { frozen_time: Math.floor(Date.now() / 1000), name: `Radar ${evidence.run} invoice acceptance` }, 'clock');
    evidence.clock = clock.id; await save();
    const [user] = await db.insert(schema.users).values({ name: `Radar ${evidence.run} invoice QA`, email: `radar-${evidence.run.toLowerCase()}@example.invalid` }).returning();
    evidence.user = user.id; evidence.email = user.email; await save();
    const created = await post('/customers', { test_clock: clock.id, name: user.name, email: user.email,
      metadata: { radar_fixture: 'E3-invoices', radar_user_id: user.id } }, 'customer');
    evidence.customer = created.id;
    await db.insert(schema.billingAccounts).values({ userId: user.id, stripeCustomerId: created.id });
    await save();
  }
  const ownCustomer = await customer();
  assert.equal(ownCustomer.metadata.radar_fixture, 'E3-invoices'); assert.equal(ownCustomer.metadata.radar_user_id, evidence.user);
  assert.equal(idOf(ownCustomer.test_clock), evidence.clock);
  if (!evidence.paymentMethod) {
    await stage('create-distinct-visa-debit-test-card');
    const pm = await post('/payment_methods', { type: 'card', card: { token: 'tok_visa_debit' }, metadata: { radar_fixture: 'E3-invoices' } }, 'payment-method');
    assert.equal(pm.card.last4, '5556'); assert.equal(pm.card.funding, 'debit');
    evidence.paymentMethod = pm.id; evidence.card = { brand: pm.card.brand, funding: pm.card.funding, last4: pm.card.last4 }; await save();
  }
  if (!evidence.paymentIntent) {
    await stage('radar-start-real-card-check');
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, evidence.user));
    const result = await start({ id: user.id, email: user.email, name: user.name }, evidence.paymentMethod, 'E3-invoice-acceptance');
    assert('paymentIntentId' in result, 'Fresh fixture unexpectedly activated already');
    evidence.paymentIntent = result.paymentIntentId; await save();
  }
  await stage('confirm-real-one-dollar-payment');
  let pi = await get(`/payment_intents/${evidence.paymentIntent}`);
  if (pi.status !== 'succeeded') pi = await post(`/payment_intents/${pi.id}/confirm`, { payment_method: evidence.paymentMethod }, 'confirm-payment');
  assert.equal(pi.livemode, false); assert.equal(pi.amount, 100); assert.equal(pi.currency, 'usd'); assert.equal(pi.status, 'succeeded');
  evidence.cardCheck = { id: pi.id, amount: pi.amount, currency: pi.currency, status: pi.status }; await save();
  await stage('radar-activate-real-trial-and-credit');
  await confirmTrial({ id: evidence.user }, evidence.paymentIntent);
  let [local] = await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId, evidence.user));
  assert.equal(local.status, 'trialing'); assert(local.trialCreditedAt);
  evidence.subscription = local.stripeSubscriptionId; await save();
  let sub = await subscription(); assert.equal(sub.status, 'trialing'); assert.equal(sub.livemode, false);
  evidence.trial = { subscription: sub.id, trial_end: sub.trial_end, status: sub.status };
  const credits = (await get(`/customers/${evidence.customer}/balance_transactions`, { limit: 100 })).data
    .filter(transaction => transaction.description === 'Card confirmation credit');
  assert.equal(credits.length, 1); assert.equal(credits[0].amount, -100); assert.equal(credits[0].currency, 'usd');
  evidence.credits = credits.map(transaction => ({ id: transaction.id, amount: transaction.amount, currency: transaction.currency })); await save();
  await stage('advance-to-first-recurring-invoice');
  await advance(sub.trial_end + 3600, 'advance-first');
  evidence.firstInvoice = invoiceSummary(await paidInvoice(4900)); await save();
  sub = await subscription(); assert.equal(sub.status, 'active');
  const periodEnd = sub.items.data[0].current_period_end; assert.equal(typeof periodEnd, 'number');
  await stage('advance-to-next-recurring-invoice');
  await advance(periodEnd + 3600, 'advance-second');
  evidence.secondInvoice = invoiceSummary(await paidInvoice(5000));
  const payments = (await get('/payment_intents', { customer: evidence.customer, limit: 100 })).data;
  assert.equal(payments.filter(payment => payment.amount === 100).length, 1);
  evidence.payments = payments.map(payment => ({ id: payment.id, amount: payment.amount, status: payment.status, currency: payment.currency }));
  await webhookProof();
  [local] = await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId, evidence.user));
  assert.equal(local.status, 'active'); assert.equal(local.stripeSubscriptionId, evidence.subscription);
  const trialEvents = await db.select().from(schema.events).where(eq(schema.events.userId, evidence.user));
  assert.equal(trialEvents.filter(event => event.kind === 'trial.started').length, 1);
  evidence.local = { status: local.status, trialCredited: !!local.trialCreditedAt, trialStartedEvents: 1 };
  await stage('passed'); console.log(JSON.stringify({ result: 'passed', clock: evidence.clock, customer: evidence.customer,
    cardCheck: evidence.cardCheck, firstInvoice: evidence.firstInvoice, secondInvoice: evidence.secondInvoice, webhooks: evidence.webhooks }));
  }
} catch (error) {
  const failure = safeError(error);
  if (!verifyOnly) { evidence.failure = failure; await save(); }
  console.log(JSON.stringify({ result: 'blocked-or-failed', stage: verifyOnly ? verificationPhase : evidence.stage, failure })); process.exitCode = 1;
} finally { await pool.end(); }
