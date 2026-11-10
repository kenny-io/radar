// The activity signal on the database (IS-1) and the catch-up on return (IS-3), driven through the real route handlers:
// what counts as a member using the app, what never does, the hourly write, and the one AI visibility run a returning
// business gets.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { and, eq } from 'drizzle-orm';
import { db, schema } from './db';
import { env } from './env';
import { Fixtures, type TUser } from './testing/fixtures';
import { getBiz } from './workspace';
import { todayIn } from '@/lib/format';
import { TOUCH_EVERY_MS, touchActive } from './idle';
import { POST as ACT } from '@/app/api/b/[bid]/act/route';
import { GET as WORKSPACE } from '@/app/api/b/[bid]/workspace/route';
import { GET as EVENTS } from '@/app/api/b/[bid]/events/route';
import { GET as EMAIL_OPEN } from '@/app/email/open/route';
import { GET as EMAIL_LEARN } from '@/app/email/learn/route';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const B = schema.businesses; const J = schema.jobs;
const HOUR = 3600e3, DAY = 864e5;
const p = (bid: string) => ({ params: Promise.resolve({ bid }) });
const act = (bid: string, action: string, input: any = {}) => ACT(new Request('http://t/api/b/x/act', { method: 'POST', body: JSON.stringify({ action, input }), headers: { 'x-forwarded-for': '10.9.0.1' } }), p(bid));
const ws = (bid: string) => WORKSPACE(new Request('http://t/w'), p(bid));
async function ev(bid: string) { const ac = new AbortController(); const r = await EVENTS(new Request('http://t/e', { signal: ac.signal }), p(bid)); await new Promise(res => setTimeout(res, 150)); ac.abort(); return r; }
const as = async (u: TUser) => { H.jar.clear(); await F.signIn(u, H.jar); };
/** A business whose members last used the app `ms` ago. */
async function bizUsed(owner: TUser, ms: number, o: Parameters<Fixtures['biz']>[1] & { autopilot?: any } = {}) {
  const b = await F.biz(owner, o);
  await db.update(B).set({ lastActiveAt: new Date(Date.now() - ms), ...(o.autopilot ? { autopilot: o.autopilot } : {}) }).where(eq(B.id, b.id));
  return getBiz(b.id);
}
const seen = async (bid: string) => { const [r] = await db.select({ at: B.lastActiveAt, rev: B.rev, updatedAt: B.updatedAt }).from(B).where(eq(B.id, bid)).limit(1); return { at: r.at.getTime(), rev: r.rev, updatedAt: r.updatedAt.getTime() }; };
const reset = (bid: string, ms: number) => db.update(B).set({ lastActiveAt: new Date(Date.now() - ms) }).where(eq(B.id, bid));
const visRuns = (bid: string) => db.select().from(J).where(and(eq(J.businessId, bid), eq(J.kind, 'visibility.run')));
afterEach(() => { H.jar.clear(); vi.restoreAllMocks(); });

