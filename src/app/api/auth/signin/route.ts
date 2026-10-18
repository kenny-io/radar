import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { createSession, verifyPassword } from '@/server/auth/session';
import { handle, json } from '@/server/http/handle';

const Body = z.object({ email: z.string(), password: z.string() });
export const POST = handle(async (req: Request) => {
  const b = Body.parse(await req.json());
  const email = b.email.trim().toLowerCase();
  const r = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  const u = r[0];
  if (!u || !u.passwordHash || !(await verifyPassword(b.password, u.passwordHash))) return json({ ok: false, errors: { pw: 'That email and password don’t match.' } }, 401);
  await createSession(u.id);
  return json({ ok: true });
});
