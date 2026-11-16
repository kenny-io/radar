// POST { id } → { ok, data: RestoreBusinessResult }. Owner only, until the business's purgeAt
// (.factory/delete-business/architecture.md §3.2, §9.2). It never calls requireRole, which refuses a deleted business:
// restoreBusiness checks the owner under the row lock and answers everyone else as if the business did not exist.
import { z } from 'zod';
import { requireUser } from '@/server/access';
import { assertAuthOrigin } from '@/server/auth/requests';
import { setCurrentBusiness } from '@/server/auth/users';
import { restoreBusiness } from '@/server/deletion';
import { handle, json, requestJson } from '@/server/http/handle';
import { reportFailure } from '@/server/observability/failures';

export const runtime = 'nodejs';
export const POST = handle(async (req: Request) => {
  assertAuthOrigin(req);
  const user = await requireUser();                       // never a guest
  const { id } = z.object({ id: z.string().max(100) }).parse(await requestJson(req));
  const data = await restoreBusiness(user.id, id);
  // Restored but locked (no subscription): it is not made current, and the layout sends the owner to /start-trial.
  if (data.open) {
    try { await setCurrentBusiness(data.id); }
    catch (e) { await reportFailure(e, { source: 'http', operation: 'business.restore.cookie', businessId: data.id, userId: user.id }); }
  }
  const response = json({ ok: true, data });
  response.headers.set('Cache-Control', 'no-store');
  return response;
});
