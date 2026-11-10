// Stub provider only (404 otherwise): POST {status, pastDueHoursAgo?} → {ok, state}. Moves the account's subscription as
// Stripe would (past_due opens an invoice) and runs the same webhook path (customer.subscription.updated) as production.
// `pastDueHoursAgo` (with status past_due) then moves an existing grace clock back, so its expiry can be tested without
// waiting two days. It never starts a grace: a row the webhook path left without `past_due_at` stays without one.
import { z } from 'zod';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { requireUser } from '@/server/access';
import { notFound } from '@/server/errors';
import { handle, json, requestJson } from '@/server/http/handle';
import { SUB_STATUSES } from '@/lib/billing';
import { accountOf } from '@/server/billing/access';
import { providerName } from '@/server/billing/config';
import { BillingError } from '@/server/billing/errors';
import { ProviderError, restartDueCents } from '@/server/billing/provider';
import { billingState } from '@/server/billing/state';
import { processEvent } from '@/server/billing/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ status: z.enum(SUB_STATUSES).refine(s => s !== 'none', 'Pick a subscription status'), pastDueHoursAgo: z.number().min(0).max(24 * 365).optional() });
export const POST = handle(async (req: Request) => {
  if (providerName() !== 'stub') throw notFound();
  const u = await requireUser();
  const { status, pastDueHoursAgo } = Body.parse(await requestJson(req));
  const acct = await accountOf(u.id);
  if (!acct?.stripeSubscriptionId) throw BillingError.noSubscription();
  const stub = await import('@/server/billing/stub');
  let sub;
  try { sub = stub.stubSetStatus(acct.stripeSubscriptionId, status); }
  catch (e) { if (e instanceof ProviderError) throw BillingError.noSubscription(); throw e; }
  await processEvent(stub.stubEvent(status === 'canceled' ? 'customer.subscription.deleted' : 'customer.subscription.updated', sub));
  if (status === 'past_due' && pastDueHoursAgo != null) {
    const A = schema.billingAccounts;
    await db.update(A).set({ pastDueAt: new Date(Date.now() - pastDueHoursAgo * 3600e3) }).where(and(eq(A.userId, u.id), eq(A.status, 'past_due'), isNotNull(A.pastDueAt)));
  }
  return json({ ok: true, state: await billingState(u, { restartDueCents }) });
});
