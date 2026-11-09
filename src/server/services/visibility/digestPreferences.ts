import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';

function signature(body: string): string {
  if (!env.secretKey && env.isProd) throw new Error('RADAR_SECRET_KEY is required in production');
  return createHmac('sha256', env.secretKey || 'radar-dev-only-key').update(`visibility-weekly-preferences:${body}`).digest('base64url');
}
export function digestPreferencesToken(bid: string, ownerId: string): string {
  const body = Buffer.from(JSON.stringify({ bid, ownerId })).toString('base64url');
  return `${body}.${signature(body)}`;
}
export function readDigestPreferencesToken(token: string): { bid: string; ownerId: string } | null {
  if (token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = signature(body);
  if (!/^[A-Za-z0-9_-]{43}$/.test(sig) || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuid.test(value.bid) && uuid.test(value.ownerId) ? { bid: value.bid, ownerId: value.ownerId } : null;
  } catch { return null; }
}
export const digestPreferencesUrl = (bid: string, ownerId: string) => `${env.appUrl}/ai-email-preferences?token=${encodeURIComponent(digestPreferencesToken(bid, ownerId))}`;
/** The signed token only authorizes disabling this report. Lock ownership until the update commits. */
export async function disableDigestEmail(token: string): Promise<boolean> {
  const identity = readDigestPreferencesToken(token);
  if (!identity) return false;
  return db.transaction(async tx => {
    const [business] = await tx.select({ id: schema.businesses.id }).from(schema.businesses)
      .where(and(eq(schema.businesses.id, identity.bid), eq(schema.businesses.ownerId, identity.ownerId))).limit(1).for('update');
    if (!business) return false;
    await tx.insert(schema.visibilityPreferences).values({ businessId: identity.bid, weeklyEmail: false })
      .onConflictDoUpdate({ target: schema.visibilityPreferences.businessId, set: { weeklyEmail: false, updatedAt: new Date() } });
    return true;
  });
}

/** Account-level access: these choices remain available without an active subscription. */
export async function managedDigestPreferences(userId: string) {
  const B = schema.businesses, M = schema.members, P = schema.visibilityPreferences;
  const rows = await db.select({ id: B.id, domain: B.domain, weeklyEmail: P.weeklyEmail, role: M.role }).from(B)
    .innerJoin(M, and(eq(M.businessId, B.id), eq(M.userId, userId), eq(M.status, 'active'))).leftJoin(P, eq(P.businessId, B.id));
  return rows.filter(r => r.role === 'Owner' || r.role === 'Admin').map(({ role: _role, ...r }) => ({ ...r, weeklyEmail: r.weeklyEmail !== false }));
}
export async function updateDigestPreference(userId: string, bid: string, weeklyEmail: boolean) {
  return db.transaction(async tx => {
    const [business] = await tx.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, bid)).for('update');
    if (!business) return false;
    const [member] = await tx.select({ role: schema.members.role }).from(schema.members).where(and(eq(schema.members.businessId, bid), eq(schema.members.userId, userId), eq(schema.members.status, 'active'))).limit(1);
    if (!member || !['Owner','Admin'].includes(member.role)) return false;
    await tx.insert(schema.visibilityPreferences).values({ businessId: bid, weeklyEmail }).onConflictDoUpdate({ target: schema.visibilityPreferences.businessId, set: { weeklyEmail, updatedAt: new Date() } });
    return true;
  });
}
