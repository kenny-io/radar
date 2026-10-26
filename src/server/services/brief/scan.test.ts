// Background rescans of today's brief (DBR-1…5, 8), end to end on the database with the dev stubs: the cron decision for
// one business, the quiet job, new items marked New (a later find gets into a platform the morning filled), the members'
// toast, and a failing platform skipped in the background while a manual Scan again keeps its failure UI.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; });

import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { Fixtures } from '@/server/testing/fixtures';
import { getJob, runJobNow } from '@/server/jobs/queue';
import { todayIn } from '@/lib/format';
import type { BriefItem } from '@/lib/types';
import { acctOf } from '@/features/brief/model';
import { enqueueScan, maybeRescan } from './jobs';
import { getDay } from './store';
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
async function biz() {
  const u = await F.user(); const b = await F.biz(u, { profile, domain: `fn-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.test` });
  await db.update(schema.businesses).set({ briefSetup: true, timezone: TZ }).where(eq(schema.businesses.id, b.id));
  return { id: b.id, tz: TZ };
}
const run = async (id: string) => { await runJobNow(id); return (await getJob(id))!; };
const backdate = (id: string, ms: number) => db.update(schema.jobs).set({ createdAt: new Date(Date.now() - ms) }).where(eq(schema.jobs.id, id));
const toasts = async (bid: string) => (await db.select().from(schema.notifications).where(eq(schema.notifications.businessId, bid))).map(n => n.payload);
const scanJobs = (bid: string) => db.select().from(schema.jobs).where(and(eq(schema.jobs.businessId, bid), eq(schema.jobs.kind, 'brief.scan')));
const replies = (items: BriefItem[]) => items.filter(i => i.kind === 'reply').map(i => `${acctOf(i)}:${i.plat}`).sort();
const most = (items: BriefItem[]) => Math.max(...Object.values(replies(items).reduce((m, k) => ({ ...m, [k]: (m[k] || 0) + 1 }), {} as Record<string, number>)));
const count = (items: BriefItem[], k: string) => replies(items).filter(x => x === k).length;

afterEach(() => { delete process.env.BRIEF_STUB_FAIL; });

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

    // The next rescan finds nothing new: silent, and the day's items are unchanged.
    await backdate(id, RESCAN_EVERY_MS);
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
});
