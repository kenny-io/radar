// POST {email, password, next?} → AuthResult {ok, next}. Never matches a guest; attaches invites; claims the guest draft.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { verifyPassword } from '@/server/auth/session';
import { attachInvites } from '@/server/auth/users';
import { finishAuth } from '@/server/auth/claim';
import { handle, json } from '@/server/http/handle';

const Body = z.object({ email: z.string(), password: z.string(), next: z.string().max(2000).optional() });
export const POST = handle(async (req: Request) => {
  const b = Body.parse(await req.json());
  const email = b.email.trim().toLowerCase();
  const r = await db.select().from(schema.users).where(and(eq(schema.users.email, email), eq(schema.users.guest, false))).limit(1);
  const u = r[0];
  if (!u || !u.passwordHash || !(await verifyPassword(b.password, u.passwordHash))) return json({ ok: false, errors: { pw: 'That email and password don’t match.' } }, 401);
  await attachInvites(u.id, email);
  const f = await finishAuth({ id: u.id, name: u.name, email: u.email, appearance: u.appearance }, b.next);
  return json({ ok: true, next: f.next });
});
