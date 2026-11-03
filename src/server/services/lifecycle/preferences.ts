import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { hmacSha256 } from '@/server/crypto';
const secret = () => {
  if (!env.secretKey && env.isProd) throw new Error('RADAR_SECRET_KEY is required');
  return env.secretKey || 'radar-dev-only-key';
};
export function preferenceToken(userId: string) { return `${userId}.${hmacSha256(secret(), `radar-onboarding-optout:${userId}`)}`; }
export function preferenceUser(token: string): string | null {
  const [id, signature, extra] = token.split('.');
  if (extra || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id || '') || !/^[\da-f]{64}$/.test(signature || '')) return null;
  const expected = preferenceToken(id).split('.')[1];
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? id : null;
}
export async function stopOnboarding(userId: string) {
  await db.insert(schema.userEmailPreferences).values({ userId, onboarding: false }).onConflictDoUpdate({ target: schema.userEmailPreferences.userId, set: { onboarding: false, updatedAt: new Date() } });
}
export async function onboardingAllowed(userId: string) {
  const [p] = await db.select().from(schema.userEmailPreferences).where(eq(schema.userEmailPreferences.userId, userId)).limit(1);
  return p?.onboarding !== false;
}
