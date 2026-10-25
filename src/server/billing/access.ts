// Who may open Radar (architecture §4.1, §4.3). ownAccess is always false for a guest. For a real user it is true when
// billing isn't enforced for them, they are comp (row, or the optional lazy grandfather cutoff), or their subscription is
// trialing/active. Members ride on the owner's subscription (D6): bizAccess(biz) = ownAccess(owner).
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { billingFlag, billingFlagNeedsEmail, grandfatherCutoff } from '../flags';
import { providerName } from './config';
import { toDraftSummary } from './draft';
import type { DraftSummary, SubStatus } from '@/lib/types';

export type Account = typeof schema.billingAccounts.$inferSelect;
export interface AccessActor { id: string; email?: string | null; guest?: boolean }
export const GRANTING: readonly SubStatus[] = ['trialing', 'active'];
export const TERMINAL: readonly SubStatus[] = ['canceled', 'incomplete_expired'];

/** RADAR_BILLING asks for the gate for this account and a provider exists. On but unconfigured → off, loudly (B19). */
export function billingEnforced(email?: string | null): boolean {
  if (!billingFlag(email)) return false;
  if (providerName() === 'none') { console.error('[billing] RADAR_BILLING is on but no payment provider is configured (STRIPE_SECRET_KEY); treating billing as off'); return false; }
  return true;
}

export const accountGrants = (a: Pick<Account, 'comp' | 'status'> | null | undefined) => !!a && (a.comp || GRANTING.includes(a.status));
export async function accountOf(uid: string, q: Pick<typeof db, 'select'> = db): Promise<Account | null> {
  return (await q.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId, uid)).limit(1))[0] || null;
}
const userRow = async (uid: string) => (await db.select({ email: schema.users.email, guest: schema.users.guest }).from(schema.users).where(eq(schema.users.id, uid)).limit(1))[0] || null;

/** Lazy grandfather (§21.2, optional): an owner of an active business created before RADAR_BILLING_GRANDFATHER_BEFORE
 *  is comp; the comp row is written on first use. Never call while holding this user's billing row lock. */
export async function lazyGrandfather(uids: string[]): Promise<Set<string>> {
  const cutoff = grandfatherCutoff();
  if (!cutoff || !uids.length) return new Set();
  const rows = await db.selectDistinct({ id: schema.businesses.ownerId }).from(schema.businesses).innerJoin(schema.users, eq(schema.users.id, schema.businesses.ownerId))
    .where(and(inArray(schema.businesses.ownerId, uids), eq(schema.businesses.status, 'active'), lt(schema.businesses.createdAt, cutoff), eq(schema.users.guest, false)));
  if (!rows.length) return new Set();
  await db.insert(schema.billingAccounts).values(rows.map(r => ({ userId: r.id, comp: true, compReason: 'grandfather' })))
    .onConflictDoUpdate({ target: schema.billingAccounts.userId, set: { comp: true, compReason: sql`coalesce(${schema.billingAccounts.compReason}, 'grandfather')`, updatedAt: new Date() } });
  console.info(`[billing] grandfathered ${rows.length} account(s) (cutoff ${cutoff.toISOString()})`);
  return new Set(rows.map(r => r.id));
}

/** The account's own access. A guest → false in every flag state. */
export async function ownAccess(a: AccessActor): Promise<boolean> {
  if (a.guest) return false;
  let email = a.email;
  if (email == null && billingFlagNeedsEmail()) email = (await userRow(a.id))?.email ?? null;
  if (!billingEnforced(email)) return true;
  if (accountGrants(await accountOf(a.id))) return true;
  return (await lazyGrandfather([a.id])).has(a.id);
}

/** Access to an active business = its owner's own access. */
export async function bizAccess(biz: { ownerId: string }): Promise<boolean> {
  const o = await userRow(biz.ownerId);
  if (!o || o.guest) return false;
  return ownAccess({ id: biz.ownerId, email: o.email, guest: false });
}

export interface AccessSummary {
  enforced: boolean; own: boolean; status: SubStatus | 'comp';
  /** active businesses where the user is an active member and ownAccess(owner) */
  accessible: string[];
  /** owns one or more active businesses */
  ownsActive: boolean;
  draft: { id: string; domain: string; savedAt: string | null; summary: DraftSummary } | null;
  /** the user's billing row, read only when billing is enforced for them */
  account: Account | null;
}

/** Everything the guards need for one user, in a handful of queries (none of them billing queries when billing is off). */
export async function accessSummary(uid: string): Promise<AccessSummary> {
  const B = schema.businesses;
  const [me, rows] = await Promise.all([
    db.select({ email: schema.users.email, guest: schema.users.guest }).from(schema.users).where(eq(schema.users.id, uid)).limit(1),
    db.select({ b: B, ownerEmail: schema.users.email, ownerGuest: schema.users.guest }).from(schema.members)
      .innerJoin(B, eq(B.id, schema.members.businessId)).innerJoin(schema.users, eq(schema.users.id, B.ownerId))
      .where(and(eq(schema.members.userId, uid), eq(schema.members.status, 'active'))).orderBy(B.createdAt),
  ]);
  const self = me[0];
  const guest = !self || self.guest;
  const enforced = !guest && billingEnforced(self.email);
  const active = rows.filter(r => r.b.status === 'active');
  // Owners whose access matters: me, plus the owners of active businesses I'm a member of.
  const owners = new Map<string, { email: string; guest: boolean }>([[uid, { email: self?.email || '', guest }]]);
  for (const r of active) owners.set(r.b.ownerId, { email: r.ownerEmail, guest: r.ownerGuest });
  const enforcedFor = new Map([...owners].map(([id, o]) => [id, !o.guest && billingEnforced(o.email)]));
  const needAccounts = [...owners.keys()].filter(id => enforcedFor.get(id));
  const accts = needAccounts.length ? await db.select().from(schema.billingAccounts).where(inArray(schema.billingAccounts.userId, needAccounts)) : [];
  const byUser = new Map(accts.map(a => [a.userId, a]));
  const access = new Map<string, boolean>();
  for (const [id, o] of owners) access.set(id, o.guest ? false : !enforcedFor.get(id) || accountGrants(byUser.get(id)));
  const grand = await lazyGrandfather(needAccounts.filter(id => !access.get(id)));
  for (const id of grand) access.set(id, true);
  const account = byUser.get(uid) || null;   // only read when billing is enforced for me
  const d = rows.filter(r => r.b.status === 'onboarding' && r.b.ownerId === uid).pop()?.b;
  return {
    enforced, own: !guest && !!access.get(uid),
    status: grand.has(uid) || account?.comp ? 'comp' : (account?.status || 'none'),
    accessible: active.filter(r => access.get(r.b.ownerId)).map(r => r.b.id),
    ownsActive: active.some(r => r.b.ownerId === uid),
    draft: d ? { id: d.id, domain: d.domain, savedAt: d.onboarding?.savedAt || null, summary: toDraftSummary(d) } : null,
    account,
  };
}
