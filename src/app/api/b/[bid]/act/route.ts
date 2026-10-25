// RPC endpoint: POST { action, input } → { ok, data, workspace? }. Role checks, the business gate (402/404, architecture
// §4.4) and input validation per action. A guest reaches only its own draft and only DRAFT_ACTIONS.
import { z } from 'zod';
import { gateBusiness, requireActor, requireRole } from '@/server/access';
import { loadWorkspace, bump } from '@/server/workspace';
import { ACTIONS } from '@/server/actions';
import { handle, json } from '@/server/http/handle';
import { RadarError } from '@/server/errors';
import { ACTION_OUTCOME, trackSoon } from '@/server/events';
import { ownAccess } from '@/server/billing/access';
import { touchGuest } from '@/server/auth/session';
import { clientIp } from '@/server/abuse/ip';

export const POST = handle(async (req: Request, { params }: { params: Promise<{ bid: string }> }) => {
  const { bid } = await params;
  const actor = await requireActor();
  const { action, input } = z.object({ action: z.string(), input: z.any().optional() }).parse(await req.json());
  const def = ACTIONS[action];
  if (!def) throw new RadarError('Unknown action', 404, 'unknown_action');
  const role = await requireRole(bid, actor.id, def.role || (def.read ? 'Viewer' : 'Editor'));
  const own = await ownAccess(actor);
  const biz = await gateBusiness(actor, bid, { action, own });
  const parsed = def.input ? def.input.parse(input ?? {}) : input;
  const data = await def.run({ user: actor, bid, role, biz, actor: { guest: actor.guest, ownAccess: own }, ip: clientIp(req) }, parsed);
  if (def.read) return json({ ok: true, data });
  if (actor.guest) await touchGuest();
  trackSoon(`action.${action}`, { bid, uid: actor.id, props: { input: parsed, result: data } });
  if (ACTION_OUTCOME[action]) trackSoon(ACTION_OUTCOME[action], { bid, uid: actor.id, props: { input: parsed, result: data } });
  await bump(bid);
  return json({ ok: true, data, workspace: await loadWorkspace(bid, actor.id, role) });
});
