// POST {paymentMethodId} → {ok, clientSecret, subscriptionId} | {ok, activated: true, state} (architecture §7.2 restart).
import { z } from 'zod';
import { requireUser } from '@/server/access';
import { handle, json } from '@/server/http/handle';
import { clientIp } from '@/server/abuse/ip';
import { restart } from '@/server/billing/restart';
import { billingState } from '@/server/billing/state';
import { restartDueCents } from '@/server/billing/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ paymentMethodId: z.string().min(1).max(255) });
export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const { paymentMethodId } = Body.parse(await req.json());
  const r = await restart(u, paymentMethodId, clientIp(req));
  if ('activated' in r) return json({ ok: true, activated: true, state: await billingState(u, { restartDueCents }) });
  return json({ ok: true, ...r });
});
