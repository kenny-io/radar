import { requireUser } from '@/server/access';
import { billingOverview } from '@/server/billing/overview';
import { handle, json } from '@/server/http/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const overview = handle(async () => json(await billingOverview(await requireUser())));
export async function GET() {
  const response = await overview();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
