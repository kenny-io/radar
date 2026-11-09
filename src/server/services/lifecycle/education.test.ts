import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { decrypt } from '@/server/crypto';
import { Fixtures } from '@/server/testing/fixtures';
import { EDUCATION_LESSONS } from './educationContent';
import { collectEducation, educationContext, EDUCATION_WEEK } from './education';
import { dispatchLifecycleBatch } from './dispatch';
import { educationAllowed, educationPreferenceToken, educationPreferenceUser, preferenceToken, stopOnboarding, updateEducationPreference, updateEngagementPreferences } from './preferences';
import { queueLifecycle, type LifecyclePayload } from './queue';
import { recordEngagement } from './engagement';
import { isEducationLanding, parseEducationLanding } from './educationLinks';
const E = schema.educationEnrollments, M = schema.lifecycleEmails, F = new Fixtures();
const start = new Date('2026-11-09T12:00:00Z');
const prior = { key: env.resendKey, stub: env.devStubs, flag: process.env.RADAR_EDUCATION_EMAILS, billing: process.env.RADAR_BILLING };
const enrollment = async (uid: string) => (await db.select().from(E).where(eq(E.userId, uid)))[0];
const messages = (uid: string) => db.select().from(M).where(and(eq(M.userId, uid), eq(M.type, 'weekly_education')));
const payload = (m: typeof M.$inferSelect) => decrypt<LifecyclePayload>(m.payloadEnc)!;
const provider = (post: () => Promise<Response> = async () => new Response('{"id":"fake-education-ack"}')) => vi.fn(async (_url: string | URL | Request, init?: RequestInit) => init?.method === 'GET' ? new Response(null, { status: 404 }) : post());
const dispatch = (uid: string, at = start, fetcher = provider(), clock = () => at) => dispatchLifecycleBatch({ userIds: [uid], now: at, clock, fetch: fetcher as typeof fetch, sleep: async () => {}, limit: 10 });
async function owner() { const u = await F.user(), b = await F.biz(u); await db.update(schema.businesses).set({ timezone: 'UTC' }).where(eq(schema.businesses.id, b.id)); return { u, b }; }

