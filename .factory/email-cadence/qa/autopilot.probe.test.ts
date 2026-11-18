// Independent QA probes (EC-Q) for the Autopilot owner email: EC-01, EC-02, EC-03, EC-04, EC-06.
// Local database and a fake email provider only. Simulated days are in the past of the real clock.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; process.env.RADAR_SOCIAL_PUBLISHING = 'all'; process.env.RADAR_BILLING = 'off'; process.env.STORAGE_DIR = '.data/autopilot-tests'; });
import { and, eq, like } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, schema as S } from '@/server/db';
import { encrypt } from '@/server/crypto';
import { env } from '@/server/env';
import { defaultProfile, getBiz } from '@/server/workspace';
import { setAutopilot } from '@/server/services/autopilot/control';
import { autopilotOf } from '@/server/services/autopilot/policy';
import { runAutopilot } from '@/server/services/autopilot/run';
import { deliverHandoff, enqueueHandoff, businessHref } from '@/server/services/autopilot/handoff';
import { addDays, todayIn } from '@/lib/format';
import { zonedTimeToUtc } from '@/lib/socialPublish';
import * as failures from '@/server/observability/failures';
import type { JobCtx } from '@/server/jobs/queue';
import type { ActCtx } from '@/server/actions/define';
import '@/server/services/calendar/jobs';
import '@/server/services/social/jobs';
import '@/server/services/autopilot/jobs';

const NY = 'America/New_York', D0 = '2026-11-08', D1 = '2026-11-09', D2 = '2026-11-10';
const NAME = 'Cadence QA probe';
let uid = '', bid = '', act = '';
const profile = defaultProfile('cadence-qa.test'); profile.business.name = NAME;
type Mail = { day?: string; activationId: string; items: { key: string; title: string }[] };

