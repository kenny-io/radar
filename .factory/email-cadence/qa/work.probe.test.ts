// Independent QA probes (EC-Q) for weekly work reminders: EC-05, EC-06. Local database and a fake provider only.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; });
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { decrypt } from '@/server/crypto';
import { Fixtures } from '@/server/testing/fixtures';
import { collectWorkUpdates, recordEngagement } from '@/server/services/lifecycle/engagement';
import { updateEngagementPreferences } from '@/server/services/lifecycle/preferences';
import { dispatchLifecycleBatch } from '@/server/services/lifecycle/dispatch';
import type { LifecyclePayload } from '@/server/services/lifecycle/queue';

const F = new Fixtures(), E = schema.engagementEvents, M = schema.lifecycleEmails;
const prior = { stub: env.devStubs, key: env.resendKey };
const DAY = 864e5, HOUR = 3600e3;
const start = new Date('2026-11-02T09:30:00Z');
const at = (t: Date | number) => { const d = new Date(t); vi.setSystemTime(d); return d; };
const events = (uid: string) => db.select().from(E).where(eq(E.userId, uid));
const work = async (uid: string) => (await db.select().from(M).where(eq(M.userId, uid))).filter(m => m.type === 'work_update').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
const sections = (r: typeof M.$inferSelect) => decrypt<LifecyclePayload>(r.payloadEnc)!.data.workSections || [];
const provider = () => vi.fn(async (_url: unknown, _init: any) => new Response('{"id":"qa-ack"}'));
const dispatch = (uid: string, fetcher: any, now: Date) => dispatchLifecycleBatch({ userIds: [uid], now, fetch: fetcher, sleep: async () => {}, limit: 10 });

async function owner() {
  const u = await F.user(), b = await F.biz(u);
  await db.update(schema.businesses).set({ timezone: 'UTC' }).where(eq(schema.businesses.id, b.id));
  await updateEngagementPreferences(u.id, { dailyBrief: true, calendarReminders: true, articleSocial: true }, new Date(start.getTime() - 30 * DAY));
  return { u, b };
}
async function article(bid: string, id: string, when: Date) {
  await db.insert(schema.calendarEntries).values({ id, businessId: bid, title: 'Article ' + id, kw: 'useful work', type: 'guide', date: when.toISOString().slice(0, 10), status: 'review' });
  await db.insert(schema.articles).values({ entryId: id, businessId: bid, data: { generated: true, body: [['p', 'A real article body']] } as any });
  await recordEngagement(db, { businessId: bid, kind: 'article_social', ref: id, now: when });
}
async function brief(bid: string, date: string, when: Date) {
  await db.insert(schema.briefDays).values({ businessId: bid, date, scannedAt: '07:00', items: [{ id: 'reply-' + date, kind: 'reply', st: 'open', url: 'https://example.com/discussion', title: 'A useful discussion', drafts: { help: 'Useful reply' }, edits: {}, tag: 'Advice', why: '', mention: false }] as any }).onConflictDoNothing();
  await recordEngagement(db, { businessId: bid, kind: 'brief_reply', ref: date, now: when });
}
async function pack(bid: string, id: string, when: Date) {
  await db.insert(schema.socialPacks).values({ id, businessId: bid, data: { id, name: 'A useful social post', source: { kind: 'idea', label: 'An idea' }, posts: { x: { text: 'A useful post', copiedAt: null } } } as any });
  await recordEngagement(db, { businessId: bid, kind: 'social_publish', ref: id, now: when });
}

