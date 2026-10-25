// POST {paymentIntentId} | {subscriptionId} → {ok, state}; sets radar_biz to the committed business (architecture §5.3).
// Never a 2xx without access: the trial page shows success on any 2xx, so a not-yet-active account gets 409
// payment_not_succeeded, which the client retries and then polls GET /api/billing/state.
import { z } from 'zod';
import { cookies } from 'next/headers';
import { requireUser } from '@/server/access';
import { BIZ_COOKIE } from '@/server/auth/users';
import { handle, json } from '@/server/http/handle';
import { businessToOpen, confirmSubscription, confirmTrial } from '@/server/billing/confirm';
import { BillingError } from '@/server/billing/errors';
import { billingState } from '@/server/billing/state';
import { openInvoiceCents } from '@/server/billing/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ paymentIntentId: z.string().min(1).max(255).optional(), subscriptionId: z.string().min(1).max(255).optional() })
  .refine(b => !!b.paymentIntentId !== !!b.subscriptionId, 'Send paymentIntentId or subscriptionId');
export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const b = Body.parse(await req.json());
  let committed: string | null = null;
  if (b.paymentIntentId) committed = await confirmTrial(u, b.paymentIntentId);
  else await confirmSubscription(u, b.subscriptionId!);
  const state = await billingState(u, { openInvoiceCents });
  if (!state.access) throw BillingError.notSucceeded();
  const bid = await businessToOpen(u.id, committed);
  if (bid) (await cookies()).set(BIZ_COOKIE, bid, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 864e2 });
  return json({ ok: true, state });
});
