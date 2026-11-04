import { requireUser, requireRole } from '@/server/access';
import { assertAuthOrigin } from '@/server/auth/requests';
import { getBiz } from '@/server/workspace';
import { handle, json } from '@/server/http/handle';
import { readSupportRequest } from '@/server/services/support/input';
import { supportRequest } from '@/server/services/support';

export const runtime = 'nodejs';
export const maxDuration = 60;
/** Support is available to every signed-in member, including members troubleshooting billing. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ bid: string }> }) => {
  assertAuthOrigin(req);
  const user = await requireUser();
  const { bid } = await params;
  await requireRole(bid, user.id, 'Viewer');
  const input = await readSupportRequest(req);
  const biz = await getBiz(bid);
  const data = await supportRequest(user, biz, input);
  const response = json({ ok: true, data });
  response.headers.set('Cache-Control', 'no-store');
  return response;
});
