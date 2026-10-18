import { requireRole, requireUser } from '@/server/access';
import { loadWorkspace } from '@/server/workspace';
import { handle, json } from '@/server/http/handle';

export const GET = handle(async (_req: Request, { params }: { params: Promise<{ bid: string }> }) => {
  const { bid } = await params;
  const u = await requireUser();
  const role = await requireRole(bid, u.id, 'Viewer');
  return json(await loadWorkspace(bid, u.id, role));
});
