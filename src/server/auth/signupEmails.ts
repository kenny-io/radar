import { and, desc, eq } from 'drizzle-orm';
import { schema } from '../db';
import type { Tx } from '../billing/draft';
import { queueLifecycle } from '../services/lifecycle/queue';

/** Called only inside the transaction that creates a real account, never on sign-in or guest creation. */
export async function queueSignupEmails(tx: Tx, user: { id: string; name: string }, guestId?: string) {
  // guestId comes only from currentGuest(), before the creation transaction. Read the latest draft through this
  // transaction before finishAuth claims it; an empty default profile is not proof that analysis has completed.
  const [draft] = guestId ? await tx.select({ profile: schema.businesses.profile, site: schema.businesses.site, domain: schema.businesses.domain })
    .from(schema.businesses).innerJoin(schema.users, and(eq(schema.users.id, schema.businesses.ownerId), eq(schema.users.guest, true)))
    .where(and(eq(schema.businesses.ownerId, guestId), eq(schema.businesses.status, 'onboarding')))
    .orderBy(desc(schema.businesses.createdAt), desc(schema.businesses.id)).limit(1) : [];
  const profileAnalyzed = typeof draft?.site?.analyzedAt === 'string' && !!draft.site.analyzedAt.trim();
  const rawName = draft?.profile?.business?.name;
  const businessName = profileAnalyzed ? (typeof rawName === 'string' && rawName.trim() ? rawName.trim().slice(0, 200) : draft.domain) : undefined;
  await queueLifecycle(tx, { type: 'welcome', userId: user.id, eventKey: `welcome:${user.id}`, data: { name: user.name, profileAnalyzed, ...(businessName ? { businessName } : {}) } });
  await queueLifecycle(tx, { type: 'founder_note', userId: user.id, eventKey: `founder:${user.id}`, data: { name: user.name }, sendAt: new Date(Date.now() + 24 * 3600e3) });
}
