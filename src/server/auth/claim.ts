// Claim: the guest's onboarding draft moves to the account at signup, signin or Google sign-in (architecture §6, AC-G5).
// One transaction with a FOR UPDATE lock on the guest row: two tabs or a double submit move it exactly once. Everything is
// keyed by business_id (GSC tokens, crawl pages, jobs, logo), so moving the owner and the member row moves all of it.
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { decrypt } from '../crypto';
import { track } from '../events';
import { revoke, type GscTokens } from '../services/gsc/client';
import { destinationAfterAuth } from '../billing/guard';
import { clearGuestCookie, createSession, currentGuest, type SessionUser } from './session';

export interface ClaimResult { claimed: string | null; replaced: string[] }

export async function claimGuest(guestId: string, user: { id: string; email: string }): Promise<ClaimResult> {
  const B = schema.businesses;
  const out: ClaimResult = { claimed: null, replaced: [] };
  const revokeLater: (GscTokens | null)[] = [];
  await db.transaction(async tx => {
    const g = await tx.execute(sql`SELECT id FROM users WHERE id = ${guestId} AND guest FOR UPDATE`);
    if (!g.rows.length) return;                                   // cleaned up, or another tab already claimed it
    const draft = (await tx.select({ id: B.id }).from(B).where(and(eq(B.ownerId, guestId), eq(B.status, 'onboarding'))).orderBy(sql`${B.createdAt} desc`).limit(1))[0];
    if (draft) {
      // One draft per owner (B6): the guest draft replaces the account's own unfinished one.
      const old = await tx.select({ id: B.id, tokens: schema.gscConnections.tokensEnc }).from(B).leftJoin(schema.gscConnections, eq(schema.gscConnections.businessId, B.id))
        .where(and(eq(B.ownerId, user.id), eq(B.status, 'onboarding')));
      for (const o of old) {
        try { revokeLater.push(decrypt<GscTokens>(o.tokens)); } catch { /* unreadable token: nothing to revoke */ }
        await tx.delete(B).where(eq(B.id, o.id));
        out.replaced.push(o.id);
      }
      await tx.update(B).set({ ownerId: user.id, updatedAt: new Date() }).where(eq(B.id, draft.id));
      await tx.update(schema.members).set({ userId: user.id, email: user.email.toLowerCase() }).where(and(eq(schema.members.businessId, draft.id), eq(schema.members.userId, guestId)));
      out.claimed = draft.id;
    }
    await tx.update(schema.events).set({ userId: user.id }).where(eq(schema.events.userId, guestId));
    await tx.delete(schema.oauthStates).where(eq(schema.oauthStates.userId, guestId));
    await tx.delete(B).where(eq(B.ownerId, guestId));            // guests own nothing else; owner_id has no ON DELETE
    await tx.delete(schema.users).where(eq(schema.users.id, guestId));   // cascades the guest's sessions
  });
  for (const t of revokeLater) await revoke(t);
  for (const bid of out.replaced) await track('onboarding.draft_replaced', { uid: user.id, bid });
  if (out.claimed) await track('onboarding.claimed', { uid: user.id, bid: out.claimed });
  return out;
}

/** The end of every sign-in path (route handlers only: sets cookies). Claims this browser's guest, clears radar_guest,
 *  starts the session and returns where to go (AuthResult.next). */
export async function finishAuth(user: SessionUser, next?: string | null): Promise<{ next: string; claimed: string | null }> {
  const g = await currentGuest();
  const r = g ? await claimGuest(g.id, user) : { claimed: null };
  await clearGuestCookie();
  await createSession(user.id);
  return { next: await destinationAfterAuth(user, next), claimed: r.claimed };
}
