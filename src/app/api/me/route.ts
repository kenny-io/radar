import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { requireUser } from '@/server/access';
import { getMe } from '@/server/auth/users';
import { handle, json } from '@/server/http/handle';

export const GET = handle(async () => { const u = await requireUser(); return json(await getMe(u)); });
/** Account → Name */
export const PATCH = handle(async (req: Request) => {
  const u = await requireUser();
  const { name } = z.object({ name: z.string().max(120) }).parse(await req.json());
  await db.update(schema.users).set({ name }).where(eq(schema.users.id, u.id));
  return json({ ok: true });
});
