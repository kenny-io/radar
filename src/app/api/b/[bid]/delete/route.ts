// POST { domain } → { ok, data: DeleteBusinessResult }. Owner only, typed domain (.factory/delete-business/architecture.md
// §3.2, §9.2). Not an action: the act route would bump and rebuild the workspace of the business it just deleted.
import { z } from 'zod';
import { gateBusiness, requireRole, requireUser } from '@/server/access';
import { assertAuthOrigin } from '@/server/auth/requests';
import { setCurrentBusiness } from '@/server/auth/users';
import { deleteBusiness } from '@/server/deletion';
import { handle, json, requestJson } from '@/server/http/handle';
import { reportFailure } from '@/server/observability/failures';

export const runtime = 'nodejs';
export const POST = handle(async (req: Request, { params }: { params: Promise<{ bid: string }> }) => {
  assertAuthOrigin(req);
  const user = await requireUser();                       // never a guest
  const { bid } = await params;
  await requireRole(bid, user.id, 'Owner');               // already deleted → 404 business_deleted
  await gateBusiness({ ...user, guest: false }, bid);     // a locked business answers 402: that case goes through support
  const { domain } = z.object({ domain: z.string().max(300) }).parse(await requestJson(req));
  const data = await deleteBusiness(user.id, bid, { domain });
  // The delete is committed: a cookie that cannot be set must not turn it into an error.
  if (data.nextId) {
    try { await setCurrentBusiness(data.nextId); }
    catch (e) { await reportFailure(e, { source: 'http', operation: 'business.delete.cookie', businessId: bid, userId: user.id }); }
  }
  const response = json({ ok: true, data });
  response.headers.set('Cache-Control', 'no-store');
  return response;
});
