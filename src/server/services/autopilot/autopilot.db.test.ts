import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; process.env.RADAR_SOCIAL_PUBLISHING = 'all'; process.env.RADAR_BILLING = 'off'; process.env.STORAGE_DIR = '.data/autopilot-tests'; });
import { and, eq, inArray, like } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, schema as S } from '@/server/db';
import { encrypt } from '@/server/crypto';
import { defaultProfile, getBiz } from '@/server/workspace';
import { setAutopilot, requestAutopilotRun } from './control';
import { autopilotOf } from './policy';
import { runAutopilot } from './run';
import { enqueueHandoff, deliverHandoff, businessHref } from './handoff';
import { canRun } from './guard';
import { jobDefs, type JobCtx } from '@/server/jobs/queue';
import { todayIn, addDays } from '@/lib/format';
import { zonedTimeToUtc } from '@/lib/socialPublish';
import { env } from '@/server/env';
import { claimScheduled, runSend } from '../social/publish/send';
import { writeScheduled, resolve } from '../social/publish/schedule';
import { setAdapterForTests } from '../social/publish/accounts';
import { stubAdapter } from '../social/publish/stubs';
import { createPack } from '../social/generate';
import * as access from '@/server/billing/access';
import * as failures from '@/server/observability/failures';
import * as scheduling from '../social/publish/schedule';
import * as briefStore from '../brief/store';
import '../calendar/jobs';
import '../social/jobs';
import './jobs';
import type { ActCtx } from '@/server/actions/define';

let uid = '', bid = '', foreign = '';
const date = todayIn('UTC');
const profile = defaultProfile('autopilot.test'); profile.business.name = 'Autopilot tests'; profile.business.offerings = ['Calendar time tracking']; profile.audience.segments = ['Freelance designers']; profile.audience.needs = ['Track billable time'];
const context = async (role: ActCtx['role'] = 'Owner') => ({ user: { id: uid, name: 'Autopilot owner', email: 'autopilot@test.local' }, bid, role, biz: await getBiz(bid) } as ActCtx);
const rows = (kind?: string) => db.select().from(S.jobs).where(and(eq(S.jobs.businessId, bid), ...(kind ? [eq(S.jobs.kind, kind)] : [])));
const runCtx = (activationId: string): JobCtx<any> => ({ businessId: bid, payload: { activationId }, attempt: 1, job: { id: randomUUID(), maxAttempts: 3 } as any, progress: async () => {}, touch: async () => {} });
const topic = (id: string, day = addDays(date, 1)) => ({ id, businessId: bid, date: day, title: 'Saved title ' + id, kw: 'saved ' + id, type: 'Guide', status: 'proposed' });

