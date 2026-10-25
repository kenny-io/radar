import { gateBusiness, requireActor, requireRole } from '@/server/access';
import { loadWorkspace } from '@/server/workspace';
import { handle, json } from '@/server/http/handle';

export const GET = handle(async (_req: Request, { params }: { params: Promise<{ bid: string }> }) => {
  const { bid } = await params;
  const a = await requireActor();
  const role = await requireRole(bid, a.id, 'Viewer');
  await gateBusiness(a, bid);
  return json(await loadWorkspace(bid, a.id, role));
});
