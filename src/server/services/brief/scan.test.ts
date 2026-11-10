// Background rescans of today's brief (DBR-1…5, 8), end to end on the database with the dev stubs: the cron decision for
// one business, the quiet job, new items marked New (a later find gets into a platform the morning filled), the members'
// toast, and a failing platform skipped in the background while a manual Scan again keeps its failure UI.
// First five optimizations: a rescan has to be earned by an action on the day's items since its last scan (IS-7), and a
// background rescan with no reply slot left reads no source and calls no model (IS-4).
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { sources: [] as string[] }; });
// Every source read goes through here, so a test can tell that none happened. Behaviour is the real (stub) source's.
vi.mock('./sources', async orig => { const m = await orig<typeof import('./sources')>(); return { ...m, sourceFor: (p: Parameters<typeof m.sourceFor>[0]) => { const read = m.sourceFor(p); return (o: Parameters<typeof read>[0]) => { H.sources.push(p); return read(o); }; } }; });

import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { Fixtures } from '@/server/testing/fixtures';
import { getJob, runJobNow } from '@/server/jobs/queue';
import { ACTIONS } from '@/server/actions';
import { getBiz } from '@/server/workspace';
import { ai } from '@/server/ai';
import { todayIn } from '@/lib/format';
import type { BriefItem } from '@/lib/types';
import { acctOf } from '@/features/brief/model';
import { enqueueScan, maybeRescan } from './jobs';
import { dayMark, getDay } from './store';
import { RESCAN_EVERY_MS } from './rescan';
import { DAY_REPLIES, FIRST_SCAN_REPLIES } from './cap';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const TZ = 'America/New_York';
const profile = {
  domain: 'fieldnote.app',
  business: { name: 'Fieldnote', description: 'Time tracking and invoicing for independent designers and small studios.', offerings: ['Calendar-based time tracking', 'Project budgets', 'One-click invoicing'], industry: 'B2B software · Productivity', positioning: '', differentiators: ['Tracks time from your calendar, no timers', 'Invoices straight from tracked hours'] },
  audience: { segments: ['Freelance designers', 'Small design studios (2–15 people)'], buyers: ['Studio owner', 'Solo freelancer'], needs: ['Bill accurately without micromanaging', 'Spend less time on admin'], competitors: ['Tallyhour', 'Billable'] },
  keywords: { list: [{ kw: 'calendar time tracking', priority: true }, { kw: 'time tracking for designers', priority: true }, { kw: 'track billable hours', priority: true }, { kw: 'scope creep' }, { kw: 'project profitability' }] },
  brand: { primary: '#1F4D3A', secondary: '#F2B544', voice: 'Plain-spoken and warm.', language: 'English (US)', markets: ['United States'] },
};
async function biz(briefSettings?: object) {
  const u = await F.user(); const b = await F.biz(u, { profile, domain: `fn-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.test` });
  await db.update(schema.businesses).set({ briefSetup: true, timezone: TZ, ...(briefSettings ? { briefSettings } : {}) }).where(eq(schema.businesses.id, b.id));
  return { id: b.id, tz: TZ, u };
}
/** A member's action on the Daily Brief, through the real action (as the act route runs it). */
const act = async (b: { id: string; u: any }, name: string, input: any) => ACTIONS[name].run({ user: b.u, bid: b.id, role: 'Owner', biz: await getBiz(b.id) }, ACTIONS[name].input!.parse(input));
/** As if the day's last action happened `ms` ago (the counterpart of `backdate` for jobs); null = nobody has acted. */
const actedAgo = (bid: string, date: string, ms: number | null) => db.update(schema.briefDays).set({ actedAt: ms == null ? null : new Date(Date.now() - ms) }).where(and(eq(schema.briefDays.businessId, bid), eq(schema.briefDays.date, date)));
const run = async (id: string) => { await runJobNow(id); return (await getJob(id))!; };
const backdate = (id: string, ms: number) => db.update(schema.jobs).set({ createdAt: new Date(Date.now() - ms) }).where(eq(schema.jobs.id, id));
const toasts = async (bid: string) => (await db.select().from(schema.notifications).where(eq(schema.notifications.businessId, bid))).map(n => n.payload);
const scanJobs = (bid: string) => db.select().from(schema.jobs).where(and(eq(schema.jobs.businessId, bid), eq(schema.jobs.kind, 'brief.scan')));
const replies = (items: BriefItem[]) => items.filter(i => i.kind === 'reply').map(i => `${acctOf(i)}:${i.plat}`).sort();
const most = (items: BriefItem[]) => Math.max(...Object.values(replies(items).reduce((m, k) => ({ ...m, [k]: (m[k] || 0) + 1 }), {} as Record<string, number>)));
const count = (items: BriefItem[], k: string) => replies(items).filter(x => x === k).length;

