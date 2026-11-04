import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { decrypt } from '@/server/crypto';
import { Fixtures } from '@/server/testing/fixtures';
import { updateEngagementPreferences } from '@/server/services/lifecycle/preferences';
import { recordEngagement, engagementSection, collectWorkUpdates, optionalDeliveryAfter } from '@/server/services/lifecycle/engagement';
import type { LifecyclePayload } from '@/server/services/lifecycle/queue';
const F = new Fixtures('engagement-independent-policy');
const hour = 3600e3, day = 24 * hour;
const at = new Date('2026-11-04T12:00:00Z');
const eventFor = async (bid: string, kind: string) => (await db.select().from(schema.engagementEvents).where(and(eq(schema.engagementEvents.businessId, bid), eq(schema.engagementEvents.kind, kind))))[0];
async function owner() {
  const u = await F.user(); await F.account(u.id, { comp: true }); const b = await F.biz(u);
  await db.update(schema.businesses).set({ timezone: 'UTC' }).where(eq(schema.businesses.id, b.id));
  return { u, b };
}
async function enabled(uid: string) { await updateEngagementPreferences(uid, { dailyBrief: true, calendarReminders: true, articleSocial: true }, new Date(at.getTime() - 5 * day)); }
async function brief(bid: string, items: any[] = [{ id: 'r-one', kind: 'reply', st: 'open', plat: 'reddit', url: 'https://reddit.com/r/test/comments/example', title: 'Relevant conversation' }]) {
  await db.insert(schema.briefDays).values({ businessId: bid, date: '2026-11-04', scannedAt: at.toISOString(), items });
}
afterAll(() => F.cleanup());
beforeEach(() => { process.env.RADAR_BILLING = 'on'; });
describe('independent next-action timing, suppression and caps', () => {
  it('starts off, captures no pre-consent work, and delays the actual brief by an hour', async () => {
    const { u, b } = await owner(); await brief(b.id);
    await recordEngagement(db, { businessId: b.id, kind: 'brief_reply', ref: '2026-11-04', now: at });
    expect(await eventFor(b.id, 'brief_reply')).toBeUndefined();
    await enabled(u.id);
    await recordEngagement(db, { businessId: b.id, kind: 'brief_reply', ref: '2026-11-04', now: at });
    const event = await eventFor(b.id, 'brief_reply');
    expect(await engagementSection(event, new Date(at.getTime() + hour - 1))).toBeNull();
    expect(await engagementSection(event, new Date(at.getTime() + hour))).toMatchObject({ count: 1, kind: 'brief_reply' });
  });
  it('suppresses the whole brief after one copied reply and expires conversations the following day', async () => {
    const { u, b } = await owner(); await enabled(u.id);
    const items = [{ id: 'one', kind: 'reply', st: 'open', url: 'https://reddit.com/r/test/comments/one' }, { id: 'two', kind: 'reply', st: 'open', url: 'https://reddit.com/r/test/comments/two' }];
    await brief(b.id, items);
    await recordEngagement(db, { businessId: b.id, kind: 'brief_reply', ref: '2026-11-04', now: at });
    const event = await eventFor(b.id, 'brief_reply');
    expect(await engagementSection(event, new Date(at.getTime() + hour))).toMatchObject({ count: 2 });
    await db.update(schema.briefDays).set({ items: [{ ...items[0], st: 'copied' }, items[1]] }).where(eq(schema.briefDays.businessId, b.id));
    expect(await engagementSection(event, new Date(at.getTime() + hour))).toBeNull();
    await db.update(schema.briefDays).set({ items }).where(eq(schema.briefDays.businessId, b.id));
    expect(await engagementSection(event, new Date(at.getTime() + day))).toBeNull();
  });
  it('uses the 24-hour social-pack wait and suppresses all of its follow-up after copying one post', async () => {
    const { u, b } = await owner(); await enabled(u.id); const id = 'qa-pack-delay';
    const data = { id, name: 'Social pack', posts: { x: { text: 'Useful post' }, linkedin: { text: 'Longer useful post' } }, source: { kind: 'idea', label: 'Idea' } };
    await db.insert(schema.socialPacks).values({ id, businessId: b.id, data });
    await recordEngagement(db, { businessId: b.id, kind: 'social_publish', ref: id, now: at });
    const event = await eventFor(b.id, 'social_publish');
    expect(await engagementSection(event, new Date(at.getTime() + 2 * hour))).toBeNull();
    expect(await engagementSection(event, new Date(at.getTime() + day))).toMatchObject({ count: 2 });
    await db.update(schema.socialPacks).set({ data: { ...data, posts: { ...data.posts, x: { ...data.posts.x, copiedAt: at.getTime() + 1 } } } }).where(eq(schema.socialPacks.id, id));
    expect(await engagementSection(event, new Date(at.getTime() + day))).toBeNull();
  });
  it('requires a real generated article and suppresses only for its own business article-sourced pack', async () => {
    const { u, b } = await owner(); await enabled(u.id); const id = 'qa-article-policy';
    const other = await F.biz(u);
    await db.insert(schema.calendarEntries).values({ id, businessId: b.id, title: 'An actual article', kw: 'test', type: 'article', date: '2026-11-07', status: 'review' });
    await db.insert(schema.articles).values({ entryId: id, businessId: b.id, data: { generated: false, body: [] } });
    await recordEngagement(db, { businessId: b.id, kind: 'article_social', ref: id, now: at });
    const event = await eventFor(b.id, 'article_social'), time = new Date(at.getTime() + 2 * hour);
    expect(await engagementSection(event, time)).toBeNull();
    await db.update(schema.articles).set({ data: { generated: true, body: [['p', 'A useful article body.']] } }).where(eq(schema.articles.entryId, id));
    expect(await engagementSection(event, time)).toMatchObject({ count: 1, title: 'An actual article' });
    await db.insert(schema.socialPacks).values({ id: 'qa-other-pack', businessId: other.id, data: { source: { kind: 'article', ref: id }, posts: { x: { text: 'Foreign pack' } } } });
    expect(await engagementSection(event, time)).not.toBeNull();
    await db.insert(schema.socialPacks).values({ id: 'qa-own-pack', businessId: b.id, data: { source: { kind: 'article', ref: id }, posts: { x: { text: 'Own pack' } } } });
    expect(await engagementSection(event, time)).toBeNull();
  });
  it('does not nag remaining calendar topics after one item is approved and rejects a superseded plan', async () => {
    const { u, b } = await owner(); await enabled(u.id);
    const ids = ['qa-calendar-one', 'qa-calendar-two'];
    await db.update(schema.businesses).set({ calendarGeneratedAt: at }).where(eq(schema.businesses.id, b.id));
    await db.insert(schema.calendarEntries).values(ids.map(id => ({ id, businessId: b.id, title: id, kw: id, type: 'article', date: '2026-11-07', status: 'proposed' })));
    await recordEngagement(db, { businessId: b.id, kind: 'calendar_review', ref: at.toISOString(), entryIds: ids, now: at });
    const event = await eventFor(b.id, 'calendar_review'), time = new Date(at.getTime() + day);
    expect(await engagementSection(event, new Date(time.getTime() - 1))).toBeNull();
    expect(await engagementSection(event, time)).toMatchObject({ count: 2 });
    await db.update(schema.calendarEntries).set({ status: 'approved' }).where(eq(schema.calendarEntries.id, ids[0]));
    expect(await engagementSection(event, time)).toBeNull();
    await db.update(schema.calendarEntries).set({ status: 'proposed' }).where(eq(schema.calendarEntries.id, ids[0]));
    await db.update(schema.businesses).set({ calendarGeneratedAt: new Date(at.getTime() + 1000) }).where(eq(schema.businesses.id, b.id));
    expect(await engagementSection(event, time)).toBeNull();
  });
  it('coalesces work into at most three distinct kinds and concurrent collectors assign each source once', async () => {
    const { u, b } = await owner(); await enabled(u.id); await brief(b.id);
    await recordEngagement(db, { businessId: b.id, kind: 'brief_reply', ref: '2026-11-04', now: new Date(at.getTime() - hour) });
    const article = 'qa-digest-article';
    await db.insert(schema.calendarEntries).values({ id: article, businessId: b.id, title: 'Digest article', kw: 'test', type: 'article', date: '2026-11-07', status: 'review' });
    await db.insert(schema.articles).values({ entryId: article, businessId: b.id, data: { generated: true, body: [['p', 'Body']] } });
    await recordEngagement(db, { businessId: b.id, kind: 'article_social', ref: article, now: new Date(at.getTime() - 2 * hour) });
    const results = await Promise.all([collectWorkUpdates(at, [u.id]), collectWorkUpdates(at, [u.id])]);
    expect(results.reduce((sum, result) => sum + result.queued, 0)).toBe(1);
    const mails = await db.select().from(schema.lifecycleEmails).where(eq(schema.lifecycleEmails.userId, u.id));
    expect(mails).toHaveLength(1);
    const payload = decrypt<LifecyclePayload>(mails[0].payloadEnc)!;
    expect(payload.data.workSections).toHaveLength(2);
    expect(new Set(payload.data.workSections!.map(section => section.kind)).size).toBe(2);
    expect((await db.select().from(schema.engagementEvents).where(eq(schema.engagementEvents.userId, u.id))).every(e => e.lifecycleEmailId === mails[0].id && e.resolvedReason === 'queued')).toBe(true);
  });
  it('counts an ambiguous founder attempt against the same owner across businesses and respects quiet hours', async () => {
    const { u, b } = await owner();
    await db.update(schema.businesses).set({ timezone: 'Asia/Dubai', createdAt: new Date('2026-01-01') }).where(eq(schema.businesses.id, b.id));
    const other = await F.biz(u, { createdAt: new Date('2026-02-01') });
    await db.update(schema.businesses).set({ timezone: 'Pacific/Honolulu' }).where(eq(schema.businesses.id, other.id));
    const quiet = new Date('2026-11-04T19:00:00Z');
    const until = await optionalDeliveryAfter(u.id, quiet);
    expect(until).not.toBeNull();
    expect(until!.toISOString()).toBe('2026-11-05T05:00:00.000Z');
    await db.insert(schema.lifecycleEmails).values({ userId: u.id, type: 'founder_note', eventKey: 'qa-founder-cap', payloadEnc: 'unused', nextAttemptAt: at, expiresAt: new Date(at.getTime() + 3 * day), firstAttemptAt: new Date(at.getTime() - hour), status: 'queued' });
    expect((await optionalDeliveryAfter(u.id, at))?.toISOString()).toBe(new Date(at.getTime() + 23 * hour).toISOString());
  });
});
