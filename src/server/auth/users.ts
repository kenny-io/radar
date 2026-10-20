import { eq, and } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { db, schema } from '../db';
import { sha256 } from '../crypto';
import type { BusinessSummary, Me } from '@/lib/types';

export const BIZ_COOKIE = 'radar_biz';

/** Link pending invites addressed to this email to the user (invites by signed link are accepted in /api/invites/[token]). */
export async function attachInvites(userId: string, email: string) {
  await db.update(schema.members).set({ userId }).where(and(eq(schema.members.email, email.toLowerCase()), eq(schema.members.status, 'invited')));
}

export async function listBusinesses(userId: string): Promise<BusinessSummary[]> {
  const rows = await db.select({ b: schema.businesses, role: schema.members.role }).from(schema.members)
    .innerJoin(schema.businesses, eq(schema.businesses.id, schema.members.businessId))
    .where(and(eq(schema.members.userId, userId), eq(schema.members.status, 'active'))).orderBy(schema.businesses.createdAt);
  return rows.map(({ b, role }) => ({ id: b.id, name: (b.profile as any)?.business?.name || b.domain, domain: b.domain, brand: { logo: b.profile?.brand?.logo ?? null, primary: b.profile?.brand?.primary || '#17181C', secondary: b.profile?.brand?.secondary || '#EF6A2E' }, status: b.status, role: role as any }));
}

export async function getMe(user: { id: string; name: string; email: string; appearance?: 'system' | 'light' | 'dark' }): Promise<Me> {
  const businesses = await listBusinesses(user.id);
  const jar = await cookies();
  const want = jar.get(BIZ_COOKIE)?.value;
  const active = businesses.filter(b => b.status === 'active');
  const cur = businesses.find(b => b.id === want && b.status === 'active') || active[0] || null;
  return { user, businesses, currentId: cur?.id || null };
}
export { sha256 };
