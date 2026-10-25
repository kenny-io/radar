// POST /api/billing/confirm (architecture §5.3): after stripe-js confirmed the card, make access real now rather than
// waiting for the webhook. Both paths are idempotent with the webhook.
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { RadarError } from '../errors';
import { lockAccount, needProvider, nullIfMissing, withBillingLock } from './account';
import { activateIn } from './activate';
import { BillingError } from './errors';
import { syncIn } from './sync';

/** The trial check: the PaymentIntent must be this user's succeeded $1. Unexpected failures → 502 activation_failed
 *  ("You won't be charged twice"): the client retries, then polls state while the webhook catches up. */
export async function confirmTrial(u: { id: string }, piId: string): Promise<string | null> {
  const p = await needProvider();
  const pi = await p.getPaymentIntent(piId).catch(nullIfMissing);
  if (!pi || pi.metadata?.radar_user_id !== u.id || pi.metadata?.purpose !== 'trial_check') throw BillingError.notYours();
  if (pi.status !== 'succeeded') throw BillingError.notSucceeded();
  try { return (await withBillingLock(u.id, (tx, later) => activateIn(p, tx, later, pi, 'confirm'))).committed; }
  catch (e: any) {
    if (e instanceof RadarError) throw e;
    console.error(`[billing] activation of ${pi.id} failed:`, e?.message || e);
    throw BillingError.activationFailed();
  }
}

/** A restart: the subscription must be this account's; access follows its status. */
export async function confirmSubscription(u: { id: string }, subId: string) {
  const p = await needProvider();
  await withBillingLock(u.id, async (tx, later) => {
    const a = await lockAccount(tx, u.id);
    const s = await p.getSubscription(subId).catch(nullIfMissing);
    if (!s || !a.stripeCustomerId || s.customer !== a.stripeCustomerId) throw BillingError.notYours();
    await syncIn(tx, later, a, s);
  });
}

/** The business to open after paying: the one this call committed, else the newest the user committed today
 *  (the webhook may have committed it first). */
export async function businessToOpen(uid: string, committed: string | null): Promise<string | null> {
  if (committed) return committed;
  const B = schema.businesses; const ts = sql`${B.onboarding}->>'committedAt'`;
  const r = await db.select({ id: B.id }).from(B)
    .where(and(eq(B.ownerId, uid), eq(B.status, 'active'), sql`${ts} > ${new Date(Date.now() - 864e5).toISOString()}`)).orderBy(desc(ts)).limit(1);
  return r[0]?.id || null;
}
