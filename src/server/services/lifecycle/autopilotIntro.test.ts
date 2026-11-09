import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { decrypt } from '@/server/crypto';
import { Fixtures } from '@/server/testing/fixtures';
import { setProviderNameForTests } from '@/server/billing/config';
import { collectGuides, prepareGuide } from './guides';
import { collectEducation } from './education';
import { updateEducationPreference } from './preferences';
import { dispatchLifecycleBatch } from './dispatch';
import type { LifecyclePayload } from './queue';
const F = new Fixtures(), G = schema.lifecycleGuideStates, M = schema.lifecycleEmails, B = schema.businesses;
const now = new Date('2026-11-10T12:00:00Z'), DAY = 864e5, due = new Date(+now + 2 * DAY);
const old = { flag: process.env.RADAR_EDUCATION_EMAILS, billing: process.env.RADAR_BILLING, stub: env.devStubs, key: env.resendKey };
const state = async (uid: string) => (await db.select().from(G).where(and(eq(G.userId, uid), eq(G.guideId, 'autopilot_intro'))))[0];
const mail = async (uid: string) => (await db.select().from(M).where(eq(M.eventKey, `guide:v1:${uid}:autopilot_intro`)))[0];
const unpack = (m: typeof M.$inferSelect) => decrypt<LifecyclePayload>(m.payloadEnc)!;
const provider = (status = 200) => vi.fn(async (_url: string | URL | Request, init?: RequestInit) => init?.method === 'GET' ? new Response('{"name":"restricted_api_key"}', { status: 401 }) : new Response(status === 200 ? '{"id":"intro-test-ack"}' : '', { status }));
const send = (uid: string, at: Date, fake = provider(), limit = 10) => dispatchLifecycleBatch({ userIds: [uid], now: at, clock: () => at, fetch: fake as typeof fetch, sleep: async () => {}, limit });
async function owner(status: 'active' | 'trialing' | 'canceled' | 'none' = 'active', comp = false) {
  const u = await F.user(); await F.account(u.id, { status, comp });
  const b = await F.biz(u, { status: status === 'none' ? 'onboarding' : 'active', onboarding: { savedAt: now.toISOString() } });
  await db.update(B).set({ timezone: 'UTC' }).where(eq(B.id, b.id));
  // Manual work excludes the earlier article guide, but must never exclude this introduction.
  await db.insert(schema.calendarEntries).values({ id: 'intro-work-' + u.id, businessId: b.id, title: 'Existing work', kw: 'topic', type: 'Guide', date: '2026-11-10', status: 'approved' });
  return { u, b };
}
async function queue(uid: string) { await collectGuides(now, [uid]); vi.setSystemTime(due); await collectGuides(due, [uid]); return (await mail(uid))!; }
describe.skipIf(!process.env.DATABASE_URL)('Autopilot introduction (Postgres; fake provider only)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); process.env.RADAR_EDUCATION_EMAILS = '1'; process.env.RADAR_BILLING = 'on'; env.devStubs = false; env.resendKey = 'test-not-real'; setProviderNameForTests('stub'); });
  afterEach(() => { vi.useRealTimers(); env.devStubs = old.stub; env.resendKey = old.key; setProviderNameForTests(null); });
  afterAll(async () => { for (const [k, v] of [['RADAR_EDUCATION_EMAILS', old.flag], ['RADAR_BILLING', old.billing]]) { if (v === undefined) delete process.env[k!]; else process.env[k!] = v; } await F.cleanup(); });
  it.each([['none', false], ['trialing', false], ['active', false], ['active', true], ['canceled', false]] as const)('starts a fresh48h observation for old %s/comp%s owners without GSC or workflow prerequisites', async (status, comp) => {
    const { u } = await owner(status, comp); await db.update(schema.users).set({ createdAt: new Date('2020-01-01') }).where(eq(schema.users.id, u.id));
    await Promise.all([collectGuides(now, [u.id]), collectGuides(now, [u.id])]);
    expect(await state(u.id)).toMatchObject({ firstObservedAt: now, dueAt: due, status: 'waiting' });
    await collectGuides(new Date(+due - 1), [u.id]); expect(await mail(u.id)).toBeUndefined();
    vi.setSystemTime(due); await Promise.all([collectGuides(due, [u.id]), collectGuides(due, [u.id])]);
    expect((await mail(u.id)).eventKey).toBe(`guide:v1:${u.id}:autopilot_intro`); expect((await mail(u.id)).businessId).toBeNull();
  });
  it('does not reset a completed course or prior guide history', async () => {
    const { u, b } = await owner();
    await db.insert(schema.educationEnrollments).values({ userId: u.id, status: 'completed', nextLesson: 5, nextDueAt: now, lastAcceptedAt: now });
    await db.insert(G).values({ userId: u.id, guideId: 'article_workflow', firstObservedAt: now, dueAt: now, sourceBusinessId: b.id, status: 'sent', sentAt: now });
    const before = await db.select().from(schema.educationEnrollments).where(eq(schema.educationEnrollments.userId, u.id));
    const prior = await db.select().from(G).where(and(eq(G.userId, u.id), eq(G.guideId, 'article_workflow')));
    await queue(u.id); await send(u.id, due);
    expect((await state(u.id)).status).toBe('sent');
    expect(await db.select().from(schema.educationEnrollments).where(eq(schema.educationEnrollments.userId, u.id))).toEqual(before);
    expect(await db.select().from(G).where(and(eq(G.userId, u.id), eq(G.guideId, 'article_workflow')))).toEqual(prior);
  });
  it.each([{ enabled: true }, { enabled: false, enabledAt: '2025-01-01' }])('tombstones prior/current use on a secondary owned business and never reopens after off', async autopilot => {
    const { u } = await owner(), other = await F.biz(u); await db.update(B).set({ autopilot }).where(eq(B.id, other.id));
    await collectGuides(now, [u.id]); expect(await state(u.id)).toMatchObject({ status: 'skipped', reason: 'autopilot_already_enabled' });
    await db.update(B).set({ autopilot: {} }).where(eq(B.id, other.id)); await collectGuides(new Date(+due + 100 * DAY), [u.id]); expect(await mail(u.id)).toBeUndefined(); expect((await state(u.id)).status).toBe('skipped');
  });
  it('uses normalized state, ignores foreign activation and rejects non-Owner source roles', async () => {
    const { u, b } = await owner(); await db.update(B).set({ autopilot: { enabled: 'true', enabledAt: 123 } as never }).where(eq(B.id, b.id));
    const other = await owner(); await F.member(other.b.id, u); await db.update(B).set({ autopilot: { enabled: true } }).where(eq(B.id, other.b.id));
    await collectGuides(now, [u.id]); expect((await state(u.id)).status).toBe('waiting');
    const denied = await owner(); await db.update(schema.members).set({ role: 'Admin' }).where(and(eq(schema.members.businessId, denied.b.id), eq(schema.members.userId, denied.u.id)));
    await collectGuides(now, [denied.u.id]); expect(await state(denied.u.id)).toBeUndefined();
  });
  it('excludes opted-out, unverified, guest and member-only accounts', async () => {
    const opt = await owner(); await updateEducationPreference(opt.u.id, false);
    const unverified = await owner(); await db.update(schema.users).set({ emailVerifiedAt: null }).where(eq(schema.users.id, unverified.u.id));
    const guest = await owner(); await db.update(schema.users).set({ guest: true }).where(eq(schema.users.id, guest.u.id));
    const member = await F.user(); await F.member(opt.b.id, member, 'Admin');
    const ids = [opt.u.id, unverified.u.id, guest.u.id, member.id]; await collectGuides(now, ids); for (const id of ids) expect(await state(id)).toBeUndefined();
  });
  it('skips an activation observed while waiting and while queued before a provider request', async () => {
    const a = await owner(), b = await owner(); await collectGuides(now, [a.u.id]); await db.update(B).set({ autopilot: { enabled: true } }).where(eq(B.id, a.b.id)); await collectGuides(due, [a.u.id]); expect((await state(a.u.id)).status).toBe('skipped');
    await queue(b.u.id); await db.update(B).set({ autopilot: { enabledAt: '2026-11-12', enabled: false } }).where(eq(B.id, b.b.id)); const fake = provider(); await send(b.u.id, due, fake);
    expect(fake).not.toHaveBeenCalled(); expect(await state(b.u.id)).toMatchObject({ status: 'skipped', reason: 'autopilot_already_enabled' });
  });
  it('rechecks activation after the read-only suppression lookup before POST', async () => {
    const { u, b } = await owner(); await queue(u.id);
    const fake = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'GET') { await db.update(B).set({ autopilot: { enabled: true } }).where(eq(B.id, b.id)); return new Response('', { status: 404 }); }
      return new Response('{"id":"must-not-post"}', { status: 200 });
    });
    await send(u.id, due, fake);
    expect(fake.mock.calls.map(([, init]) => init?.method)).toEqual(['GET']);
    expect(await state(u.id)).toMatchObject({ status: 'skipped', reason: 'autopilot_already_enabled' });
    expect((await mail(u.id)).firstAttemptAt).toBeNull();
  });
  it('blocks an ambiguous retry if another owned business activates without changing the frozen envelope or key', async () => {
    const { u } = await owner(), other = await F.biz(u); await queue(u.id); await send(u.id, due, provider(503)); const first = await mail(u.id);
    await db.update(B).set({ autopilot: { enabled: true } }).where(eq(B.id, other.id)); vi.setSystemTime(first.nextAttemptAt); const fake = provider(); await send(u.id, first.nextAttemptAt, fake);
    expect(fake).not.toHaveBeenCalled(); expect((await state(u.id)).status).toBe('blocked'); const final = await mail(u.id); expect(final.payloadEnc).toBe(first.payloadEnc); expect(final.eventKey).toBe(first.eventKey); expect(final.attempts).toBe(first.attempts);
  });
  it('keeps a failed request body/key/identity exactly stable through a GSC-only change', async () => {
    const { u, b } = await owner(); await queue(u.id); const fail = provider(503); await send(u.id, due, fail); const first = await mail(u.id);
    await db.insert(schema.gscConnections).values({ businessId: b.id, status: 'connected', property: 'sc-domain:example.com' }); vi.setSystemTime(first.nextAttemptAt);
    expect((await prepareGuide(first, unpack(first), first.nextAttemptAt)).kind).toBe('send');
    const ack = provider(); await send(u.id, first.nextAttemptAt, ack);
    const post = (f: ReturnType<typeof provider>) => f.mock.calls.find(([, init]) => init?.method === 'POST')![1]!;
    expect(post(ack).body).toBe(post(fail).body); expect(post(ack).headers).toEqual(post(fail).headers); expect((await state(u.id)).status).toBe('sent');
  });
  it('rechecks owner role and source binding after enqueue', async () => {
    const { u, b } = await owner(); const first = await queue(u.id); await db.update(schema.members).set({ role: 'Editor' }).where(and(eq(schema.members.businessId, b.id), eq(schema.members.userId, u.id)));
    expect(await prepareGuide(first, unpack(first), due)).toEqual({ kind: 'suppress', reason: 'source_changed' });
  });
  it('retains a paused unattempted introduction through expiry and resumes its original key', async () => {
    const { u } = await owner(); const first = await queue(u.id); await updateEducationPreference(u.id, false, due);
    const later = new Date(+due + 40 * DAY); vi.setSystemTime(later); const fake = provider(); await send(u.id, later, fake); expect(fake).not.toHaveBeenCalled();
    await updateEducationPreference(u.id, true, later); await send(u.id, later, fake); expect((await state(u.id)).status).toBe('sent'); expect((await mail(u.id)).id).toBe(first.id);
  });
  it('gives a due weekly lesson the cap slot, then sends the introduction at the next daytime slot', async () => {
    const { u } = await owner(); await queue(u.id); await collectEducation(due, [u.id]); await send(u.id, due, provider(), 1);
    expect((await mail(u.id)).firstAttemptAt).toBeNull(); const early = new Date(+due + DAY - 1); vi.setSystemTime(early); const fake = provider(); await send(u.id, early, fake); expect(fake).not.toHaveBeenCalled();
    const next = new Date(+due + DAY); vi.setSystemTime(next); await send(u.id, next); expect((await state(u.id)).status).toBe('sent');
  });
});
