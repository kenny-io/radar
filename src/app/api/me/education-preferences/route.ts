import { z } from 'zod';
import { requireUser } from '@/server/access';
import { authBody, assertAuthOrigin } from '@/server/auth/requests';
import { handle, json } from '@/server/http/handle';
import { educationAllowed, updateEducationPreference } from '@/server/services/lifecycle/preferences';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uncached = (response: Response) => { response.headers.set('Cache-Control', 'private, no-store'); return response; };
const get = handle(async () => json({ education: await educationAllowed((await requireUser()).id) }));
const patch = handle(async (req: Request) => {
  assertAuthOrigin(req);
  const user = await requireUser();
  const input = z.object({ education: z.boolean() }).strict().parse(await authBody(req));
  return json(await updateEducationPreference(user.id, input.education));
});
export async function GET() { return uncached(await get()); }
export async function PATCH(req: Request) { return uncached(await patch(req)); }
