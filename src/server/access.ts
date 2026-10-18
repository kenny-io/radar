import { and, eq } from 'drizzle-orm';
import { db, schema } from './db';
import { currentUser } from './auth/session';
import { forbidden, notFound, unauthorized } from './errors';
import type { Role } from '@/lib/types';

export const ROLE_RANK: Record<Role, number> = { Viewer: 0, Editor: 1, Admin: 2, Owner: 3 };
export type MinRole = Role;

export async function requireUser() {
  const u = await currentUser();
  if (!u) throw unauthorized();
  return u;
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
