import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { createSession, hashPassword } from '@/server/auth/session';
import { attachInvites } from '@/server/auth/users';
import { handle, json } from '@/server/http/handle';
import { EMAIL_RE } from '@/lib/format';

const Body = z.object({ name: z.string(), email: z.string(), password: z.string() });
export const POST = handle(async (req: Request) => {
  const b = Body.parse(await req.json());
  const errors: Record<string, string> = {};
  if (!b.name.trim()) errors.name = 'Add your name';
  if (!EMAIL_RE.test(b.email)) errors.email = 'Enter a valid email';
  if (b.password.length < 8) errors.pw = 'Use at least 8 characters';
  if (Object.keys(errors).length) return json({ ok: false, errors }, 400);
  const email = b.email.trim().toLowerCase();
  const exists = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (exists[0]) return json({ ok: false, errors: { email: 'An account with this email already exists. Sign in instead.' } }, 409);
  const [u] = await db.insert(schema.users).values({ name: b.name.trim(), email, passwordHash: await hashPassword(b.password) }).returning();
  await attachInvites(u.id, email);
  await createSession(u.id);
  return json({ ok: true });
});
