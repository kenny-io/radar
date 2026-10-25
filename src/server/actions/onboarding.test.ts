// onboarding.save / step / finish and POST /api/b (architecture §16.8), through the real route handlers.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { encrypt } from '../crypto';
import { Fixtures, uniq, type TUser } from '../testing/fixtures';
import { GUEST_COOKIE } from '../auth/session';
import { POST as ACT } from '@/app/api/b/[bid]/act/route';
import { POST as CREATE } from '@/app/api/b/route';
import { POST as SIGNUP } from '@/app/api/auth/signup/route';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const S = schema;
const act = async (bid: string, action: string, input: any = {}) => { const r = await ACT(new Request('http://t/act', { method: 'POST', body: JSON.stringify({ action, input }) }), { params: Promise.resolve({ bid }) }); return { status: r.status, j: await r.json() }; };
const create = async (domain: string, ip = '10.9.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250)) => { const r = await CREATE(new Request('http://t/api/b', { method: 'POST', body: JSON.stringify({ domain }), headers: { 'x-forwarded-for': ip } })); return { status: r.status, j: await r.json() }; };
const biz = async (bid: string) => (await db.select().from(S.businesses).where(eq(S.businesses.id, bid)))[0];
const onboarded = async (bid: string) => (await db.select().from(S.events).where(and(eq(S.events.businessId, bid), eq(S.events.kind, 'business.onboarded')))).length;
const as = async (u: TUser) => { H.jar.clear(); await F.signIn(u, H.jar); };
afterEach(() => { delete process.env.RADAR_BILLING; H.jar.clear(); });

describe.skipIf(!ON)('onboarding actions (database)', () => {
  afterAll(() => F.cleanup());

  it('save without access does not commit: a guest goes to /signup, a user to /start-trial', async () => {
    process.env.RADAR_BILLING = 'on';
    const g = await F.user({ guest: true }); await as(g);
    const gd = await F.biz(g, { status: 'onboarding' });
    const r = await act(gd.id, 'onboarding.save', { tz: 'Europe/Berlin' });
    expect(r.j.data).toEqual({ committed: false, next: '/signup', id: gd.id });
    expect((await biz(gd.id)).onboarding).toMatchObject({ step: 'save', tz: 'Europe/Berlin' });
    expect(typeof (await biz(gd.id)).onboarding.savedAt).toBe('string');
    expect(r.j.workspace.onboarding).toMatchObject({ step: 'save', tz: 'Europe/Berlin' });   // Workspace.onboarding
    const u = await F.user(); await as(u);
    const ud = await F.biz(u, { status: 'onboarding' });
    expect((await act(ud.id, 'onboarding.save', { tz: 'Nope/Zone' })).j.data).toEqual({ committed: false, next: '/start-trial', id: ud.id });
    expect((await biz(ud.id)).onboarding.tz).toBeUndefined();                                  // an invalid zone is ignored
    expect((await biz(ud.id)).status).toBe('onboarding');
  });

  it('a guest’s save with the flag off still goes to /signup; after signup the claim commits it', async () => {
    const g = await F.user({ guest: true }); await as(g);
    const d = await F.biz(g, { status: 'onboarding' });
    expect((await act(d.id, 'onboarding.save', { tz: 'America/Denver' })).j.data).toEqual({ committed: false, next: '/signup', id: d.id });
    expect((await biz(d.id)).status).toBe('onboarding');
    const email = `ob-${uniq()}@test.local`;
    const r = await SIGNUP(new Request('http://t/s', { method: 'POST', body: JSON.stringify({ name: 'Ada', email, password: 'longenough1' }) }));
    const u = (await db.select().from(S.users).where(eq(S.users.email, email)))[0]; F.track(u.id);
    expect(await r.json()).toEqual({ ok: true, next: '/dashboard?saved=profile' });
    const b = await biz(d.id);
    expect([b.status, b.ownerId, b.timezone]).toEqual(['active', u.id, 'America/Denver']);
    expect(await onboarded(d.id)).toBe(1);
  });

  it('with access save commits, business.onboarded is tracked once, and finish is an alias', async () => {
    process.env.RADAR_BILLING = 'on';
    const u = await F.user(); await F.account(u.id, { status: 'trialing' }); await as(u);
    const d = await F.biz(u, { status: 'onboarding' });
    expect((await act(d.id, 'onboarding.save', { tz: 'Asia/Tokyo' })).j.data).toEqual({ committed: true, next: '/dashboard', id: d.id });
    const b = await biz(d.id);
    expect([b.status, b.timezone]).toEqual(['active', 'Asia/Tokyo']);
    expect((await db.select().from(S.gscConnections).where(eq(S.gscConnections.businessId, d.id)))[0].status).toBe('skipped');
    expect((await act(d.id, 'onboarding.finish', { tz: 'UTC' })).j.data).toEqual({ committed: false, next: '/dashboard', id: d.id });
    expect(await onboarded(d.id)).toBe(1);
    const d2 = await F.biz(u, { status: 'onboarding' });
    expect((await act(d2.id, 'onboarding.finish', {})).j.data).toMatchObject({ committed: true, next: '/dashboard' });
    delete process.env.RADAR_BILLING;                                                           // flag off: a user's save commits, as today
    const d3 = await F.biz(u, { status: 'onboarding' });
    expect((await act(d3.id, 'onboarding.save', {})).j.data).toMatchObject({ committed: true });
  });

  it('onboarding.step persists; Owner only', async () => {
    const u = await F.user(); await as(u);
    const d = await F.biz(u, { status: 'onboarding' });
    await act(d.id, 'onboarding.step', { step: 'gsc' });
    expect((await biz(d.id)).onboarding).toEqual({ step: 'gsc' });
    expect((await act(d.id, 'onboarding.step', { step: 'domain' })).status).toBe(400);
  });

  it('POST /api/b: no session creates a guest; same domain keeps Search Console; another domain clears it, the crawl and the state', async () => {
    const domain = `ob-${uniq()}.test`;
    const r = await create(domain);
    expect(r.status).toBe(200);
    expect(r.j).toMatchObject({ ok: true, guest: true });
    expect(H.jar.has(GUEST_COOKIE)).toBe(true);
    const id = r.j.id; const b = await biz(id); F.track(b.ownerId);
    const owner = (await db.select().from(S.users).where(eq(S.users.id, b.ownerId)))[0];
    expect([owner.guest, owner.name, owner.email.endsWith('@guest.radar.invalid')]).toEqual([true, '', true]);
    await db.insert(S.gscConnections).values({ businessId: id, status: 'none', tokensEnc: encrypt({ stub: true }) });
    await db.insert(S.crawlPages).values({ businessId: id, url: `https://${domain}/`, path: '/' });
    await db.update(S.businesses).set({ onboarding: { step: 'gsc' }, edited: { 'business.name': true } }).where(eq(S.businesses.id, id));
    const same = await create(domain.toUpperCase());
    expect(same.j).toEqual({ ok: true, id, guest: true });                                      // same browser → same draft
    expect(await db.select().from(S.gscConnections).where(eq(S.gscConnections.businessId, id))).toHaveLength(1);
    expect((await biz(id)).edited).toEqual({});
    expect((await biz(id)).onboarding).toEqual({ step: 'gsc' });
    const other = await create(`other-${domain}`);
    expect(other.j.id).toBe(id);
    expect(await db.select().from(S.gscConnections).where(eq(S.gscConnections.businessId, id))).toHaveLength(0);
    expect(await db.select().from(S.crawlPages).where(eq(S.crawlPages.businessId, id))).toHaveLength(0);
    expect((await biz(id))).toMatchObject({ domain: `other-${domain}`, onboarding: {} });
    expect((await create('not a domain')).status).toBe(400);
  });

  it('POST /api/b for a signed-in user creates their draft, never a guest', async () => {
    const u = await F.user(); await as(u);
    const r = await create(`u-${uniq()}.test`);
    expect(r.j.guest).toBe(false);
    expect((await biz(r.j.id)).ownerId).toBe(u.id);
    expect(H.jar.has(GUEST_COOKIE)).toBe(false);
  });
});
