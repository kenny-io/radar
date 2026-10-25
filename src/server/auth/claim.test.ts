// Claim of the anonymous draft at signup, signin and Google sign-in (architecture §6, §16.7, AC-G5), through the real
// route handlers with an in-memory cookie jar. Skipped without DATABASE_URL.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { encrypt, randomToken } from '../crypto';
import { Fixtures, uniq, type TUser } from '../testing/fixtures';
import { GUEST_COOKIE, SESSION_COOKIE, hashPassword } from './session';
import { claimGuest } from './claim';
import { POST as SIGNUP } from '@/app/api/auth/signup/route';
import { POST as SIGNIN } from '@/app/api/auth/signin/route';
import { GET as GOOGLE } from '@/app/api/auth/google/callback/route';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const post = (fn: any, body: any) => fn(new Request('http://t/api/auth', { method: 'POST', body: JSON.stringify(body) }));
const S = schema;
afterEach(() => { delete process.env.RADAR_BILLING; H.jar.clear(); });

/** A guest in this browser with an analysed, edited draft and a stub Search Console connection. */
async function guestWithDraft(o: { saved?: boolean } = {}) {
  const g = await F.user({ guest: true });
  await F.signIn(g, H.jar);
  const d = await F.biz(g, { status: 'onboarding', domain: `claim-${uniq()}.test`, profile: { business: { name: 'Fieldnote', positioning: 'Edited by hand' }, brand: { primary: '#123456', secondary: '#654321' } },
    edited: { 'business.positioning': true, 'keywords.list': true }, site: { analyzedAt: new Date().toISOString() }, onboarding: o.saved ? { step: 'save', savedAt: new Date().toISOString() } : { step: 'gsc' } });
  await db.insert(S.gscConnections).values({ businessId: d.id, status: 'connected', property: 'sc-domain:fieldnote.app', tokensEnc: encrypt({ stub: true }) });
  await db.insert(S.oauthStates).values({ state: randomToken(8), userId: g.id, businessId: d.id, provider: 'gsc' });
  await db.insert(S.events).values({ kind: 'action.onboarding.analyze', userId: g.id, businessId: d.id });
  return { g, d };
}
async function expectClaimed(bid: string, g: TUser, userId: string, email: string) {
  const b = (await db.select().from(S.businesses).where(eq(S.businesses.id, bid)))[0];
  expect(b.ownerId).toBe(userId);
  expect(b.edited).toEqual({ 'business.positioning': true, 'keywords.list': true });
  expect((b.profile as any).business.positioning).toBe('Edited by hand');
  const m = await db.select().from(S.members).where(eq(S.members.businessId, bid));
  expect(m.map(x => [x.userId, x.email, x.role])).toEqual([[userId, email.toLowerCase(), 'Owner']]);
  const gsc = (await db.select().from(S.gscConnections).where(eq(S.gscConnections.businessId, bid)))[0];
  expect([gsc.status, gsc.property, !!gsc.tokensEnc]).toEqual(['connected', 'sc-domain:fieldnote.app', true]);
  expect(await db.select().from(S.users).where(eq(S.users.id, g.id))).toHaveLength(0);          // guest deleted
  expect(await db.select().from(S.oauthStates).where(eq(S.oauthStates.userId, g.id))).toHaveLength(0);
  const ev = await db.select().from(S.events).where(and(eq(S.events.businessId, bid), eq(S.events.kind, 'action.onboarding.analyze')));
  expect(ev.map(e => e.userId)).toEqual([userId]);                                             // history moved to the user
  expect(H.jar.has(GUEST_COOKIE)).toBe(false);
  expect(H.jar.has(SESSION_COOKIE)).toBe(true);
}

