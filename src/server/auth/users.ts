import { eq, and } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { db, schema } from '../db';
import { sha256 } from '../crypto';
import { accessSummary } from '../billing/access';
import type { BusinessSummary, Me } from '@/lib/types';

export const BIZ_COOKIE = 'radar_biz';

/** Link pending invites addressed to this email to the user (invites by signed link are accepted in /api/invites/[token]). */
export async function attachInvites(userId: string, email: string) {
  if (email.toLowerCase().endsWith('@guest.radar.invalid')) return;
  await db.update(schema.members).set({ userId }).where(and(eq(schema.members.email, email.toLowerCase()), eq(schema.members.status, 'invited')));
}

export async function listBusinesses(userId: string): Promise<BusinessSummary[]> {
  const rows = await db.select({ b: schema.businesses, role: schema.members.role }).from(schema.members)
    .innerJoin(schema.businesses, eq(schema.businesses.id, schema.members.businessId))
    .where(and(eq(schema.members.userId, userId), eq(schema.members.status, 'active'))).orderBy(schema.businesses.createdAt);
  return rows.map(({ b, role }) => ({ id: b.id, name: (b.profile as any)?.business?.name || b.domain, domain: b.domain, brand: { logo: b.profile?.brand?.logo ?? null, primary: b.profile?.brand?.primary || '#17181C', secondary: b.profile?.brand?.secondary || '#EF6A2E' }, status: b.status, role: role as any }));
}

/** `access` is set on every business (false = the owner has no trialing/active subscription; the switcher hides it).
 *  currentId is chosen only among active businesses the user can open (architecture §19.6). */
export async function getMe(user: { id: string; name: string; email: string; appearance?: 'system' | 'light' | 'dark' }): Promise<Me> {
  const [list, s] = await Promise.all([listBusinesses(user.id), accessSummary(user.id)]);
  const open = new Set(s.accessible);
  const businesses = list.map(b => ({ ...b, access: b.status === 'active' ? open.has(b.id) : s.own }));
  const jar = await cookies();
  const want = jar.get(BIZ_COOKIE)?.value;
  const usable = businesses.filter(b => b.status === 'active' && b.access);
  const cur = usable.find(b => b.id === want) || usable[0] || null;
  return { user, businesses, currentId: cur?.id || null };
}
export { sha256 };
