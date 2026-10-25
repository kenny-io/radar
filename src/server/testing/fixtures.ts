// Test-only fixtures for the gating and billing DB tests. Each test file tags its rows and deletes them afterwards.
import { inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { randomToken, sha256 } from '../crypto';
import { GUEST_COOKIE, SESSION_COOKIE } from '../auth/session';
import type { SubStatus } from '@/lib/types';

export const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export type TUser = { id: string; name: string; email: string; guest: boolean };

export class Fixtures {
  users: string[] = [];
  constructor(public tag = uniq()) {}
  async user(o: { name?: string; email?: string; guest?: boolean; password?: string } = {}): Promise<TUser> {
    const n = this.users.length;
    const email = o.email || (o.guest ? `guest+${this.tag}-${n}@guest.radar.invalid` : `t-${this.tag}-${n}@test.local`);
    const [u] = await db.insert(schema.users).values({ name: o.name ?? (o.guest ? '' : `User ${n}`), email, guest: !!o.guest, passwordHash: o.password ?? null }).returning();
    this.users.push(u.id);
    return { id: u.id, name: u.name, email: u.email, guest: u.guest };
  }
  /** A live session for `u` in `jar` (radar_guest for guests, radar_session otherwise unless `cookie` says so). */
  async signIn(u: TUser, jar: Map<string, string>, cookie = u.guest ? GUEST_COOKIE : SESSION_COOKIE, hours = 72) {
    const t = randomToken();
    await db.insert(schema.sessions).values({ id: sha256(t), userId: u.id, expiresAt: new Date(Date.now() + hours * 3600e3) });
    jar.set(cookie, t);
    return t;
  }
  async biz(owner: TUser, o: { status?: 'onboarding' | 'active'; domain?: string; createdAt?: Date; onboarding?: any; profile?: any; edited?: any; site?: any } = {}) {
    const domain = o.domain || `b-${uniq()}.test`;
    const [b] = await db.insert(schema.businesses).values({ ownerId: owner.id, domain, status: o.status || 'active', profile: o.profile || { domain, business: { name: 'Fieldnote' }, brand: { primary: '#1F4D3A', secondary: '#F2B544' } },
      edited: o.edited || {}, site: o.site || {}, onboarding: o.onboarding || {}, ...(o.createdAt ? { createdAt: o.createdAt } : {}) }).returning();
    await db.insert(schema.members).values({ businessId: b.id, userId: owner.id, email: owner.email.toLowerCase(), role: 'Owner', status: 'active' });
    return b;
  }
  async member(bid: string, u: TUser, role: 'Admin' | 'Editor' | 'Viewer' = 'Editor') {
    await db.insert(schema.members).values({ businessId: bid, userId: u.id, email: u.email.toLowerCase(), role, status: 'active' });
  }
  async account(uid: string, a: Partial<typeof schema.billingAccounts.$inferInsert> & { status?: SubStatus } = {}) {
    await db.insert(schema.billingAccounts).values({ userId: uid, ...a }).onConflictDoUpdate({ target: schema.billingAccounts.userId, set: { ...a, updatedAt: new Date() } });
  }
  track(id: string) { this.users.push(id); }
  async cleanup() {
    const ids = [...new Set(this.users)];
    if (!ids.length) return;
    await db.delete(schema.trialFingerprints).where(inArray(schema.trialFingerprints.userId, ids));
    await db.delete(schema.businesses).where(inArray(schema.businesses.ownerId, ids));
    await db.delete(schema.events).where(inArray(schema.events.userId, ids));
    await db.delete(schema.oauthStates).where(inArray(schema.oauthStates.userId, ids));
    await db.delete(schema.users).where(inArray(schema.users.id, ids));
  }
}
/** Drop rate-limit rows whose key contains `part` (per-run unique IPs and domains). */
export const clearLimits = (part: string) => db.execute(sql`DELETE FROM rate_limits WHERE key LIKE ${'%' + part + '%'}`);
