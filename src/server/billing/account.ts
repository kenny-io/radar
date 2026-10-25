// The billing account row, the customer and the single per-user billing lock (architecture §7.2).
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { env } from '../env';
import { PRICE_CENTS } from '@/lib/billing';
import type { Account } from './access';
import { runLater, type Later, type Tx } from './draft';
import { BillingError } from './errors';
import { getProvider, ProviderError, STUB_PRICE_ID, type BillingProvider } from './provider';

const A = schema.billingAccounts;

/** One transaction per request, holding pg_advisory_xact_lock(hashtext('billing:' || uid)). Each request (start,
 *  restart, confirm, a webhook delivery) enters it once and passes `tx` down: advisory locks are re-entrant only on the
 *  same connection, so nesting across the pool would wait on itself. `later` runs after commit (tracking).
 *  Never call ownAccess or accessSummary inside: the lazy grandfather upserts this row through another connection. */
export async function withBillingLock<T>(uid: string, fn: (tx: Tx, later: Later) => Promise<T>): Promise<T> {
  const later: Later = [];
  const r = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'billing:' + uid}))`);
    return fn(tx, later);
  });
  await runLater(later);
  return r;
}

/** The account row, created if missing, locked FOR UPDATE for the rest of the transaction. */
export async function lockAccount(tx: Tx, uid: string): Promise<Account> {
  await tx.insert(A).values({ userId: uid }).onConflictDoNothing();
  return (await tx.select().from(A).where(eq(A.userId, uid)).for('update'))[0];
}

export const accountByCustomer = async (customer: string) =>
  (await db.select().from(A).where(eq(A.stripeCustomerId, customer)).limit(1))[0] || null;

export async function needProvider(): Promise<BillingProvider> {
  const p = await getProvider();
  if (!p) throw BillingError.unavailable();
  return p;
}

/** STRIPE_PRICE_ID (the stub has its own). Unset with Stripe → 503, loudly. */
export function priceId(p: BillingProvider): string {
  const id = env.stripePriceId || (p.name === 'stub' ? STUB_PRICE_ID : '');
  if (!id) { console.error('[billing] STRIPE_PRICE_ID is not set'); throw BillingError.unavailable(); }
  return id;
}

const g = globalThis as unknown as { __radarPriceChecked?: boolean };
/** Once per process: the configured price must be the $50/month USD the pages show (PRICE_CENTS). Logs, never blocks. */
export async function checkPriceOnce(p: BillingProvider, id: string) {
  if (g.__radarPriceChecked) return;
  g.__radarPriceChecked = true;
  try {
    const pr = await p.getPrice(id);
    if (pr.unit_amount !== PRICE_CENTS || pr.currency !== 'usd' || pr.interval !== 'month')
      console.error(`[billing] STRIPE_PRICE_ID ${id} is ${pr.unit_amount} ${pr.currency}/${pr.interval}; the pages show ${PRICE_CENTS} usd/month`);
  } catch (e: any) { g.__radarPriceChecked = false; console.error('[billing] price check failed', e?.message || e); }
}

/** The Stripe customer, created once (key radar:cus:{uid} replays it within 24h). Runs before the lock. */
export async function ensureCustomer(p: BillingProvider, u: { id: string; email: string; name: string }): Promise<string> {
  const cur = async () => (await db.select({ c: A.stripeCustomerId }).from(A).where(eq(A.userId, u.id)).limit(1))[0]?.c || null;
  const have = await cur();
  if (have) return have;
  const c = await p.createCustomer({ email: u.email, name: u.name, uid: u.id }, `radar:cus:${u.id}`);
  await db.insert(A).values({ userId: u.id, stripeCustomerId: c.id })
    .onConflictDoUpdate({ target: A.userId, set: { stripeCustomerId: sql`coalesce(${A.stripeCustomerId}, excluded.stripe_customer_id)`, updatedAt: new Date() } });
  return (await cur())!;
}

/** A provider 4xx about the user's input (unknown or unusable card) → 400; anything else propagates. */
export const asInvalidCard = (e: unknown): never => {
  if (e instanceof ProviderError && e.status >= 400 && e.status < 500 && e.status !== 409 && e.status !== 429) throw BillingError.invalidPaymentMethod();
  throw e;
};
export const nullIfMissing = (e: unknown): null => { if (e instanceof ProviderError && e.status === 404) return null; throw e; };
