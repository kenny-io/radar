import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; });
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { decrypt } from '@/server/crypto';
import { Fixtures } from '@/server/testing/fixtures';
import { getBiz } from '@/server/workspace';
import { actions as calendarActions } from '@/server/actions/calendar';
import { withDay } from '@/server/services/brief/store';
import { enqueueScan } from '@/server/services/brief/jobs';
import { getJob, runJobNow } from '@/server/jobs/queue';
import { updatePack } from '@/server/services/social/generate';
import { collectWorkUpdates, currentWorkSections, engagementSection, optionalDeliveryAfter, recordEngagement, type EngagementEvent } from './engagement';
import { getEngagementPreferences, stopWorkUpdates, updateEngagementPreferences } from './preferences';
import { dispatchLifecycleBatch } from './dispatch';
import { queueLifecycle, type LifecyclePayload } from './queue';

const F = new Fixtures(), E = schema.engagementEvents, M = schema.lifecycleEmails;
const prior = { stub: env.devStubs, key: env.resendKey };
const now = new Date('2026-11-04T12:00:00Z'), day = '2026-11-04';
const ago = (hours: number) => new Date(now.getTime() - hours * 3600e3);
const events = (uid: string) => db.select().from(E).where(eq(E.userId, uid));
const mails = (uid: string) => db.select().from(M).where(eq(M.userId, uid));
const unpack = (r: typeof M.$inferSelect) => decrypt<LifecyclePayload>(r.payloadEnc)!;
const ack = () => vi.fn(async () => new Response('{"id":"work-test-ack"}'));
const dispatch = (uid: string, fetcher = ack(), at = now) => dispatchLifecycleBatch({ userIds: [uid], now: at, fetch: fetcher, sleep: async () => {}, limit: 10 });
async function owner(enabled = true) {
  const u = await F.user(), b = await F.biz(u);
  await db.update(schema.businesses).set({ timezone: 'UTC' }).where(eq(schema.businesses.id, b.id));
  if (!enabled) await updateEngagementPreferences(u.id, { dailyBrief: false, calendarReminders: false, articleSocial: false }, ago(72));
  if (enabled) await updateEngagementPreferences(u.id, { dailyBrief: true, calendarReminders: true, articleSocial: true }, ago(72));
  return { u, b };
}
async function brief(uid: string, bid: string, time = ago(2)) {
  await db.insert(schema.briefDays).values({ businessId: bid, date: day, scannedAt: '10:00', items: [{ id: 'reply-one', kind: 'reply', st: 'open', url: 'https://example.com/discussion', title: 'A useful discussion', drafts: { help: 'Useful reply' }, edits: {}, tag: 'Advice', why: '', mention: false }] }).onConflictDoNothing();
  await recordEngagement(db, { businessId: bid, kind: 'brief_reply', ref: day, now: time });
  return (await events(uid)).find(e => e.kind === 'brief_reply')!;
}
async function article(uid: string, bid: string, id = `article-${uid}`) {
  await db.insert(schema.calendarEntries).values({ id, businessId: bid, title: 'A real article', kw: 'useful work', type: 'guide', date: day, status: 'review' });
  await db.insert(schema.articles).values({ entryId: id, businessId: bid, data: { generated: true, body: [['p', 'A real article body']] } });
  await recordEngagement(db, { businessId: bid, kind: 'article_social', ref: id, now: ago(3) });
  return (await events(uid)).find(e => e.sourceRef.ref === id)!;
}
async function pack(uid: string, bid: string, id = `pack-${uid}`) {
  await db.insert(schema.socialPacks).values({ id, businessId: bid, data: { id, name: 'A useful social post', source: { kind: 'idea', label: 'An idea' }, posts: { x: { text: 'A useful post', copiedAt: null } } } });
  await recordEngagement(db, { businessId: bid, kind: 'social_publish', ref: id, now: ago(25) });
  return (await events(uid)).find(e => e.sourceRef.ref === id)!;
}