describe.skipIf(!process.env.DATABASE_URL)('QA probes: weekly work reminders', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(start); env.devStubs = false; env.resendKey = 'test-not-real'; });
  afterEach(() => { vi.useRealTimers(); env.devStubs = prior.stub; env.resendKey = prior.key; });
  afterAll(() => F.cleanup());

  it('EC-05: an owner with two ordinary businesses and an Autopilot business, new work every day for 9 days, gets a reminder on day 0 and day 7 only', async () => {
    const { u, b } = await owner(), fetcher = provider();
    const b2 = await F.biz(u), auto = await F.biz(u);
    for (const x of [b2, auto]) await db.update(schema.businesses).set({ timezone: 'UTC' }).where(eq(schema.businesses.id, x.id));
    const activationId = randomUUID();
    await db.update(schema.businesses).set({ autopilot: { enabled: true, activationId, enabledBy: u.id, enabledAt: new Date(start.getTime() - DAY).toISOString() } }).where(eq(schema.businesses.id, auto.id));
    const sentAt: number[] = [];
    for (let d = 0; d <= 8; d++) {
      const morning = new Date(start.getTime() + d * DAY), date = morning.toISOString().slice(0, 10);
      at(morning.getTime() - 3 * HOUR);
      await article(b.id, `qa-art-${d}-${u.id}`, new Date(morning.getTime() - 3 * HOUR));
      await brief(b.id, date, new Date(morning.getTime() - 2 * HOUR));
      await pack(b2.id, `qa-pack-${d}-${u.id}`, new Date(morning.getTime() - 25 * HOUR));
      // The Autopilot business makes the same kinds of work; it must not feed the work reminder.
      await brief(auto.id, date, new Date(morning.getTime() - 2 * HOUR));
      await article(auto.id, `qa-auto-art-${d}-${u.id}`, new Date(morning.getTime() - 3 * HOUR));
      for (const h of [0, 2.5, 8]) {                                              // 09:30, 12:00, 17:30 UTC
        const t = at(morning.getTime() + h * HOUR), before = fetcher.mock.calls.length;
        await collectWorkUpdates(t, [u.id]); await dispatch(u.id, fetcher, t);
        if (fetcher.mock.calls.length > before) sentAt.push(t.getTime());
      }
    }
    expect(sentAt.map(t => Math.round((t - start.getTime()) / HOUR))).toEqual([0, 7 * 24]);
    const rows = await work(u.id);
    expect(rows.map(r => r.status)).toEqual(['sent', 'sent']);
    for (const r of rows) { const s = sections(r); expect(s.length).toBeLessThanOrEqual(3); expect(new Set(s.map(x => x.kind)).size).toBe(s.length); expect(s.some(x => x.businessId === auto.id)).toBe(false); }
    expect((await events(u.id)).filter(e => e.businessId === auto.id)).toHaveLength(0);
    // No source is tombstoned as queued without its email having been sent.
    const sentIds = new Set(rows.filter(r => r.status === 'sent').map(r => r.id));
    expect((await events(u.id)).filter(e => e.resolvedReason === 'queued' && !sentIds.has(e.lifecycleEmailId || ''))).toHaveLength(0);
    // The second reminder is about current work, not a week-old Daily Brief.
    const second = sections(rows[1]);
    expect(second.filter(s => s.kind === 'brief_reply').every(s => s.ref === new Date(start.getTime() + 7 * DAY).toISOString().slice(0, 10))).toBe(true);
  }, 120_000);

  it('EC-06: a queued, never-attempted reminder for an account that got one 3 days ago is not sent; its sources wait and go out when the week ends', async () => {
    const { u, b } = await owner(), fetcher = provider();
    await article(b.id, `qa-roll-${u.id}`, new Date(start.getTime() - 3 * HOUR));
    await brief(b.id, start.toISOString().slice(0, 10), new Date(start.getTime() - 2 * HOUR));
    expect((await collectWorkUpdates(start, [u.id])).queued).toBe(1);             // queued by the old code
    const last = new Date(start.getTime() - 3 * DAY), free = new Date(last.getTime() + 7 * DAY);
    await db.insert(M).values({ id: randomUUID(), userId: u.id, type: 'work_update', eventKey: `qa-earlier:${randomUUID()}`, payloadEnc: '', status: 'sent', firstAttemptAt: last, sentAt: last, attempts: 1, nextAttemptAt: last, expiresAt: last });
    for (let h = 0; h < 4 * 24; h += 6) { const t = at(start.getTime() + h * HOUR); await collectWorkUpdates(t, [u.id]); await dispatch(u.id, fetcher, t); }
    expect(fetcher).not.toHaveBeenCalled();
    const held = (await work(u.id)).find(r => r.eventKey.startsWith('work-update:'))!;
    expect(held).toMatchObject({ status: 'suppressed', lastError: 'work_weekly_limit', firstAttemptAt: null });
    expect((await events(u.id)).filter(e => e.resolvedReason === 'queued')).toHaveLength(0);
    const t = at(free); await collectWorkUpdates(t, [u.id]); await dispatch(u.id, fetcher, t);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const text = JSON.parse(fetcher.mock.calls[0][1].body).text as string;
    expect(text).toContain(`Article qa-roll-${u.id}`);
    // The Daily Brief from four days ago expired at the end of its day and is dropped, not sent late.
    expect((await events(u.id)).find(e => e.kind === 'brief_reply')).toMatchObject({ resolvedReason: 'no_longer_actionable' });
  }, 120_000);

  it('EC-06: a reminder whose first attempt failed retries the identical body under the same key even though the account is inside its week', async () => {
    const { u, b } = await owner();
    await article(b.id, `qa-retry-${u.id}`, new Date(start.getTime() - 3 * HOUR));
    await collectWorkUpdates(start, [u.id]);
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('down', { status: 500 })).mockResolvedValue(new Response('{"id":"qa-retry"}'));
    await dispatch(u.id, fetcher, start);
    const last = new Date(start.getTime() - 2 * DAY);
    await db.insert(M).values({ id: randomUUID(), userId: u.id, type: 'work_update', eventKey: `qa-earlier:${randomUUID()}`, payloadEnc: '', status: 'sent', firstAttemptAt: last, sentAt: last, attempts: 1, nextAttemptAt: last, expiresAt: last });
    for (const m of [1, 5, 30, 120, 600]) await dispatch(u.id, fetcher, at(start.getTime() + m * 60e3));
    const row = (await work(u.id)).find(r => r.eventKey.startsWith('work-update:'))!;
    expect(row.status).toBe('sent');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(fetcher.mock.calls.map(c => c[1].headers['Idempotency-Key'])).toEqual(Array(2).fill(`radar-lifecycle/${row.id}`));
  }, 60_000);

  it('EC-05: two workers collecting and dispatching at once at the end of the week still send one reminder', async () => {
    const { u, b } = await owner(), fetcher = provider();
    const last = new Date(start.getTime() - 7 * DAY);
    await db.insert(M).values({ id: randomUUID(), userId: u.id, type: 'work_update', eventKey: `qa-earlier:${randomUUID()}`, payloadEnc: '', status: 'sent', firstAttemptAt: last, sentAt: last, attempts: 1, nextAttemptAt: last, expiresAt: last });
    await article(b.id, `qa-race-${u.id}`, new Date(start.getTime() - 3 * HOUR));
    await Promise.all([collectWorkUpdates(start, [u.id]), collectWorkUpdates(start, [u.id]), collectWorkUpdates(start, [u.id])]);
    await Promise.all([dispatch(u.id, fetcher, start), dispatch(u.id, fetcher, start)]);
    await article(b.id, `qa-race-2-${u.id}`, new Date(start.getTime() - 3 * HOUR));
    const later = at(start.getTime() + HOUR);
    await Promise.all([collectWorkUpdates(later, [u.id]), collectWorkUpdates(later, [u.id])]);
    await Promise.all([dispatch(u.id, fetcher, later), dispatch(u.id, fetcher, later)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await work(u.id)).filter(r => r.eventKey.startsWith('work-update:')).map(r => r.status)).toEqual(['sent']);
  }, 60_000);
});