afterEach(() => { delete process.env.BRIEF_STUB_FAIL; vi.restoreAllMocks(); });

describe.skipIf(!ON)('background rescans (database, dev stubs)', () => {
  afterAll(() => F.cleanup());
  let seeded: { items: BriefItem[]; candidates: any[]; stats: any } | null = null;

  it('nothing without today’s brief: no rescan is enqueued, and a background job never creates a day', async () => {
    const b = await biz(); const today = todayIn(TZ);
    expect(await maybeRescan(b)).toBeNull();
    const id = await enqueueScan(b.id, today, 'again', undefined, { background: true });
    const j = await run(id);
    expect([j.status, (j.result as any).skipped, (j.result as any).added]).toEqual(['done', 'no_day', 0]);
    expect(await getDay(b.id, today)).toBeNull();
  });

  it('a quiet rescan is enqueued 2 h after the last scan, adds new replies marked New, and toasts the members once', async () => {
    const b = await biz(); const today = todayIn(TZ);
    const first = await run(await enqueueScan(b.id, today, 'first'));
    expect(first.status).toBe('done');
    const day0 = (await getDay(b.id, today))!;
    seeded = { items: day0.items as BriefItem[], candidates: day0.candidates as any[], stats: day0.stats };
    // Stub cap math: the first scan stops at 2 (Reddit is full); X still has a company slot.
    expect(most(day0.items as BriefItem[])).toBe(FIRST_SCAN_REPLIES);
    expect([count(day0.items as BriefItem[], 'founder:reddit'), count(day0.items as BriefItem[], 'company:x')]).toEqual([2, 1]);

    expect(await maybeRescan(b)).toBeNull();                       // just scanned
    // Nobody has touched the brief: no rescan, however long ago the scan was (IS-7).
    expect((await dayMark(b.id, today))!.actedAt).toBeNull();
    await backdate(first.id, RESCAN_EVERY_MS);
    expect(await maybeRescan(b)).toBeNull();                       // 2h, no action
    await backdate(first.id, 9 * 3600e3);
    expect(await maybeRescan(b)).toBeNull();                       // 9h, no action
    expect(await scanJobs(b.id)).toHaveLength(1);
    // The owner copies one reply: that earns the next rescan, still no sooner than 2 h after the scan.
    const open = (day0.items as BriefItem[]).filter(i => i.kind === 'reply' && i.st === 'open');
    await act(b, 'brief.item', { date: today, id: open[0].id, st: 'copied' });
    const earned = (await dayMark(b.id, today))!.actedAt!;
    expect(Math.abs(earned.getTime() - Date.now())).toBeLessThan(30_000);
    await backdate(first.id, RESCAN_EVERY_MS - 60e3);
    expect(await maybeRescan(b)).toBeNull();                       // 1h59
    await backdate(first.id, RESCAN_EVERY_MS);
    const id = (await maybeRescan(b))!;
    expect(id).toBeTruthy();
    expect(await maybeRescan(b)).toBe(null);                       // queued: the next minute tick adds nothing
    expect(await scanJobs(b.id)).toHaveLength(2);
    const queued = (await getJob(id))!;
    expect(queued.payload).toMatchObject({ mode: 'again', date: today, background: true, round: 1 });
    expect(queued.progress).toMatchObject({ quiet: true });        // quiet before the worker picks it up

    await db.update(schema.briefDays).set({ scannedAt: '06:00' }).where(and(eq(schema.briefDays.businessId, b.id), eq(schema.briefDays.date, today)));
    const j = await run(id);
    const r = j.result as any;
    expect(j.status).toBe('done');
    expect(j.progress).toMatchObject({ step: 'done', quiet: true, mode: 'again' });
    expect(r).toMatchObject({ mode: 'again', since: '06:00', notified: true, background: true, round: 1, skippedPlats: [] });
    expect(r.failed).toBeUndefined();
    expect(r.added).toBeGreaterThanOrEqual(2);
    const day1 = (await getDay(b.id, today))!;
    const added = (day1.items as BriefItem[]).filter(i => r.addedIds.includes(i.id));
    expect(added).toHaveLength(r.added);
    expect(added.every(i => i.kind === 'reply' && i.fresh)).toBe(true);              // marked New, never a feed post
    expect((day1.items as BriefItem[]).length).toBe(day0.items.length + r.added);  // nothing already in the day redrafted
    expect(day1.scannedAt).not.toBe('06:00');                                         // "Found at {latest scan}"
    // DBR-8: a later find gets into a platform the morning filled (day cap 4), and the company's X slot is used.
    expect([count(day1.items as BriefItem[], 'founder:reddit'), count(day1.items as BriefItem[], 'company:x')]).toEqual([3, 2]);
    expect(most(day1.items as BriefItem[])).toBeLessThanOrEqual(DAY_REPLIES);
    expect(await toasts(b.id)).toEqual([{ msg: `${r.added} new ${r.added === 1 ? 'conversation' : 'conversations'} since 6:00 AM`, tone: 'signal' }]);
    expect(await maybeRescan(b)).toBeNull();                       // the rescan restarted the clock
    expect((await dayMark(b.id, today))!.actedAt).toEqual(earned); // a scan adding items is not a member's action
    // ...and it spent the copy: two hours on, with nothing done since, there is no further rescan.
    await backdate(id, RESCAN_EVERY_MS); await actedAgo(b.id, today, RESCAN_EVERY_MS + 60e3);
    expect(await maybeRescan(b)).toBeNull();
    expect(await scanJobs(b.id)).toHaveLength(2);

    // The owner skips another reply. The next rescan finds nothing new: silent, and the day's items are unchanged.
    await act(b, 'brief.item', { date: today, id: open[1].id, st: 'skipped' });
    const again = await run((await maybeRescan(b))!);
    expect(again.payload).toMatchObject({ round: 2 });
    expect((again.result as any)).toMatchObject({ added: 0 });
    expect((again.result as any).notified).toBeUndefined();
    expect(await toasts(b.id)).toHaveLength(1);
    expect(((await getDay(b.id, today))!.items as BriefItem[]).length).toBe(day1.items.length);
  }, 90_000);

  it('a failing platform is skipped in the background; a manual Scan again still shows the failure', async () => {
    expect(seeded).toBeTruthy();
    const b = await biz(); const today = todayIn(TZ);
    await db.insert(schema.briefDays).values({ businessId: b.id, date: today, scannedAt: '06:00', ...seeded! });
    process.env.BRIEF_STUB_FAIL = 'linkedin';
    const j = await run(await enqueueScan(b.id, today, 'again', undefined, { background: true }));
    const r = j.result as any;
    expect(j.status).toBe('done');
    expect(r.failed).toBeUndefined();
    expect(r.skippedPlats).toEqual(['linkedin']);
    expect(r.added).toBeGreaterThanOrEqual(1);                     // the other platforms still count
    expect(j.progress.failed).toBeUndefined();
    expect(await toasts(b.id)).toHaveLength(1);

    const manual = await run(await enqueueScan(b.id, today, 'again'));
    expect(manual.payload).toMatchObject({ mode: 'again', round: 1 });
    expect(manual.payload.background).toBeUndefined();
    expect([manual.status, (manual.result as any).failed, manual.progress.failed, manual.progress.quiet]).toEqual(['done', 'linkedin', 'linkedin', undefined]);

    // Keep this morning's brief: a quiet job from the moment it is queued, under the day cap like any later scan.
    const keep = await enqueueScan(b.id, today, 'keep', manual.id);
    expect((await getJob(keep))!.progress).toMatchObject({ quiet: true, mode: 'keep' });
    const kept = await run(keep);
    expect([kept.status, (kept.result as any).mode, kept.progress.quiet]).toEqual(['done', 'keep', true]);
  }, 90_000);

  it('a rescan still queued when the day ends does nothing', async () => {
    expect(seeded).toBeTruthy();
    const b = await biz(); const today = todayIn(TZ);
    const yesterday = todayIn(TZ, new Date(Date.now() - 864e5));
    await db.insert(schema.briefDays).values({ businessId: b.id, date: yesterday, scannedAt: '06:00', ...seeded! });
    const j = await run(await enqueueScan(b.id, yesterday, 'again', undefined, { background: true }));
    expect([j.status, (j.result as any).skipped, (j.result as any).added]).toEqual(['done', 'past', 0]);
    expect(((await getDay(b.id, yesterday))!.items as BriefItem[]).length).toBe(seeded!.items.length);
    expect(await maybeRescan(b)).toBeNull();                       // no brief for today: nothing until the morning scan
    expect(await getDay(b.id, today)).toBeNull();
  });

  it('earned rescans: only an action after the day’s most recent scan counts, whatever started that scan (IS-7)', async () => {
    const b = await biz(); const today = todayIn(TZ); const HR = 3600e3;
    await db.insert(schema.briefDays).values({ businessId: b.id, date: today, scannedAt: '06:00', items: [] });
    const scan = async (ago: number, payload: object) => (await db.insert(schema.jobs).values({ businessId: b.id, kind: 'brief.scan', ref: today, status: 'done', payload, createdAt: new Date(Date.now() - ago), finishedAt: new Date(Date.now() - ago) }).returning())[0];
    const ranAt = (id: string, ago: number) => db.update(schema.jobs).set({ status: 'done', finishedAt: new Date(), createdAt: new Date(Date.now() - ago) }).where(eq(schema.jobs.id, id));
    await scan(6 * HR, { mode: 'first', date: today });           // the morning scan
    expect(await maybeRescan(b)).toBeNull();                       // no action at all
    await actedAgo(b.id, today, 7 * HR);
    expect(await maybeRescan(b)).toBeNull();                       // an action from before that scan
    await actedAgo(b.id, today, 5 * HR);                           // copied a reply an hour after it
    const first = (await maybeRescan(b))!;
    expect((await getJob(first))!.payload).toMatchObject({ mode: 'again', background: true, round: 1 });
    // That rescan ran four hours ago: it answered the copy, so nothing more is due although 2 h have passed.
    await ranAt(first, 4 * HR);
    expect(await maybeRescan(b)).toBeNull();
    // An action, then "Keep this morning's brief" (a scan like any other): the Keep run restarts it too.
    await actedAgo(b.id, today, 3.5 * HR);
    await scan(3 * HR, { mode: 'keep', date: today });
    expect(await maybeRescan(b)).toBeNull();
    // Same for a manual Scan again; and clicking it is never held back by any of this.
    await actedAgo(b.id, today, 2.75 * HR);
    await scan(2.5 * HR, { mode: 'again', date: today, round: 3 });
    expect(await maybeRescan(b)).toBeNull();
    await actedAgo(b.id, today, null);
    const manual = (await act(b, 'brief.scan', {})).jobId as string;
    expect((await getJob(manual))!.payload).toMatchObject({ mode: 'again', date: today });
    expect((await getJob(manual))!.payload.background).toBeUndefined();
    // An action after the latest scan earns the next one, once that scan is 2 h old.
    await ranAt(manual, 2.1 * HR);
    await actedAgo(b.id, today, 1 * HR);
    const next = (await maybeRescan(b))!;
    expect(next).toBeTruthy();
    expect((await getJob(next))!.payload).toMatchObject({ background: true, round: 5 });
  });

  it('a background rescan with no reply slot left reads no source and calls no model; manual and morning scans do (IS-4)', async () => {
    // Founder on Reddit and X, the company on X (it never drafts on Reddit): three account × platform pairs, 4 replies a day each.
    const settings = { platforms: ['reddit', 'x'], accounts: ['founder', 'company'], time: '06:00', mention: 'asked' };
    const b = await biz(settings); const today = todayIn(TZ);
    const reply = (acct: 'founder' | 'company', plat: 'reddit' | 'x', n: number, st: BriefItem['st']): BriefItem => ({ id: `full-${acct}-${plat}-${n}`, kind: 'reply', acct, plat, where: plat === 'x' ? 'X' : 'r/freelance', url: `https://example.test/${acct}/${plat}/${n}`, title: `Thread ${n}`, tag: 't', why: 'w', drafts: { help: 'A reply.' }, edits: {}, mention: false, st } as BriefItem);
    // Every status counts towards the cap, so a day of skipped and posted replies is as full as an untouched one.
    const full = ([['founder', 'reddit'], ['founder', 'x'], ['company', 'x']] as const).flatMap(([a, p]) => (['open', 'copied', 'skipped', 'posted'] as const).map((st, n) => reply(a, p, n, st)));
    expect(most(full)).toBe(DAY_REPLIES);
    const setItems = (items: BriefItem[]) => db.update(schema.briefDays).set({ items }).where(and(eq(schema.briefDays.businessId, b.id), eq(schema.briefDays.date, today)));
    await db.insert(schema.briefDays).values({ businessId: b.id, date: today, scannedAt: '06:00', items: full, candidates: [], stats: { reddit: { read: 30 }, x: { read: 12 } } });
    const model = vi.spyOn(ai, 'run');
    const before = (await getDay(b.id, today))!;

    H.sources.length = 0;
    const j = await run(await enqueueScan(b.id, today, 'again', undefined, { background: true, round: 1 }));
    expect([j.status, j.result]).toEqual(['done', { mode: 'again', added: 0, addedIds: [], since: '06:00', skipped: 'no_slots' }]);
    expect(H.sources).toEqual([]);
    expect(model).not.toHaveBeenCalled();
    expect(j.progress).toEqual({ threadsRead: 0, mode: 'again', quiet: true });          // never left its queued, quiet state
    expect(await getDay(b.id, today)).toEqual(before);                                    // items, candidates, "Found at" and counts untouched
    expect(await toasts(b.id)).toEqual([]);
    // It is still the day's latest scan: the next rescan needs a new action after it and two more hours.
    await act(b, 'brief.item', { date: today, id: full[0].id, st: 'copied' });
    expect(await maybeRescan(b)).toBeNull();
    await backdate(j.id, RESCAN_EVERY_MS);
    expect(await maybeRescan(b)).toBeTruthy();
    await db.delete(schema.jobs).where(and(eq(schema.jobs.businessId, b.id), eq(schema.jobs.status, 'queued')));

    // One slot open anywhere (the company has 3 on X): the background rescan reads as before.
    await setItems(full.filter(i => i.id !== 'full-company-x-0'));
    H.sources.length = 0; model.mockClear();
    const open = await run(await enqueueScan(b.id, today, 'again', undefined, { background: true, round: 2 }));
    expect([open.status, (open.result as any).skipped]).toEqual(['done', undefined]);
    expect(H.sources).toEqual(['reddit', 'x']);

    // Manual Scan again on the full day: the owner asked, so it reads every platform as it always has.
    await setItems(full);
    H.sources.length = 0; model.mockClear();
    const manual = await run((await act(b, 'brief.scan', {})).jobId);
    expect([manual.status, (manual.result as any).skipped, (manual.result as any).added, manual.payload.background]).toEqual(['done', undefined, 0, undefined]);
    expect(H.sources).toEqual(['reddit', 'x']);
    expect((manual.result as any).threadsRead).toBeGreaterThan(0);
    expect(((await getDay(b.id, today))!.items as BriefItem[]).length).toBe(full.length);

    // The morning scan (no brief yet, same settings) reads every platform and drafts with the model.
    const fresh = await biz(settings);
    H.sources.length = 0; model.mockClear();
    const morning = await run(await enqueueScan(fresh.id, today, 'first'));
    expect([morning.status, (morning.result as any).skipped]).toEqual(['done', undefined]);
    expect(H.sources).toEqual(['reddit', 'x']);
    expect(model.mock.calls.length).toBeGreaterThan(0);
    expect(((await getDay(fresh.id, today))!.items as BriefItem[]).length).toBeGreaterThan(0);
  }, 120_000);
});
