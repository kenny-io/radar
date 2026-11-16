// Delete a business (DEL-1..4, DEL-6, DEL-8, E-1), driven through the real route handlers on a real database.
// Skipped without DATABASE_URL.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { Fixtures, type TUser } from '../testing/fixtures';
import { gateBusiness, requireRole } from '../access';
import { BIZ_COOKIE } from '../auth/users';
import { deleteBusiness, isBusinessDeleted, listDeleted } from './index';
import { POST as DELETE } from '@/app/api/b/[bid]/delete/route';
import { POST as ACT } from '@/app/api/b/[bid]/act/route';
import { GET as WORKSPACE } from '@/app/api/b/[bid]/workspace/route';
import { GET as EVENTS } from '@/app/api/b/[bid]/events/route';
import { GET as MEDIA } from '@/app/api/b/[bid]/media/route';
import { POST as SUPPORT } from '@/app/api/b/[bid]/support/route';
import { POST as CURRENT } from '@/app/api/b/current/route';
import { GET as ME } from '@/app/api/me/route';
import type { DeleteBusinessResult, Me } from '@/lib/types';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const B = schema.businesses; const J = schema.jobs;
const HOURS_168 = 168 * 3600e3;
const p = (bid: string) => ({ params: Promise.resolve({ bid }) });
const post = (body: unknown, headers: Record<string, string> = {}) => new Request('http://t/api', { method: 'POST', body: JSON.stringify(body), headers });
const del = (bid: string, domain: unknown, headers: Record<string, string> = {}) => DELETE(post({ domain }, headers), p(bid));
const as = async (u: TUser) => { H.jar.clear(); await F.signIn(u, H.jar); };
const code = async (r: Response) => [r.status, (await r.clone().json().catch(() => ({}))).code];
const row = async (bid: string) => (await db.select().from(B).where(eq(B.id, bid)))[0];
const me = async (): Promise<Me> => (await ME()).json();
const deletedOk = async (r: Response): Promise<DeleteBusinessResult> => { expect(r.status).toBe(200); const j = await r.json(); expect(j.ok).toBe(true); return j.data; };
afterEach(() => { delete process.env.RADAR_BILLING; H.jar.clear(); });

