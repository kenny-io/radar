import { z } from 'zod';
import { authBody, assertAuthOrigin } from '@/server/auth/requests';
import { handle, json } from '@/server/http/handle';
import { preferenceUser, stopOnboarding } from '@/server/services/lifecycle/preferences';
export const POST = handle(async (req: Request) => {
  assertAuthOrigin(req);
  const { token } = z.object({ token: z.string().max(256) }).parse(await authBody(req));
  const uid = preferenceUser(token);
  if (!uid) return json({ ok: false, error: 'This preference link isn’t valid.' }, 400);
  await stopOnboarding(uid);
  return json({ ok: true });
});