describe('education link validation', () => {
  it('only preserves the exact allowlisted lesson route and optional UUID', () => {
    expect(parseEducationLanding('/email/learn?lesson=ai_visibility')).toEqual({ lesson: 'ai_visibility' });
    for (const path of ['/email/learn?lesson=ai_visibility&next=https://evil.example', '/email/learn?lesson=ai_visibility&lesson=backlinks', '/email/learn/other?lesson=ai_visibility', '/email/learn?lesson=ai_visibility#x', '/email/learn?lesson=unknown', '/email/learn?lesson=ai_visibility&businessId=bad']) expect(isEducationLanding(path)).toBe(false);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('weekly education (real PostgreSQL; fake provider)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(start); env.devStubs = false; env.resendKey = 'test-not-real'; process.env.RADAR_EDUCATION_EMAILS = '1'; process.env.RADAR_BILLING = 'off'; });
  afterEach(() => { vi.useRealTimers(); env.devStubs = prior.stub; env.resendKey = prior.key; });
  afterAll(async () => { for (const [key, value] of [['RADAR_EDUCATION_EMAILS', prior.flag], ['RADAR_BILLING', prior.billing]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; } await F.cleanup(); });
  it('enrolls once per verified account, excludes guests/unverified and inherits earlier setup opt-out', async () => {
    const yes = await owner(), guest = await F.user({ guest: true }), unverified = await F.user({ verified: false }), no = await F.user(); await stopOnboarding(no.id);
    const ids = [yes.u.id, guest.id, unverified.id, no.id];
    const calls = await Promise.all([collectEducation(start, ids), collectEducation(start, ids)]);
    expect(calls.reduce((n, r) => n + r.enrolled, 0)).toBe(1); expect(await messages(yes.u.id)).toHaveLength(1);
    expect(await enrollment(guest.id)).toBeUndefined(); expect(await enrollment(unverified.id)).toBeUndefined(); expect(await enrollment(no.id)).toBeUndefined();
    await updateEducationPreference(no.id, true); expect(await educationAllowed(no.id)).toBe(true); expect(await collectEducation(start, [no.id])).toEqual({ enrolled: 1, queued: 1 });
    await db.update(schema.users).set({ emailVerifiedAt: start }).where(eq(schema.users.id, unverified.id)); expect((await collectEducation(start, [unverified.id])).enrolled).toBe(1);
  });
  it('sends five lessons once, schedules from actual acceptance and never catches up after downtime', async () => {
    const { u } = await owner(); let at = start;
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(at); await collectEducation(at, [u.id]);
      const [pending] = (await messages(u.id)).filter(m => m.status === 'queued');
      expect(payload(pending).data.education?.lesson).toBe(EDUCATION_LESSONS[i]); expect(pending.businessId).toBeNull();
      const accepted = new Date(at.getTime() + 120000);
      await dispatch(u.id, at, provider(), () => accepted);
      const e = await enrollment(u.id); expect(e.nextLesson).toBe(i + 1); expect(e.lastAcceptedAt).toEqual(accepted); expect(e.nextDueAt.getTime()).toBe(accepted.getTime() + EDUCATION_WEEK);
      await collectEducation(new Date(accepted.getTime() + EDUCATION_WEEK - 1), [u.id]); expect(await messages(u.id)).toHaveLength(i + 1);
      at = new Date(accepted.getTime() + EDUCATION_WEEK + 864e5); // downtime cannot create a burst
    }
    expect((await enrollment(u.id)).status).toBe('completed'); await collectEducation(new Date(at.getTime() + 100 * EDUCATION_WEEK), [u.id]); expect(await messages(u.id)).toHaveLength(5);
  });
  it('retains frozen body and key after an ambiguous provider failure and blocks expired retries', async () => {
    const { u, b } = await owner(); await collectEducation(start, [u.id]);
    const fetcher = provider(async () => { throw new Error('simulated lost response'); });
    await dispatch(u.id, start, fetcher); const [first] = await messages(u.id); expect(first.attempts).toBe(1);
    const retry = new Date(first.nextAttemptAt); vi.setSystemTime(retry);
    await db.update(schema.businesses).set({ profile: { business: { name: 'New profile text' } } }).where(eq(schema.businesses.id, b.id));
    await dispatch(u.id, retry, fetcher);
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'); expect(posts).toHaveLength(2); expect(posts[0][1]?.body).toBe(posts[1][1]?.body); expect(posts[0][1]?.headers).toEqual(posts[1][1]?.headers);
    await dispatch(u.id, new Date(start.getTime() + 23 * 3600e3), fetcher); expect((await enrollment(u.id)).status).toBe('blocked'); expect(await messages(u.id)).toHaveLength(1);
  });
  it.each([401, 429, 500, 200])('fails closed on uncertain suppression response%s without spending attempts', async status => {
    const { u } = await owner(); await collectEducation(start, [u.id]);
    const fetcher = vi.fn(async () => new Response(status === 200 ? '{"wrong":"shape"}' : '', { status }));
    await dispatch(u.id, start, fetcher); const [m] = await messages(u.id); expect(m.status).toBe('queued'); expect(m.attempts).toBe(0); expect(m.firstAttemptAt).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('uses native provider suppression only for the recognized sending-only key response', async () => {
    const { u } = await owner(); await collectEducation(start, [u.id]);
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => init?.method === 'GET'
      ? new Response('{"name":"restricted_api_key","message":"Sending access only"}', { status: 401 })
      : new Response('{"id":"accepted-native-suppression-still-applies"}'));
    await dispatch(u.id, start, fetcher);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST']);
    expect((await messages(u.id))[0]).toMatchObject({ status: 'sent', attempts: 1 });
    expect((await enrollment(u.id)).nextLesson).toBe(1); // acceptance is not a claim of inbox delivery
  });
  it.each([
    ['invalid key', 401, '{"name":"invalid_api_key"}'],
    ['unknown401', 401, '{}'],
    ['freeform message only', 401, '{"message":"restricted_api_key"}'],
    ['malformed JSON', 401, '{"name":"restricted_api_key"}trailing'],
    ['array body', 401, '[{"name":"restricted_api_key"}]'],
    ['null body', 401, 'null'],
    ['prototype property', 401, '{"__proto__":{"name":"restricted_api_key"}}'],
    ['same code at200', 200, '{"name":"restricted_api_key"}'],
    ['oversized body', 401, JSON.stringify({ name: 'restricted_api_key', message: 'x'.repeat(4096) })],
    ['otherHTTPstatus', 403, '{"name":"restricted_api_key"}'],
  ])('defers %s without applying the native suppression fallback', async (_label, status, body) => {
    const { u } = await owner(); await collectEducation(start, [u.id]);
    const fetcher = vi.fn(async () => new Response(body, { status }));
    await dispatch(u.id, start, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await messages(u.id))[0]).toMatchObject({ status: 'queued', attempts: 0, firstAttemptAt: null });
    expect((await enrollment(u.id)).nextLesson).toBe(0);
  });
  it('blocks matching provider suppression, never POSTS or advances', async () => {
    const { u } = await owner(); await collectEducation(start, [u.id]);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ email: u.email, reason: 'complaint' })));
    await dispatch(u.id, start, fetcher); expect(fetcher).toHaveBeenCalledTimes(1); expect((await enrollment(u.id)).reason).toBe('provider_suppressed'); expect((await enrollment(u.id)).nextLesson).toBe(0);
  });
  it('pauses an unattempted pending lesson beyond its old TTL and resumes the same key', async () => {
    const { u } = await owner(); await collectEducation(start, [u.id]); const [original] = await messages(u.id);
    await updateEducationPreference(u.id, false); const later = new Date(start.getTime() + 40 * 864e5); vi.setSystemTime(later);
    const fake = provider(); await dispatch(u.id, later, fake); expect(fake).not.toHaveBeenCalled(); expect((await enrollment(u.id)).status).toBe('paused');
    await updateEducationPreference(u.id, true, later); await dispatch(u.id, later, fake); expect((await enrollment(u.id)).nextLesson).toBe(1); expect((await messages(u.id))[0].id).toBe(original.id);
  });
  it.each(['welcome', 'invoice_paid'] as const)('dispatches essential %s before an already queued weekly lesson in a limit-one batch', async type => {
    const { u } = await owner();
    await collectEducation(start, [u.id]); // earlier creation must not let optional mail win
    const eventKey = `essential-priority:${type}:${u.id}`;
    await queueLifecycle(db, { userId: u.id, type, eventKey, data: { amountCents: 4900, currency: 'USD' }, sendAt: start });
    const fetcher = provider();
    expect(await dispatchLifecycleBatch({ userIds: [u.id], now: start, clock: () => start, fetch: fetcher as typeof fetch, sleep: async () => {}, limit: 1 })).toEqual({ processed: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.method).toBe('POST');
    const sent = JSON.parse(fetcher.mock.calls[0][1]?.body as string);
    expect(sent.subject).toBe(type === 'welcome' ? 'Welcome to Radar' : 'Your Radar subscription receipt');
    expect((await db.select().from(M).where(eq(M.eventKey, eventKey)))[0].status).toBe('sent');
    expect((await messages(u.id))[0]).toMatchObject({ status: 'queued', attempts: 0, firstAttemptAt: null });
    expect((await enrollment(u.id)).nextLesson).toBe(0);
  });
  it('prioritizes a due lesson in the next optional slot and respects a saved draft timezone', async () => {
    const { u } = await owner(); await queueLifecycle(db, { userId: u.id, type: 'founder_note', eventKey: 'founder-test:' + u.id, data: {}, sendAt: start });
    await collectEducation(start, [u.id]); await dispatch(u.id); expect((await enrollment(u.id)).nextLesson).toBe(1);
    const [founder] = await db.select().from(M).where(and(eq(M.userId, u.id), eq(M.type, 'founder_note'))); expect(founder.firstAttemptAt).toBeNull(); expect(founder.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(start.getTime() + 864e5);
    const draftUser = await F.user(); const draft = await F.biz(draftUser, { status: 'onboarding', onboarding: { savedAt: start.toISOString() } }); await db.update(schema.businesses).set({ timezone: 'Asia/Dubai' }).where(eq(schema.businesses.id, draft.id));
    const early = new Date('2026-11-10T04:00:00Z'); vi.setSystemTime(early); await collectEducation(early, [draftUser.id]); expect((await messages(draftUser.id))[0].nextAttemptAt.toISOString()).toBe('2026-11-10T05:00:00.000Z');
  });
  it('defaults work source capture on, preserves explicit off, and does not capture unverified work', async () => {
    const { u, b } = await owner(); await recordEngagement(db, { businessId: b.id, kind: 'article_social', ref: 'new-live-event', now: start });
    expect(await db.select().from(schema.engagementEvents).where(eq(schema.engagementEvents.userId, u.id))).toHaveLength(1);
    await updateEngagementPreferences(u.id, { articleSocial: false }); await recordEngagement(db, { businessId: b.id, kind: 'article_social', ref: 'after-off', now: start });
    expect(await db.select().from(schema.engagementEvents).where(eq(schema.engagementEvents.userId, u.id))).toHaveLength(1);
    await db.update(schema.users).set({ emailVerifiedAt: null }).where(eq(schema.users.id, u.id)); await recordEngagement(db, { businessId: b.id, kind: 'brief_reply', ref: '2026-11-09', now: start });
    expect(await db.select().from(schema.engagementEvents).where(eq(schema.engagementEvents.userId, u.id))).toHaveLength(1);
  });
  it('uses only owned deterministic profile text and neutral copy for member-only accounts', async () => {
    const { u, b } = await owner(); const teammate = await F.user(); await F.member(b.id, teammate);
    expect(await educationContext(teammate.id)).toEqual({ context: { access: 'workspace', gscConnected: false } });
    expect((await educationContext(u.id)).businessId).toBe(b.id);
    expect(educationPreferenceUser(educationPreferenceToken(u.id))).toBe(u.id); expect(educationPreferenceUser(preferenceToken(u.id))).toBeNull(); expect(educationPreferenceUser(educationPreferenceToken(u.id) + 'x')).toBeNull();
  });
  it('protects pending history against direct mail deletion but permits account cleanup', async () => {
    const { u, b } = await owner(); await collectEducation(start, [u.id]); const [m] = await messages(u.id);
    await expect(db.delete(M).where(eq(M.id, m.id))).rejects.toThrow();
    await db.delete(schema.businesses).where(eq(schema.businesses.id, b.id)); expect(await messages(u.id)).toHaveLength(1);
    await db.delete(schema.users).where(eq(schema.users.id, u.id)); expect(await enrollment(u.id)).toBeUndefined(); expect(await messages(u.id)).toHaveLength(0);
  });
});
