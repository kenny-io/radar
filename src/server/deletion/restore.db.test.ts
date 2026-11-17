// Restore a deleted business (RES-1..4, E-2), driven through the real route handlers on a real database.
// Skipped without DATABASE_URL.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { Fixtures, uniq, type TUser } from '../testing/fixtures';
import { BIZ_COOKIE } from '../auth/users';
import { listDeleted, restoreBusiness } from './index';
import { POST as DELETE } from '@/app/api/b/[bid]/delete/route';
import { POST as RESTORE } from '@/app/api/b/restore/route';
import { GET as WORKSPACE } from '@/app/api/b/[bid]/workspace/route';
import { GET as ME } from '@/app/api/me/route';
import { addDays, todayIn } from '@/lib/format';
import type { Me, RestoreBusinessResult } from '@/lib/types';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const B = schema.businesses; const E = schema.calendarEntries; const P = schema.socialPubs; const J = schema.jobs;
const DAY = 864e5;
const p = (bid: string) => ({ params: Promise.resolve({ bid }) });
const post = (body: unknown, headers: Record<string, string> = {}) => new Request('http://t/api', { method: 'POST', body: JSON.stringify(body), headers });
const del = (bid: string, domain: string) => DELETE(post({ domain }), p(bid));
const restore = (id: unknown, headers: Record<string, string> = {}) => RESTORE(post({ id }, headers));
const as = async (u: TUser) => { H.jar.clear(); await F.signIn(u, H.jar); };
const code = async (r: Response) => [r.status, (await r.clone().json().catch(() => ({}))).code];
const row = async (bid: string) => (await db.select().from(B).where(eq(B.id, bid)))[0];
const me = async (): Promise<Me> => (await ME()).json();
const restoredOk = async (r: Response): Promise<RestoreBusinessResult> => { expect(r.status).toBe(200); const j = await r.json(); expect(j.ok).toBe(true); return j.data; };
const gone = async (owner: TUser, o: Parameters<Fixtures['biz']>[1] = {}) => F.biz(owner, { status: 'deleted', ...o });
afterEach(() => { delete process.env.RADAR_BILLING; H.jar.clear(); });

const entry = (bid: string, status: string, date: string, o: Partial<typeof E.$inferInsert> = {}) =>
  ({ id: `e-${uniq()}`, businessId: bid, title: `T ${status} ${date}`, kw: 'kw', type: 'Guide', date, status, ...o });
const pub = (bid: string, status: 'scheduled' | 'sending' | 'posted' | 'failed', dueAt: Date, o: Partial<typeof P.$inferInsert> = {}) =>
  ({ businessId: bid, sid: `s-${uniq()}`, src: 'pack' as const, platform: 'x' as const, ch: 'x' as const, acctLabel: '@fieldnote', status, date: '2026-11-16', time: '09:00', dueAt, ...o });

