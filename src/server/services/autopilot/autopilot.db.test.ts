import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { claimScheduled, runSend } from '../social/publish/send';
import { writeScheduled, resolve } from '../social/publish/schedule';
import { setAdapterForTests } from '../social/publish/accounts';
import { stubAdapter } from '../social/publish/stubs';
import { createPack } from '../social/generate';
import * as access from '@/server/billing/access';
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
    [{ id: uid }] = await db.insert(S.users).values({ name: 'Autopilot tests', email: `autopilot-${randomUUID()}@test.local` }).returning();
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
    await db.update(S.businesses).set({ autopilot: {}, blog: { mode: 'review' }, socialAuto: { on: false, post: 'library', freq: 'custom', days: [], platforms: ['x'], time: '00:00' }, calendarSettings: { cadence: 'custom', perWeek: 3 }, briefSetup: false }).where(eq(S.businesses.id, bid));
  });
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
  it('manual replies are handed to owner with selected edits; repeated runs dedupe and late arrivals are delivered', async () => {
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
    await runAutopilot(runCtx(a.activationId!)); expect((await rows('autopilot.handoff')).length).toBe(mailJobs.length + 1);
    await db.delete(S.outboxEmails).where(like(S.outboxEmails.subject, '%Autopilot tests%'));
  });
  it('owner email jobs persist exact payloads and explicit retry revives terminal failure with same job id', async () => {
    await setAutopilot(await context(), true); const a = autopilotOf(await getBiz(bid));
    await enqueueHandoff(bid, a.activationId!, [{ key: 'one', title: 'Manual action', reason: 'Needs owner', href: businessHref(bid, '/brief') }]);
    const [mail] = await rows('autopilot.handoff');
    await db.update(S.jobs).set({ status: 'failed', attempts: 4 }).where(eq(S.jobs.id, mail.id));
    await requestAutopilotRun(await context());
    const [retried] = await rows('autopilot.handoff'); expect(retried.id).toBe(mail.id); expect(retried.status).toBe('queued'); expect(retried.payload).toEqual(mail.payload); expect(retried.attempts).toBe(0);
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
});