// Opt-in database coverage uses only generated fixture businesses in the configured isolated test DB.
describe.skipIf(!process.env.DATABASE_URL)('Autopilot program (database)', () => {
  beforeAll(async () => {
    [{ id: uid }] = await db.insert(S.users).values({ name: 'Autopilot tests', email: `autopilot-${randomUUID()}@test.local`, emailVerifiedAt: new Date() }).returning();
    [{ id: bid }] = await db.insert(S.businesses).values({ ownerId: uid, domain: profile.domain, profile, timezone: 'UTC', status: 'active' }).returning();
    [{ id: foreign }] = await db.insert(S.businesses).values({ ownerId: uid, domain: 'autopilot-foreign.test', profile, timezone: 'UTC', status: 'active' }).returning();
  });
  beforeEach(async () => {
    vi.restoreAllMocks(); setAdapterForTests('x', null);
    await db.delete(S.jobs).where(eq(S.jobs.businessId, bid));
    await db.delete(S.cronMarks).where(like(S.cronMarks.key, `%${bid}%`));
    await db.delete(S.calendarEntries).where(eq(S.calendarEntries.businessId, bid));
    await db.delete(S.socialPacks).where(eq(S.socialPacks.businessId, bid));
    await db.delete(S.socialPubs).where(eq(S.socialPubs.businessId, bid));
    await db.delete(S.socialAccounts).where(eq(S.socialAccounts.businessId, bid));
    await db.delete(S.briefDays).where(eq(S.briefDays.businessId, bid));
    await db.delete(S.connections).where(eq(S.connections.businessId, bid));
    // A test that failed before its own cleanup must not leave its mail for the next run to count.
    await db.delete(S.outboxEmails).where(like(S.outboxEmails.subject, '%Autopilot tests%'));
    await db.update(S.businesses).set({ timezone: 'UTC', autopilot: {}, blog: { mode: 'review' }, socialAuto: { on: false, post: 'library', freq: 'custom', days: [], platforms: ['x'], time: '00:00' }, calendarSettings: { cadence: 'custom', perWeek: 3 }, briefSetup: false }).where(eq(S.businesses.id, bid));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  afterAll(async () => {
    setAdapterForTests('x', null);
    await db.delete(S.cronMarks).where(like(S.cronMarks.key, `%${bid}%`));
    await db.delete(S.events).where(inArray(S.events.businessId, [bid, foreign]));
    await db.delete(S.businesses).where(inArray(S.businesses.id, [bid, foreign]));
    await db.delete(S.users).where(eq(S.users.id, uid));
  });
  it('defaults off; only actual owner can delegate; tenant action cannot alter a different business', async () => {
    expect(autopilotOf(await getBiz(bid)).enabled).toBe(false);
    for (const role of ['Admin', 'Editor', 'Viewer'] as const) await expect(setAutopilot(await context(role), true)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(setAutopilot({ ...(await context()), user: { id: randomUUID() } as any }, true)).rejects.toMatchObject({ code: 'forbidden' });
    await setAutopilot(await context(), true);
    expect(autopilotOf(await getBiz(foreign)).enabled).toBe(false);
    expect(await canRun(bid, autopilotOf(await getBiz(bid)).activationId)).toBe(true);
  });
  it('enable is idempotent; revoke/re-enable rotates authorization and supersedes old queued coordinators', async () => {
    const before = await getBiz(bid);
    await setAutopilot(await context(), true); const first = autopilotOf(await getBiz(bid));
    await setAutopilot(await context(), true); expect(autopilotOf(await getBiz(bid)).activationId).toBe(first.activationId);
    expect((await rows('autopilot.run')).filter(j => j.status === 'queued')).toHaveLength(1);
    await setAutopilot(await context(), false); expect(await canRun(bid, first.activationId)).toBe(false);
    await setAutopilot(await context(), true); const current = await getBiz(bid);
    expect(autopilotOf(current).activationId).not.toBe(first.activationId);
    expect(current.blog).toEqual(before.blog); expect(current.socialAuto).toEqual(before.socialAuto);
    expect((await rows('autopilot.run')).filter(j => j.status === 'queued')).toHaveLength(1);
    expect((await runAutopilot(runCtx(first.activationId!))) as any).toMatchObject({ skipped: 'autopilot_off_or_no_access' });
  });
  it('repeated coordinator runs create one calendar and brief job without altering user topics or legacy preferences', async () => {
    await db.insert(S.calendarEntries).values(topic('saved-' + randomUUID(), addDays(date, 10)));
    await setAutopilot(await context(), true); const a = autopilotOf(await getBiz(bid));
    await runAutopilot(runCtx(a.activationId!)); await runAutopilot(runCtx(a.activationId!));
    expect(await rows('calendar.generate')).toHaveLength(1); expect(await rows('brief.scan')).toHaveLength(1);
    expect(await rows('social.autoRun')).toHaveLength(0); // custom empty days is respected
    expect((await getBiz(bid)).briefSetup).toBe(false);
    expect(await db.select().from(S.calendarEntries).where(eq(S.calendarEntries.businessId, bid))).toHaveLength(1);
  });
  it('additive calendar generation preserves existing proposals, dates and edited article bodies', async () => {
    const id = 'saved-' + randomUUID(); const old = topic(id, addDays(date, 5));
    await db.insert(S.calendarEntries).values(old);
    await db.insert(S.articles).values({ entryId: id, businessId: bid, data: { generated: false, brief: { angle: 'My edited angle', outline: ['My outline'] }, body: [['p', 'My saved text']] } });
    await setAutopilot(await context(), true); const a = autopilotOf(await getBiz(bid));
    await runAutopilot(runCtx(a.activationId!)); const [job] = await rows('calendar.generate');
    const c: JobCtx<any> = { ...runCtx(a.activationId!), job, payload: job.payload, businessId: bid, attempt: 1 };
    await jobDefs().get('calendar.generate')!.run(c);
    const entries = await db.select().from(S.calendarEntries).where(eq(S.calendarEntries.businessId, bid));
    expect(entries.length).toBeGreaterThan(1); expect(entries.find(e => e.id === id)).toMatchObject(old);
    expect(new Set(entries.map(e => e.date)).size).toBe(entries.length);
    const [art] = await db.select().from(S.articles).where(eq(S.articles.entryId, id)); expect(art.data.body).toEqual([['p', 'My saved text']]);
    await setAutopilot(await context(), false);
    expect(await jobDefs().get('calendar.generate')!.run(c)).toMatchObject({ skipped: 'autopilot_off' });
  }, 30_000);
  it('manual replies are handed to owner with selected edits; repeated runs dedupe and a late arrival gets no second email that day', async () => {
    await setAutopilot(await context(), true); const a = autopilotOf(await getBiz(bid));
    const item = { id: 'reddit-1', kind: 'reply', plat: 'reddit', title: 'Help with tracking', url: 'https://www.reddit.com/r/test/comments/1', tag: 'A question', why: 'Relevant', drafts: { help: 'Original draft' }, edits: { help: 'My prepared reply' }, mention: false, st: 'open' };
    await db.insert(S.briefDays).values({ businessId: bid, date, scannedAt: '08:00', items: [item] });
    await runAutopilot(runCtx(a.activationId!)); await runAutopilot(runCtx(a.activationId!));
    const mailJobs = await rows('autopilot.handoff'); const matching = mailJobs.filter(j => JSON.stringify(j.payload).includes('My prepared reply')); expect(matching).toHaveLength(1);
    const mail = matching[0]; const payload = mail.payload as any;
    expect(payload.items.find((i: any) => i.key.includes('reddit-1'))).toMatchObject({ text: 'My prepared reply', sourceUrl: item.url });
    expect((await db.select().from(S.briefDays).where(eq(S.briefDays.businessId, bid)))[0].items[0].st).toBe('open');
    const c = { ...runCtx(a.activationId!), job: mail, payload, attempt: 1 };
    await deliverHandoff(c); await deliverHandoff(c);
    const outbox = await db.select().from(S.outboxEmails).where(like(S.outboxEmails.subject, '%Autopilot tests%'));
    expect(outbox.filter(m => m.text.includes('My prepared reply'))).toHaveLength(1);
    expect(outbox.find(m => m.text.includes('My prepared reply'))?.to).toBe((await db.select().from(S.users).where(eq(S.users.id, uid)))[0].email);
    await db.update(S.briefDays).set({ items: [item, { ...item, id: 'reddit-2', title: 'Late arrival' }] }).where(and(eq(S.briefDays.businessId, bid), eq(S.briefDays.date, date)));
    await runAutopilot(runCtx(a.activationId!)); await runAutopilot(runCtx(a.activationId!));
    expect(mailJobs).toHaveLength(1); expect(await rows('autopilot.handoff')).toHaveLength(1);
    await db.delete(S.outboxEmails).where(like(S.outboxEmails.subject, '%Autopilot tests%'));
  });
  it('owner email jobs persist exact payloads and explicit retry revives terminal failure with same job id', async () => {
    await setAutopilot(await context(), true); const a = autopilotOf(await getBiz(bid));
    expect(await enqueueHandoff(bid, a.activationId!, { date, ready: true, items: [{ key: 'one', title: 'Manual action', reason: 'Needs owner', href: businessHref(bid, '/brief') }] })).toBe(1);
    const [mail] = await rows('autopilot.handoff'); expect(mail.payload).toMatchObject({ day: date, items: [{ key: 'one' }] });
    await db.update(S.jobs).set({ status: 'failed', attempts: 4 }).where(eq(S.jobs.id, mail.id));
    await requestAutopilotRun(await context());
    const [retried] = await rows('autopilot.handoff'); expect(retried.id).toBe(mail.id); expect(retried.status).toBe('queued'); expect(retried.payload).toEqual(mail.payload); expect(retried.attempts).toBe(0);
    // The retry run finds a blog to connect, but the day's email already exists: the same job, never a second one.
    await runAutopilot({ ...runCtx(a.activationId!), payload: { activationId: a.activationId!, retry: true } });
    expect((await rows('autopilot.handoff')).map(j => j.id)).toEqual([mail.id]);
  });
  it('master social generation overrides saved draft pause, queues once and schedules saved packs without duplicates', async () => {
    await db.update(S.businesses).set({ socialAuto: { on: false, post: 'library', freq: 'daily', platforms: ['x'], time: '00:00', style: 'branded' } }).where(eq(S.businesses.id, bid));
    await db.insert(S.socialAccounts).values({ businessId: bid, ch: 'x', name: 'Test', remoteId: 'test', tokensEnc: encrypt({ access_token: 'stub', stub: true }) });
    await setAutopilot(await context(), true); const a = autopilotOf(await getBiz(bid));
    await runAutopilot(runCtx(a.activationId!)); await runAutopilot(runCtx(a.activationId!));
    const jobs = await rows('social.autoRun'); expect(jobs).toHaveLength(1); expect(jobs[0].maxAttempts).toBe(3);
    await jobDefs().get('social.autoRun')!.run({ ...runCtx(a.activationId!), job: jobs[0], payload: jobs[0].payload });
    await runAutopilot(runCtx(a.activationId!)); await runAutopilot(runCtx(a.activationId!));
    const posts = await db.select().from(S.socialPubs).where(eq(S.socialPubs.businessId, bid));
    expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ status: 'scheduled', autopilotActivationId: a.activationId, platform: 'x' });
    expect((await getBiz(bid)).socialAuto).toMatchObject({ on: false, post: 'library' });
    // The existing guarded publisher finishes the prepared program post through its normal stub adapter.
    await db.update(S.socialPubs).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(S.socialPubs.id, posts[0].id));
    const claimed = await claimScheduled(posts[0].id); expect(claimed).not.toBeNull();
    expect((await runSend(claimed!, { manual: false }))?.status).toBe('posted');
    expect(await claimScheduled(posts[0].id)).toBeNull();
  }, 30_000);
  it('a concurrent manual publication cannot be overwritten by the program scheduling upsert', async () => {
    await setAutopilot(await context(), true); const a = autopilotOf(await getBiz(bid));
    const [account] = await db.insert(S.socialAccounts).values({ businessId: bid, ch: 'x', name: 'Test', remoteId: 'test', tokensEnc: encrypt({ access_token: 'stub', stub: true }) }).returning();
    const packId = await createPack(bid, { source: { kind: 'idea', label: 'A manual choice' }, platforms: ['x'], style: 'branded' });
    const sid = `s:${packId}:x`; const r = await resolve(bid, sid);
    const [manual] = await db.insert(S.socialPubs).values({ businessId: bid, src: 'pack', platform: 'x', sid, acctId: account.id, ch: 'x', acctLabel: 'Test', status: 'scheduled', date: addDays(date, 5), time: '15:00', dueAt: new Date(Date.now() + 5 * 86400_000), createdBy: uid }).returning();
    expect(await writeScheduled(db, { biz: await getBiz(bid), r, date: addDays(date, 1), time: '08:00', userId: null, auto: true, autopilotActivationId: a.activationId! })).toBeNull();
    const [saved] = await db.select().from(S.socialPubs).where(eq(S.socialPubs.id, manual.id)); expect(saved.date).toBe(manual.date); expect(saved.autopilotActivationId).toBeNull(); expect(saved.createdBy).toBe(uid);
  }, 30_000);
  it('revoking while media uploads prevents the remote create call', async () => {
    await setAutopilot(await context(), true); const a = autopilotOf(await getBiz(bid));
    const [account] = await db.insert(S.socialAccounts).values({ businessId: bid, ch: 'x', name: 'Test', remoteId: 'test', tokensEnc: encrypt({ access_token: 'stub', stub: true }) }).returning();
    const packId = await createPack(bid, { source: { kind: 'idea', label: 'A paused post' }, platforms: ['x'], style: 'branded' });
    const [post] = await db.insert(S.socialPubs).values({ businessId: bid, src: 'pack', platform: 'x', sid: `s:${packId}:x`, acctId: account.id, ch: 'x', acctLabel: 'Test', status: 'scheduled', date, time: '08:00', dueAt: new Date(Date.now() - 1000), autopilotActivationId: a.activationId }).returning();
    const create = vi.fn(stubAdapter('x').create);
    setAdapterForTests('x', { ...stubAdapter('x'), upload: async () => { await setAutopilot(await context(), false); return 'uploaded'; }, create });
    const claimed = await claimScheduled(post.id); expect(claimed).not.toBeNull();
    expect((await runSend(claimed!, { manual: false }))?.status).toBe('failed'); expect(create).not.toHaveBeenCalled();
  }, 30_000);
  it('autonomous generation fails closed if the billing access check cannot complete', async () => {
    await setAutopilot(await context(), true); const a = autopilotOf(await getBiz(bid));
    vi.spyOn(access, 'bizAccess').mockRejectedValue(new Error('database unavailable'));
    expect(await canRun(bid, a.activationId)).toBe(false);
    vi.mocked(access.bizAccess).mockResolvedValue(false);
    expect(await canRun(bid, a.activationId)).toBe(false);
    expect(await runAutopilot(runCtx(a.activationId!))).toMatchObject({ skipped: 'autopilot_off_or_no_access' });
    expect(await rows('calendar.generate')).toHaveLength(0);
  });
  it('disable removes only unsent program schedules, retaining manual schedules and never sends revoked rows', async () => {
    await setAutopilot(await context(), true); const a = autopilotOf(await getBiz(bid));
    const [account] = await db.insert(S.socialAccounts).values({ businessId: bid, ch: 'x', name: 'Test', remoteId: 'test', tokensEnc: 'unused' }).returning();
    const p = { businessId: bid, src: 'pack' as const, platform: 'x' as const, acctId: account.id, ch: 'x' as const, acctLabel: 'Test', status: 'scheduled' as const, date, time: '08:00', dueAt: new Date(Date.now() - 60_000) };
    const [auto] = await db.insert(S.socialPubs).values({ ...p, sid: 's:auto:x', autopilotActivationId: a.activationId }).returning();
    const [manual] = await db.insert(S.socialPubs).values({ ...p, sid: 's:manual:x' }).returning();
    await setAutopilot(await context(), false);
    expect(await claimScheduled(auto.id)).toBeNull(); expect((await claimScheduled(manual.id))?.status).toBe('sending');
    expect(await db.select().from(S.socialPubs).where(eq(S.socialPubs.id, auto.id))).toHaveLength(0);
  });
  it('an unconnected channel is the owner\'s to fix: told once, never reported as a service failure, other channels still scheduled', async () => {
    const reported = vi.spyOn(failures, 'reportFailure').mockResolvedValue();
    await db.insert(S.socialAccounts).values({ businessId: bid, ch: 'x', name: 'Test', remoteId: 'test', tokensEnc: encrypt({ access_token: 'stub', stub: true }) });
    await setAutopilot(await context(), true); const a = autopilotOf(await getBiz(bid));
    const post = (id: string, pl: 'x' | 'linkedin', acct?: 'company') => ({ id, kind: 'post', pl, plats: [pl], ...(acct ? { acct } : {}), title: 'Post ' + id, tag: 'An idea', why: 'Relevant', drafts: { [pl]: 'Prepared ' + id }, edits: {}, mention: false, st: 'open' });
    await db.insert(S.briefDays).values({ businessId: bid, date, scannedAt: '08:00', items: [post('li-profile', 'linkedin'), post('li-page', 'linkedin', 'company'), post('x-ok', 'x')] });
    await runAutopilot(runCtx(a.activationId!)); await runAutopilot(runCtx(a.activationId!)); await runAutopilot(runCtx(a.activationId!));
    expect(reported.mock.calls.map(c => [c[1].operation, (c[0] as any)?.code])).toEqual([]);
    const told = (await rows('autopilot.handoff')).flatMap(j => (j.payload as any).items as { key: string }[]).map(i => i.key).filter(k => /li[-_]/.test(k));
    expect(told.sort()).toEqual(['social:li_page', 'social:li_profile']);
    const pubs = await db.select().from(S.socialPubs).where(eq(S.socialPubs.businessId, bid));
    expect(pubs.map(p => [p.platform, p.status])).toEqual([['x', 'scheduled']]);
    expect(autopilotOf(await getBiz(bid)).lastError).toBeNull();
  }, 30_000);
  it('a generated daily post for an unconnected channel is handed to the owner without a failure report', async () => {
    const reported = vi.spyOn(failures, 'reportFailure').mockResolvedValue();
    await db.update(S.businesses).set({ socialAuto: { on: false, post: 'library', freq: 'daily', platforms: ['linkedin'], time: '00:00', style: 'branded' } }).where(eq(S.businesses.id, bid));
    await db.insert(S.briefDays).values({ businessId: bid, date, scannedAt: '08:00', items: [] });
    await setAutopilot(await context(), true); const a = autopilotOf(await getBiz(bid));
    await runAutopilot(runCtx(a.activationId!));
    const [job] = await rows('social.autoRun');
    await jobDefs().get('social.autoRun')!.run({ ...runCtx(a.activationId!), job, payload: job.payload });
    await runAutopilot(runCtx(a.activationId!)); await runAutopilot(runCtx(a.activationId!));
    expect(reported.mock.calls.map(c => [c[1].operation, (c[0] as any)?.code])).toEqual([]);
    const told = (await rows('autopilot.handoff')).flatMap(j => (j.payload as any).items as { key: string; title: string }[]).filter(i => /pack:|social:/.test(i.key));
    expect(told.map(i => [i.key, i.title])).toEqual([['social:li_profile', 'Your linkedin post needs attention']]);
    expect(await db.select().from(S.socialPubs).where(eq(S.socialPubs.businessId, bid))).toHaveLength(0);
  }, 30_000);
  it('a refusal the owner cannot fix is reported: an expired account stays quiet, a schedule in the past does not', async () => {
    const reported = vi.spyOn(failures, 'reportFailure').mockResolvedValue();
    const real = scheduling.scheduleChecks;
    const [account] = await db.insert(S.socialAccounts).values({ businessId: bid, ch: 'x', name: 'Test', remoteId: 'test', expired: true, tokensEnc: encrypt({ access_token: 'stub', stub: true }) }).returning();
    await setAutopilot(await context(), true); const a = autopilotOf(await getBiz(bid));
    await db.insert(S.briefDays).values({ businessId: bid, date, scannedAt: '08:00', items: [{ id: 'x-1', kind: 'post', pl: 'x', plats: ['x'], title: 'Post', tag: 'An idea', why: 'Relevant', drafts: { x: 'Prepared' }, edits: {}, mention: false, st: 'open' }] });
    await runAutopilot(runCtx(a.activationId!));
    expect(reported.mock.calls.map(c => (c[0] as any)?.code)).toEqual([]);
    await db.update(S.socialAccounts).set({ expired: false }).where(eq(S.socialAccounts.id, account.id));
    vi.spyOn(scheduling, 'scheduleChecks').mockImplementation((biz, r, _date, time, nowMs) => real(biz, r, addDays(date, -1), time, nowMs));
    await runAutopilot(runCtx(a.activationId!));
    expect(reported.mock.calls.map(c => [c[1].operation, (c[0] as any)?.code])).toEqual([['autopilot.scheduleBrief', 'past']]);
  }, 30_000);
  it('an unexpected scheduling error is still reported as a failure', async () => {
    const reported = vi.spyOn(failures, 'reportFailure').mockResolvedValue();
    vi.spyOn(scheduling, 'scheduleChecks').mockRejectedValue(new Error('storage unavailable'));
    await db.insert(S.socialAccounts).values({ businessId: bid, ch: 'x', name: 'Test', remoteId: 'test', tokensEnc: encrypt({ access_token: 'stub', stub: true }) });
    await setAutopilot(await context(), true); const a = autopilotOf(await getBiz(bid));
    await db.insert(S.briefDays).values({ businessId: bid, date, scannedAt: '08:00', items: [{ id: 'x-1', kind: 'post', pl: 'x', plats: ['x'], title: 'Post', tag: 'An idea', why: 'Relevant', drafts: { x: 'Prepared' }, edits: {}, mention: false, st: 'open' }] });
    await runAutopilot(runCtx(a.activationId!));
    expect(reported.mock.calls.map(c => [c[1].operation, (c[0] as Error).message])).toEqual([['autopilot.scheduleBrief', 'storage unavailable']]);
    expect((await rows('autopilot.handoff')).flatMap(j => (j.payload as any).items as { key: string }[]).some(i => i.key === `brief:${date}:x-1`)).toBe(true);
  }, 30_000);

  // One owner email per business-local day. Simulated days are in the past of the real clock: the outbox compares
  // Date.now() with a database timestamp, and "not ready yet" would be false on the real clock late in the evening.
  describe('daily owner email cadence', () => {
    const NY = 'America/New_York', D0 = '2026-11-08', D1 = '2026-11-09', D2 = '2026-11-10', D3 = '2026-11-11', D4 = '2026-11-12', D5 = '2026-11-13';
    let act = '', tz = NY;
    const at = (day: string, hm: string) => vi.setSystemTime(zonedTimeToUtc(day, hm, tz));
    const run = () => runAutopilot(runCtx(act));
    const mails = async () => (await rows('autopilot.handoff')).map(j => j.payload as { day?: string; activationId: string; items: { key: string; title: string }[] }).sort((a, b) => (a.day || '').localeCompare(b.day || ''));
    const keys = async (day: string) => (await mails()).filter(m => m.day === day).flatMap(m => m.items.map(i => i.key)).sort();
    const marks = async () => (await db.select().from(S.cronMarks).where(like(S.cronMarks.key, `%${bid}%`))).map(m => m.key);
    const told = async (key: string) => (await marks()).includes(`autopilot-handoff:${bid}:${act}:${key}`);
    const reply = (id: string) => ({ id, kind: 'reply', plat: 'reddit', title: 'Thread ' + id, url: 'https://www.reddit.com/r/test/comments/' + id, tag: 'A question', why: 'Relevant', drafts: { help: 'Reply ' + id }, edits: {}, mention: false, st: 'open' });
    const feed = (id: string, pl: 'x' | 'linkedin', text = 'Prepared ' + id) => ({ id, kind: 'post', pl, plats: [pl], title: 'Post ' + id, tag: 'An idea', why: 'Relevant', drafts: { [pl]: text }, edits: {}, mention: false, st: 'open' });
    const brief = (day: string, items: unknown[] = []) => db.insert(S.briefDays).values({ businessId: bid, date: day, scannedAt: '08:00', items: items as any }).onConflictDoUpdate({ target: [S.briefDays.businessId, S.briefDays.date], set: { items: items as any } });
    const packId = (day: string) => `auto-${bid}-${day}`;
    const pack = (day: string, posts: Record<string, { text: string; copiedAt: number | null }>) => db.insert(S.socialPacks).values({ id: packId(day), businessId: bid, data: { id: packId(day), name: 'Daily post', created: day, auto: true, style: 'branded', source: { kind: 'idea', label: 'An idea' }, posts } });
    const blog = () => db.insert(S.connections).values({ businessId: bid, type: 'wordpress', url: 'https://blog.autopilot.test' });
    const account = async (ch: 'x' | 'li_profile' = 'x') => (await db.insert(S.socialAccounts).values({ businessId: bid, ch, name: 'Test', remoteId: 'test-' + ch, tokensEnc: encrypt({ access_token: 'stub', stub: true }) }).returning())[0];
    const failedPost = async (acctId: string, sid: string) => (await db.insert(S.socialPubs).values({ businessId: bid, src: 'pack', platform: 'x', sid, acctId, ch: 'x', acctLabel: 'Test', status: 'failed', date: D1, time: '08:00', dueAt: new Date(zonedTimeToUtc(D1, '08:00', tz)), autopilotActivationId: act }).returning())[0];
    /** Autopilot turned on at noon the day before, daily social time 08:00; no daily pack is due unless `social` names platforms. */
    async function program(o: { zone?: string; social?: string[]; enabled?: [string, string] } = {}) {
      tz = o.zone || NY;
      await db.update(S.businesses).set({ timezone: tz, socialAuto: { on: false, post: 'library', freq: o.social ? 'daily' : 'custom', days: [], platforms: o.social || ['x'], time: '08:00', style: 'branded' } }).where(eq(S.businesses.id, bid));
      vi.useFakeTimers({ toFake: ['Date'] }); at(...(o.enabled || [D0, '12:00']));
      await setAutopilot(await context(), true); act = autopilotOf(await getBiz(bid)).activationId!;
    }

    it('sends nothing before the daily time, then one email with the day\'s work; a late reply waits and is dropped at midnight (A1, A4)', async () => {
      await program({ social: ['reddit'] });
      await brief(D1, [reply('r1'), reply('r2')]);
      at(D1, '07:55'); await run(); expect(await mails()).toHaveLength(0);
      await pack(D1, { reddit: { text: 'Daily reddit draft', copiedAt: null } });
      at(D1, '08:10'); await run();
      expect(await mails()).toHaveLength(1);
      expect(await keys(D1)).toEqual(['blog', `brief:${D1}:r1`, `brief:${D1}:r2`, `pack:${packId(D1)}:reddit`]);
      at(D1, '08:15'); await run(); at(D1, '11:00'); await brief(D1, [reply('r1'), reply('r2'), reply('late')]);
      for (const hm of ['11:05', '13:00', '23:55']) { at(D1, hm); await run(); }
      expect(await mails()).toHaveLength(1); expect(await told(`brief:${D1}:late`)).toBe(false);
      await brief(D2, [reply('n1')]); await pack(D2, { reddit: { text: 'Next reddit draft', copiedAt: null } });
      at(D2, '08:10'); await run(); await run();
      expect(await mails()).toHaveLength(2);
      expect(await keys(D2)).toEqual([`brief:${D2}:n1`, `pack:${packId(D2)}:reddit`]);
    }, 30_000);

    it('waits for the brief until two hours after the daily time, then sends what it has (A2)', async () => {
      await program();
      for (const hm of ['08:10', '09:55']) { at(D1, hm); await run(); expect(await mails()).toHaveLength(0); }
      at(D1, '10:00'); await run();
      expect(await keys(D1)).toEqual(['blog']); expect(await mails()).toHaveLength(1);
    }, 30_000);

    it('a program turned on in the afternoon sends its first email when the first brief is ready (A3)', async () => {
      await program({ enabled: [D1, '15:00'] });
      at(D1, '15:01'); await run(); expect(await mails()).toHaveLength(0);
      await brief(D1, [reply('r1')]);
      at(D1, '15:20'); await run();
      expect(await keys(D1)).toEqual(['blog', `brief:${D1}:r1`]);
    }, 30_000);

    it('a program turned on in the afternoon whose brief never arrives sends two hours after it started (A3)', async () => {
      await program({ enabled: [D1, '15:00'] });
      at(D1, '16:59'); await run(); expect(await mails()).toHaveLength(0);
      at(D1, '17:00'); await run(); expect(await keys(D1)).toEqual(['blog']);
    }, 30_000);

    it('a post that fails after the day\'s email is in the next day\'s email only while it is still failed (A5)', async () => {
      await program(); const x = await account();
      at(D1, '10:00'); await run(); expect(await keys(D1)).toEqual(['blog']);
      at(D1, '14:00'); const stays = await failedPost(x.id, 's:stays:x'), fixed = await failedPost(x.id, 's:fixed:x');
      for (const hm of ['14:05', '20:00']) { at(D1, hm); await run(); }
      expect(await mails()).toHaveLength(1);
      await db.update(S.socialPubs).set({ status: 'posted' }).where(eq(S.socialPubs.id, fixed.id));
      await brief(D2); at(D2, '08:10'); await run();
      expect(await keys(D2)).toEqual([`failed-post:${stays.id}`]);
      at(D3, '10:00'); await run(); expect(await mails()).toHaveLength(2);
    }, 30_000);

    it('a hand-published daily post that missed its day\'s email is carried one day, unless it was copied (A6)', async () => {
      await program({ social: ['reddit', 'facebook'] });
      at(D1, '10:00'); await run(); expect(await keys(D1)).toEqual(['blog']);
      at(D1, '11:00'); await pack(D1, { reddit: { text: 'Late reddit draft', copiedAt: null }, facebook: { text: 'Late facebook draft', copiedAt: null } });
      at(D1, '11:05'); await run(); expect(await mails()).toHaveLength(1);
      await db.update(S.socialPacks).set({ data: { id: packId(D1), name: 'Daily post', source: { kind: 'idea', label: 'An idea' }, posts: { reddit: { text: 'Late reddit draft', copiedAt: null }, facebook: { text: 'Late facebook draft', copiedAt: 1 } } } }).where(eq(S.socialPacks.id, packId(D1)));
      await brief(D2); await pack(D2, { reddit: { text: 'Second reddit draft', copiedAt: null } });
      at(D2, '08:10'); await run();
      expect(await keys(D2)).toEqual([`pack:${packId(D1)}:reddit`, `pack:${packId(D2)}:reddit`]);
    }, 30_000);

    it('a hand-published daily post nobody was told about is dropped after the next day (A6)', async () => {
      await program({ social: ['reddit'] });
      at(D1, '10:00'); await run();
      at(D1, '11:00'); await pack(D1, { reddit: { text: 'Late reddit draft', copiedAt: null } });
      // No run on D2 at all.
      await brief(D3); await pack(D3, { reddit: { text: 'Third reddit draft', copiedAt: null } });
      at(D3, '08:10'); await run();
      expect(await keys(D3)).toEqual([`pack:${packId(D3)}:reddit`]);
    }, 30_000);

    it('a quiet morning sends nothing; the first problem of the day is emailed at once and the second waits for tomorrow (A7)', async () => {
      await program(); await blog(); const x = await account(); await brief(D1);
      for (const hm of ['08:10', '12:00']) { at(D1, hm); await run(); }
      expect(await mails()).toHaveLength(0); expect(await marks()).not.toContain(`autopilot-day:${bid}:${D1}`);
      at(D1, '15:00'); const first = await failedPost(x.id, 's:first:x');
      at(D1, '15:05'); await run(); expect(await keys(D1)).toEqual([`failed-post:${first.id}`]);
      at(D1, '16:00'); const second = await failedPost(x.id, 's:second:x');
      at(D1, '16:05'); await run(); expect(await mails()).toHaveLength(1);
      await brief(D2); at(D2, '08:10'); await run();
      expect(await keys(D2)).toEqual([`failed-post:${second.id}`]); expect(await mails()).toHaveLength(2);
    }, 30_000);

    it('two runs at the same moment produce one email and one day mark (A8)', async () => {
      await program(); await brief(D1, [reply('r1')]);
      at(D1, '08:10'); await Promise.all([run(), run(), run()]);
      expect(await mails()).toHaveLength(1);
      expect((await marks()).filter(k => k.startsWith('autopilot-day:'))).toEqual([`autopilot-day:${bid}:${D1}`]);
      expect(await keys(D1)).toEqual(['blog', `brief:${D1}:r1`]);
    }, 30_000);

    it('a delivery the provider refused is retried as the identical email under the same key, and sent once (A9)', async () => {
      await program(); vi.spyOn(failures, 'reportFailure').mockResolvedValue();
      await brief(D1, [reply('r1')]); at(D1, '08:10'); await run();
      const [job] = await rows('autopilot.handoff'); const c = { ...runCtx(act), job, payload: job.payload as any, attempt: 1 };
      const provider = vi.fn().mockResolvedValueOnce(new Response('unavailable', { status: 503 })).mockResolvedValue(new Response('{"id":"ok"}'));
      vi.stubGlobal('fetch', provider); const key = env.resendKey; env.resendKey = 'test-not-real';
      try {
        await expect(deliverHandoff(c)).rejects.toThrow('Resend 503');
        expect(await deliverHandoff(c)).toEqual({ count: 2 }); await deliverHandoff(c); await deliverHandoff(c);
      } finally { env.resendKey = key; }
      expect(provider).toHaveBeenCalledTimes(2);
      expect(provider.mock.calls[0][1].body).toBe(provider.mock.calls[1][1].body);
      expect(provider.mock.calls.map(call => call[1].headers['Idempotency-Key'])).toEqual([`autopilot-handoff:${job.id}`, `autopilot-handoff:${job.id}`]);
      const outbox = await db.select().from(S.outboxEmails).where(like(S.outboxEmails.text, `%${bid}%`));
      expect(outbox.map(m => m.status)).toEqual(['sent']);
      await db.delete(S.outboxEmails).where(like(S.outboxEmails.text, `%${bid}%`));
    }, 30_000);

    it('turning Autopilot off and on again sends no second email that day; the new program tells its standing problems the next day (A11)', async () => {
      await program(); at(D1, '10:00'); await run();
      const [first] = await rows('autopilot.handoff'); const old = act;
      await setAutopilot(await context(), false); await setAutopilot(await context(), true); act = autopilotOf(await getBiz(bid)).activationId!;
      expect(act).not.toBe(old);
      for (const hm of ['10:10', '12:30', '18:00']) { at(D1, hm); await run(); }
      expect(await mails()).toHaveLength(1); expect(await told('blog')).toBe(false);
      expect(await deliverHandoff({ ...runCtx(old), job: first, payload: first.payload as any, attempt: 1 })).toEqual({ skipped: 'autopilot_off' });
      at(D2, '10:00'); await run();
      expect((await mails()).map(m => [m.day, m.activationId, m.items.map(i => i.key)])).toEqual([[D1, old, ['blog']], [D2, act, ['blog']]]);
    }, 30_000);

    it('a missing blog connection is told once, not daily, and again only after it was fixed and broke again (A12)', async () => {
      await program();
      for (const day of [D1, D2, D3]) { at(day, '10:05'); await run(); }
      expect((await mails()).map(m => [m.day, m.items.map(i => i.key)])).toEqual([[D1, ['blog']]]);
      await blog(); at(D4, '10:05'); await run();
      expect(await told('blog')).toBe(false); expect(await mails()).toHaveLength(1);
      await db.delete(S.connections).where(eq(S.connections.businessId, bid));
      at(D5, '10:05'); await run();
      expect((await mails()).map(m => [m.day, m.items.map(i => i.key)])).toEqual([[D1, ['blog']], [D5, ['blog']]]);
    }, 30_000);

    it('an unconnected LinkedIn account is one item however many posts it holds up, told once until it is fixed and breaks again (A13)', async () => {
      await program({ social: ['linkedin'] }); await blog(); vi.spyOn(failures, 'reportFailure').mockResolvedValue();
      const day = async (d: string, withPack = true) => { await brief(d, [feed('a', 'linkedin'), feed('b', 'linkedin')]); if (withPack) await pack(d, { linkedin: { text: 'Daily LinkedIn draft', copiedAt: null } }); at(d, '10:05'); await run(); };
      await day(D1);
      expect((await mails()).map(m => [m.day, m.items.map(i => i.key)])).toEqual([[D1, ['social:li_profile']]]);
      await day(D2); expect(await mails()).toHaveLength(1);
      const li = await account('li_profile'); await day(D3, false);
      expect(await told('social:li_profile')).toBe(false); expect(await mails()).toHaveLength(1);
      expect((await db.select().from(S.socialPubs).where(eq(S.socialPubs.businessId, bid))).map(p => [p.ch, p.status])).toEqual([['li_profile', 'scheduled'], ['li_profile', 'scheduled']]);
      await db.update(S.socialAccounts).set({ expired: true }).where(eq(S.socialAccounts.id, li.id));
      at(D4, '10:05'); await run(); at(D5, '10:05'); await run();
      expect((await mails()).map(m => [m.day, m.items.map(i => i.key)])).toEqual([[D1, ['social:li_profile']], [D4, ['social:li_profile']]]);
    }, 30_000);

    it('a standing problem on its own still gets its one email (A14)', async () => {
      await program(); await blog();
      await db.update(S.businesses).set({ blog: { mode: 'review', paused: true } }).where(eq(S.businesses.id, bid));
      at(D1, '10:05'); await run(); at(D2, '10:05'); await run();
      expect((await mails()).map(m => [m.day, m.items.map(i => i.key)])).toEqual([[D1, ['blog-paused']]]);
    }, 30_000);

    it('a reply the owner already copied no longer needs them and is left out', async () => {
      await program(); await blog();
      await brief(D1, [reply('open'), { ...reply('copied'), st: 'copied' }, { ...reply('posted'), st: 'posted' }]);
      at(D1, '08:10'); await run();
      expect(await keys(D1)).toEqual([`brief:${D1}:open`]);
    }, 30_000);

    it('a step that keeps failing and a blocked brief source are told once, and again only after a success in between', async () => {
      await program(); await blog();
      const job = (kind: string, d: string, status: 'done' | 'failed', result?: unknown) => db.insert(S.jobs).values({ kind, businessId: bid, ref: d, status, result: result as any, createdAt: new Date(zonedTimeToUtc(d, '06:00', NY)), payload: { autopilotActivationId: act } });
      const day = async (d: string, ok: boolean) => { await job('calendar.generate', d, ok ? 'done' : 'failed'); await job('brief.scan', d, 'done', ok ? {} : { failed: 'reddit' }); at(d, '10:05'); await run(); };
      const both = ['brief-source', 'job:calendar.generate'];
      await day(D1, false); await day(D2, false);
      expect((await mails()).map(m => [m.day, m.items.map(i => i.key).sort()])).toEqual([[D1, both]]);
      expect((await mails())[0].items.map(i => i.title).sort()).toEqual(['A Daily Brief source is unavailable', 'Calendar research needs attention']);
      await day(D3, true);
      expect([await told('brief-source'), await told('job:calendar.generate')]).toEqual([false, false]);
      await day(D4, false);
      expect((await mails()).map(m => [m.day, m.items.map(i => i.key).sort()])).toEqual([[D1, both], [D4, both]]);
    }, 30_000);

    it('a stage that fails every run is told once, not every day', async () => {
      await program(); await blog(); vi.spyOn(failures, 'reportFailure').mockResolvedValue();
      const real = briefStore.getDay; const broken = vi.spyOn(briefStore, 'getDay').mockRejectedValue(new Error('storage unavailable'));
      for (const d of [D1, D2]) { at(d, '10:05'); await run(); }
      expect((await mails()).map(m => [m.day, m.items.map(i => i.key)])).toEqual([[D1, ['stage:Daily Brief']]]);
      broken.mockImplementation(real); at(D3, '10:05'); await run();
      expect(await told('stage:Daily Brief')).toBe(false);
      broken.mockRejectedValue(new Error('storage unavailable')); at(D4, '10:05'); await run();
      expect((await mails()).map(m => m.day)).toEqual([D1, D4]);
    }, 30_000);

    it('an account that expires after its post was emailed for a publishing check is still announced, once (QA-1)', async () => {
      await program({ social: ['x'] }); await blog(); const x = await account(); vi.spyOn(failures, 'reportFailure').mockResolvedValue();
      const long = 'word '.repeat(80);
      const day = async (d: string, hm = '10:05') => { await brief(d, [feed('long', 'x', long)]); await pack(d, { x: { text: long, copiedAt: null } }).onConflictDoNothing(); at(d, hm); await run(); };
      await day(D1, '08:10');
      expect(await keys(D1)).toEqual([`brief:${D1}:long`, `pack:${packId(D1)}:x`]);
      at(D1, '12:00'); await db.update(S.socialAccounts).set({ expired: true }).where(eq(S.socialAccounts.id, x.id));
      at(D1, '12:05'); await run(); expect(await mails()).toHaveLength(1); expect(await told('social:x')).toBe(false);
      await day(D2); await day(D3);
      expect((await mails()).map(m => [m.day, m.items.map(i => i.key)])).toEqual([[D1, [`pack:${packId(D1)}:x`, `brief:${D1}:long`]], [D2, ['social:x']]]);
    }, 30_000);

    it('a program turned on today does not carry yesterday\'s hand-published post into its first email', async () => {
      await program({ social: ['reddit'], enabled: [D2, '07:00'] });
      await pack(D1, { reddit: { text: 'Yesterday reddit draft', copiedAt: null } }); await pack(D2, { reddit: { text: 'Today reddit draft', copiedAt: null } }); await brief(D2);
      at(D2, '08:10'); await run();
      expect(await keys(D2)).toEqual(['blog', `pack:${packId(D2)}:reddit`]);
    }, 30_000);

    it('a post that fails its own publishing check is that day\'s work, not a standing account problem (A15)', async () => {
      await program(); await blog(); await account(); const reported = vi.spyOn(failures, 'reportFailure').mockResolvedValue();
      for (const d of [D1, D2]) { await brief(d, [feed('long', 'x', 'word '.repeat(80))]); at(d, '10:05'); await run(); }
      expect((await mails()).map(m => [m.day, m.items.map(i => i.key)])).toEqual([[D1, [`brief:${D1}:long`]], [D2, [`brief:${D2}:long`]]]);
      expect(await told('social:x')).toBe(false); expect(reported).not.toHaveBeenCalled();
    }, 30_000);

    it('the day is the business\'s local day: two emails on one UTC date, and a run that crosses midnight sends none (A16)', async () => {
      await program({ zone: 'Pacific/Auckland' }); await blog(); const x = await account();
      const night = await failedPost(x.id, 's:night:x');
      at(D1, '23:50'); const utc = new Date().toISOString().slice(0, 10); await run();
      const morning = await failedPost(x.id, 's:morning:x'); await brief(D2);
      at(D2, '08:10'); expect(new Date().toISOString().slice(0, 10)).toBe(utc); await run();
      expect((await mails()).map(m => [m.day, m.items.map(i => i.key)])).toEqual([[D1, [`failed-post:${night.id}`]], [D2, [`failed-post:${morning.id}`]]]);
      // A run that began on D3 and reaches the email step after local midnight.
      at(D4, '00:01');
      expect(await enqueueHandoff(bid, act, { date: D3, ready: true, items: [{ key: 'crossing', title: 'Late', reason: 'Needs owner', href: businessHref(bid, '/brief') }] })).toBe(0);
      expect(await mails()).toHaveLength(2); expect(await marks()).not.toContain(`autopilot-day:${bid}:${D3}`); expect(await told('crossing')).toBe(false);
    }, 30_000);

    it('rollout: a batch the old code already sent today counts as today\'s email; nothing more goes out that day (A18)', async () => {
      await program({ social: ['linkedin'] }); vi.spyOn(failures, 'reportFailure').mockResolvedValue();
      const P = `autopilot-handoff:${bid}:${act}:`;
      await db.insert(S.cronMarks).values([{ key: `${P}blog:${D1}` }, { key: `${P}pack:${packId(D1)}:linkedin` }]);
      await db.insert(S.jobs).values({ kind: 'autopilot.handoff', businessId: bid, status: 'done', maxAttempts: 4, createdAt: new Date(zonedTimeToUtc(D1, '00:20', NY)), payload: { activationId: act, ownerId: uid, name: 'Autopilot tests', items: [{ key: `blog:${D1}`, title: 'Connect your publishing destination', reason: '', href: '' }] } });
      await brief(D1, [reply('r1')]); await pack(D1, { linkedin: { text: 'Daily LinkedIn draft', copiedAt: null } });
      at(D1, '10:05'); await run(); at(D1, '15:00'); await run();
      expect(await mails()).toHaveLength(1); expect((await mails())[0].day).toBeUndefined();
      expect(await marks()).toContain(`autopilot-day:${bid}:${D1}`);
      expect([await told('blog'), await told('social:li_profile')]).toEqual([true, true]);
      await brief(D2, [reply('n1')]); await pack(D2, { linkedin: { text: 'Next LinkedIn draft', copiedAt: null } });
      at(D2, '08:10'); await run();
      expect(await keys(D2)).toEqual([`brief:${D2}:n1`]);
    }, 30_000);

    it('rollout: problems the old code told yesterday under per-day keys are not told again by the first new email (A18)', async () => {
      await program({ social: ['linkedin'] }); vi.spyOn(failures, 'reportFailure').mockResolvedValue();
      const P = `autopilot-handoff:${bid}:${act}:`;
      await db.insert(S.cronMarks).values([`blog:${D1}`, `blog-paused:${D1}`, `pack:${packId(D1)}:linkedin`].map(k => ({ key: P + k })));
      await db.insert(S.jobs).values({ kind: 'autopilot.handoff', businessId: bid, status: 'done', maxAttempts: 4, createdAt: new Date(zonedTimeToUtc(D1, '08:20', NY)), payload: { activationId: act, ownerId: uid, name: 'Autopilot tests', items: [] } });
      await db.update(S.businesses).set({ blog: { mode: 'review', paused: true } }).where(eq(S.businesses.id, bid));
      await brief(D2, [reply('n1')]); await pack(D2, { linkedin: { text: 'Next LinkedIn draft', copiedAt: null } });
      at(D2, '08:10'); await run();
      expect((await mails()).filter(m => m.day).map(m => [m.day, m.items.map(i => i.key)])).toEqual([[D2, [`brief:${D2}:n1`]]]);
      expect([await told('blog'), await told('blog-paused'), await told('social:li_profile')]).toEqual([true, true, true]);
    }, 30_000);
  });
});
