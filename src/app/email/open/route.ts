import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { currentUser } from '@/server/auth/session';
import { gateBusiness, requireRole } from '@/server/access';
import { openBusinessUrl } from '@/server/billing/guard';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { notFound } from '@/server/errors';
import { handle } from '@/server/http/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const Input = z.object({ businessId: z.string().uuid(), kind: z.enum(['brief_reply', 'calendar_review', 'article_social', 'social_publish']), ref: z.string().min(1).max(120) });
/** A fixed feature destination, never a user-supplied URL. The browser's current business changes only after authorization. */
const get = handle(async (req: Request) => {
  const p = new URL(req.url).searchParams;
  const input = Input.parse({ businessId: p.get('businessId'), kind: p.get('kind'), ref: p.get('ref') });
  const query = new URLSearchParams(input);
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL(`/signin?next=${encodeURIComponent('/email/open?' + query)}`, env.appUrl), 303);
  await requireRole(input.businessId, user.id, 'Viewer');
  const business = await gateBusiness({ ...user, guest: false }, input.businessId);
  if (business.status !== 'active' || business.ownerId !== user.id) throw notFound('Business');
  let target = '/calendar';
  if (input.kind === 'brief_reply') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.ref) || !Number.isFinite(Date.parse(input.ref)) || new Date(input.ref).toISOString().slice(0, 10) !== input.ref) throw notFound('That brief');
    const [day] = await db.select({ date: schema.briefDays.date }).from(schema.briefDays).where(and(eq(schema.briefDays.businessId, input.businessId), eq(schema.briefDays.date, input.ref))).limit(1);
    if (!day) throw notFound('That brief');
    target = '/brief';
  } else if (input.kind === 'calendar_review') {
    if (!business.calendarGeneratedAt || !Number.isFinite(Date.parse(input.ref))) throw notFound('That content plan');
    // A newer generation is still the useful current calendar; the reminder never directs into a stale snapshot.
  } else if (input.kind === 'article_social') {
    const [article] = await db.select({ data: schema.articles.data }).from(schema.articles).where(and(eq(schema.articles.businessId, input.businessId), eq(schema.articles.entryId, input.ref))).limit(1);
    if (!article?.data?.generated) throw notFound('That article');
    target = '/social?' + new URLSearchParams({ generate: '1', article: input.ref });
  } else {
    const [pack] = await db.select({ id: schema.socialPacks.id }).from(schema.socialPacks).where(and(eq(schema.socialPacks.businessId, input.businessId), eq(schema.socialPacks.id, input.ref))).limit(1);
    if (!pack) throw notFound('That social content');
    target = '/social?' + new URLSearchParams({ pack: input.ref });
  }
  return NextResponse.redirect(new URL(openBusinessUrl(input.businessId, target), env.appUrl), 303);
});
export async function GET(req: Request) {
  const response = await get(req);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
