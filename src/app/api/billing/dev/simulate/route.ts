// Stub provider only (404 otherwise): POST {status} → {ok, state}. Moves the account's subscription as Stripe would
// (past_due opens an invoice) and runs the same webhook path (customer.subscription.updated) as production.
import { z } from 'zod';
import { requireUser } from '@/server/access';
import { notFound } from '@/server/errors';
import { handle, json } from '@/server/http/handle';
import { SUB_STATUSES } from '@/lib/billing';
import { accountOf } from '@/server/billing/access';
import { providerName } from '@/server/billing/config';
import { BillingError } from '@/server/billing/errors';
import { openInvoiceCents, ProviderError } from '@/server/billing/provider';
import { billingState } from '@/server/billing/state';
import { processEvent } from '@/server/billing/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ status: z.enum(SUB_STATUSES).refine(s => s !== 'none', 'Pick a subscription status') });
export const POST = handle(async (req: Request) => {
  if (providerName() !== 'stub') throw notFound();
  const u = await requireUser();
  const { status } = Body.parse(await req.json());
  const acct = await accountOf(u.id);
  if (!acct?.stripeSubscriptionId) throw BillingError.noSubscription();
  const stub = await import('@/server/billing/stub');
  let sub;
  try { sub = stub.stubSetStatus(acct.stripeSubscriptionId, status); }
  catch (e) { if (e instanceof ProviderError) throw BillingError.noSubscription(); throw e; }
  await processEvent(stub.stubEvent(status === 'canceled' ? 'customer.subscription.deleted' : 'customer.subscription.updated', sub));
  return json({ ok: true, state: await billingState(u, { openInvoiceCents }) });
});
