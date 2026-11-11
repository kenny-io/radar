// RPC endpoint: POST { action, input, reply? } → { ok, data, rev?, workspace? }. Role checks, the business gate (402/404,
// architecture §4.4) and input validation per action. A guest reaches only its own draft and only DRAFT_ACTIONS.
// Replies (.factory/first-five-optimizations/architecture.md §3.1): read → { ok, data } · write with reply:'rev' (every
// debounced autosave) → { ok, data, rev } and no workspace is built · any other write → { ok, data, rev, workspace }.
// A request without the `x-radar-client` header is a tab opened before that contract: it gets today's
// { ok, data, workspace } with whole articles and no `rev`, whatever it sends.
import { z } from 'zod';
import { gateBusiness, requireActor, requireRole } from '@/server/access';
import { articlesMode, loadWorkspace, bump } from '@/server/workspace';
import { ACTIONS } from '@/server/actions';
import { handle, json, requestJson } from '@/server/http/handle';
import { RadarError } from '@/server/errors';
import { ACTION_OUTCOME, trackSoon } from '@/server/events';
import { ownAccess } from '@/server/billing/access';
import { touchGuest } from '@/server/auth/session';
import { reportFailure, shouldReportFailure, withFailureContext } from '@/server/observability/failures';
import { clientIp } from '@/server/abuse/ip';
import { touchActive } from '@/server/idle';

export const POST = handle(async (req: Request, { params }: { params: Promise<{ bid: string }> }) => {
  const { bid } = await params;
  const actor = await requireActor();
  const { action, input, reply } = z.object({ action: z.string(), input: z.any().optional(), reply: z.literal('rev').optional() }).parse(await requestJson(req));
  const def = ACTIONS[action];
  if (!def) throw new RadarError('Unknown action', 404, 'unknown_action');
  const role = await requireRole(bid, actor.id, def.role || (def.read ? 'Viewer' : 'Editor'));
  const own = await ownAccess(actor);
  const biz = await gateBusiness(actor, bid, { action, own });
  const parsed = def.input ? def.input.parse(input ?? {}) : input;
  return withFailureContext({ source: 'action', operation: action, businessId: bid, userId: actor.id }, async () => {
    try {
      const data = await def.run({ user: actor, bid, role, biz, actor: { guest: actor.guest, ownAccess: own }, ip: clientIp(req) }, parsed);
      if (def.read) return json({ ok: true, data });
      if (actor.guest) await touchGuest();
      trackSoon(`action.${action}`, { bid, uid: actor.id, props: { input: parsed, result: data } });
      if (ACTION_OUTCOME[action]) trackSoon(ACTION_OUTCOME[action], { bid, uid: actor.id, props: { input: parsed, result: data } });
      await touchActive(biz, actor);
      const rev = await bump(bid);
      if (articlesMode(req) === 'full') return json({ ok: true, data, workspace: await loadWorkspace(bid, actor.id, role, { articles: 'full' }) });
      if (reply === 'rev') return json({ ok: true, data, rev });
      return json({ ok: true, data, rev, workspace: await loadWorkspace(bid, actor.id, role) });
    } catch (error) {
      if (shouldReportFailure(error)) await reportFailure(error, { source: 'action', operation: action });
      throw error;
    }
  });
});
