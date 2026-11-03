import { z } from 'zod';
import { EMAIL_RE } from '@/lib/format';
import { assertAuthOrigin, authBody } from '@/server/auth/requests';
import { limitResetRequest, requestPasswordReset } from '@/server/auth/passwordReset';
import { handle, json } from '@/server/http/handle';

const Body = z.object({ email: z.string().max(320) });
export const POST = handle(async (req: Request) => {
  assertAuthOrigin(req);
  const b = Body.parse(await authBody(req));
  const email = b.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'Enter a valid email.', code: 'invalid_email' }, 400);
  await limitResetRequest(req, email);
  const started = Date.now();
  await requestPasswordReset(email);
  // Queue-only work is short; equalize normal response timing for unknown, password and Google-only accounts.
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 250 - (Date.now() - started))));
  return json({ ok: true, message: 'If a password account exists for that email, we’ll send a reset link. If you joined with Google, continue with Google instead.' });
});