describe.skipIf(!ON)('delete a business (database)', () => {
  afterAll(() => F.cleanup());

  it('an Admin, Editor or Viewer cannot delete; a non-member gets not found; nobody signed out, cross-site or a guest gets in (DEL-1)', async () => {
    const owner = await F.user(); const biz = await F.biz(owner);
    for (const role of ['Admin', 'Editor', 'Viewer'] as const) {
      const u = await F.user(); await F.member(biz.id, u, role); await as(u);
      expect(await code(await del(biz.id, biz.domain))).toEqual([403, 'forbidden']);
    }
    const stranger = await F.user(); await as(stranger);
    expect(await code(await del(biz.id, biz.domain))).toEqual([404, 'not_found']);
    H.jar.clear();
    expect(await code(await del(biz.id, biz.domain))).toEqual([401, 'unauthorized']);
    const guest = await F.user({ guest: true }); await as(guest);
    expect(await code(await del(biz.id, biz.domain))).toEqual([401, 'unauthorized']);
    await as(owner);
    expect(await code(await del(biz.id, biz.domain, { 'sec-fetch-site': 'cross-site' }))).toEqual([403, 'forbidden']);
    expect(await code(await del(biz.id, biz.domain, { origin: 'https://evil.test' }))).toEqual([403, 'forbidden']);
    expect((await row(biz.id)).status).toBe('active');
    // The module repeats the ownership check under the row lock, whatever the route let through.
    await expect(deleteBusiness(stranger.id, biz.id, { domain: biz.domain })).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(await row(biz.id)).toMatchObject({ status: 'active', deletedAt: null, purgeAt: null });
  });

  it('delete refuses a wrong domain and accepts the right one with spaces and in any case (DEL-2)', async () => {
    const owner = await F.user(); await as(owner);
    const biz = await F.biz(owner, { domain: `Shop-${F.tag}.Example.test` });
    for (const typed of ['', 'example.test', `www.${biz.domain}`, `https://${biz.domain}`, `${biz.domain}/`]) {
      const r = await del(biz.id, typed);
      expect(await code(r)).toEqual([400, 'domain_mismatch']);
      expect((await r.json()).error).toBe('That doesn’t match. Type the business’s domain to confirm.');
    }
    expect(await code(await del(biz.id, 42))).toEqual([400, 'invalid']);
    expect(await code(await DELETE(post({}), p(biz.id)))).toEqual([400, 'invalid']);
    expect(await row(biz.id)).toMatchObject({ status: 'active', deletedAt: null, purgeAt: null, rev: biz.rev });
    const data = await deletedOk(await del(biz.id, `  ${biz.domain.toUpperCase()}\n`));
    expect(data).toMatchObject({ id: biz.id, name: 'Fieldnote', domain: biz.domain });
    expect((await row(biz.id)).status).toBe('deleted');
  });

  it('delete sets purgeAt exactly 168 hours after deletedAt, on the database clock, and bumps the revision (DEL-3)', async () => {
    const owner = await F.user(); await as(owner); const biz = await F.biz(owner);
    const started = Date.now();
    const data = await deletedOk(await del(biz.id, biz.domain));
    const after = await row(biz.id);
    expect(after.status).toBe('deleted');
    expect(after.rev).toBe(biz.rev + 1);
    expect(after.purgeAt!.getTime() - after.deletedAt!.getTime()).toBe(HOURS_168);
    expect(Math.abs(after.deletedAt!.getTime() - started)).toBeLessThan(60_000);
    expect(data.deletedAt).toBe(after.deletedAt!.toISOString());
    expect(data.purgeAt).toBe(after.purgeAt!.toISOString());
    // Postgres agrees to the microsecond, which the millisecond dates above cannot show.
    const exact = (await db.execute(sql`SELECT purge_at - deleted_at = interval '168 hours' AS exact FROM businesses WHERE id = ${biz.id}`)).rows[0] as { exact: boolean };
    expect(exact.exact).toBe(true);
    expect(await isBusinessDeleted(biz.id)).toBe(true);
  });

  it('the response names the owner’s next usable business and makes it current, or null when none is left (DEL-3, E-1)', async () => {
    process.env.RADAR_BILLING = 'on';
    const owner = await F.user(); await F.account(owner.id, { status: 'active' });
    const lapsed = await F.user();   // owns a business the deleting owner is a member of, with no subscription: locked
    const locked = await F.biz(lapsed, { createdAt: new Date(Date.now() - 9 * 864e5) }); await F.member(locked.id, owner, 'Admin');
    const first = await F.biz(owner, { createdAt: new Date(Date.now() - 5 * 864e5) });
    const second = await F.biz(owner, { createdAt: new Date(Date.now() - 3 * 864e5) });
    const third = await F.biz(owner, { createdAt: new Date(Date.now() - 1 * 864e5) });
    await F.biz(owner, { status: 'onboarding' });   // a draft is never "next"
    await as(owner); H.jar.set(BIZ_COOKIE, first.id);

    const one = await deletedOk(await del(first.id, first.domain));
    expect(one.nextId).toBe(second.id);              // the oldest usable one: not the locked membership, not the draft
    expect(H.jar.get(BIZ_COOKIE)).toBe(second.id);
    expect((await me()).currentId).toBe(second.id);

    expect((await deletedOk(await del(second.id, second.domain))).nextId).toBe(third.id);
    const last = await deletedOk(await del(third.id, third.domain));
    expect(last.nextId).toBeNull();
    expect(H.jar.get(BIZ_COOKIE)).toBe(third.id);    // left alone: getMe ignores an id that is not usable
    const m = await me();
    expect(m.currentId).toBeNull();
    expect(m.deleted.map(d => d.id)).toEqual([third.id, second.id, first.id]);   // newest delete first
    expect((await row(locked.id)).status).toBe('active');
  });

  it('after a delete the business is in nobody’s me.businesses and only in its owner’s me.deleted (DEL-4, RES-1)', async () => {
    const owner = await F.user(); const admin = await F.user();
    const biz = await F.biz(owner, { profile: { business: { name: 'Lived' }, brand: { logo: 'https://cdn.test/l.png', primary: '#112233', secondary: '#445566', voice: 'never sent' } } });
    const kept = await F.biz(owner); await F.member(biz.id, admin, 'Admin'); await F.member(kept.id, admin, 'Admin');
    await as(owner);
    expect((await me()).businesses.map(b => b.id).sort()).toEqual([biz.id, kept.id].sort());
    expect((await me()).deleted).toEqual([]);
    const data = await deletedOk(await del(biz.id, biz.domain));

    const mine = await me();
    expect(mine.businesses.map(b => b.id)).toEqual([kept.id]);
    expect(mine.deleted).toEqual([{ id: biz.id, name: 'Lived', domain: biz.domain, brand: { logo: 'https://cdn.test/l.png', primary: '#112233', secondary: '#445566' }, deletedAt: data.deletedAt, purgeAt: data.purgeAt }]);
    await as(admin);
    const theirs = await me();
    expect(theirs.businesses.map(b => b.id)).toEqual([kept.id]);
    expect(theirs.deleted).toEqual([]);
    expect(await listDeleted(admin.id)).toEqual([]);
  });

  it('after a delete workspace, act, events, media, support and "make current" answer 404 business_deleted for the owner and for a member (DEL-4)', async () => {
    const owner = await F.user(); const member = await F.user(); const stranger = await F.user();
    const biz = await F.biz(owner); await F.member(biz.id, member, 'Editor');
    await as(owner); await deletedOk(await del(biz.id, biz.domain));
    const calls: Array<() => Promise<Response>> = [
      () => WORKSPACE(new Request('http://t/w'), p(biz.id)),
      () => ACT(post({ action: 'job.get', input: { id: 'x' } }), p(biz.id)),
      () => ACT(post({ action: 'profile.update', input: {} }), p(biz.id)),
      () => EVENTS(new Request('http://t/e'), p(biz.id)),
      () => MEDIA(new Request('http://t/m?url=x'), p(biz.id)),
      () => SUPPORT(post({ message: 'help' }), p(biz.id)),
      () => CURRENT(post({ id: biz.id })),
    ];
    for (const u of [owner, member]) {
      await as(u);
      for (const call of calls) {
        const r = await call();
        expect(await code(r)).toEqual([404, 'business_deleted']);
        expect((await r.json()).error).toBe('Business wasn’t found.');
      }
      await expect(requireRole(biz.id, u.id, 'Viewer')).rejects.toMatchObject({ status: 404, code: 'business_deleted' });
      // The gate refuses it on its own too, for a caller that skipped requireRole.
      await expect(gateBusiness({ ...u, guest: false }, biz.id)).rejects.toMatchObject({ status: 404, code: 'business_deleted' });
    }
    // Someone who was never a member learns nothing: the ordinary not-found, as for an id that does not exist.
    await as(stranger);
    for (const call of calls) expect(await code(await call())).toEqual([404, 'not_found']);
  });

  it('delete closes the business’s queued jobs as skipped, forgets its pending OAuth flows, and touches no other business (DEL-5, DEL-6)', async () => {
    const owner = await F.user(); await as(owner); await F.account(owner.id, { status: 'active', stripeCustomerId: `cus_${F.tag}` });
    const biz = await F.biz(owner); const other = await F.biz(owner);
    const [queued, later, running, done, otherQueued] = await db.insert(J).values([
      { kind: 'test.noop', businessId: biz.id, status: 'queued', singletonKey: `t:${biz.id}` },
      { kind: 'test.noop', businessId: biz.id, status: 'queued', runAt: new Date(Date.now() + 864e5) },
      { kind: 'test.noop', businessId: biz.id, status: 'running', lockedAt: new Date(), lockedBy: 'w1' },
      { kind: 'test.noop', businessId: biz.id, status: 'done', result: { kept: true }, finishedAt: new Date() },
      { kind: 'test.noop', businessId: other.id, status: 'queued' },
    ]).returning();
    await db.insert(schema.oauthStates).values([
      { state: `s1-${F.tag}`, userId: owner.id, businessId: biz.id, provider: 'gsc' },
      { state: `s2-${F.tag}`, userId: owner.id, businessId: other.id, provider: 'gsc' },
    ]);
    const before = { other: await row(other.id), account: (await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId, owner.id)))[0] };

    await deletedOk(await del(biz.id, biz.domain));

    const job = async (id: string) => (await db.select().from(J).where(eq(J.id, id)))[0];
    for (const j of [queued, later]) {
      const now = await job(j.id);
      expect(now).toMatchObject({ status: 'done', result: { skipped: 'deleted' }, lockedAt: null });
      expect(now.finishedAt).toBeInstanceOf(Date);
    }
    expect(await job(running.id)).toMatchObject({ status: 'running', lockedBy: 'w1', result: null });   // left to the queue's own checks
    expect(await job(done.id)).toMatchObject({ status: 'done', result: { kept: true } });
    expect(await job(otherQueued.id)).toMatchObject({ status: 'queued', result: null, finishedAt: null });
    expect((await db.select({ state: schema.oauthStates.state }).from(schema.oauthStates).where(eq(schema.oauthStates.userId, owner.id))).map(r => r.state)).toEqual([`s2-${F.tag}`]);
    // The owner's other business and billing row are unchanged, field for field.
    expect(await row(other.id)).toEqual(before.other);
    expect((await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId, owner.id)))[0]).toEqual(before.account);
    expect(await isBusinessDeleted(other.id)).toBe(false);
  });

  it('a draft cannot be deleted, and a business locked for no subscription is refused with 402 (DEL-8)', async () => {
    const owner = await F.user(); await as(owner);
    const draft = await F.biz(owner, { status: 'onboarding' });
    const r = await del(draft.id, draft.domain);
    expect(await code(r)).toEqual([409, 'not_active']);
    expect((await r.json()).error).toBe('Only a business that is set up can be deleted here.');
    expect(await row(draft.id)).toMatchObject({ status: 'onboarding', deletedAt: null, purgeAt: null });

    process.env.RADAR_BILLING = 'on';
    const locked = await F.biz(owner);
    expect(await code(await del(locked.id, locked.domain))).toEqual([402, 'subscription_required']);
    expect((await row(locked.id)).status).toBe('active');
  });

  it('a second delete and two deletes at once leave one deletedAt (DEL-8)', async () => {
    const owner = await F.user(); await as(owner);
    const biz = await F.biz(owner); const twin = await F.biz(owner);
    const first = await deletedOk(await del(biz.id, biz.domain));
    // Later repeat through the route: the gate answers "already gone".
    expect(await code(await del(biz.id, biz.domain))).toEqual([404, 'business_deleted']);
    // A repeat that had already passed the gate (two clicks at once) gets the stored timestamps, whatever it typed.
    const again = await deleteBusiness(owner.id, biz.id, { domain: 'not-the-domain' });
    expect(again).toMatchObject({ id: biz.id, deletedAt: first.deletedAt, purgeAt: first.purgeAt });
    expect((await row(biz.id)).rev).toBe(biz.rev + 1);

    const both = await Promise.all([del(twin.id, twin.domain), del(twin.id, twin.domain), deleteBusiness(owner.id, twin.id, { domain: twin.domain })]);
    const after = await row(twin.id);
    expect(after.rev).toBe(twin.rev + 1);
    expect(after.purgeAt!.getTime() - after.deletedAt!.getTime()).toBe(HOURS_168);
    for (const r of both.slice(0, 2) as Response[]) {
      if (r.status === 200) expect((await r.json()).data.deletedAt).toBe(after.deletedAt!.toISOString());
      else expect(await code(r)).toEqual([404, 'business_deleted']);
    }
    expect((both[2] as DeleteBusinessResult).deletedAt).toBe(after.deletedAt!.toISOString());
    const events = await db.select().from(schema.events).where(and(eq(schema.events.userId, owner.id), eq(schema.events.kind, 'action.business.delete')));
    expect(events.map(e => e.businessId).sort()).toEqual([biz.id, twin.id].sort());   // one per business, not per click
  });

  it('the database refuses a deleted row without its timestamps, an active row with them, and a wipe time under 168 hours (PUR-4)', async () => {
    const owner = await F.user(); const biz = await F.biz(owner); const draft = await F.biz(owner, { status: 'onboarding' });
    const refused = (q: ReturnType<typeof sql>) => expect(db.execute(q)).rejects.toMatchObject({ cause: { constraint: 'businesses_deleted_check' } });
    await refused(sql`UPDATE businesses SET status = 'deleted' WHERE id = ${biz.id}`);
    await refused(sql`UPDATE businesses SET status = 'deleted', deleted_at = now() WHERE id = ${biz.id}`);
    await refused(sql`UPDATE businesses SET status = 'deleted', purge_at = now() + interval '168 hours' WHERE id = ${biz.id}`);
    await refused(sql`UPDATE businesses SET deleted_at = now(), purge_at = now() + interval '168 hours' WHERE id = ${biz.id}`);
    await refused(sql`UPDATE businesses SET purge_at = now() + interval '168 hours' WHERE id = ${draft.id}`);
    await refused(sql`UPDATE businesses SET status = 'deleted', deleted_at = now(), purge_at = now() WHERE id = ${biz.id}`);
    await refused(sql`UPDATE businesses SET status = 'deleted', deleted_at = now(), purge_at = now() + interval '167 hours 59 minutes 59.999999 seconds' WHERE id = ${biz.id}`);
    await refused(sql`UPDATE businesses SET status = 'deleted', deleted_at = now(), purge_at = now() - interval '1 hour' WHERE id = ${biz.id}`);
    expect(await row(biz.id)).toMatchObject({ status: 'active', deletedAt: null, purgeAt: null });
    // Exactly 168 hours is allowed, and so is a later wipe time; then the wipe time cannot be pulled in or removed.
    await db.execute(sql`UPDATE businesses SET status = 'deleted', deleted_at = now(), purge_at = now() + interval '168 hours' WHERE id = ${biz.id}`);
    await refused(sql`UPDATE businesses SET purge_at = purge_at - interval '1 second' WHERE id = ${biz.id}`);
    await refused(sql`UPDATE businesses SET purge_at = NULL WHERE id = ${biz.id}`);
    await refused(sql`UPDATE businesses SET status = 'active' WHERE id = ${biz.id}`);
    await db.execute(sql`UPDATE businesses SET purge_at = purge_at + interval '1 day' WHERE id = ${biz.id}`);
    expect((await row(biz.id)).status).toBe('deleted');
    // The fixture places a deleted row on either side of its window without breaking the rule.
    const past = await F.biz(owner, { status: 'deleted', deletedAt: new Date(Date.now() - 8 * 864e5) });
    expect(past.purgeAt!.getTime()).toBeLessThan(Date.now());
    expect(past.purgeAt!.getTime() - past.deletedAt!.getTime()).toBe(HOURS_168);
  });
});