describe.skipIf(!ON)('last active (database)', () => {
  afterAll(() => F.cleanup());

  it('touchActive writes at most once an hour, and never the revision or updated_at', async () => {
    const owner = await F.user(); const stale = await bizUsed(owner, 3 * HOUR); const before = await seen(stale.id);
    const now = new Date();
    await touchActive(stale, { guest: false }, now);
    expect(await seen(stale.id)).toEqual({ at: now.getTime(), rev: before.rev, updatedAt: before.updatedAt });

    // Within the hour: the usual call sees a fresh row and does nothing...
    await touchActive(await getBiz(stale.id), { guest: false }, new Date(now.getTime() + TOUCH_EVERY_MS - 1));
    expect((await seen(stale.id)).at).toBe(now.getTime());
    // ...and a request that still holds the row from before the write (a concurrent tab) does not write a second time.
    await touchActive(stale, { guest: false }, new Date(now.getTime() + 30 * 60e3));
    expect((await seen(stale.id)).at).toBe(now.getTime());
    // An hour on, the next use is recorded.
    const later = new Date(now.getTime() + TOUCH_EVERY_MS);
    await touchActive(await getBiz(stale.id), { guest: false }, later);
    expect(await seen(stale.id)).toEqual({ at: later.getTime(), rev: before.rev, updatedAt: before.updatedAt });
  });

  it('never for a guest, and a failing write is swallowed (callers await it after their own work succeeded)', async () => {
    const owner = await F.user(); const b = await bizUsed(owner, 40 * DAY); const before = await seen(b.id);
    await touchActive(b, { guest: true });
    expect(await seen(b.id)).toEqual(before);
    expect(await visRuns(b.id)).toHaveLength(0);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(touchActive({ ...b, id: 'not-a-business-id' }, { guest: false })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });

  it('a workspace GET, read actions and the events stream leave it alone; opening the app (app.seen) and a change record it', async () => {
    const owner = await F.user(); const viewer = await F.user(); const b = await bizUsed(owner, 3 * HOUR); await F.member(b.id, viewer, 'Viewer');
    const before = await seen(b.id);
    await as(owner);
    // What an open tab does by itself: refetch the workspace, rerun the screen's read actions, hold the events stream.
    expect((await ws(b.id)).status).toBe(200);
    expect((await act(b.id, 'visibility.list')).status).toBe(200);
    expect((await act(b.id, 'suggestions.list')).status).toBe(200);
    expect((await ev(b.id)).status).toBe(200);
    expect(await seen(b.id)).toEqual(before);

    // The shell's ping: recorded, answered without a workspace, and the shared revision does not move.
    const t0 = Date.now();
    const r = await act(b.id, 'app.seen');
    expect([r.status, await r.json()]).toEqual([200, { ok: true, data: { ok: true } }]);
    const pinged = await seen(b.id);
    expect(pinged.at).toBeGreaterThanOrEqual(t0);
    expect([pinged.rev, pinged.updatedAt]).toEqual([before.rev, before.updatedAt]);

    // A change by a member: recorded (the write's own revision bump is the action's, as before).
    await reset(b.id, 3 * HOUR);
    const t1 = Date.now();
    expect((await act(b.id, 'brief.settings', { platforms: ['reddit'], time: '07:00', mention: 'asked' })).status).toBe(200);
    const changed = await seen(b.id);
    expect(changed.at).toBeGreaterThanOrEqual(t1);
    expect(changed.rev).toBe(before.rev + 1);

    // Any member counts, whatever their role; a change that was refused does not.
    await reset(b.id, 3 * HOUR); const stale = (await seen(b.id)).at;
    await as(viewer);
    expect((await act(b.id, 'brief.settings', { platforms: ['reddit'], time: '07:00', mention: 'asked' })).status).toBe(403);
    expect((await seen(b.id)).at).toBe(stale);
    expect((await act(b.id, 'app.seen')).status).toBe(200);
    expect((await seen(b.id)).at).toBeGreaterThan(stale);
  });

  it('a guest never records activity: not by a change to its own draft, not by the ping', async () => {
    const guest = await F.user({ guest: true }); const draft = await bizUsed(guest, 3 * HOUR, { status: 'onboarding' });
    const before = (await seen(draft.id)).at;
    await as(guest);
    expect((await act(draft.id, 'onboarding.step', { step: 'review' })).status).toBe(200);
    expect((await act(draft.id, 'app.seen')).status).toBe(402);
    expect((await ws(draft.id)).status).toBe(200);
    expect((await seen(draft.id)).at).toBe(before);
  });

  it('a click on a Radar email link records it, once every check has passed; a refused or signed-out click does not', async () => {
    const owner = await F.user(); const member = await F.user(); const b = await bizUsed(owner, 3 * HOUR); await F.member(b.id, member);
    const today = todayIn(b.timezone);
    await db.insert(schema.briefDays).values({ businessId: b.id, date: today, scannedAt: '06:00', items: [] });
    const open = (ref: string) => EMAIL_OPEN(new Request(new URL('/email/open?' + new URLSearchParams({ businessId: b.id, kind: 'brief_reply', ref }), env.appUrl)));
    const learn = (q: Record<string, string>) => EMAIL_LEARN(new Request(new URL('/email/learn?' + new URLSearchParams(q), env.appUrl)));
    const before = (await seen(b.id)).at;

    // Signed out: sent to sign in. A link to a brief that isn't there, or opened by someone who isn't the owner: 404.
    expect((await open(today)).status).toBe(303);
    await as(owner);
    expect((await open('2020-01-01')).status).toBe(404);
    await as(member);
    expect((await open(today)).status).toBe(404);
    expect((await learn({ lesson: 'daily_brief', businessId: b.id })).status).toBe(404);
    // A lesson link without a business names none, so it marks none.
    await as(owner);
    expect((await learn({ lesson: 'daily_brief' })).status).toBe(303);
    expect((await seen(b.id)).at).toBe(before);

    const t0 = Date.now();
    const ok = await open(today);
    expect(ok.status).toBe(303);
    expect((await seen(b.id)).at).toBeGreaterThanOrEqual(t0);

    await reset(b.id, 3 * HOUR);
    const t1 = Date.now();
    expect((await learn({ lesson: 'daily_brief', businessId: b.id })).status).toBe(303);
    expect((await seen(b.id)).at).toBeGreaterThanOrEqual(t1);
  });
});

describe.skipIf(!ON)('coming back after a quiet spell: one AI visibility catch-up (database)', () => {
  afterAll(() => F.cleanup());
  const run = async (bid: string, ageMs: number, status: 'done' | 'queued' = 'done') => { const [j] = await db.insert(J).values({ businessId: bid, kind: 'visibility.run', ref: bid, status, createdAt: new Date(Date.now() - ageMs), ...(status === 'done' ? { finishedAt: new Date(Date.now() - ageMs) } : {}) }).returning(); return j; };

  it('an idle or dormant business gets exactly one run the moment a member returns, without a revision bump', async () => {
    const owner = await F.user();
    for (const quiet of [10 * DAY, 40 * DAY]) {
      const b = await bizUsed(owner, quiet); const before = await seen(b.id);
      await as(owner);
      expect((await act(b.id, 'app.seen')).status).toBe(200);
      const jobs = await visRuns(b.id);
      expect(jobs.map(j => [j.status, j.ref, j.singletonKey, j.payload])).toEqual([['queued', b.id, 'vis-run:' + b.id, {}]]);
      expect((await seen(b.id)).rev).toBe(before.rev);
      // Later use (the row is fresh now) starts nothing more, even once that run has finished and aged past a day.
      await db.update(J).set({ status: 'done', finishedAt: new Date(), createdAt: new Date(Date.now() - 2 * DAY) }).where(eq(J.id, jobs[0].id));
      await touchActive(await getBiz(b.id), { guest: false }, new Date(Date.now() + 2 * HOUR));
      expect((await act(b.id, 'app.seen')).status).toBe(200);
      expect(await visRuns(b.id)).toHaveLength(1);
    }
  });

  it('two requests arriving together on the same stale row start one run between them', async () => {
    const owner = await F.user(); const b = await bizUsed(owner, 12 * DAY);
    const now = new Date();
    await Promise.all([touchActive(b, { guest: false }, now), touchActive(b, { guest: false }, now), touchActive(b, { guest: false }, new Date(now.getTime() + 5))]);
    expect(await visRuns(b.id)).toHaveLength(1);
  });

  it('no catch-up when a run was started in the last 24 hours; one when the newest is older', async () => {
    const owner = await F.user();
    const recent = await bizUsed(owner, 12 * DAY); await run(recent.id, 23 * HOUR);
    await touchActive(recent, { guest: false });
    expect(await visRuns(recent.id)).toHaveLength(1);
    const old = await bizUsed(owner, 12 * DAY); await run(old.id, 25 * HOUR);
    await touchActive(old, { guest: false });
    expect((await visRuns(old.id)).map(j => j.status).sort()).toEqual(['done', 'queued']);
    // One already waiting (say, the first-week run): the catch-up does not add a second.
    const waiting = await bizUsed(owner, 12 * DAY); await run(waiting.id, 2 * DAY, 'queued');
    await db.update(J).set({ singletonKey: 'vis-run:' + waiting.id }).where(eq(J.businessId, waiting.id));
    await touchActive(waiting, { guest: false });
    expect(await visRuns(waiting.id)).toHaveLength(1);
  });

  it('nothing to catch up for a business that was never slowed, a draft, or a guest', async () => {
    const owner = await F.user(); const guest = await F.user({ guest: true });
    const active = await bizUsed(owner, 3 * DAY);
    const autopilot = await bizUsed(owner, 40 * DAY, { autopilot: { enabled: true, activationId: 'a1' } });
    const fresh = await bizUsed(owner, 40 * DAY, { onboarding: { committedAt: new Date(Date.now() - 2 * DAY).toISOString() } });
    const draft = await bizUsed(owner, 40 * DAY, { status: 'onboarding' });
    const theirs = await bizUsed(guest, 40 * DAY, { status: 'onboarding' });
    const t0 = Date.now();
    for (const b of [active, autopilot, fresh, draft]) await touchActive(b, { guest: false });
    await touchActive(theirs, { guest: true });
    for (const b of [active, autopilot, fresh, draft, theirs]) expect([b.id, (await visRuns(b.id)).length]).toEqual([b.id, 0]);
    // The use itself was still recorded for the signed-in ones.
    for (const b of [active, autopilot, fresh, draft]) expect((await seen(b.id)).at).toBeGreaterThanOrEqual(t0);
  });
});
