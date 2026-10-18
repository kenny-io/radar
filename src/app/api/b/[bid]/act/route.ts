// RPC endpoint: POST { action, input } → { ok, data, workspace? }. Role checks + input validation per action.
import { z } from 'zod';
import { requireRole, requireUser } from '@/server/access';
import { getBiz, loadWorkspace, bump } from '@/server/workspace';
import { ACTIONS } from '@/server/actions';
import { handle, json } from '@/server/http/handle';
import { RadarError } from '@/server/errors';

export const POST = handle(async (req: Request, { params }: { params: Promise<{ bid: string }> }) => {
  const { bid } = await params;
  const u = await requireUser();
  const { action, input } = z.object({ action: z.string(), input: z.any().optional() }).parse(await req.json());
  const def = ACTIONS[action];
  if (!def) throw new RadarError('Unknown action', 404, 'unknown_action');
  const role = await requireRole(bid, u.id, def.role || (def.read ? 'Viewer' : 'Editor'));
  const parsed = def.input ? def.input.parse(input ?? {}) : input;
  const biz = await getBiz(bid);
  const data = await def.run({ user: u, bid, role, biz }, parsed);
  if (def.read) return json({ ok: true, data });
  await bump(bid);
  return json({ ok: true, data, workspace: await loadWorkspace(bid, u.id, role) });
});