describe.skipIf(!ON)('claim (database)', () => {
  afterAll(() => F.cleanup());

  it('signup by email claims the draft intact (edits, Edited flags, Search Console); journey A lands on /start-trial', async () => {
    process.env.RADAR_BILLING = 'on';
    const { g, d } = await guestWithDraft({ saved: true });
    const email = `claim-${uniq()}@test.local`;
    const r = await post(SIGNUP, { name: 'Ada', email, password: 'longenough1' });
    const j = await r.json();
    const u = (await db.select().from(S.users).where(eq(S.users.email, email)))[0]; F.track(u.id);
    expect(j).toEqual({ ok: true, next: '/start-trial' });
    await expectClaimed(d.id, g, u.id, email);
    expect((await db.select().from(S.businesses).where(eq(S.businesses.id, d.id)))[0].status).toBe('onboarding');
  });

  it('signin to an existing account claims it and replaces the account’s own old draft; with access a saved draft commits', async () => {
    process.env.RADAR_BILLING = 'on';
    const u = await F.user({ password: await hashPassword('longenough1') });
    await F.account(u.id, { status: 'active' });
    const old = await F.biz(u, { status: 'onboarding' });
    const { g, d } = await guestWithDraft({ saved: true });
    const r = await post(SIGNIN, { email: u.email.toUpperCase(), password: 'longenough1' });
    expect(await r.json()).toEqual({ ok: true, next: '/dashboard?saved=profile' });
    await expectClaimed(d.id, g, u.id, u.email);
    expect((await db.select().from(S.businesses).where(eq(S.businesses.id, d.id)))[0].status).toBe('active');
    expect(await db.select().from(S.businesses).where(eq(S.businesses.id, old.id))).toHaveLength(0);
    expect((await db.select().from(S.events).where(and(eq(S.events.userId, u.id), eq(S.events.kind, 'onboarding.draft_replaced'))))).toHaveLength(1);
  });

  it('Google sign-up claims it too (dev stub identity), and redirects to the server destination', async () => {
    const { g, d } = await guestWithDraft();
    const email = `g-${uniq()}@test.local`;
    const state = randomToken(8);
    await db.insert(S.oauthStates).values({ state, provider: 'google-signin', data: { next: '/' } });
    const r = await GOOGLE(new Request(`http://t/api/auth/google/callback?state=${state}&code=${encodeURIComponent('dev:' + email)}`));
    const u = (await db.select().from(S.users).where(eq(S.users.email, email)))[0]; F.track(u.id);
    expect(r.status).toBe(307);
    expect(new URL(r.headers.get('location')!).pathname).toBe('/onboarding');            // claimed but not saved yet
    await expectClaimed(d.id, g, u.id, email);
  });

  it('an invite next is honoured and the draft is still claimed', async () => {
    const { g, d } = await guestWithDraft({ saved: true });
    const email = `inv-${uniq()}@test.local`;
    const r = await post(SIGNUP, { name: 'Ada', email, password: 'longenough1', next: '/api/invites/tok123' });
    const u = (await db.select().from(S.users).where(eq(S.users.email, email)))[0]; F.track(u.id);
    expect(await r.json()).toEqual({ ok: true, next: '/api/invites/tok123' });
    await expectClaimed(d.id, g, u.id, email);
  });

  it('two concurrent claims of one guest: exactly one moves the draft', async () => {
    const { g, d } = await guestWithDraft();
    const a = await F.user(); const b = await F.user();
    const [ra, rb] = await Promise.all([claimGuest(g.id, a), claimGuest(g.id, b)]);
    expect([ra.claimed, rb.claimed].filter(Boolean)).toEqual([d.id]);
    const winner = ra.claimed ? a : b;
    expect((await db.select().from(S.businesses).where(eq(S.businesses.id, d.id)))[0].ownerId).toBe(winner.id);
  });

  it('nothing is claimed when signup fails, and a guest email can’t sign up', async () => {
    const { g, d } = await guestWithDraft();
    const taken = await F.user();
    expect((await post(SIGNUP, { name: 'Ada', email: taken.email, password: 'longenough1' })).status).toBe(409);
    expect((await post(SIGNUP, { name: 'Ada', email: `x+1@guest.radar.invalid`, password: 'longenough1' })).status).toBe(400);
    expect((await post(SIGNIN, { email: g.email, password: 'whatever1' })).status).toBe(401);
    expect((await db.select().from(S.businesses).where(eq(S.businesses.id, d.id)))[0].ownerId).toBe(g.id);
    expect(H.jar.has(GUEST_COOKIE)).toBe(true);
  });

  it('a stale guest cookie (cleaned-up guest) is cleared and signup proceeds', async () => {
    H.jar.set(GUEST_COOKIE, 'gone');
    const email = `stale-${uniq()}@test.local`;
    const r = await post(SIGNUP, { name: 'Ada', email, password: 'longenough1' });
    const u = (await db.select().from(S.users).where(eq(S.users.email, email)))[0]; F.track(u.id);
    expect(await r.json()).toEqual({ ok: true, next: '/onboarding' });
    expect(H.jar.has(GUEST_COOKIE)).toBe(false);
  });
});