describe.skipIf(!ON)('restore a deleted business (database)', () => {
  afterAll(() => F.cleanup());

  it('restore brings back the same business: row, members and roles, entries, articles and scheduled posts (RES-2)', async () => {
    const owner = await F.user(); const admin = await F.user(); const viewer = await F.user();
    const biz = await F.biz(owner); await F.member(biz.id, admin, 'Admin'); await F.member(biz.id, viewer, 'Viewer');
    const future = addDays(todayIn(biz.timezone), 3);
    const [scheduled] = await db.insert(E).values([entry(biz.id, 'scheduled', future, { autopilotActivationId: 'act-1' }), entry(biz.id, 'approved', future), entry(biz.id, 'published', addDays(future, -30), { publishedUrl: 'https://b.test/p' })]).returning();
    await db.insert(schema.articles).values({ entryId: scheduled.id, businessId: biz.id, data: { generated: true, body: [{ t: 'p', text: 'Hello' }] } });
    await db.insert(P).values([pub(biz.id, 'scheduled', new Date(Date.now() + 2 * DAY), { autopilotActivationId: 'act-1' }), pub(biz.id, 'posted', new Date(Date.now() - 9 * DAY), { remoteId: '1' })]);
    const dump = async () => ({
      biz: (({ status, deletedAt, purgeAt, rev, updatedAt, ...rest }) => rest)(await row(biz.id)),
      members: await db.select().from(schema.members).where(eq(schema.members.businessId, biz.id)).orderBy(asc(schema.members.email)),
      entries: await db.select().from(E).where(eq(E.businessId, biz.id)).orderBy(asc(E.id)),
      articles: await db.select().from(schema.articles).where(eq(schema.articles.businessId, biz.id)),
      pubs: await db.select().from(P).where(eq(P.businessId, biz.id)).orderBy(asc(P.sid)),
    });
    const before = await dump();

    await as(owner);
    expect((await del(biz.id, biz.domain)).status).toBe(200);
    expect(await dump()).toEqual(before);              // a delete removes and rewrites nothing
    const data = await restoredOk(await restore(biz.id));
    expect(data).toEqual({ id: biz.id, name: 'Fieldnote', open: true });
    expect(await dump()).toEqual(before);              // and everything dated in the future is exactly as it was
    expect(await row(biz.id)).toMatchObject({ status: 'active', deletedAt: null, purgeAt: null, rev: biz.rev + 2 });

    expect(H.jar.get(BIZ_COOKIE)).toBe(biz.id);
    const m = await me();
    expect(m).toMatchObject({ currentId: biz.id, deleted: [] });
    expect(m.businesses.map(b => b.id)).toEqual([biz.id]);
    for (const u of [owner, admin, viewer]) { await as(u); expect((await WORKSPACE(new Request('http://t/w'), p(biz.id))).status).toBe(200); }
  });

  it('restore moves overdue scheduled and all publishing entries to review, drafting to approved, overdue undrafted approved to proposed, and leaves future entries alone (RES-2)', async () => {
    const owner = await F.user(); await as(owner);
    const biz = await gone(owner);
    await db.update(B).set({ blog: { time: '00:00' } }).where(eq(B.id, biz.id));   // so "today" is already due at any hour
    const today = todayIn(biz.timezone); const past = addDays(today, -2); const future = addDays(today, 2);
    const rows = await db.insert(E).values([
      entry(biz.id, 'scheduled', past, { autopilotActivationId: 'act-1' }),          // 0 → review, activation cleared
      entry(biz.id, 'scheduled', today, { autopilotActivationId: 'act-1' }),         // 1 → review (its publish time has passed)
      entry(biz.id, 'scheduled', future, { autopilotActivationId: 'act-1' }),        // 2 untouched
      entry(biz.id, 'publishing', future, { publishRemote: { connId: 'c', id: 'r1' } }),   // 3 → review, remote draft kept
      entry(biz.id, 'publishing', past),                                             // 4 → review
      entry(biz.id, 'drafting', future),                                             // 5 → approved
      entry(biz.id, 'drafting', past, { autopilotActivationId: 'act-1' }),           // 6 → approved → proposed (overdue, never written)
      entry(biz.id, 'approved', past, { autopilotActivationId: 'act-1' }),           // 7 → proposed, activation cleared
      entry(biz.id, 'approved', past),                                               // 8 stays: its article is written
      entry(biz.id, 'approved', past),                                               // 9 → proposed: only an outline exists
      entry(biz.id, 'approved', future, { autopilotActivationId: 'act-1' }),         // 10 untouched
      entry(biz.id, 'review', past),                                                 // 11 untouched
      entry(biz.id, 'proposed', past),                                               // 12 untouched
      entry(biz.id, 'published', past, { publishedUrl: 'https://b.test/x' }),        // 13 untouched
    ]).returning();
    await db.insert(schema.articles).values([
      { entryId: rows[8].id, businessId: biz.id, data: { generated: true, body: [] } },
      { entryId: rows[9].id, businessId: biz.id, data: { generated: false, body: [] } },
    ]);
    // The same states in the owner's other business must not move.
    const other = await F.biz(owner);
    const [otherScheduled, otherDrafting] = await db.insert(E).values([entry(other.id, 'scheduled', past), entry(other.id, 'drafting', past)]).returning();

    await restoredOk(await restore(biz.id));

    const now = new Map((await db.select().from(E).where(eq(E.businessId, biz.id))).map(r => [r.id, r]));
    const state = (i: number) => { const r = now.get(rows[i].id)!; return [r.status, r.autopilotActivationId]; };
    expect(state(0)).toEqual(['review', null]);
    expect(state(1)).toEqual(['review', null]);
    expect(state(2)).toEqual(['scheduled', 'act-1']);
    expect(state(3)).toEqual(['review', null]);
    expect(now.get(rows[3].id)!.publishRemote).toEqual({ connId: 'c', id: 'r1' });
    expect(state(4)).toEqual(['review', null]);
    expect(state(5)).toEqual(['approved', null]);
    expect(state(6)).toEqual(['proposed', null]);
    expect(state(7)).toEqual(['proposed', null]);
    expect(state(8)).toEqual(['approved', null]);
    expect(state(9)).toEqual(['proposed', null]);
    expect(state(10)).toEqual(['approved', 'act-1']);
    expect(state(11)).toEqual(['review', null]);
    expect(state(12)).toEqual(['proposed', null]);
    expect(state(13)).toEqual(['published', null]);
    // Nothing is left that the publishing scheduler or the drafting cron would pick up for a date that has passed.
    const late = [...now.values()].filter(r => String(r.date) <= today && (r.status === 'scheduled' || r.status === 'publishing' || r.status === 'drafting' || (r.status === 'approved' && r.id !== rows[8].id)));
    expect(late).toEqual([]);
    expect((await db.select().from(E).where(eq(E.id, otherScheduled.id)))[0].status).toBe('scheduled');
    expect((await db.select().from(E).where(eq(E.id, otherDrafting.id)))[0].status).toBe('drafting');
  });

  it('an entry dated today is left scheduled while the blog’s publish time is still ahead (RES-2)', async () => {
    const owner = await F.user(); await as(owner);
    // These zones are 11 to 14 hours apart, so at any moment at least one of them is well before 23:59.
    const ahead = (['Pacific/Pago_Pago', 'Pacific/Kiritimati', 'UTC'] as const).find(tz => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()) < '22')!;
    const biz = await gone(owner);
    await db.update(B).set({ timezone: ahead, blog: { time: '23:59' } }).where(eq(B.id, biz.id));
    const today = todayIn(ahead);
    const [todays, yesterdays] = await db.insert(E).values([entry(biz.id, 'scheduled', today), entry(biz.id, 'scheduled', addDays(today, -1))]).returning();
    await restoredOk(await restore(biz.id));
    expect((await db.select().from(E).where(eq(E.id, todays.id)))[0].status).toBe('scheduled');
    expect((await db.select().from(E).where(eq(E.id, yesterdays.id)))[0].status).toBe('review');
  });

  it('restore fails overdue scheduled posts and unfinished sends as stale, leaves future ones scheduled, and closes jobs queued meanwhile (RES-2)', async () => {
    const owner = await F.user(); await as(owner);
    const biz = await gone(owner); const other = await F.biz(owner);
    const past = new Date(Date.now() - 3 * 3600e3); const future = new Date(Date.now() + 3 * 3600e3);
    const rows = await db.insert(P).values([
      pub(biz.id, 'scheduled', past, { retryAt: new Date(Date.now() + 60e3), autopilotActivationId: 'act-1' }),   // 0 → failed stale
      pub(biz.id, 'scheduled', past, { platform: 'linkedin', ch: 'li_page' }),               // 1 → failed stale
      pub(biz.id, 'scheduled', future),                                                      // 2 untouched
      pub(biz.id, 'sending', past, { stage: 'media', claimedAt: past, attempts: 1 }),        // 3 → failed stale (never reached the platform)
      pub(biz.id, 'sending', past, { stage: null, claimedAt: past, attempts: 1 }),           // 4 → failed stale (claimed, nothing sent)
      pub(biz.id, 'sending', past, { stage: 'create', claimedAt: past, attempts: 1 }),       // 5 untouched: unknown outcome, the publisher verifies it
      pub(biz.id, 'posted', past, { remoteId: 'r', postedAt: past }),                        // 6 untouched
      pub(biz.id, 'failed', past, { errCode: 'auth', err: 'X refused Radar’s access. Reconnect and try again.' }),   // 7 untouched
      pub(other.id, 'scheduled', past),                                                      // 8 another business: untouched
    ]).returning();
    const [strayJob, otherJob] = await db.insert(J).values([{ kind: 'test.noop', businessId: biz.id, status: 'queued' }, { kind: 'test.noop', businessId: other.id, status: 'queued' }]).returning();

    await restoredOk(await restore(biz.id));

    const now = async (i: number) => (await db.select().from(P).where(eq(P.id, rows[i].id)))[0];
    for (const i of [0, 1, 3, 4]) expect(await now(i)).toMatchObject({ status: 'failed', errCode: 'stale', err: 'It couldn’t go out on time, so Radar held it back.', stage: null, retryAt: null });
    expect(await now(2)).toMatchObject({ status: 'scheduled', errCode: null, err: null });
    expect(await now(5)).toMatchObject({ status: 'sending', stage: 'create', errCode: null });
    expect(await now(6)).toMatchObject({ status: 'posted', remoteId: 'r' });
    expect(await now(7)).toMatchObject({ status: 'failed', errCode: 'auth' });
    expect(await now(8)).toMatchObject({ status: 'scheduled', errCode: null });
    // The publisher picks `scheduled` rows that are due: none is left for this business.
    expect(await db.select({ id: P.id }).from(P).where(and(eq(P.businessId, biz.id), eq(P.status, 'scheduled'), sql`${P.dueAt} <= now()`))).toEqual([]);
    expect((await db.select().from(J).where(eq(J.id, strayJob.id)))[0]).toMatchObject({ status: 'done', result: { skipped: 'deleted' } });
    expect((await db.select().from(J).where(eq(J.id, otherJob.id)))[0]).toMatchObject({ status: 'queued', result: null });
  });

  it('an Admin of the business and the owner of another account cannot restore; nobody signed out, cross-site or a guest gets in (RES-3)', async () => {
    const owner = await F.user(); const admin = await F.user(); const outsider = await F.user(); await F.biz(outsider);
    const biz = await gone(owner); await F.member(biz.id, admin, 'Admin');
    const refusedAsMissing = async (r: Response) => { expect(await code(r)).toEqual([404, 'restore_not_found']); expect((await r.json()).error).toBe('This business can’t be restored. It may already be wiped.'); };
    for (const u of [admin, outsider]) {
      await as(u);
      await refusedAsMissing(await restore(biz.id));
      expect(await listDeleted(u.id)).toEqual([]);
    }
    H.jar.clear();
    expect(await code(await restore(biz.id))).toEqual([401, 'unauthorized']);
    const guest = await F.user({ guest: true }); await as(guest);
    expect(await code(await restore(biz.id))).toEqual([401, 'unauthorized']);
    await as(owner);
    expect(await code(await restore(biz.id, { 'sec-fetch-site': 'cross-site' }))).toEqual([403, 'forbidden']);
    // The same answer for an id that does not exist, is not an id, or is the owner's unfinished draft.
    const draft = await F.biz(owner, { status: 'onboarding' });
    for (const id of ['00000000-0000-4000-8000-000000000000', 'not-an-id', '', draft.id]) await refusedAsMissing(await restore(id));
    expect(await code(await restore(42))).toEqual([400, 'invalid']);
    // The row's owner without an active Owner membership is refused too.
    const orphan = await gone(owner);
    await db.update(schema.members).set({ role: 'Admin' }).where(and(eq(schema.members.businessId, orphan.id), eq(schema.members.userId, owner.id)));
    await refusedAsMissing(await restore(orphan.id));
    for (const id of [biz.id, orphan.id]) expect((await row(id)).status).toBe('deleted');
    expect((await row(draft.id)).status).toBe('onboarding');
  });

  it('restore is refused once purgeAt has passed while the row still exists, and such a business is no longer listed (RES-3)', async () => {
    const owner = await F.user(); await as(owner);
    const longGone = await gone(owner, { deletedAt: new Date(Date.now() - 9 * DAY) });                       // window ended two days ago
    const justGone = await gone(owner, { deletedAt: new Date(Date.now() - 7 * DAY - 1000) });                // ended a second ago
    const stillIn = await gone(owner, { deletedAt: new Date(Date.now() - 7 * DAY + 3600e3) });               // an hour left
    await db.insert(E).values(entry(longGone.id, 'scheduled', addDays(todayIn(longGone.timezone), -3)));
    for (const b of [longGone, justGone]) {
      const r = await restore(b.id);
      expect(await code(r)).toEqual([410, 'restore_expired']);
      expect((await r.json()).error).toBe('This business can’t be restored. Its 7 days have passed.');
      await expect(restoreBusiness(owner.id, b.id)).rejects.toMatchObject({ status: 410, code: 'restore_expired' });
      expect(await row(b.id)).toMatchObject({ status: 'deleted', rev: b.rev });
    }
    // A refused restore settles nothing.
    expect((await db.select().from(E).where(eq(E.businessId, longGone.id)))[0].status).toBe('scheduled');
    expect((await listDeleted(owner.id)).map(d => d.id)).toEqual([stillIn.id]);
    expect((await me()).deleted.map(d => d.id)).toEqual([stillIn.id]);
    expect(await restoredOk(await restore(stillIn.id))).toMatchObject({ id: stillIn.id, open: true });
    expect(await listDeleted(owner.id)).toEqual([]);
  });

  it('restoring twice and two restores at once leave one active business (RES-4)', async () => {
    const owner = await F.user(); await as(owner);
    const biz = await gone(owner); const twin = await gone(owner);
    await restoredOk(await restore(biz.id));
    const again = await restoredOk(await restore(biz.id));
    expect(again).toEqual({ id: biz.id, name: 'Fieldnote', open: true });
    expect(await row(biz.id)).toMatchObject({ status: 'active', rev: biz.rev + 1, deletedAt: null, purgeAt: null });

    const both = await Promise.all([restore(twin.id), restore(twin.id), restoreBusiness(owner.id, twin.id)]);
    for (const r of both.slice(0, 2) as Response[]) expect(await restoredOk(r)).toEqual({ id: twin.id, name: 'Fieldnote', open: true });
    expect(both[2]).toEqual({ id: twin.id, name: 'Fieldnote', open: true });
    expect(await row(twin.id)).toMatchObject({ status: 'active', rev: twin.rev + 1 });
    const events = await db.select().from(schema.events).where(and(eq(schema.events.userId, owner.id), eq(schema.events.kind, 'action.business.restore')));
    expect(events.map(e => e.businessId).sort()).toEqual([biz.id, twin.id].sort());   // one per business, not per click
  });

  it('an owner with no subscription can restore, and the business comes back locked and is not made current (§3.4)', async () => {
    process.env.RADAR_BILLING = 'on';
    const lapsed = await F.user(); await F.account(lapsed.id, { status: 'canceled' });
    const paying = await F.user(); await F.account(paying.id, { status: 'active' });
    const locked = await gone(lapsed); const open = await gone(paying);
    await as(lapsed);
    expect(await restoredOk(await restore(locked.id))).toEqual({ id: locked.id, name: 'Fieldnote', open: false });
    expect((await row(locked.id)).status).toBe('active');
    expect(H.jar.has(BIZ_COOKIE)).toBe(false);
    expect(await code(await WORKSPACE(new Request('http://t/w'), p(locked.id)))).toEqual([402, 'subscription_required']);
    expect(await restoredOk(await restore(locked.id))).toMatchObject({ open: false });   // the repeat says the same
    await as(paying);
    expect(await restoredOk(await restore(open.id))).toEqual({ id: open.id, name: 'Fieldnote', open: true });
    expect(H.jar.get(BIZ_COOKIE)).toBe(open.id);
  });

  it('adding the same domain during the window makes a new business and the deleted one still restores (E-2)', async () => {
    const owner = await F.user(); await as(owner);
    const domain = `same-${F.tag}.test`;
    const first = await F.biz(owner, { domain, createdAt: new Date(Date.now() - 5 * DAY) });
    expect((await del(first.id, domain)).status).toBe(200);
    const second = await F.biz(owner, { domain });
    expect((await me()).businesses.map(b => b.id)).toEqual([second.id]);
    expect((await listDeleted(owner.id)).map(d => [d.id, d.domain])).toEqual([[first.id, domain]]);
    await restoredOk(await restore(first.id));
    const m = await me();
    expect(m.businesses.map(b => [b.id, b.domain, b.status])).toEqual([[first.id, domain, 'active'], [second.id, domain, 'active']]);
    expect(m.deleted).toEqual([]);
  });
});