describe.skipIf(!process.env.DATABASE_URL)('QA probes: Autopilot owner email', () => {
  const context = async () => ({ user: { id: uid, name: 'QA owner', email: 'qa@test.local' }, bid, role: 'Owner', biz: await getBiz(bid) } as ActCtx);
  const runCtx = (activationId: string): JobCtx<any> => ({ businessId: bid, payload: { activationId }, attempt: 1, job: { id: randomUUID(), maxAttempts: 3 } as any, progress: async () => {}, touch: async () => {} });
  const at = (day: string, hm: string) => vi.setSystemTime(zonedTimeToUtc(day, hm, NY));
  const run = () => runAutopilot(runCtx(act));
  const jobs = () => db.select().from(S.jobs).where(and(eq(S.jobs.businessId, bid), eq(S.jobs.kind, 'autopilot.handoff')));
  const mails = async () => (await jobs()).map(j => j.payload as Mail).sort((a, b) => (a.day || '').localeCompare(b.day || ''));
  const keys = async (day: string) => (await mails()).filter(m => m.day === day).flatMap(m => m.items.map(i => i.key)).sort();
  const marks = async () => (await db.select().from(S.cronMarks).where(like(S.cronMarks.key, `%${bid}%`))).map(m => m.key);
  const reply = (id: string) => ({ id, kind: 'reply', plat: 'reddit', title: 'Thread ' + id, url: 'https://www.reddit.com/r/test/comments/' + id, tag: 'A question', why: 'Relevant', drafts: { help: 'Reply ' + id }, edits: {}, mention: false, st: 'open' });
  const feed = (id: string, pl: 'x' | 'linkedin', text = 'Prepared ' + id) => ({ id, kind: 'post', pl, plats: [pl], title: 'Post ' + id, tag: 'An idea', why: 'Relevant', drafts: { [pl]: text }, edits: {}, mention: false, st: 'open' });
  const brief = (day: string, items: unknown[] = []) => db.insert(S.briefDays).values({ businessId: bid, date: day, scannedAt: '08:00', items: items as any }).onConflictDoUpdate({ target: [S.briefDays.businessId, S.briefDays.date], set: { items: items as any } });
  const packId = (day: string) => `auto-${bid}-${day}`;
  const pack = (day: string, posts: Record<string, { text: string; copiedAt: number | null }>) => db.insert(S.socialPacks).values({ id: packId(day), businessId: bid, data: { id: packId(day), name: 'Daily post', created: day, auto: true, style: 'branded', source: { kind: 'idea', label: 'An idea' }, posts } as any });
  const blog = () => db.insert(S.connections).values({ businessId: bid, type: 'wordpress', url: 'https://blog.cadence-qa.test' });
  const account = async (ch: 'x' | 'li_profile' = 'x') => (await db.insert(S.socialAccounts).values({ businessId: bid, ch, name: 'Test', remoteId: 'qa-' + ch, tokensEnc: encrypt({ access_token: 'stub', stub: true }) }).returning())[0];
  async function program(o: { social?: string[]; enabled?: [string, string] } = {}) {
    await db.update(S.businesses).set({ timezone: NY, socialAuto: { on: false, post: 'library', freq: o.social ? 'daily' : 'custom', days: [], platforms: o.social || ['x'], time: '08:00', style: 'branded' } as any }).where(eq(S.businesses.id, bid));
    vi.useFakeTimers({ toFake: ['Date'] }); at(...(o.enabled || [D0, '12:00']));
    await setAutopilot(await context(), true); act = autopilotOf(await getBiz(bid)).activationId!;
  }
  /** Deliver every queued owner email through a fake provider, as the worker would, and note the local day it left on. */
  const calls: { day: string; key: string; body: string }[] = [];
  async function deliverQueued() {
    const provider = vi.fn(async (_url: unknown, init: any) => { calls.push({ day: todayIn(NY, new Date()), key: init.headers['Idempotency-Key'], body: init.body }); return new Response('{"id":"qa"}'); });
    const key = env.resendKey; env.resendKey = 'test-not-real'; vi.stubGlobal('fetch', provider);
    try {
      for (const job of (await jobs()).filter(j => j.status === 'queued')) {
        await deliverHandoff({ ...runCtx((job.payload as Mail).activationId), job, payload: job.payload as any, attempt: 1 });
        await db.update(S.jobs).set({ status: 'done' }).where(eq(S.jobs.id, job.id));
      }
    } finally { env.resendKey = key; vi.unstubAllGlobals(); }
  }

  beforeAll(async () => {
    [{ id: uid }] = await db.insert(S.users).values({ name: 'Cadence QA', email: `cadence-qa-${randomUUID()}@test.local`, emailVerifiedAt: new Date() }).returning();
    [{ id: bid }] = await db.insert(S.businesses).values({ ownerId: uid, domain: profile.domain, profile, timezone: NY, status: 'active' }).returning();
  });
  beforeEach(async () => {
    vi.restoreAllMocks(); calls.length = 0;
    vi.spyOn(failures, 'reportFailure').mockResolvedValue();
    await db.delete(S.jobs).where(eq(S.jobs.businessId, bid));
    await db.delete(S.cronMarks).where(like(S.cronMarks.key, `%${bid}%`));
    for (const t of [S.calendarEntries, S.socialPacks, S.socialPubs, S.socialAccounts, S.briefDays, S.connections]) await db.delete(t).where(eq(t.businessId, bid));
    await db.delete(S.outboxEmails).where(like(S.outboxEmails.subject, `%${NAME}%`));
    await db.update(S.businesses).set({ timezone: NY, autopilot: {}, blog: { mode: 'review' }, calendarSettings: { cadence: 'custom', perWeek: 3 }, briefSetup: false } as any).where(eq(S.businesses.id, bid));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  afterAll(async () => {
    await db.delete(S.outboxEmails).where(like(S.outboxEmails.subject, `%${NAME}%`));
    await db.delete(S.cronMarks).where(like(S.cronMarks.key, `%${bid}%`));
    await db.delete(S.events).where(eq(S.events.businessId, bid));
    await db.delete(S.businesses).where(eq(S.businesses.id, bid));
    await db.delete(S.users).where(eq(S.users.id, uid));
  });

  it('EC-01/02/03/04: a week of daily replies, a never-connected LinkedIn and no blog gives one email per local day, the standing problems once', async () => {
    await program({ social: ['linkedin'] });
    const days = Array.from({ length: 7 }, (_, i) => addDays(D1, i));
    for (const d of days) {
      at(d, '00:10'); await run(); await deliverQueued();                       // brief not scanned yet
      await brief(d, [reply(d + '-a'), reply(d + '-b'), feed(d + '-li', 'linkedin')]);
      for (const hm of ['00:20', '03:00', '07:55']) { at(d, hm); await run(); await deliverQueued(); }
      expect((await mails()).filter(m => m.day === d), `before 08:00 on ${d}`).toHaveLength(0);
      await pack(d, { linkedin: { text: 'Daily LinkedIn draft ' + d, copiedAt: null } });
      for (const hm of ['08:05', '08:10', '08:15', '10:00', '10:05']) { at(d, hm); await run(); await deliverQueued(); }
      at(d, '11:00'); await brief(d, [reply(d + '-a'), reply(d + '-b'), feed(d + '-li', 'linkedin'), reply(d + '-late')]);
      for (const hm of ['11:05', '15:00', '18:00', '23:35', '23:55']) { at(d, hm); await run(); await deliverQueued(); }
    }
    const all = await mails();
    expect(all.map(m => m.day)).toEqual(days);                                    // exactly one job per local day
    expect(days.map(d => calls.filter(c => c.day === d).length)).toEqual(days.map(() => 1)); // one provider call per local day
    expect(new Set(calls.map(c => c.key)).size).toBe(7);
    expect(await keys(D1)).toEqual(['blog', `brief:${D1}:${D1}-a`, `brief:${D1}:${D1}-b`, 'social:li_profile']);
    for (const d of days.slice(1)) expect(await keys(d), d).toEqual([`brief:${d}:${d}-a`, `brief:${d}:${d}-b`]);
    // Documented exclusion (PM decision 1): a reply found after the day's email is never emailed.
    expect(all.flatMap(m => m.items).filter(i => i.key.endsWith('-late'))).toHaveLength(0);
    expect((await marks()).filter(k => k.startsWith('autopilot-day:'))).toHaveLength(7);
  }, 120_000);

  it('EC-01: many runs and direct enqueues racing at readiness give one email and one day mark', async () => {
    await program(); await brief(D1, [reply('r1'), reply('r2')]);
    at(D1, '08:10');
    const extra = (k: string) => enqueueHandoff(bid, act, { date: D1, ready: true, items: [{ key: k, title: 'Racing ' + k, reason: 'Needs owner', href: businessHref(bid, '/brief') }] });
    const results = await Promise.all([run(), run(), extra('race-1'), run(), extra('race-2'), run(), run()]);
    expect(await mails()).toHaveLength(1);
    expect((await marks()).filter(k => k.startsWith('autopilot-day:'))).toEqual([`autopilot-day:${bid}:${D1}`]);
    // Whoever lost the race did not mark its items as told.
    const told = (await marks()).filter(k => k.startsWith('autopilot-handoff:')).map(k => k.split(`${act}:`)[1]).sort();
    expect(told).toEqual((await keys(D1)));
    expect(results.filter(r => (typeof r === 'number' ? r : r.handoffs) > 0)).toHaveLength(1);
  }, 60_000);

  it('EC-06: old per-day marks from yesterday and an old-shape job from yesterday evening do not block or repeat today', async () => {
    await program({ enabled: [addDays(D0, -1), '12:00'] });
    const P = `autopilot-handoff:${bid}:${act}:`;
    await db.insert(S.cronMarks).values([{ key: `${P}blog:${D0}` }, { key: `${P}brief:${D0}:old` }]);
    // Sent by the per-batch code at 23:50 local yesterday: it is yesterday's email, not today's.
    await db.insert(S.jobs).values({ kind: 'autopilot.handoff', businessId: bid, status: 'done', maxAttempts: 4, createdAt: new Date(zonedTimeToUtc(D0, '23:50', NY)), payload: { activationId: act, ownerId: uid, name: NAME, items: [{ key: `blog:${D0}`, title: 'Connect your publishing destination', reason: '', href: '' }] } });
    await brief(D1, [reply('r1')]);
    at(D1, '08:10'); await run(); at(D1, '09:00'); await run();
    expect((await mails()).filter(m => m.day)).toHaveLength(1);
    expect(await keys(D1)).toEqual([`brief:${D1}:r1`]);                         // blog was told yesterday under blog:{D0}
    expect(await marks()).toContain(`${P}blog`);
  }, 60_000);

  it('EC-06: an old-shape job sent earlier today is today\'s email; the first new email comes tomorrow without repeating the old marks', async () => {
    await program();
    const P = `autopilot-handoff:${bid}:${act}:`;
    await db.insert(S.cronMarks).values([{ key: `${P}blog:${D1}` }, { key: `${P}brief:${D1}:r1` }]);
    await db.insert(S.jobs).values({ kind: 'autopilot.handoff', businessId: bid, status: 'queued', maxAttempts: 4, createdAt: new Date(zonedTimeToUtc(D1, '00:15', NY)), payload: { activationId: act, ownerId: uid, name: NAME, items: [{ key: `brief:${D1}:r1`, title: 'reddit: Thread r1', reason: 'Old batch', href: businessHref(bid, '/brief') }] } });
    await brief(D1, [reply('r1'), reply('r2')]);
    for (const hm of ['08:10', '10:05', '16:00']) { at(D1, hm); await run(); }
    expect(await mails()).toHaveLength(1);
    await deliverQueued();                                                       // the queued old-shape job still delivers unchanged
    expect(calls).toHaveLength(1); expect(JSON.parse(calls[0].body).text).toContain('Old batch');
    await brief(D2, [reply('n1')]); at(D2, '08:10'); await run();
    expect(await keys(D2)).toEqual([`brief:${D2}:n1`]);
  }, 60_000);

  it('EC-06: a refused delivery is retried as the identical email under the same key, and later attempts send nothing', async () => {
    await program(); await brief(D1, [reply('r1')]); at(D1, '08:10'); await run();
    const [job] = await jobs(); const c = { ...runCtx(act), job, payload: job.payload as any, attempt: 1 };
    const provider = vi.fn().mockResolvedValueOnce(new Response('down', { status: 500 })).mockRejectedValueOnce(new Error('socket hang up')).mockResolvedValue(new Response('{"id":"ok"}'));
    vi.stubGlobal('fetch', provider); const key = env.resendKey; env.resendKey = 'test-not-real';
    try {
      await expect(deliverHandoff(c)).rejects.toThrow(); await expect(deliverHandoff({ ...c, attempt: 2 })).rejects.toThrow();
      // The owner's blog is connected between attempts: the frozen payload must not change.
      await blog();
      await deliverHandoff({ ...c, attempt: 3 }); await deliverHandoff({ ...c, attempt: 4 });
    } finally { env.resendKey = key; }
    expect(provider).toHaveBeenCalledTimes(3);
    expect(new Set(provider.mock.calls.map(call => call[1].body)).size).toBe(1);
    expect(new Set(provider.mock.calls.map(call => call[1].headers['Idempotency-Key']))).toEqual(new Set([`autopilot-handoff:${job.id}`]));
    expect(JSON.parse(provider.mock.calls[0][1].body).text).toContain('Connect your publishing destination');
  }, 60_000);

  // The engineer's open point, as fixed in b7a13489: the one-day carry belongs to the program that was on yesterday.
  it('EC-03: a program enabled today does not carry yesterday\'s uncopied hand-published post', async () => {
    await db.update(S.businesses).set({ timezone: NY }).where(eq(S.businesses.id, bid));
    await pack(D0, { reddit: { text: 'Yesterday reddit draft', copiedAt: null } });
    await program({ social: ['reddit'], enabled: [D1, '00:00'] }); await blog();      // exactly local midnight counts as today
    await brief(D1, [reply('r1')]); await pack(D1, { reddit: { text: 'Today reddit draft', copiedAt: null } });
    at(D1, '09:05'); await run();
    expect(await keys(D1)).toEqual([`brief:${D1}:r1`, `pack:${packId(D1)}:reddit`]);
  }, 60_000);

  it('EC-03: re-enabling today does not repeat yesterday\'s post; the day after it carries its own', async () => {
    await program({ social: ['reddit'] }); await blog();
    await brief(D1, []); await pack(D1, { reddit: { text: 'Day one reddit draft', copiedAt: null } });
    at(D1, '08:10'); await run();
    expect(await keys(D1)).toEqual([`pack:${packId(D1)}:reddit`]);
    at(D2, '00:30'); await setAutopilot(await context(), false); await setAutopilot(await context(), true); act = autopilotOf(await getBiz(bid)).activationId!;
    await brief(D2, []);
    at(D2, '10:05'); await run();                                                 // cut-off, pack not made yet
    expect(await mails()).toHaveLength(1);                                        // nothing to tell: yesterday's post is not carried
    at(D2, '11:00'); await pack(D2, { reddit: { text: 'Day two reddit draft', copiedAt: null } });
    at(D2, '11:05'); await run();
    expect(await keys(D2)).toEqual([`pack:${packId(D2)}:reddit`]);
  }, 60_000);

  it('EC-03: a program enabled at 23:59 yesterday still carries yesterday\'s late post for one day', async () => {
    await program({ social: ['reddit'], enabled: [D0, '23:59'] }); await blog();
    await pack(D0, { reddit: { text: 'Late reddit draft', copiedAt: null } });
    await brief(D1, []); await pack(D1, { reddit: { text: 'Today reddit draft', copiedAt: null } });
    at(D1, '08:10'); await run();
    expect(await keys(D1)).toEqual([`pack:${packId(D0)}:reddit`, `pack:${packId(D1)}:reddit`]);
  }, 60_000);

  it('EC-06 + QA-1: the first day mark written by the rollout guard still honours old marks, and later post marks do not hide an account problem', async () => {
    await program({ social: ['x'] }); await blog(); const x = await account('x');
    const P = `autopilot-handoff:${bid}:${act}:`;
    // Old code today: told a missing LinkedIn account under the pack key, and no-blog under blog:{D1}.
    await db.delete(S.connections).where(eq(S.connections.businessId, bid));
    await db.insert(S.cronMarks).values([{ key: `${P}blog:${D1}` }]);
    await db.insert(S.jobs).values({ kind: 'autopilot.handoff', businessId: bid, status: 'done', maxAttempts: 4, createdAt: new Date(zonedTimeToUtc(D1, '00:15', NY)), payload: { activationId: act, ownerId: uid, name: NAME, items: [{ key: `blog:${D1}`, title: 'Connect your publishing destination', reason: '', href: '' }] } });
    await new Promise(r => setTimeout(r, 20));
    await brief(D1, [reply('r1')]); await pack(D1, { x: { text: 'Daily X draft', copiedAt: null } });
    for (const hm of ['08:10', '10:05', '15:00']) { at(D1, hm); await run(); }
    expect((await mails()).filter(m => m.day)).toHaveLength(0);                   // guard: today is taken
    expect(await marks()).toContain(`autopilot-day:${bid}:${D1}`);
    expect(await marks()).toContain(`${P}blog`);
    // Day 2: too-long daily post is told; blog is not re-announced.
    await brief(D2, []); await pack(D2, { x: { text: 'word '.repeat(80), copiedAt: null } });
    at(D2, '08:10'); await run();
    expect(await keys(D2)).toEqual([`pack:${packId(D2)}:x`]);
    await db.update(S.socialAccounts).set({ expired: true }).where(eq(S.socialAccounts.id, x.id));
    const D3 = addDays(D2, 1);
    await brief(D3, []); await pack(D3, { x: { text: 'Daily X draft 3', copiedAt: null } });
    at(D3, '08:10'); await run(); at(D3, '12:00'); await run();
    expect(await keys(D3)).toEqual(['social:x']);
    expect((await mails()).filter(m => m.day).map(m => m.day)).toEqual([D2, D3]);
  }, 60_000);

  // Expected behaviour (EC-04): an account that expires is announced once. The rollout lookup treats the post's own
  // per-post key as "already told", so a publishing-check item told earlier hides the account problem for good.
  it('control: an X account that expires with nothing told before is announced once', async () => {
    await program(); await blog(); const x = await account('x');
    await brief(D1, []); at(D1, '08:10'); await run();
    await db.update(S.socialAccounts).set({ expired: true }).where(eq(S.socialAccounts.id, x.id));
    const days = [D2, addDays(D2, 1), addDays(D2, 2)];
    for (const d of days) { await brief(d, [feed('ok-' + d, 'x')]); at(d, '08:10'); await run(); at(d, '10:05'); await run(); }
    expect((await mails()).map(m => [m.day, m.items.map(i => i.key)])).toEqual([[D2, ['social:x']]]);
  }, 60_000);

  it('QA-1 regression, EC-04: an X account that expires after a too-long post was told that day is still announced', async () => {
    await program(); await blog(); const x = await account('x');
    await brief(D1, [feed('long', 'x', 'word '.repeat(80))]);
    at(D1, '08:10'); await run();
    expect(await keys(D1)).toEqual([`brief:${D1}:long`]);
    at(D1, '12:00'); await db.update(S.socialAccounts).set({ expired: true }).where(eq(S.socialAccounts.id, x.id));
    at(D1, '12:05'); await run();
    const days = [D2, addDays(D2, 1), addDays(D2, 2)];
    for (const d of days) { await brief(d, [feed('ok-' + d, 'x')]); at(d, '08:10'); await run(); at(d, '10:05'); await run(); }
    const told = (await mails()).flatMap(m => m.items.map(i => i.key));
    expect(told, `emailed keys; marks now: ${(await marks()).map(k => k.split(act + ':')[1] || k).join(', ')}`).toContain('social:x');
  }, 60_000);

  it('QA-1 regression, EC-04: an X account that expires the day after a too-long daily post was told is still announced', async () => {
    await program({ social: ['x'] }); await blog(); const x = await account('x');
    await brief(D1, []); await pack(D1, { x: { text: 'word '.repeat(80), copiedAt: null } });
    at(D1, '08:10'); await run();
    expect(await keys(D1)).toEqual([`pack:${packId(D1)}:x`]);
    at(D1, '20:00'); await db.update(S.socialAccounts).set({ expired: true }).where(eq(S.socialAccounts.id, x.id));
    const days = [D2, addDays(D2, 1), addDays(D2, 2)];
    for (const d of days) { await brief(d, []); await pack(d, { x: { text: 'Daily X draft ' + d, copiedAt: null } }); at(d, '08:10'); await run(); at(d, '10:05'); await run(); }
    const told = (await mails()).flatMap(m => m.items.map(i => i.key));
    expect(told, `emailed keys; marks now: ${(await marks()).map(k => k.split(act + ':')[1] || k).join(', ')}`).toContain('social:x');
  }, 60_000);

  it('EC-01 edge (observed): toggling Autopilot before the day\'s email is delivered leaves the owner with no email that day', async () => {
    await program(); await brief(D1, [reply('r1')]); at(D1, '08:10'); await run();
    expect(await mails()).toHaveLength(1);
    at(D1, '08:11'); await setAutopilot(await context(), false); await setAutopilot(await context(), true); act = autopilotOf(await getBiz(bid)).activationId!;
    await deliverQueued();
    for (const hm of ['08:20', '10:05', '18:00']) { at(D1, hm); await run(); await deliverQueued(); }
    expect(calls).toHaveLength(0);                                              // old job skipped, the day is already taken
    expect(await mails()).toHaveLength(1);
  }, 60_000);
});
