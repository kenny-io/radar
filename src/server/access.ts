import { and, eq } from 'drizzle-orm';
import { db, schema } from './db';
import { currentActor, currentUser, type Actor } from './auth/session';
import { forbidden, notFound, subscriptionRequired, unauthorized } from './errors';
import { bizAccess, ownAccess } from './billing/access';
import type { Role } from '@/lib/types';

export const ROLE_RANK: Record<Role, number> = { Viewer: 0, Editor: 1, Admin: 2, Owner: 3 };
export type MinRole = Role;
export type { Actor };

/** Signed-in users only (never a guest). */
export async function requireUser() {
  const u = await currentUser();
  if (!u) throw unauthorized();
  return u;
}
/** A signed-in user or this browser's guest (architecture §4.4). */
export async function requireActor(): Promise<Actor> {
  const a = await currentActor();
  if (!a) throw unauthorized();
  return a;
}

export async function memberRole(businessId: string, userId: string): Promise<Role | null> {
  const r = await db.select({ role: schema.members.role }).from(schema.members)
    .where(and(eq(schema.members.businessId, businessId), eq(schema.members.userId, userId), eq(schema.members.status, 'active'))).limit(1);
  return (r[0]?.role as Role) || null;
}

/** Throws unless the user is an active member of the business with at least `min` role. */
export async function requireRole(businessId: string, userId: string, min: Role = 'Viewer'): Promise<Role> {
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) throw notFound('Business');
  const role = await memberRole(businessId, userId);
  if (!role) throw notFound('Business');
  if (ROLE_RANK[role] < ROLE_RANK[min]) throw forbidden();
  return role;
}

/** What onboarding needs. Held on a draft by any actor without own access (every guest, in every flag state). */
export const DRAFT_ACTIONS = new Set(['onboarding.analyze', 'onboarding.step', 'onboarding.save', 'onboarding.finish',
  'profile.update', 'job.get', 'gsc.properties', 'gsc.connect']);   // profile.update covers the logo data-URL upload

/** The business gate (architecture §4.4), after requireRole:
 *  - a draft belongs to its owner only (404 otherwise); a non-allowlisted action on it needs own access (402);
 *  - an active business: a guest gets 404, a user without access (the owner's subscription) gets 402.
 *  `own` is the actor's ownAccess when the caller already has it. Returns the business row. */
export async function gateBusiness(actor: Actor, bid: string, o: { action?: string; own?: boolean } = {}) {
  const biz = (await db.select().from(schema.businesses).where(eq(schema.businesses.id, bid)).limit(1))[0];
  if (!biz) throw notFound('Business');
  if (biz.status === 'onboarding') {
    if (biz.ownerId !== actor.id) throw notFound('Business');
    if (o.action && !DRAFT_ACTIONS.has(o.action) && !(o.own ?? await ownAccess(actor))) throw subscriptionRequired();
  } else {
    if (actor.guest) throw notFound('Business');
    const access = biz.ownerId === actor.id && o.own != null ? o.own : await bizAccess(biz);
    if (!access) throw subscriptionRequired();
  }
  return biz;
}
