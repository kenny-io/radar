// GET → BillingState for the signed-in user (architecture §5.2). The trial page polls it after paying.
import { requireUser } from '@/server/access';
import { handle, json } from '@/server/http/handle';
import { billingState } from '@/server/billing/state';
import { openInvoiceCents } from '@/server/billing/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  const u = await requireUser();
  return json(await billingState(u, { openInvoiceCents }));
});
