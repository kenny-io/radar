import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { requireUser } from '@/server/access';
import { getMe } from '@/server/auth/users';
import { handle, json } from '@/server/http/handle';

export const GET = handle(async () => { const u = await requireUser(); return json(await getMe(u)); });
/** Account → Name and Appearance */
export const PATCH = handle(async (req: Request) => {
  const u = await requireUser();
  const b = z.object({ name: z.string().max(120).optional(), appearance: z.enum(['system', 'light', 'dark']).optional() }).parse(await req.json());
  const set: Partial<typeof schema.users.$inferInsert> = {};
  if (b.name != null) set.name = b.name;
  if (b.appearance) set.appearance = b.appearance;
  if (Object.keys(set).length) await db.update(schema.users).set(set).where(eq(schema.users.id, u.id));
  return json({ ok: true });
});
