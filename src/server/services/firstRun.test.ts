// The first-week run (first-five architecture §1, FS-1 … FS-4): what a commit starts, what the Dashboard is told, and
// the retry and dismiss actions. Skipped without DATABASE_URL. No worker runs here: job outcomes are written to the rows.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>(), failBrief: false }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));
// One enqueue can be made to fail, the way a queue hiccup would, without touching the other two.
vi.mock('./brief/jobs', async importOriginal => {
  const real = await importOriginal<typeof import('./brief/jobs')>();
  return { ...real, enqueueScan: (...a: Parameters<typeof real.enqueueScan>) => (H.failBrief ? Promise.reject(new Error('queue unavailable')) : real.enqueueScan(...a)) };
});

import { asc, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { Fixtures, clearLimits, type TUser } from '../testing/fixtures';
import { billing, card as stubCard, Deliveries } from '../testing/billing';
import { commitDraft } from '../billing/draft';
import { resolveEntry, trialGuard } from '../billing/guard';
import { stubReset } from '../billing/stub';
import { loadWorkspace } from '../workspace';
import { FIRST_RUN_DAYS, START_ERROR, START_GRACE_MS, dismissFirstRun, firstRunOf, retryFirstRun, startFirstRun } from './firstRun';
import { POST as ACT } from '@/app/api/b/[bid]/act/route';
import type { FirstRunItem, FirstRunKey, OnboardingState } from '@/lib/types';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const D = new Deliveries();
const J = schema.jobs, B = schema.businesses;
const SAVED = (): OnboardingState => ({ step: 'save', savedAt: new Date().toISOString(), tz: 'Europe/Lisbon' });
const KINDS = ['brief.scan', 'calendar.generate', 'visibility.run'];
const as = async (u: TUser) => { H.jar.clear(); await F.signIn(u, H.jar); };
const act = async (bid: string, action: string, input: any = {}) => { const r = await ACT(new Request('http://t/act', { method: 'POST', body: JSON.stringify({ action, input }) }), { params: Promise.resolve({ bid }) }); return { status: r.status, j: await r.json() as any }; };
const biz = async (bid: string) => (await db.select().from(B).where(eq(B.id, bid)))[0];
const jobsOf = (bid: string) => db.select().from(J).where(eq(J.businessId, bid)).orderBy(asc(J.createdAt));
const kindsOf = async (bid: string) => (await jobsOf(bid)).map(j => j.kind).sort();
const tracked = async (bid: string) => (await biz(bid)).onboarding.firstRun?.jobs as Record<FirstRunKey, string | null>;
const setJob = (id: string, patch: Partial<typeof J.$inferInsert>) => db.update(J).set(patch).where(eq(J.id, id));
const rows = async (bid: string) => (await firstRunOf(await biz(bid)))?.items;
const row = async (bid: string, key: FirstRunKey) => (await rows(bid))?.find(i => i.key === key) as FirstRunItem | undefined;
const statuses = async (bid: string) => Object.fromEntries(((await rows(bid)) || []).map(i => [i.key, i.status]));
/** Another job of a kind for the business, as its own screen or a schedule would have made it. */
const otherJob = async (bid: string, kind: string, o: Partial<typeof J.$inferInsert> = {}) => (await db.insert(J).values({ businessId: bid, kind, ref: bid, status: 'done', finishedAt: new Date(), ...o }).returning({ id: J.id }))[0].id;
const setFirstRun = async (bid: string, patch: Record<string, unknown>) => { const b = await biz(bid); await db.update(B).set({ onboarding: { ...b.onboarding, firstRun: { ...b.onboarding.firstRun!, ...patch } } }).where(eq(B.id, bid)); };

/** A business committed just now by an owner with access (billing off), its three jobs queued. */
async function committed(o: { owner?: TUser } = {}) {
  const owner = o.owner || await F.user();
  const d = await F.biz(owner, { status: 'onboarding', onboarding: SAVED() });
  expect(await commitDraft(d.id)).toBe(d.id);
  return { owner, bid: d.id, jobs: await tracked(d.id) };
}

beforeEach(() => { H.failBrief = false; stubReset(); });
afterEach(() => { delete process.env.RADAR_BILLING; H.jar.clear(); vi.useRealTimers(); });

describe.skipIf(!ON)('first-week run (database)', () => {
  afterAll(async () => { await D.cleanup(); await clearLimits('10.88.'); for (const id of F.users) await clearLimits(id); await F.cleanup(); });

  describe('what a commit starts (FS-1)', () => {
    const expectStarted = async (bid: string) => {
      expect(await kindsOf(bid)).toEqual(KINDS);
      const all = await jobsOf(bid); const ids = await tracked(bid);
      expect(ids.calendar).toBe(all.find(j => j.kind === 'calendar.generate')!.id);
      expect(ids.brief).toBe(all.find(j => j.kind === 'brief.scan')!.id);
      expect(ids.visibility).toBe(all.find(j => j.kind === 'visibility.run')!.id);
      expect(all.every(j => j.status === 'queued')).toBe(true);
      const b = await biz(bid);
      expect(b.status).toBe('active');
      expect(b.onboarding.firstRun!.at).toBe(b.onboarding.committedAt);
      expect(b.briefSetup).toBe(false);                                   // the first scan sets it when it succeeds
      expect(await statuses(bid)).toEqual({ calendar: 'queued', brief: 'queued', visibility: 'queued' });
    };

    it('saving the profile with access (onboarding.save, also "Add a business") starts the three jobs once', async () => {
      process.env.RADAR_BILLING = 'on';
      const u = await F.user(); await F.account(u.id, { status: 'active', everSubscribed: true }); await as(u);
      const d = await F.biz(u, { status: 'onboarding' });
      const r = await act(d.id, 'onboarding.save', { tz: 'Europe/Lisbon' });
      expect(r.j.data).toMatchObject({ committed: true, next: '/dashboard' });
      await expectStarted(d.id);
      expect(r.j.workspace.firstRun.items.map((i: FirstRunItem) => i.key)).toEqual(['calendar', 'brief', 'visibility']);
      // The same request again (a double click, an old tab): nothing more.
      expect((await act(d.id, 'onboarding.save', { tz: 'Europe/Lisbon' })).j.data).toMatchObject({ committed: false });
      expect(await kindsOf(d.id)).toEqual(KINDS);
    });

    it('starting the trial commits the saved draft and starts them once, even when confirm and the webhook both arrive', async () => {
      process.env.RADAR_BILLING = 'on';
      const u = await F.user(); await as(u);
      const d = await F.biz(u, { status: 'onboarding', onboarding: SAVED() });
      const s = await billing.start(await stubCard(8500, 9500)); expect(s.status, JSON.stringify(s.j)).toBe(200);
      await billing.confirmIntent(s.j.paymentIntentId);
      const [c] = await Promise.all([billing.confirm({ paymentIntentId: s.j.paymentIntentId }), D.deliver('payment_intent.succeeded', D.pi(s.j.paymentIntentId))]);
      expect(c.status).toBe(200);
      expect((await billing.confirm({ paymentIntentId: s.j.paymentIntentId })).status).toBe(200);
      await expectStarted(d.id);
    });

    it('the signed-in entry (resolveEntry) and /start-trial (trialGuard) commit a saved draft for an owner with access and start them once', async () => {
      process.env.RADAR_BILLING = 'on';
      const a = await F.user(); await F.account(a.id, { comp: true, compReason: 'manual' });
      const da = await F.biz(a, { status: 'onboarding', onboarding: SAVED() });
      expect(await resolveEntry({ ...a, guest: false } as any)).toMatchObject({ render: true, committed: da.id });
      await expectStarted(da.id);
      expect(await resolveEntry({ ...a, guest: false } as any)).toEqual({ render: true });
      expect(await kindsOf(da.id)).toEqual(KINDS);

      const b = await F.user(); await F.account(b.id, { status: 'trialing', everSubscribed: true }); await as(b);
      const dbz = await F.biz(b, { status: 'onboarding', onboarding: SAVED() });
      expect(await trialGuard()).toMatchObject({ redirect: expect.stringContaining(dbz.id) });
      await expectStarted(dbz.id);
      expect(await trialGuard()).toEqual({ redirect: '/dashboard' });
      expect(await kindsOf(dbz.id)).toEqual(KINDS);
    });

    it('two commits racing: one wins, the three jobs exist once; starting again by hand adds nothing', async () => {
      const u = await F.user(); const d = await F.biz(u, { status: 'onboarding', onboarding: SAVED() });
      const won = await Promise.all([commitDraft(d.id), commitDraft(d.id), commitDraft(d.id)]);
      expect(won.filter(Boolean)).toEqual([d.id]);
      expect(await kindsOf(d.id)).toEqual(KINDS);
      const before = await tracked(d.id);
      await startFirstRun(d.id); await startFirstRun(d.id);
      expect(await kindsOf(d.id)).toEqual(KINDS);
      expect(await tracked(d.id)).toEqual(before);
      // …and once the jobs have finished, a late or repeated start still adds nothing.
      await db.update(J).set({ status: 'done', finishedAt: new Date() }).where(eq(J.businessId, d.id));
      await startFirstRun(d.id);
      expect(await kindsOf(d.id)).toEqual(KINDS);
    });

    it('a business that was active before this shipped has no marker and gets nothing (FS-4)', async () => {
      const u = await F.user();
      const old = await F.biz(u, { onboarding: { step: 'save', savedAt: '2026-10-01T10:00:00.000Z', committedAt: '2026-10-01T10:00:05.000Z' } });
      await startFirstRun(old.id);
      expect(await jobsOf(old.id)).toHaveLength(0);
      expect(await firstRunOf(await biz(old.id))).toBeUndefined();
      expect((await loadWorkspace(old.id, u.id, 'Owner')).firstRun).toBeUndefined();
      await expect(retryFirstRun(old.id, 'calendar')).rejects.toMatchObject({ status: 409, code: 'no_first_run' });
      expect(await jobsOf(old.id)).toHaveLength(0);
      // A draft that is not committed yet has none either.
      const draft = await F.biz(u, { status: 'onboarding', onboarding: SAVED() });
      await startFirstRun(draft.id);
      expect(await jobsOf(draft.id)).toHaveLength(0);
    });

    it('one job that cannot be queued leaves the other two and the commit intact, and shows as a failed row with Retry (FS-3)', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      H.failBrief = true;
      const u = await F.user(); const d = await F.biz(u, { status: 'onboarding', onboarding: SAVED() });
      expect(await commitDraft(d.id)).toBe(d.id);
      expect((await biz(d.id)).status).toBe('active');
      expect(await kindsOf(d.id)).toEqual(['calendar.generate', 'visibility.run']);
      expect(await tracked(d.id)).toMatchObject({ calendar: expect.any(String), brief: null, visibility: expect.any(String) });
      expect(await row(d.id, 'brief')).toEqual({ key: 'brief', jobId: null, status: 'failed', progress: null, error: START_ERROR });
      expect(await statuses(d.id)).toMatchObject({ calendar: 'queued', visibility: 'queued' });
      // Retry while the queue is still down: a clear error, the row stays failed.
      await expect(retryFirstRun(d.id, 'brief')).rejects.toMatchObject({ status: 503, userMessage: 'Radar couldn’t start this. Try again.' });
      expect((await row(d.id, 'brief'))!.status).toBe('failed');
      H.failBrief = false;
      const id = await retryFirstRun(d.id, 'brief');
      expect(await kindsOf(d.id)).toEqual(KINDS);
      expect((await tracked(d.id)).brief).toBe(id);
      expect(await row(d.id, 'brief')).toMatchObject({ jobId: id, status: 'queued', error: null });
    });

    it('a commit whose jobs were never stored reads as starting for a minute, then as three rows that could not start', async () => {
      const u = await F.user();
      const b = await F.biz(u, { onboarding: { committedAt: new Date().toISOString(), firstRun: { at: new Date().toISOString() } } });
      expect(await rows(b.id)).toEqual(['calendar', 'brief', 'visibility'].map(key => ({ key, jobId: null, status: 'queued', progress: null, error: null })));
      // Retry while it is still starting starts nothing (startFirstRun is about to).
      expect(await retryFirstRun(b.id, 'calendar')).toBeNull();
      expect(await jobsOf(b.id)).toHaveLength(0);
      await setFirstRun(b.id, { at: new Date(Date.now() - START_GRACE_MS - 5000).toISOString() });
      expect(await rows(b.id)).toEqual(['calendar', 'brief', 'visibility'].map(key => ({ key, jobId: null, status: 'failed', progress: null, error: START_ERROR })));
      const id = await retryFirstRun(b.id, 'visibility');
      expect(await statuses(b.id)).toEqual({ calendar: 'failed', brief: 'failed', visibility: 'queued' });
      expect((await tracked(b.id)).visibility).toBe(id);
    });
  });

  describe('what the Dashboard is told (FS-2, FS-3)', () => {
    it('rows follow their jobs: queued, running with progress, done; the block disappears when all three are done', async () => {
      const { owner, bid, jobs } = await committed();
      await setJob(jobs.calendar!, { status: 'running', progress: { phase: 4, results: ['a', 'b'] } });
      await setJob(jobs.visibility!, { status: 'done', progress: { done: 20, total: 20 }, result: { total: 20 }, finishedAt: new Date() });
      expect(await rows(bid)).toEqual([
        { key: 'calendar', jobId: jobs.calendar, status: 'running', progress: { phase: 4, results: ['a', 'b'] }, error: null },
        { key: 'brief', jobId: jobs.brief, status: 'queued', progress: null, error: null },
        { key: 'visibility', jobId: jobs.visibility, status: 'done', progress: { done: 20, total: 20 }, error: null },
      ]);
      const w = await loadWorkspace(bid, owner.id, 'Owner');
      expect(w.firstRun).toMatchObject({ at: (await biz(bid)).onboarding.firstRun!.at });
      expect(w.firstRun!.items.map(i => i.status)).toEqual(['running', 'queued', 'done']);
      await setJob(jobs.calendar!, { status: 'done', finishedAt: new Date() });
      expect(await statuses(bid)).toMatchObject({ calendar: 'done', brief: 'queued' });
      await setJob(jobs.brief!, { status: 'done', result: { mode: 'first', added: 6 }, finishedAt: new Date() });
      expect(await firstRunOf(await biz(bid))).toBeUndefined();
      expect((await loadWorkspace(bid, owner.id, 'Owner')).firstRun).toBeUndefined();
    });

    it('a failed job is a failed row with the job’s message; the others carry on and the block stays', async () => {
      const { bid, jobs } = await committed();
      await setJob(jobs.calendar!, { status: 'failed', error: 'Radar couldn’t finish this. Try again.', result: { detail: 'upstream 500' }, finishedAt: new Date() });
      await setJob(jobs.brief!, { status: 'done', result: { mode: 'first' }, finishedAt: new Date() });
      await setJob(jobs.visibility!, { status: 'done', result: { total: 0 }, finishedAt: new Date() });
      const r = await rows(bid);
      expect(r).toHaveLength(3);
      expect(r![0]).toEqual({ key: 'calendar', jobId: jobs.calendar, status: 'failed', progress: null, error: 'Radar couldn’t finish this. Try again.' });
      expect(r!.slice(1).map(i => i.status)).toEqual(['done', 'done']);
      expect(JSON.stringify(r)).not.toContain('upstream 500');            // internal detail never reaches the client
    });

    it('a brief scan that ended with a source that did not respond is a failed row; dismissed in the Daily Brief, it is not', async () => {
      const { bid, jobs } = await committed();
      await setJob(jobs.brief!, { status: 'done', result: { mode: 'first', failed: 'reddit', partial: 0 }, progress: { step: 'reddit', threadsRead: 12, failed: 'reddit' }, finishedAt: new Date() });
      expect(await row(bid, 'brief')).toMatchObject({ jobId: jobs.brief, status: 'failed', error: 'Reddit didn’t respond, so today’s brief isn’t ready.' });
      await setJob(jobs.brief!, { result: { mode: 'first', failed: 'source' } });
      expect((await row(bid, 'brief'))!.error).toBe('A source didn’t respond, so today’s brief isn’t ready.');
      await setJob(jobs.brief!, { result: { mode: 'first', failed: 'reddit', dismissed: true } });
      expect((await row(bid, 'brief'))!.status).toBe('done');
    });

    it('a failed row does not outlive a later success of the same kind', async () => {
      const { bid, jobs } = await committed();
      const earlier = new Date(Date.now() - 3600e3), later = new Date(Date.now() + 2000);
      await setJob(jobs.calendar!, { status: 'failed', error: 'Radar couldn’t finish this. Try again.', finishedAt: new Date() });
      // None of these is a later success for this row.
      const other = await committed();
      await otherJob(other.bid, 'calendar.generate', { createdAt: later });                                   // another business
      await otherJob(bid, 'calendar.generate', { createdAt: earlier });                                         // older than the failure
      await otherJob(bid, 'visibility.run', { createdAt: later });                                              // another kind
      await otherJob(bid, 'calendar.generate', { createdAt: later, result: { skipped: 'no_access' } });         // skipped, did nothing
      await otherJob(bid, 'calendar.generate', { createdAt: later, status: 'failed', error: 'again' });         // failed too
      expect((await row(bid, 'calendar'))!.status).toBe('failed');
      // Regenerated from the Calendar screen while it runs: the row shows that run, not the stale failure.
      const live = await otherJob(bid, 'calendar.generate', { createdAt: later, status: 'running', progress: { phase: 2 }, finishedAt: null });
      expect(await row(bid, 'calendar')).toEqual({ key: 'calendar', jobId: live, status: 'running', progress: { phase: 2 }, error: null });
      expect(await retryFirstRun(bid, 'calendar')).toBe(live);            // nothing to retry while it runs
      await setJob(live, { status: 'done', result: { generatedAt: new Date().toISOString() }, finishedAt: new Date() });
      expect(await row(bid, 'calendar')).toMatchObject({ jobId: live, status: 'done', error: null });

      // The brief: a later "Scan again" that also lost a source is not a success; one that read everything is.
      await setJob(jobs.brief!, { status: 'done', result: { mode: 'first', failed: 'x' }, finishedAt: new Date() });
      await otherJob(bid, 'brief.scan', { createdAt: later, result: { mode: 'first', failed: 'x' } });
      expect((await row(bid, 'brief'))!.status).toBe('failed');
      await otherJob(bid, 'brief.scan', { createdAt: new Date(Date.now() + 4000), result: { mode: 'first', added: 5 } });
      expect((await row(bid, 'brief'))!.status).toBe('done');
      // With visibility done too, nothing is left to show.
      await setJob(jobs.visibility!, { status: 'done', finishedAt: new Date() });
      expect(await firstRunOf(await biz(bid))).toBeUndefined();
    });

    it('a row that never started is cleared by a later success as well', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      H.failBrief = true;
      const { bid } = await committed();
      expect((await row(bid, 'brief'))!.status).toBe('failed');
      await otherJob(bid, 'brief.scan', { createdAt: new Date(Date.now() + 2000), result: { mode: 'first', added: 3 } });
      expect((await row(bid, 'brief'))!.status).toBe('done');
    });

    it('the block leaves after 7 days even with a failed row, and stays until then', async () => {
      const { bid, jobs } = await committed();
      await setJob(jobs.calendar!, { status: 'failed', error: 'Radar couldn’t finish this. Try again.', finishedAt: new Date() });
      await setFirstRun(bid, { at: new Date(Date.now() - (FIRST_RUN_DAYS * 24 - 1) * 3600e3).toISOString() });
      expect((await row(bid, 'calendar'))!.status).toBe('failed');
      await setFirstRun(bid, { at: new Date(Date.now() - (FIRST_RUN_DAYS * 24 + 1) * 3600e3).toISOString() });
      expect(await firstRunOf(await biz(bid))).toBeUndefined();
      await expect(retryFirstRun(bid, 'calendar')).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('retry and dismiss (firstRun.retry, firstRun.dismiss)', () => {
    it('retry replaces the tracked job of a failed row and is a no-op on a row that is not failed', async () => {
      const { owner, bid, jobs } = await committed(); await as(owner);
      // Not failed: the tracked id comes back and nothing is queued.
      const same = await act(bid, 'firstRun.retry', { key: 'calendar' });
      expect(same).toMatchObject({ status: 200, j: { data: { jobId: jobs.calendar } } });
      expect(await jobsOf(bid)).toHaveLength(3);
      // Done: the same, even though nothing of that kind is queued any more.
      await setJob(jobs.visibility!, { status: 'done', result: { total: 12 }, finishedAt: new Date() });
      expect((await act(bid, 'firstRun.retry', { key: 'visibility' })).j.data).toEqual({ jobId: jobs.visibility });
      expect(await jobsOf(bid)).toHaveLength(3);
      await setJob(jobs.calendar!, { status: 'failed', error: 'Radar couldn’t finish this. Try again.', finishedAt: new Date() });
      const r = await act(bid, 'firstRun.retry', { key: 'calendar' });
      expect(r.status).toBe(200);
      const fresh = r.j.data.jobId as string;
      expect(fresh).not.toBe(jobs.calendar);
      expect((await tracked(bid))).toEqual({ ...jobs, calendar: fresh });
      const all = await jobsOf(bid);
      expect(all.filter(j => j.kind === 'calendar.generate').map(j => j.status).sort()).toEqual(['failed', 'queued']);
      expect(all.find(j => j.id === fresh)).toMatchObject({ kind: 'calendar.generate', status: 'queued', ref: bid, payload: { keep: false } });
      expect(r.j.workspace.firstRun.items.find((i: FirstRunItem) => i.key === 'calendar')).toMatchObject({ jobId: fresh, status: 'queued', error: null });
      // A second click joins the job that is now queued.
      expect((await act(bid, 'firstRun.retry', { key: 'calendar' })).j.data.jobId).toBe(fresh);
      expect(await jobsOf(bid)).toHaveLength(4);
      expect((await act(bid, 'firstRun.retry', { key: 'everything' })).status).toBe(400);
    });

    it('dismiss hides the block for every member; running jobs carry on', async () => {
      const { owner, bid, jobs } = await committed(); const editor = await F.user(); await F.member(bid, editor, 'Editor');
      await setJob(jobs.brief!, { status: 'failed', error: 'Radar couldn’t finish this. Try again.', finishedAt: new Date() });
      await as(editor);
      const r = await act(bid, 'firstRun.dismiss');
      expect(r.status).toBe(200);
      expect(r.j.workspace.firstRun).toBeUndefined();
      expect((await loadWorkspace(bid, owner.id, 'Owner')).firstRun).toBeUndefined();
      expect(typeof (await biz(bid)).onboarding.firstRun!.dismissedAt).toBe('string');
      expect((await jobsOf(bid)).filter(j => j.status === 'queued')).toHaveLength(2);
      await expect(retryFirstRun(bid, 'brief')).rejects.toMatchObject({ status: 409 });
      await dismissFirstRun(bid);                                           // again: harmless
      expect(await kindsOf(bid)).toEqual(KINDS);
    });

    it('a Viewer can see the rows but cannot retry or dismiss; someone outside the business gets 404', async () => {
      const { bid, jobs } = await committed(); const viewer = await F.user(); const stranger = await F.user(); await F.member(bid, viewer, 'Viewer');
      await setJob(jobs.visibility!, { status: 'failed', error: 'Radar couldn’t finish this. Try again.', finishedAt: new Date() });
      expect((await loadWorkspace(bid, viewer.id, 'Viewer')).firstRun!.items.find(i => i.key === 'visibility')!.status).toBe('failed');
      await as(viewer);
      expect(await act(bid, 'firstRun.retry', { key: 'visibility' })).toMatchObject({ status: 403, j: { code: 'forbidden' } });
      expect(await act(bid, 'firstRun.dismiss')).toMatchObject({ status: 403, j: { code: 'forbidden' } });
      await as(stranger);
      expect((await act(bid, 'firstRun.retry', { key: 'visibility' })).status).toBe(404);
      expect((await act(bid, 'firstRun.dismiss')).status).toBe(404);
      H.jar.clear();
      expect((await act(bid, 'firstRun.dismiss')).status).toBe(401);
      expect(await jobsOf(bid)).toHaveLength(3);
      expect((await biz(bid)).onboarding.firstRun!.dismissedAt).toBeUndefined();
    });

    it('retry and dismiss answer 402 once the owner has no access', async () => {
      process.env.RADAR_BILLING = 'on';
      const owner = await F.user(); await F.account(owner.id, { status: 'active', everSubscribed: true });
      const { bid, jobs } = await committed({ owner }); await as(owner);
      await setJob(jobs.calendar!, { status: 'failed', error: 'Radar couldn’t finish this. Try again.', finishedAt: new Date() });
      await F.account(owner.id, { status: 'canceled' });
      expect(await act(bid, 'firstRun.retry', { key: 'calendar' })).toMatchObject({ status: 402, j: { code: 'subscription_required' } });
      expect(await act(bid, 'firstRun.dismiss')).toMatchObject({ status: 402 });
      expect(await jobsOf(bid)).toHaveLength(3);
    });
  });
});
