import { z } from 'zod';
import { assertAuthOrigin, authBody } from '@/server/auth/requests';
import { consumePasswordReset, limitResetConsume } from '@/server/auth/passwordReset';
import { handle, json } from '@/server/http/handle';

const Body = z.object({ token: z.string().max(256), password: z.string().max(256) });
export const POST = handle(async (req: Request) => {
  assertAuthOrigin(req);
  await limitResetConsume(req);
  const b = Body.parse(await authBody(req));
  await consumePasswordReset(b.token, b.password);
  return json({ ok: true });
});
