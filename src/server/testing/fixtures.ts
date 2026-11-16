// Test-only fixtures for the gating and billing DB tests. Each test file tags its rows and deletes them afterwards.
import { inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { encrypt, randomToken, sha256 } from '../crypto';
import { GUEST_COOKIE, SESSION_COOKIE } from '../auth/session';
import type { SubStatus } from '@/lib/types';
import { DELETE_RETENTION_HOURS } from '@/lib/deletion';

export const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export type TUser = { id: string; name: string; email: string; guest: boolean };

export class Fixtures {
  users: string[] = [];
  constructor(public tag = uniq()) {}
  async user(o: { name?: string; email?: string; guest?: boolean; password?: string; verified?: boolean } = {}): Promise<TUser> {
    const n = this.users.length;
    const email = o.email || (o.guest ? `guest+${this.tag}-${n}@guest.radar.invalid` : `t-${this.tag}-${n}@test.local`);
    const [u] = await db.insert(schema.users).values({ name: o.name ?? (o.guest ? '' : `User ${n}`), email, guest: !!o.guest, passwordHash: o.password ?? null, emailVerifiedAt: !o.guest && o.verified !== false ? new Date() : null }).returning();
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
  /** `status: 'deleted'` needs both timestamps (businesses_deleted_check): by default deleted now and wiped 168 hours
   *  later. Pass `deletedAt` (and `purgeAt`) to place the row anywhere in or past its restore window. */
  async biz(owner: TUser, o: { status?: 'onboarding' | 'active' | 'deleted'; domain?: string; createdAt?: Date; onboarding?: any; profile?: any; edited?: any; site?: any; deletedAt?: Date; purgeAt?: Date } = {}) {
    const domain = o.domain || `b-${uniq()}.test`;
    const deletedAt = o.status === 'deleted' ? o.deletedAt || new Date() : null;
    const gone = deletedAt ? { deletedAt, purgeAt: o.purgeAt || new Date(deletedAt.getTime() + DELETE_RETENTION_HOURS * 3600e3) } : {};
    const [b] = await db.insert(schema.businesses).values({ ownerId: owner.id, domain, status: o.status || 'active', profile: o.profile || { domain, business: { name: 'Fieldnote' }, brand: { primary: '#1F4D3A', secondary: '#F2B544' } },
      edited: o.edited || {}, site: o.site || {}, onboarding: o.onboarding || {}, ...(o.createdAt ? { createdAt: o.createdAt } : {}), ...gone }).returning();
    await db.insert(schema.members).values({ businessId: b.id, userId: owner.id, email: owner.email.toLowerCase(), role: 'Owner', status: 'active' });
    return b;
  }
  async member(bid: string, u: TUser, role: 'Admin' | 'Editor' | 'Viewer' = 'Editor') {
    await db.insert(schema.members).values({ businessId: bid, userId: u.id, email: u.email.toLowerCase(), role, status: 'active' });
  }
  async account(uid: string, a: Partial<typeof schema.billingAccounts.$inferInsert> & { status?: SubStatus } = {}) {
    await db.insert(schema.billingAccounts).values({ userId: uid, ...a }).onConflictDoUpdate({ target: schema.billingAccounts.userId, set: { ...a, updatedAt: new Date() } });
  }
  /** At least one row in every table that can carry a business id (the wipe test checks this list against the
   *  database's own columns, so a table added later fails there until it is seeded here and handled by the wipe).
   *  Returns the ids the wipe's checks need. */
  async seedEverything(bid: string, ownerId: string) {
    const S = schema; const tag = uniq(); const day = '2026-11-10';
    await db.insert(S.crawlPages).values({ businessId: bid, url: `https://seed-${tag}.test/`, path: '/' });
    await db.insert(S.gscConnections).values({ businessId: bid, status: 'connected', property: 'sc-domain:seed.test', tokensEnc: encrypt({ access_token: 'a', refresh_token: 'r', stub: true }) }).onConflictDoNothing();
    await db.insert(S.gscRows).values({ businessId: bid, kind: 'date', date: day, key: '', clicks: 1, impressions: 2, ctr: 0.5, position: 3 });
    const entryId = `e-${tag}`;
    await db.insert(S.calendarEntries).values({ id: entryId, businessId: bid, title: 'Seed', kw: 'seed', type: 'Guide', date: day, status: 'review' });
    await db.insert(S.articles).values({ entryId, businessId: bid, data: { entryId, generated: true, body: [] } });
    await db.insert(S.connections).values({ businessId: bid, type: 'wordpress', url: 'https://seed.test', fields: {}, credentialsEnc: encrypt({ password: 'p' }) });
    await db.insert(S.socialPacks).values({ id: `p-${tag}`, businessId: bid, data: { id: `p-${tag}`, name: 'Seed' } });
    await db.insert(S.briefDays).values({ businessId: bid, date: day, scannedAt: new Date().toISOString(), items: [] });
    const [prompt] = await db.insert(S.aiPrompts).values({ businessId: bid, prompt: 'best seed tools', source: 'user' }).returning();
    await db.insert(S.aiResults).values({ businessId: bid, promptId: prompt.id, engine: 'ChatGPT' });
    await db.insert(S.aiObservations).values({ businessId: bid, promptId: prompt.id, prompt: 'best seed tools', engine: 'ChatGPT', series: 's'.repeat(64), day, status: 'mentioned' });
    await db.insert(S.aiMissTopics).values({ businessId: bid, promptId: prompt.id, series: 's'.repeat(64), entryId });
    await db.insert(S.suggestions).values({ businessId: bid, data: { title: 'Seed' } });
    const [proposal] = await db.insert(S.proposals).values({ businessId: bid, direction: 'out', data: { page: 'https://seed.test/a', target: 'https://other.test/b', anchor: 'b' } }).returning();
    await db.insert(S.liveLinks).values({ businessId: bid, proposalId: proposal.id, fromUrl: 'https://seed.test/a', toUrl: 'https://other.test/b', anchor: 'b', rel: 'follow', since: day });
    await db.insert(S.jobs).values([{ kind: 'test.seed', businessId: bid, status: 'done', result: { ok: true }, finishedAt: new Date() }, { kind: 'test.seed', businessId: bid, status: 'queued' }]);
    await db.insert(S.notifications).values({ businessId: bid, userId: ownerId, payload: { msg: 'Seed' } });
    await db.insert(S.featureRequests).values({ userId: ownerId, businessId: bid, text: 'Seed request' });
    await db.insert(S.oauthStates).values({ state: `st-${tag}`, userId: ownerId, businessId: bid, provider: 'gsc' });
    const [mail] = await db.insert(S.lifecycleEmails).values({ userId: ownerId, businessId: bid, eventKey: `seed:${tag}`, type: 'ai_weekly_report', payloadEnc: encrypt({ seed: true }), expiresAt: new Date(Date.now() + 864e5) }).returning();
    await db.insert(S.engagementEvents).values({ userId: ownerId, businessId: bid, kind: 'brief_reply', sourceKey: `seed:${tag}`, sourceRef: { ref: day }, occurredAt: new Date(), eligibleAt: new Date(), expiresAt: new Date(Date.now() + 864e5), lifecycleEmailId: mail.id });
    const [call] = await db.insert(S.aiCalls).values({ businessId: bid, task: 'writing', purpose: 'seed', model: 'stub', provider: 'stub', ok: false, error: 'Seed error naming the business', costUsd: 0.25 }).returning();
    const [event] = await db.insert(S.events).values({ businessId: bid, userId: ownerId, kind: 'article.published', ref: entryId, props: { url: 'https://seed.test/a', title: 'Seed' } }).returning();
    const [acct] = await db.insert(S.socialAccounts).values({ businessId: bid, ch: 'x', remoteId: `x-${tag}`, name: 'Seed', handle: 'seed', tokensEnc: encrypt({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3600e3, scope: '', stub: true }) }).returning();
    await db.insert(S.socialPubs).values({ businessId: bid, sid: `s:p-${tag}:x`, src: 'pack', platform: 'x', ch: 'x', acctId: acct.id, acctLabel: '@seed', status: 'posted', date: day, time: '09:00', dueAt: new Date(), remoteId: '1', createdBy: ownerId });
    await db.insert(S.visibilityPreferences).values({ businessId: bid, weeklyEmail: false });
    await db.insert(S.lifecycleGuideStates).values({ userId: ownerId, guideId: 'article_workflow', sourceBusinessId: bid, dueAt: new Date(Date.now() + 864e5) }).onConflictDoUpdate({ target: [S.lifecycleGuideStates.userId, S.lifecycleGuideStates.guideId], set: { sourceBusinessId: bid } });
    await db.insert(S.cronMarks).values([{ key: `gsc-inc:${bid}:${day}` }, { key: `kw-sugg:${bid}:${day}` }]).onConflictDoNothing();
    return { entryId, callId: call.id, eventId: event.id, acctId: acct.id, proposalId: proposal.id };
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
