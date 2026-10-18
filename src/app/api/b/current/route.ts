import { z } from 'zod';
import { cookies } from 'next/headers';
import { requireRole, requireUser } from '@/server/access';
import { BIZ_COOKIE } from '@/server/auth/users';
import { handle, json } from '@/server/http/handle';

export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const { id } = z.object({ id: z.string() }).parse(await req.json());
  await requireRole(id, u.id, 'Viewer');
  (await cookies()).set(BIZ_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 864e2 });
  return json({ ok: true });
});
