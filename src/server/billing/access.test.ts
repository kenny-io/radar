// ownAccess / bizAccess / accessSummary / getMe / currentUser against a real Postgres (architecture §16.4). Skipped
// without DATABASE_URL. RADAR_BILLING is read at call time, so each test sets the flag it needs.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { Fixtures, type TUser } from '../testing/fixtures';
import { accessSummary, bizAccess, ownAccess } from './access';
import { setProviderNameForTests } from './config';
import { currentActor, currentGuest, currentUser, GUEST_COOKIE, SESSION_COOKIE } from '../auth/session';
import { BIZ_COOKIE, getMe } from '../auth/users';
import { SUB_STATUSES } from '@/lib/billing';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const flag = (v?: string) => { if (v == null) delete process.env.RADAR_BILLING; else process.env.RADAR_BILLING = v; };
afterEach(() => { flag(); delete process.env.RADAR_BILLING_GRANDFATHER_BEFORE; setProviderNameForTests(null); H.jar.clear(); });

describe.skipIf(!ON)('ownAccess and friends (database)', () => {
  let u: TUser; let guest: TUser;
  beforeAll(async () => { u = await F.user(); guest = await F.user({ guest: true }); });
  afterAll(() => F.cleanup());

  it('flag off → every real user has access; on → only trialing/active or comp', async () => {
    flag(); expect(await ownAccess(u)).toBe(true);
    flag('off'); expect(await ownAccess(u)).toBe(true);
    flag('on'); expect(await ownAccess(u)).toBe(false);
    for (const s of SUB_STATUSES) {
      await F.account(u.id, { status: s, comp: false });
      expect(await ownAccess(u), s).toBe(s === 'trialing' || s === 'active');
    }
    await F.account(u.id, { status: 'canceled', comp: true });
    expect(await ownAccess(u)).toBe(true);
    await F.account(u.id, { status: 'none', comp: false });
  });

  it('an email list enforces billing only for the listed accounts', async () => {
    const other = await F.user();
    flag(`someone@else.test, ${u.email.toUpperCase()}`);
    expect(await ownAccess(u)).toBe(false);
    expect(await ownAccess({ id: u.id })).toBe(false);          // looks the email up when it isn't given
    expect(await ownAccess(other)).toBe(true);
  });

  it('a guest never has own access, in every flag state', async () => {
    for (const v of [undefined, 'off', 'on', guest.email]) { flag(v); expect(await ownAccess(guest), String(v)).toBe(false); }
    await F.account(guest.id, { status: 'active', comp: true });   // even with a (bogus) granting row
    flag('on'); expect(await ownAccess(guest)).toBe(false);
  });

  it('billing on without any provider fails open (B19)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    flag('on'); setProviderNameForTests('none');
    expect(await ownAccess(u)).toBe(true);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('lazy grandfather: an owner of an active business created before the cutoff is comp, and the row is written', async () => {
    const old = await F.user(); const fresh = await F.user();
    await F.biz(old, { createdAt: new Date('2026-01-01T00:00:00Z') });
    await F.biz(fresh, { createdAt: new Date('2026-09-01T00:00:00Z') });
    flag('on');
    expect(await ownAccess(old)).toBe(false);                   // no cutoff → only migration rows count
    process.env.RADAR_BILLING_GRANDFATHER_BEFORE = '2026-06-01T00:00:00Z';
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(await ownAccess(old)).toBe(true);
    expect(await ownAccess(fresh)).toBe(false);                 // after the cutoff
    info.mockRestore();
    const row = (await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId, old.id)))[0];
    expect([row.comp, row.compReason]).toEqual([true, 'grandfather']);
    delete process.env.RADAR_BILLING_GRANDFATHER_BEFORE;
    expect(await ownAccess(old)).toBe(true);                    // the comp row now stands on its own
  });

  it('a member rides on the owner (D6); getMe never picks a locked business as current', async () => {
    const owner = await F.user(); const lapsed = await F.user(); const m = await F.user();
    const paid = await F.biz(owner); const locked = await F.biz(lapsed, { createdAt: new Date(Date.now() + 1000) });
    await F.member(paid.id, m); await F.member(locked.id, m);
    await F.account(owner.id, { status: 'trialing' }); await F.account(lapsed.id, { status: 'past_due' });
    flag('on');
    expect(await bizAccess(paid)).toBe(true);
    expect(await bizAccess(locked)).toBe(false);
    const s = await accessSummary(m.id);
    expect(s.own).toBe(false);
    expect(s.accessible).toEqual([paid.id]);
    expect(s.ownsActive).toBe(false);
    H.jar.set(BIZ_COOKIE, locked.id);
    const me = await getMe(m);
    expect(me.currentId).toBe(paid.id);
    expect(Object.fromEntries(me.businesses.map(b => [b.id, b.access]))).toEqual({ [paid.id]: true, [locked.id]: false });
    await F.account(owner.id, { status: 'canceled' });
    expect((await getMe(m)).currentId).toBeNull();
    flag();
    expect((await getMe(m)).businesses.every(b => b.access)).toBe(true);   // billing off: everything opens, as today
  });

  it('accessSummary reports the draft and does no billing reads with the flag off', async () => {
    const o = await F.user();
    const d = await F.biz(o, { status: 'onboarding', onboarding: { step: 'gsc', savedAt: '2026-10-25T10:00:00.000Z' }, site: { analyzedAt: '2026-10-25T09:00:00.000Z' } });
    const s = await accessSummary(o.id);
    expect(s).toMatchObject({ enforced: false, own: true, accessible: [], ownsActive: false, account: null });
    expect(s.draft).toMatchObject({ id: d.id, savedAt: '2026-10-25T10:00:00.000Z', summary: { name: 'Fieldnote', step: 'gsc', analyzed: true } });
  });

  it('currentUser() never returns a guest: not from radar_guest, not for a guest row under radar_session', async () => {
    await F.signIn(guest, H.jar);                                 // radar_guest
    expect(await currentUser()).toBeNull();
    expect((await currentGuest())?.id).toBe(guest.id);
    expect(await currentActor()).toMatchObject({ id: guest.id, guest: true });
    H.jar.clear();
    await F.signIn(guest, H.jar, SESSION_COOKIE);                 // a guest row behind the user cookie
    expect(await currentUser()).toBeNull();
    expect(await currentActor()).toBeNull();
    H.jar.clear();
    await F.signIn(u, H.jar, GUEST_COOKIE);                       // and a real user can't pose as a guest
    expect(await currentGuest()).toBeNull();
    H.jar.clear();
    await F.signIn(u, H.jar);
    expect(await currentActor()).toMatchObject({ id: u.id, guest: false });
  });
});
