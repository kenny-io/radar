import { z } from 'zod';
import { NextResponse } from 'next/server';
import { gateBusiness, requireRole, requireUser } from '@/server/access';
import { setCurrentBusiness } from '@/server/auth/users';
import { safeNext } from '@/server/billing/guard';
import { env } from '@/server/env';
import { handle, json } from '@/server/http/handle';

/** Make a business current for this browser: a member's business that isn't locked (402), else 404/403 as everywhere. */
async function makeCurrent(u: Awaited<ReturnType<typeof requireUser>>, id: string) {
  await requireRole(id, u.id, 'Viewer');
  await gateBusiness({ ...u, guest: false }, id);   // a locked business is never made current (402)
  await setCurrentBusiness(id);
}

export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const { id } = z.object({ id: z.string() }).parse(await req.json());
  await makeCurrent(u, id);
  return json({ ok: true });
});

/** GET ?id=<bid>&next=<path>: the cookie-setting hop for server components that just committed a profile (trialGuard,
 *  the (app) layout's self-heal), which can't set radar_biz themselves. 303 to `next` when it's a same-site page path
 *  (starts with one /, no control characters, not /api/), else /dashboard. */
export const GET = handle(async (req: Request) => {
  const u = await requireUser();
  const q = new URL(req.url).searchParams;
  await makeCurrent(u, q.get('id') || '');
  const n = safeNext(q.get('next'));
  const to = n && !n.startsWith('/api/') && !/[\u0000-\u001f\u007f]/.test(n) ? n : '/dashboard';
  return NextResponse.redirect(`${env.appUrl}${to}`, 303);
});
