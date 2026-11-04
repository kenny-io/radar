import { z } from 'zod';
import { handle, json } from '@/server/http/handle';
import { assertAuthOrigin, authBody, limitAuthIp, NEW_PASSWORD_BYTES } from '@/server/auth/requests';
import { confirmEmail } from '@/server/auth/verification';
import { attachInvites } from '@/server/auth/users';
import { finishAuth } from '@/server/auth/claim';
import { track } from '@/server/events';
const Body = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password: z.string().max(256) });
export const POST = handle(async (req: Request) => {
  assertAuthOrigin(req);
  await limitAuthIp(req, 'confirm');
  const raw = await authBody(req);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: 'This confirmation link is invalid. Request a new email.', code: 'verification_invalid' }, 400);
  const b = parsed.data;
  if (b.password.length < 8 || Buffer.byteLength(b.password, 'utf8') > NEW_PASSWORD_BYTES)
    return json({ ok: false, errors: { pw: b.password.length < 8 ? 'Use at least 8 characters' : 'Use a password of 72 bytes or fewer (some characters use more than one byte).' } }, 400);
  const { user, next } = await confirmEmail(b.token, b.password);
  await track('user.signed_up', { uid: user.id, props: { method: 'password' } });
  await attachInvites(user.id, user.email);
  const r = await finishAuth({ id: user.id, name: user.name, email: user.email, appearance: user.appearance }, next);
  return json({ ok: true, next: r.next });
});
