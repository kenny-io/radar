// One source for the grace banner and the trial chip (.factory/first-five-optimizations/architecture.md §5). It is in the
// workspace, not `Me`, because members need the owner's state and `Me` only refreshes on a full load.
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { billingFlag, billingFlagNeedsEmail } from '../flags';
import { billingEnforced, graceEndsAt, inGrace } from './access';
import type { BizRow } from '../workspace';
import type { Workspace } from '@/lib/types';

/** Undefined when billing is not enforced for the owner or the owner is comp (grandfathered accounts are comp rows by the
 *  time a workspace loads: the gate wrote it). `graceEndsAt` for every member while the owner is in the past-due grace;
 *  `trialEndsAt` only for the payer while trialing. No database read while billing is off for everyone. */
export async function billingNoticeOf(biz: Pick<BizRow, 'ownerId'>, userId: string): Promise<Workspace['billing']> {
  if (!billingFlagNeedsEmail() && !billingFlag(null)) return undefined;
  const U = schema.users, A = schema.billingAccounts;
  const [r] = await db.select({ email: U.email, guest: U.guest, a: A }).from(U).leftJoin(A, eq(A.userId, U.id)).where(eq(U.id, biz.ownerId)).limit(1);
  if (!r || r.guest || !billingEnforced(r.email) || !r.a || r.a.comp) return undefined;
  const payer = biz.ownerId === userId;
  const grace = inGrace(r.a) ? graceEndsAt(r.a) : null;
  const trial = payer && r.a.status === 'trialing' && r.a.trialEnd ? r.a.trialEnd : null;
  return { payer, ...(grace ? { graceEndsAt: grace.toISOString() } : {}), ...(trial ? { trialEndsAt: trial.toISOString() } : {}) };
}