describe.skipIf(!process.env.DATABASE_URL)('conditional work updates (database; fake email provider only)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); env.devStubs = false; env.resendKey = 'test-not-real'; });
  afterEach(() => { vi.useRealTimers(); env.devStubs = prior.stub; env.resendKey = prior.key; });
  afterAll(() => F.cleanup());

  it('preserves explicit opt-outs and re-enable boundaries with stable transition timestamps', async () => {
    const { u, b } = await owner(false);
    expect(await getEngagementPreferences(u.id)).toEqual({ dailyBrief: false, calendarReminders: false, articleSocial: false });
    await recordEngagement(db, { businessId: b.id, kind: 'article_social', ref: 'before-optin', now: ago(5) });
    await updateEngagementPreferences(u.id, { articleSocial: true }, ago(4));
    await recordEngagement(db, { businessId: b.id, kind: 'article_social', ref: 'historical', now: ago(5) });
    expect(await events(u.id)).toHaveLength(0);
    await updateEngagementPreferences(u.id, { articleSocial: true }, ago(1));
    const e = await article(u.id, b.id);
    expect(e.occurredAt.toISOString()).toBe(ago(3).toISOString());
    await updateEngagementPreferences(u.id, { articleSocial: false }, now);
    await updateEngagementPreferences(u.id, { articleSocial: true }, now);
    expect(await engagementSection(e, now)).toBeNull();
  });

  it('records source references transactionally and dedupes replayed completion/approval', async () => {
    const { u, b } = await owner();
    await expect(db.transaction(async tx => { await recordEngagement(tx, { businessId: b.id, kind: 'article_social', ref: 'rollback', now: ago(3) }); throw Error('rollback'); })).rejects.toThrow('rollback');
    expect(await events(u.id)).toHaveLength(0);
    await Promise.all([recordEngagement(db, { businessId: b.id, kind: 'article_social', ref: 'same-article', now: ago(3) }), recordEngagement(db, { businessId: b.id, kind: 'article_social', ref: 'same-article', now: ago(2) })]);
    expect(await events(u.id)).toHaveLength(1);
    expect(JSON.stringify(await events(u.id))).not.toContain('A real article body');
  });

  it('captures only an actual successful initial brief, not manual rescans or failed/empty runs', async () => {
    env.devStubs = true;
    const profile = {
      business: { name: 'Fieldnote', description: 'Time tracking and invoicing for freelance designers.', offerings: ['Time tracking', 'Project invoices'], industry: 'Productivity software', positioning: '', differentiators: ['Tracks calendar time'] },
      audience: { segments: ['Freelance designers'], buyers: ['Studio owner'], needs: ['Bill accurately'], competitors: ['Other timers'] },
      keywords: { list: [{ kw: 'time tracking for designers', priority: true }, { kw: 'scope creep' }] },
      brand: { primary: '#1F4D3A', secondary: '#F2B544', voice: 'Plain and useful.', language: 'English (US)', markets: ['United States'] },
    };
    const { u, b } = await owner();
    await db.update(schema.businesses).set({ profile, briefSettings: { platforms: ['reddit'], time: '06:00', mention: 'relevant', accounts: ['founder'] } }).where(eq(schema.businesses.id, b.id));
    const first = await enqueueScan(b.id, day, 'first'); await runJobNow(first);
    expect((await getJob(first))?.status).toBe('done');
    expect(await events(u.id)).toHaveLength(1);
    const again = await enqueueScan(b.id, day, 'again'); await runJobNow(again);
    expect(await events(u.id)).toHaveLength(1);
    const failed = await owner();
    await db.update(schema.businesses).set({ profile, briefSettings: { platforms: ['reddit'], time: '06:00', mention: 'relevant', accounts: ['founder'] } }).where(eq(schema.businesses.id, failed.b.id));
    process.env.BRIEF_STUB_FAIL = 'reddit';
    try {
      const id = await enqueueScan(failed.b.id, day, 'first'); await runJobNow(id);
      expect((await getJob(id))?.result).toMatchObject({ failed: 'reddit' });
      expect(await events(failed.u.id)).toHaveLength(0);
    } finally { delete process.env.BRIEF_STUB_FAIL; }
    const empty = await owner();
    await db.update(schema.businesses).set({ profile, briefSettings: { platforms: [], time: '06:00', mention: 'relevant', accounts: ['founder'] } }).where(eq(schema.businesses.id, empty.b.id));
    const id = await enqueueScan(empty.b.id, day, 'first'); await runJobNow(id);
    expect((await getJob(id))?.status).toBe('done');
    expect(await events(empty.u.id)).toHaveLength(0);
  }, 30_000);

  it('waits one hour for a brief, and any copied reply permanently prevents its reminder even after reopen', async () => {
    const { u, b } = await owner();
    const e = await brief(u.id, b.id, new Date(now.getTime() - 59 * 60e3));
    expect(await engagementSection(e, now)).toBeNull();
    expect(await engagementSection(e, new Date(now.getTime() + 60e3))).toMatchObject({ kind: 'brief_reply', count: 1 });
    await withDay(b.id, day, row => ({ items: row.items.map(i => ({ ...i, st: 'copied' })), ret: true }));
    await withDay(b.id, day, row => ({ items: row.items.map(i => ({ ...i, st: 'open' })), ret: true }));
    expect((await events(u.id))[0].resolvedReason).toBe('action_taken');
    expect((await collectWorkUpdates(new Date(now.getTime() + 60e3), [u.id])).queued).toBe(0);
  });

  it('does not queue empty, stale, failed/unready source references or an ungenerated article', async () => {
    const { u, b } = await owner();
    await recordEngagement(db, { businessId: b.id, kind: 'brief_reply', ref: '2026-11-03', now: ago(2) });
    expect(await events(u.id)).toHaveLength(0);
    await brief(u.id, b.id);
    await db.update(schema.briefDays).set({ items: [] }).where(eq(schema.briefDays.businessId, b.id));
    const e = await article(u.id, b.id);
    await db.update(schema.articles).set({ data: { generated: false, body: [] } }).where(eq(schema.articles.entryId, e.sourceRef.ref));
    expect((await collectWorkUpdates(now, [u.id])).queued).toBe(0);
    expect(await mails(u.id)).toHaveLength(0);
  });

  it('waits24h for a calendar, resolves the whole generation on one real approval, and ignores older kept entries', async () => {
    const { u, b } = await owner(); const generated = ago(25), id = `topic-${u.id}`, old = `old-${u.id}`;
    await db.update(schema.businesses).set({ calendarGeneratedAt: generated }).where(eq(schema.businesses.id, b.id));
    await db.insert(schema.calendarEntries).values([{ id, businessId: b.id, title: 'New topic', kw: 'new', type: 'guide', date: day, status: 'proposed' }, { id: old, businessId: b.id, title: 'Kept topic', kw: 'old', type: 'guide', date: day, status: 'approved' }]);
    await recordEngagement(db, { businessId: b.id, kind: 'calendar_review', ref: generated.toISOString(), entryIds: [id], now: generated });
    const [e] = await events(u.id);
    expect(await engagementSection(e, new Date(generated.getTime() + 23 * 3600e3))).toBeNull();
    expect(await engagementSection(e, now)).toMatchObject({ count: 1 });
    const ctx = { user: u, bid: b.id, role: 'Owner' as const, biz: await getBiz(b.id) };
    await calendarActions['calendar.approve'].run(ctx, { entryId: id });
    await calendarActions['calendar.unschedule'].run(ctx, { entryId: id });
    expect((await events(u.id))[0].resolvedReason).toBe('action_taken');
    expect((await collectWorkUpdates(now, [u.id])).queued).toBe(0);
  });

  it('suggests social only for a real article without an existing article-based pack', async () => {
    const { u, b } = await owner(), e = await article(u.id, b.id);
    expect(await engagementSection(e, now)).toMatchObject({ kind: 'article_social', title: 'A real article' });
    await db.insert(schema.socialPacks).values({ id: `used-${u.id}`, businessId: b.id, data: { source: { kind: 'article', ref: e.sourceRef.ref }, posts: { x: { text: 'Done' } } } });
    expect(await engagementSection(e, now)).toBeNull();
    expect((await collectWorkUpdates(now, [u.id])).queued).toBe(0);
  });

  it('waits24h for a social pack and permanently stops after a copy, even when copiedAt is later cleared', async () => {
    const { u, b } = await owner(), e = await pack(u.id, b.id);
    expect(await engagementSection(e, new Date(e.occurredAt.getTime() + 23 * 3600e3))).toBeNull();
    expect(await engagementSection(e, now)).toMatchObject({ kind: 'social_publish', count: 1 });
    await updatePack(b.id, e.sourceRef.ref, p => ({ ...p, posts: { ...p.posts, x: { ...p.posts.x!, copiedAt: Date.now() } } }));
    await updatePack(b.id, e.sourceRef.ref, p => ({ ...p, posts: { ...p.posts, x: { ...p.posts.x!, copiedAt: null } } }));
    expect((await collectWorkUpdates(now, [u.id])).queued).toBe(0);
    expect((await events(u.id))[0].resolvedReason).toBe('action_taken');
  });

  it('atomically groups nearby work across owned businesses into one message and never reopens assigned sources', async () => {
    const { u, b } = await owner(), b2 = await F.biz(u);
    await brief(u.id, b.id); await article(u.id, b2.id); await pack(u.id, b.id);
    const collected = await Promise.all([collectWorkUpdates(now, [u.id]), collectWorkUpdates(now, [u.id])]);
    expect(collected.reduce((n, r) => n + r.queued, 0)).toBe(1);
    const rows = await mails(u.id); expect(rows).toHaveLength(1);
    expect(unpack(rows[0]).data.workSections).toHaveLength(3);
    expect(unpack(rows[0]).envelope.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    await db.delete(M).where(eq(M.id, rows[0].id));
    expect((await events(u.id)).every(e => e.resolvedAt && e.lifecycleEmailId === null)).toBe(true);
    expect((await collectWorkUpdates(new Date(now.getTime() + 864e5), [u.id])).queued).toBe(0);
  });

  it('drops acted-on sections before the first attempt, then freezes the remaining exact payload for retries', async () => {
    const { u, b } = await owner(), a = await article(u.id, b.id);
    await brief(u.id, b.id); await collectWorkUpdates(now, [u.id]);
    await db.insert(schema.socialPacks).values({ id: `acted-${u.id}`, businessId: b.id, data: { source: { kind: 'article', ref: a.sourceRef.ref }, posts: { x: { text: 'Already done' } } } });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '1' } })).mockResolvedValueOnce(new Response('{"id":"retry-ack"}'));
    await dispatch(u.id, fetcher);
    expect(unpack((await mails(u.id))[0]).data.workSections).toMatchObject([{ kind: 'brief_reply' }]);
    await dispatch(u.id, fetcher, new Date(now.getTime() + 31e3));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(fetcher.mock.calls[0][1].headers['Idempotency-Key']).toBe(fetcher.mock.calls[1][1].headers['Idempotency-Key']);
  });

  it('suppresses an obsolete included section on retry, rather than changing the provider body', async () => {
    const { u, b } = await owner(); await brief(u.id, b.id); await collectWorkUpdates(now, [u.id]);
    const fetcher = vi.fn(async () => new Response('', { status: 500 })); await dispatch(u.id, fetcher);
    const first = (await mails(u.id))[0], frozen = first.payloadEnc;
    await withDay(b.id, day, row => ({ items: row.items.map(i => ({ ...i, st: 'copied' })), ret: true }));
    await dispatch(u.id, fetcher, new Date(now.getTime() + 31e3));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await mails(u.id))[0]).toMatchObject({ status: 'suppressed', payloadEnc: frozen });
  });

  it('enforces the cross-business cap including founder mail, quiet hours, and leaves transactional mail alone', async () => {
    const { u, b } = await owner(); await article(u.id, b.id); await collectWorkUpdates(now, [u.id]);
    await queueLifecycle(db, { type: 'founder_note', userId: u.id, eventKey: `founder-cap:${u.id}`, data: {} });
    await db.update(M).set({ status: 'sent', firstAttemptAt: ago(1), sentAt: ago(1) }).where(and(eq(M.userId, u.id), eq(M.type, 'founder_note')));
    const fetcher = ack(); await dispatch(u.id, fetcher);
    const work = (await mails(u.id)).find(m => m.type === 'work_update')!;
    expect(work).toMatchObject({ status: 'queued', attempts: 0, lastError: 'optional_frequency_or_quiet_hours' });
    expect(work.nextAttemptAt.toISOString()).toBe(new Date(ago(1).getTime() + 864e5).toISOString());
    expect(fetcher).not.toHaveBeenCalled();
    await queueLifecycle(db, { type: 'welcome', userId: u.id, eventKey: `welcome-cap:${u.id}`, data: {} });
    await dispatch(u.id, fetcher); expect(fetcher).toHaveBeenCalledTimes(1);
    const quiet = await owner();
    expect((await optionalDeliveryAfter(quiet.u.id, new Date('2026-11-04T23:30:00Z')))!.toISOString()).toBe('2026-11-05T09:00:00.000Z');
  });

  it('moves capped/quiet pending owners off the bounded due page so other owners can be collected', async () => {
    const capped = await owner(), available = await owner();
    await article(capped.u.id, capped.b.id); await article(available.u.id, available.b.id);
    await queueLifecycle(db, { type: 'founder_note', userId: capped.u.id, eventKey: `fairness:${capped.u.id}`, data: {}, sendAt: ago(1) });
    await db.update(M).set({ status: 'sent', firstAttemptAt: ago(1), sentAt: ago(1) }).where(eq(M.userId, capped.u.id));
    expect((await collectWorkUpdates(now, [capped.u.id, available.u.id])).queued).toBe(1);
    expect((await events(capped.u.id))[0].eligibleAt.getTime()).toBeGreaterThan(now.getTime());
    expect((await mails(available.u.id)).find(m => m.type === 'work_update')).toBeTruthy();
  });

  it('defers remaining due work after a same-day digest was suppressed instead of monopolizing collection', async () => {
    const { u, b } = await owner(); await article(u.id, b.id); await collectWorkUpdates(now, [u.id]);
    await db.update(M).set({ status: 'suppressed' }).where(eq(M.userId, u.id));
    const later = await article(u.id, b.id, `later-${u.id}`);
    expect((await collectWorkUpdates(now, [u.id])).queued).toBe(0);
    const saved = (await events(u.id)).find(e => e.id === later.id)!;
    expect(saved.eligibleAt.toISOString()).toBe('2026-11-05T00:00:00.000Z');
    expect(await mails(u.id)).toHaveLength(1);
  });

  it('rechecks opt-out, membership, owner transfer and billing access before sending', async () => {
    const { u, b } = await owner(), e = await article(u.id, b.id); await collectWorkUpdates(now, [u.id]);
    const [mail] = await mails(u.id), frozen = unpack(mail);
    await db.update(schema.members).set({ status: 'invited' }).where(and(eq(schema.members.businessId, b.id), eq(schema.members.userId, u.id)));
    expect(await currentWorkSections(mail, frozen, now)).toHaveLength(0);
    await db.update(schema.members).set({ status: 'active' }).where(and(eq(schema.members.businessId, b.id), eq(schema.members.userId, u.id)));
    const other = await F.user(); await db.update(schema.businesses).set({ ownerId: other.id }).where(eq(schema.businesses.id, b.id));
    expect(await currentWorkSections(mail, frozen, now)).toHaveLength(0);
    await db.update(schema.businesses).set({ ownerId: u.id }).where(eq(schema.businesses.id, b.id));
    const oldFlag = process.env.RADAR_BILLING, oldSecret = env.stripeSecretKey;
    try {
      process.env.RADAR_BILLING = 'on'; env.stripeSecretKey = 'sk_test_local_no_network';
      await F.account(u.id, { status: 'canceled' });
      expect(await currentWorkSections(mail, frozen, now)).toHaveLength(0);
      await F.account(u.id, { status: 'active' });
      expect(await currentWorkSections(mail, frozen, now)).toHaveLength(1);
    } finally { if (oldFlag === undefined) delete process.env.RADAR_BILLING; else process.env.RADAR_BILLING = oldFlag; env.stripeSecretKey = oldSecret; }
    await stopWorkUpdates(u.id); expect(await engagementSection(e, now)).toBeNull();
    const fetcher = ack(); await dispatch(u.id, fetcher); expect(fetcher).not.toHaveBeenCalled();
  });
});
