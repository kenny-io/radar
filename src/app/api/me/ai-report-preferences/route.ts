import { z } from 'zod';
import { requireUser } from '@/server/access';
import { assertAuthOrigin, authBody } from '@/server/auth/requests';
import { handle, json } from '@/server/http/handle';
import { notFound } from '@/server/errors';
import { managedDigestPreferences, updateDigestPreference } from '@/server/services/visibility/digestPreferences';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uncached = (r: Response) => { r.headers.set('Cache-Control','private, no-store'); return r; };
const get = handle(async () => json(await managedDigestPreferences((await requireUser()).id)));
const patch = handle(async (req: Request) => {
  assertAuthOrigin(req); const u = await requireUser();
  const p = z.object({ businessId:z.string().uuid(), weeklyEmail:z.boolean() }).strict().parse(await authBody(req));
  if (!await updateDigestPreference(u.id,p.businessId,p.weeklyEmail)) throw notFound('That business');
  return json(await managedDigestPreferences(u.id));
});
export async function GET() { return uncached(await get()); }
export async function PATCH(req: Request) { return uncached(await patch(req)); }
