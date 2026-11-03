import { z } from 'zod';
import { requireUser } from '@/server/access';
import { authBody, assertAuthOrigin } from '@/server/auth/requests';
import { handle, json } from '@/server/http/handle';
import { getEngagementPreferences, updateEngagementPreferences } from '@/server/services/lifecycle/preferences';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const Patch = z.object({ dailyBrief: z.boolean().optional(), calendarReminders: z.boolean().optional(), articleSocial: z.boolean().optional() })
  .strict().refine(p => Object.keys(p).length > 0);
const uncached = (response: Response) => { response.headers.set('Cache-Control', 'private, no-store'); return response; };
const get = handle(async () => json(await getEngagementPreferences((await requireUser()).id)));
const patch = handle(async (req: Request) => {
  assertAuthOrigin(req);
  const user = await requireUser();
  return json(await updateEngagementPreferences(user.id, Patch.parse(await authBody(req))));
});
export async function GET() { return uncached(await get()); }
export async function PATCH(req: Request) { return uncached(await patch(req)); }
