// POST {name, email, password, next?} → AuthResult {ok, next}. Claims this browser's guest draft (architecture §6).
import { z } from 'zod';
import { track } from '@/server/events';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { hashPassword, isGuestEmail } from '@/server/auth/session';
import { attachInvites } from '@/server/auth/users';
import { finishAuth } from '@/server/auth/claim';
import { handle, json } from '@/server/http/handle';
import { EMAIL_RE } from '@/lib/format';
import { assertAuthOrigin, authBody, limitAuthIp, NEW_PASSWORD_BYTES } from '@/server/auth/requests';
import { queueSignupEmails } from '@/server/auth/signupEmails';

const Body = z.object({ name: z.string().max(200), email: z.string().max(320), password: z.string().max(256), next: z.string().max(2000).optional() });
export const POST = handle(async (req: Request) => {
  assertAuthOrigin(req);
  await limitAuthIp(req, 'signup');
  const b = Body.parse(await authBody(req));
  const errors: Record<string, string> = {};
  if (!b.name.trim()) errors.name = 'Add your name';
  if (!EMAIL_RE.test(b.email.trim()) || isGuestEmail(b.email)) errors.email = 'Enter a valid email';
  if (b.password.length < 8) errors.pw = 'Use at least 8 characters';
  if (Buffer.byteLength(b.password, 'utf8') > NEW_PASSWORD_BYTES) errors.pw = 'Use a password of 72 bytes or fewer (some characters use more than one byte).';
  if (Object.keys(errors).length) return json({ ok: false, errors }, 400);
  const email = b.email.trim().toLowerCase();
  const exists = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (exists[0]) return json({ ok: false, errors: { email: 'An account with this email already exists. Sign in instead.' } }, 409);
  // The unique email constraint decides a race between two tabs; never turn a duplicate into a 500.
  const passwordHash = await hashPassword(b.password);
  const u = await db.transaction(async tx => {
    const [created] = await tx.insert(schema.users).values({ name: b.name.trim(), email, passwordHash })
      .onConflictDoNothing({ target: schema.users.email }).returning();
    if (created) await queueSignupEmails(tx, created);
    return created;
  });
  if (!u) return json({ ok: false, errors: { email: 'An account with this email already exists. Sign in instead.' } }, 409);
  await track('user.signed_up', { uid: u.id, props: { method: 'password' } });
  await attachInvites(u.id, email);
  const r = await finishAuth({ id: u.id, name: u.name, email: u.email, appearance: u.appearance }, b.next, passwordHash);
  return json({ ok: true, next: r.next });
});
