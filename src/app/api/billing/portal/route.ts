import { requireUser } from '@/server/access';
import { openBillingPortal } from '@/server/billing/portal';
import { handle, json } from '@/server/http/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const portal = handle(async (req: Request) => json({ ok: true, ...await openBillingPortal(await requireUser(), req) }));
export async function POST(req: Request) {
  const response = await portal(req);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
