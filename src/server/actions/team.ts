// Team and permissions (02-system.md §14). Owner > Admin > Editor > Viewer, enforced server-side.
// Only one Owner per business; the Owner row is fixed. Admins can do everything except transfer ownership (not designed → never allowed here).
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { action, type ActionMap } from './define';
import { db, schema } from '../db';
import { RadarError, forbidden, notFound } from '../errors';
import { EMAIL_RE } from '@/lib/format';
import { newInviteToken, sendInviteEmail } from '../services/team/invites';

const InviteRole = z.enum(['Admin', 'Editor', 'Viewer']);

async function memberOf(bid: string, memberId: string) {
  const r = await db.select().from(schema.members).where(and(eq(schema.members.id, memberId), eq(schema.members.businessId, bid))).limit(1);
  if (!r[0]) throw notFound('That team member');
  return r[0];
}

export const actions: ActionMap = {
  'team.invite': action({
    role: 'Admin',
    input: z.object({ email: z.string(), role: InviteRole }),
    run: async (ctx, { email, role }) => {
      const v = email.trim().toLowerCase();
      if (!EMAIL_RE.test(v)) throw new RadarError('Enter a valid email', 400, 'invalid_email');
      const dup = await db.select({ id: schema.members.id }).from(schema.members).where(and(eq(schema.members.businessId, ctx.bid), eq(schema.members.email, v))).limit(1);
      if (dup[0]) throw new RadarError('Already on the team', 409, 'duplicate');
      const { token, hash } = newInviteToken();
      const [m] = await db.insert(schema.members).values({ businessId: ctx.bid, email: v, role, status: 'invited', tokenHash: hash, invitedAt: new Date() }).returning({ id: schema.members.id });
      const p = ctx.biz.profile as any;
      try {
        await sendInviteEmail({ to: v, token, inviter: ctx.user.name || ctx.user.email, business: p?.business?.name || ctx.biz.domain, domain: ctx.biz.domain, role });
      } catch (e: any) {
        // Couldn't deliver: don't leave a pending invite nobody received.
        await db.delete(schema.members).where(eq(schema.members.id, m.id));
        console.error('[team.invite] mail failed', e?.message || e);
        throw new RadarError('Radar couldn’t send the invite. Try again.', 502, 'mail_failed');
      }
      return { memberId: m.id };
    },
  }),

  'team.role': action({
    role: 'Admin',
    input: z.object({ memberId: z.string().uuid(), role: InviteRole }),
    run: async (ctx, { memberId, role }) => {
      const m = await memberOf(ctx.bid, memberId);
      if (m.role === 'Owner') throw forbidden(); // the Owner row is fixed; ownership transfer isn't designed
      if (m.userId === ctx.user.id && ctx.role !== 'Owner') throw forbidden(); // no self-demotion/promotion
      await db.update(schema.members).set({ role }).where(eq(schema.members.id, m.id));
      return { ok: true };
    },
  }),

  'team.remove': action({
    role: 'Admin',
    input: z.object({ memberId: z.string().uuid() }),
    run: async (ctx, { memberId }) => {
      const m = await memberOf(ctx.bid, memberId);
      if (m.role === 'Owner' || m.userId === ctx.user.id) throw forbidden();
      // Deleting the row revokes access immediately: every request re-checks membership (requireRole); a pending invite's token stops working.
      await db.delete(schema.members).where(eq(schema.members.id, m.id));
      return { email: m.email };
    },
  }),
};
