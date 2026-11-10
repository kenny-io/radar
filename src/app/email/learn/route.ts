import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { currentUser } from '@/server/auth/session';
import { gateBusiness, requireRole } from '@/server/access';
import { openBusinessUrl, resolveEntry } from '@/server/billing/guard';
import { educationOwnerAccess } from '@/server/services/lifecycle/education';
import { EDUCATION_DESTINATIONS, parseEducationLanding } from '@/server/services/lifecycle/educationLinks';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { notFound } from '@/server/errors';
import { handle } from '@/server/http/handle';
import { touchActive } from '@/server/idle';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const get = handle(async (req: Request) => {
  let input: ReturnType<typeof parseEducationLanding>;
  try { input = parseEducationLanding(req.url); } catch { throw notFound('Lesson'); }
  const user = await currentUser();
  const redirect = (path: string) => NextResponse.redirect(new URL(path, env.appUrl), 303);
  if (!user) return redirect(`/signin?next=${encodeURIComponent('/email/learn?' + new URLSearchParams(input))}`);
  const target = EDUCATION_DESTINATIONS[input.lesson];
  if (!input.businessId) {
    const entry = await resolveEntry(user);
    return redirect('redirect' in entry ? entry.redirect : target);
  }
  await requireRole(input.businessId, user.id, 'Viewer');
  const [business] = await db.select().from(schema.businesses).where(and(eq(schema.businesses.id, input.businessId), eq(schema.businesses.ownerId, user.id))).limit(1);
  if (!business) throw notFound('Business');
  if (business.status !== 'active') return redirect(business.onboarding?.savedAt ? '/start-trial' : '/onboarding');
  if (!await educationOwnerAccess({ ...user, guest: false })) return redirect('/start-trial');
  // Existing gate remains authoritative. No current-business cookie is written before all checks pass.
  await gateBusiness({ ...user, guest: false }, business.id);
  // A click on a Radar email is use of the business (idle spend, IS-1). A link without a business marks nothing.
  await touchActive(business, { guest: false });
  return redirect(openBusinessUrl(business.id, target));
});
export async function GET(req: Request) {
  const response = await get(req);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
