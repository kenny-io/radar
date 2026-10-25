// The API gate on act, workspace and events (architecture §4.4, §16.6, AC-G4), driven through the real route handlers.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { Fixtures, type TUser } from './testing/fixtures';
import { DRAFT_ACTIONS, gateBusiness } from './access';
import { POST as ACT } from '@/app/api/b/[bid]/act/route';
import { GET as WORKSPACE } from '@/app/api/b/[bid]/workspace/route';
import { GET as EVENTS } from '@/app/api/b/[bid]/events/route';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const p = (bid: string) => ({ params: Promise.resolve({ bid }) });
const act = (bid: string, action: string, input: any = {}) => ACT(new Request('http://t/api/b/x/act', { method: 'POST', body: JSON.stringify({ action, input }), headers: { 'x-forwarded-for': `10.${F.tag.length}.0.1` } }), p(bid));
const ws = (bid: string) => WORKSPACE(new Request('http://t/w'), p(bid));
async function ev(bid: string) { const ac = new AbortController(); const r = await EVENTS(new Request('http://t/e', { signal: ac.signal }), p(bid)); ac.abort(); return r; }
const as = async (u: TUser) => { H.jar.clear(); await F.signIn(u, H.jar); };
const code = async (r: Response) => [r.status, (await r.clone().json().catch(() => ({}))).code];
afterEach(() => { delete process.env.RADAR_BILLING; });

describe.skipIf(!ON)('API gate (database)', () => {
  let guest: TUser; let guest2: TUser; let user: TUser; let owner: TUser; let member: TUser;
  let gDraft: any; let g2Draft: any; let uDraft: any; let paid: any; let locked: any;
  beforeAll(async () => {
    guest = await F.user({ guest: true }); guest2 = await F.user({ guest: true }); user = await F.user(); owner = await F.user(); member = await F.user();
    gDraft = await F.biz(guest, { status: 'onboarding' }); g2Draft = await F.biz(guest2, { status: 'onboarding' });
    uDraft = await F.biz(user, { status: 'onboarding' });
    paid = await F.biz(owner); await F.account(owner.id, { status: 'active' }); await F.member(paid.id, member, 'Viewer');
    locked = await F.biz(user);
  });
  afterAll(() => F.cleanup());

  it('a guest on its own draft passes the gate for every DRAFT_ACTIONS entry; anything else is 402', async () => {
    process.env.RADAR_BILLING = 'on';
    for (const a of DRAFT_ACTIONS) await expect(gateBusiness({ ...guest, guest: true }, gDraft.id, { action: a })).resolves.toMatchObject({ id: gDraft.id });
    await as(guest);
    expect(await code(await act(gDraft.id, 'onboarding.step', { step: 'review' }))).toEqual([200, undefined]);
    expect(await code(await act(gDraft.id, 'profile.reanalyze'))).toEqual([402, 'subscription_required']);
    expect(await code(await act(gDraft.id, 'calendar.generate'))).toEqual([402, 'subscription_required']);
    expect((await ws(gDraft.id)).status).toBe(200);
    expect((await ev(gDraft.id)).status).toBe(200);
  });

  it('with the flag off a guest is still held to the allowlist', async () => {
    await as(guest);
    expect(await code(await act(gDraft.id, 'profile.reanalyze'))).toEqual([402, 'subscription_required']);
    expect(await code(await act(gDraft.id, 'onboarding.step', { step: 'gsc' }))).toEqual([200, undefined]);
  });

  it('a guest gets 404 on another guest’s draft and on any active business (act, workspace, events)', async () => {
    await as(guest);
    for (const bid of [g2Draft.id, paid.id, uDraft.id]) {
      expect((await act(bid, 'onboarding.step', { step: 'review' })).status).toBe(404);
      expect((await ws(bid)).status).toBe(404);
      expect((await ev(bid)).status).toBe(404);
    }
  });

  it('a signed-up user without access: allowlist on their own draft, 402 on their active business', async () => {
    process.env.RADAR_BILLING = 'on';
    await as(user);
    expect(await code(await act(uDraft.id, 'onboarding.step', { step: 'review' }))).toEqual([200, undefined]);
    expect(await code(await act(uDraft.id, 'profile.reanalyze'))).toEqual([402, 'subscription_required']);
    expect(await code(await act(locked.id, 'feature.request', { text: 'x' }))).toEqual([402, 'subscription_required']);
    expect(await code(await ws(locked.id))).toEqual([402, 'subscription_required']);
    expect(await code(await ev(locked.id))).toEqual([402, 'subscription_required']);
    delete process.env.RADAR_BILLING;                                   // flag off: today's behaviour
    expect((await ws(locked.id)).status).toBe(200);
  });

  it('a member of a paid business passes; another user’s draft is 404 even for a member of nothing', async () => {
    process.env.RADAR_BILLING = 'on';
    await as(member);
    expect((await ws(paid.id)).status).toBe(200);
    expect((await ev(paid.id)).status).toBe(200);
    expect((await ws(uDraft.id)).status).toBe(404);
  });

  it('no session at all → 401', async () => {
    H.jar.clear();
    expect((await ws(paid.id)).status).toBe(401);
    expect((await act(paid.id, 'job.get', { id: '00000000-0000-0000-0000-000000000000' })).status).toBe(401);
  });
});
