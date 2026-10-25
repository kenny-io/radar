// POST {paymentMethodId} → {ok, clientSecret, paymentIntentId, trialEnd} | {ok, activated: true, state} (architecture §7.2).
// The client secret goes to the browser only; it is never logged.
import { z } from 'zod';
import { cookies } from 'next/headers';
import { requireUser } from '@/server/access';
import { BIZ_COOKIE } from '@/server/auth/users';
import { handle, json } from '@/server/http/handle';
import { clientIp } from '@/server/abuse/ip';
import { start } from '@/server/billing/activate';
import { businessToOpen } from '@/server/billing/confirm';
import { billingState } from '@/server/billing/state';
import { openInvoiceCents } from '@/server/billing/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ paymentMethodId: z.string().min(1).max(255) });
export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const { paymentMethodId } = Body.parse(await req.json());
  const r = await start(u, paymentMethodId, clientIp(req));
  if ('activated' in r) {
    const bid = await businessToOpen(u.id, r.committed);
    if (bid) (await cookies()).set(BIZ_COOKIE, bid, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 864e2 });
    return json({ ok: true, activated: true, state: await billingState(u, { openInvoiceCents }) });
  }
  return json({ ok: true, ...r });
});
