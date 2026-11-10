// Activity (.factory/first-five-optimizations/architecture.md §4): the stored notifications of a business as a list,
// and the member's read cursor. Both are `read` actions: neither changes the shared workspace, so no revision bump.
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { action, type ActionMap } from './define';
import { activityUnread, visibleTo } from '../services/activity';
import type { ActivityItem } from '@/lib/types';

const N = schema.notifications; const M = schema.members;
const TONES = ['ok', 'warn', 'bad', 'signal'] as const;
export const ACTIVITY_PAGE = 20;

function toItem(r: typeof N.$inferSelect): ActivityItem {
  const p = r.payload || ({} as typeof r.payload); const tone = TONES.find(t => t === p.tone); const a = p.action;
  return { id: r.id, msg: String(p.msg ?? ''), ...(tone ? { tone } : {}), ...(a && typeof a.label === 'string' && typeof a.href === 'string' ? { action: { label: a.label, href: a.href } } : {}), at: r.createdAt.toISOString() };
}

export const actions: ActionMap = {
  /** Newest first. `before` is the id of the last item of the previous page; rows are ordered by (created_at, id), so
   *  two notifications written in the same instant are neither repeated nor skipped. An id that is not a row of this
   *  business (another tenant's, or pruned since) gives an empty page. */
  'activity.list': action({ read: true, role: 'Viewer', input: z.object({ before: z.string().uuid().optional(), limit: z.number().int().min(1).max(50).optional() }), run: async (ctx, { before, limit }) => {
    const me = ctx.user.id;
    const [rows, unread, seen] = await Promise.all([
      db.select().from(N).where(and(visibleTo(ctx.bid, me), before ? sql`(${N.createdAt}, ${N.id}) < (select created_at, id from notifications where id = ${before} and business_id = ${ctx.bid})` : undefined))
        .orderBy(desc(N.createdAt), desc(N.id)).limit(limit ?? ACTIVITY_PAGE),
      activityUnread(ctx.bid, me),
      db.select({ at: M.activitySeenAt }).from(M).where(and(eq(M.businessId, ctx.bid), eq(M.userId, me))).limit(1),
    ]);
    return { items: rows.map(toItem), unread, seenAt: (seen[0]?.at ?? new Date()).toISOString() };
  } }),

  /** Mark everything read for this member: move their cursor to now (the database clock, as `created_at` is).
   *  Declared read: it writes per-member state only and never changes the shared workspace. */
  'activity.seen': action({ read: true, role: 'Viewer', input: z.object({}), run: async ctx => {
    await db.update(M).set({ activitySeenAt: sql`now()` }).where(and(eq(M.businessId, ctx.bid), eq(M.userId, ctx.user.id)));
    return { ok: true as const };
  } }),
};
