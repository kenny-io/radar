// Stub provider only (404 otherwise): POST {paymentIntentId, outcome, webhook?} → the stripe-js confirmCardPayment result
// {paymentIntent} | {error} (architecture §7.4). `webhook: true` also delivers the events Stripe would send, in process,
// through the real dedupe and handlers. The stub is imported here only after the provider check, never at module load.
import { z } from 'zod';
import { requireUser } from '@/server/access';
import { notFound } from '@/server/errors';
import { handle, json } from '@/server/http/handle';
import { accountOf } from '@/server/billing/access';
import { providerName } from '@/server/billing/config';
import { ProviderError } from '@/server/billing/provider';
import { processEvent } from '@/server/billing/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ paymentIntentId: z.string().min(1).max(255), outcome: z.enum(['succeed', 'decline', 'auth_fail']), webhook: z.boolean().optional() });
export const POST = handle(async (req: Request) => {
  if (providerName() !== 'stub') throw notFound();
  const u = await requireUser();
  const b = Body.parse(await req.json());
  const stub = await import('@/server/billing/stub');
  const pi = await stub.stubProvider.getPaymentIntent(b.paymentIntentId).catch(e => { if (e instanceof ProviderError) throw notFound('That payment'); throw e; });
  const acct = await accountOf(u.id);
  const mine = pi.metadata.radar_user_id ? pi.metadata.radar_user_id === u.id : !!acct?.stripeCustomerId && pi.customer === acct.stripeCustomerId;
  if (!mine) throw notFound('That payment');
  const { result, events } = stub.stubConfirmIntent(pi.id, b.outcome);
  if (b.webhook) for (const ev of events) await processEvent(ev).catch((e: any) => console.error(`[billing] stub webhook ${ev.type} failed:`, e?.message));
  return json(result);
});
