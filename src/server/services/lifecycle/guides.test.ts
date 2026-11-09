import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { decrypt } from '@/server/crypto';
import { Fixtures } from '@/server/testing/fixtures';
import { setProviderNameForTests } from '@/server/billing/config';
import { collectGuides } from './guides';
import { collectEducation } from './education';
import { educationPreferenceToken, updateEducationPreference } from './preferences';
import { queueLifecycle, type LifecyclePayload } from './queue';
import { dispatchLifecycleBatch } from './dispatch';
const F = new Fixtures(), G = schema.lifecycleGuideStates, M = schema.lifecycleEmails, B = schema.businesses;
const now = new Date('2026-11-09T12:00:00Z'), DAY = 864e5;
const old = { flag: process.env.RADAR_EDUCATION_EMAILS, billing: process.env.RADAR_BILLING, stub: env.devStubs, key: env.resendKey };
const state = async (uid: string, id = 'article_workflow') => (await db.select().from(G).where(and(eq(G.userId, uid), eq(G.guideId, id as 'article_workflow' | 'search_refresh'))))[0];
const mails = (uid: string) => db.select().from(M).where(and(eq(M.userId, uid), eq(M.type, 'lifecycle_guide')));
const unpack = (m: typeof M.$inferSelect) => decrypt<LifecyclePayload>(m.payloadEnc)!;
const provider = (status = 200) => vi.fn(async (_url: string | URL | Request, init?: RequestInit) => init?.method === 'GET' ? new Response('{"name":"restricted_api_key"}', { status: 401 }) : new Response(status === 200 ? '{"id":"guide-test-ack"}' : '', { status }));
const send = (uid: string, at: Date, fake = provider(), limit = 10) => dispatchLifecycleBatch({ userIds: [uid], now: at, clock: () => at, fetch: fake as typeof fetch, sleep: async () => {}, limit });
async function owner(access = true) {
  const u = await F.user(); await F.account(u.id, { status: access ? 'active' : 'none' });
  const b = await F.biz(u, { status: access ? 'active' : 'onboarding', onboarding: { savedAt: now.toISOString() }, site: { analyzedAt: now.toISOString() } });
  await db.update(B).set({ timezone: 'UTC' }).where(eq(B.id, b.id)); return { u, b };
}
async function organic(uid: string, at: Date, status: 'sent' | 'logged' = 'sent') {
  const eventKey = `education:v1:${uid}:organic_search`;
  await queueLifecycle(db, { userId: uid, type: 'weekly_education', eventKey, data: { education: { version: 1, lesson: 'organic_search', context: { gscConnected: true, access: 'workspace' } } } });
  await db.update(M).set({ status, sentAt: status === 'sent' ? at : null }).where(eq(M.eventKey, eventKey));
}
async function gsc(bid: string, date = '2026-11-08', impressions = 10) {
  await db.insert(schema.gscConnections).values({ businessId: bid, status: 'connected', property: 'sc-domain:example.com', lastSyncedThrough: date }).onConflictDoUpdate({ target: schema.gscConnections.businessId, set: { status: 'connected', property: 'sc-domain:example.com', lastSyncedThrough: date } });
  await db.insert(schema.gscRows).values({ businessId: bid, kind: 'page', date, key: 'https://example.com/article', impressions, clicks: 1, ctr: .1, position: 12 }).onConflictDoUpdate({ target: [schema.gscRows.businessId, schema.gscRows.kind, schema.gscRows.date, schema.gscRows.key], set: { impressions } });
}
describe.skipIf(!process.env.DATABASE_URL)('one-time lifecycle guides (Postgres; fake provider only)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); process.env.RADAR_EDUCATION_EMAILS = '1'; process.env.RADAR_BILLING = 'on'; env.devStubs = false; env.resendKey = 'test-not-real'; setProviderNameForTests('stub'); });
  afterEach(() => { vi.useRealTimers(); env.devStubs = old.stub; env.resendKey = old.key; setProviderNameForTests(null); });
  afterAll(async () => { for (const [k,v] of [['RADAR_EDUCATION_EMAILS',old.flag],['RADAR_BILLING',old.billing]]) { if (v === undefined) delete process.env[k!]; else process.env[k!] = v; } await F.cleanup(); });
  it('observes old/new cohorts now with24h accessible and3day pretrial delays, deduping concurrency', async () => {
    const ready = await owner(), pending = await owner(false); await db.update(schema.users).set({ createdAt: new Date('2020-01-01') }).where(eq(schema.users.id, pending.u.id));
    const ids = [ready.u.id, pending.u.id]; await Promise.all([collectGuides(now, ids), collectGuides(now, ids)]);
    expect(await state(ready.u.id)).toMatchObject({ firstObservedAt: now, dueAt: new Date(now.getTime() + DAY), status: 'waiting' });
    expect((await state(pending.u.id)).dueAt.getTime()).toBe(now.getTime() + 3 * DAY); expect(await mails(ready.u.id)).toHaveLength(0);
    vi.setSystemTime(new Date(now.getTime() + DAY)); await collectGuides(new Date(now.getTime() + DAY), ids); expect(await mails(ready.u.id)).toHaveLength(1); expect(await mails(pending.u.id)).toHaveLength(0);
  });
  it('shortens a saved pretrial delay on access, never postpones and ignores mere proposed topics', async () => {
    const { u,b } = await owner(false); await db.insert(schema.calendarEntries).values({ id: 'proposed-' + u.id, businessId: b.id, title: 'A topic', kw: 'topic', type: 'Guide', date: '2026-11-09', status: 'proposed' });
    await collectGuides(now, [u.id]); await F.account(u.id, { status: 'trialing' }); await db.update(B).set({ status: 'active', calendarGeneratedAt: now }).where(eq(B.id, b.id));
    const after = new Date(now.getTime() + 3600e3); vi.setSystemTime(after); await collectGuides(after, [u.id]); const due = (await state(u.id)).dueAt;
    expect(due.getTime()).toBe(after.getTime() + DAY); await collectGuides(new Date(after.getTime() + 3600e3), [u.id]); expect((await state(u.id)).dueAt).toEqual(due);
  });
  it('permanently skips meaningful workflow in any owned business without per-business duplicates', async () => {
    const {u} = await owner(), other = await F.biz(u);
    await db.insert(schema.calendarEntries).values({ id: 'approved-' + u.id, businessId: other.id, title: 'Existing topic', kw: 'topic', type: 'Guide', date: '2026-11-09', status: 'approved' });
    await collectGuides(now, [u.id]); expect((await state(u.id)).status).toBe('skipped'); await db.delete(B).where(eq(B.id, other.id)); await collectGuides(new Date(now.getTime() + 10 * DAY), [u.id]); expect(await mails(u.id)).toHaveLength(0);
  });
  it('excludes guests, unverified, opted-out and member-only users without borrowing a profile', async () => {
    const {u,b} = await owner(), guest = await F.user({guest:true}), unverified = await F.user({verified:false}), member = await F.user(); await F.member(b.id, member); await updateEducationPreference(u.id, false);
    await collectGuides(now, [u.id,guest.id,unverified.id,member.id]); for (const uid of [u.id,guest.id,unverified.id,member.id]) expect(await state(uid)).toBeUndefined();
  });
  it.each([['2026-11-09',10],['2026-11-10',10],['2026-10-11',10],['2026-11-08',0]] as const)('does not capture search using current/future/stale/zero page data %s/%s', async (date, impressions) => {
    const {u,b} = await owner(); await organic(u.id, new Date(now.getTime() - 10 * DAY)); await gsc(b.id,date,impressions); await collectGuides(now,[u.id]); expect(await state(u.id,'search_refresh')).toBeUndefined();
  });
  it('requires actual organic acceptance and measured connected data, then records a fresh readiness anchor', async () => {
    const {u,b} = await owner(); await gsc(b.id); await organic(u.id, new Date(now.getTime() - 3 * DAY),'logged'); await collectGuides(now,[u.id]); expect(await state(u.id,'search_refresh')).toBeUndefined();
    await db.update(M).set({status:'sent',sentAt:new Date(now.getTime() - 3 * DAY)}).where(eq(M.eventKey,`education:v1:${u.id}:organic_search`));
    await collectGuides(now,[u.id]); expect(await state(u.id,'search_refresh')).toMatchObject({firstObservedAt:now,dueAt:new Date(now.getTime() + 4 * DAY)});
    expect((await db.select().from(schema.gscConnections).where(eq(schema.gscConnections.businessId,b.id)))[0].updatedAt).not.toBeNull();
  });
  it('sends once with account-owned history and education unsubscribe; preserves a frozen retry body', async () => {
    const {u} = await owner(); await collectGuides(now,[u.id]); const due = new Date(now.getTime() + DAY); vi.setSystemTime(due); await collectGuides(due,[u.id]);
    const fake = provider(503); await send(u.id,due,fake); const [first] = await mails(u.id); expect(first.businessId).toBeNull(); expect(unpack(first).envelope.headers?.['List-Unsubscribe']).toContain(encodeURIComponent(educationPreferenceToken(u.id)));
    const retry = first.nextAttemptAt; vi.setSystemTime(retry); const ack = provider(); await send(u.id,retry,ack);
    expect(fake.mock.calls.filter(([,i])=>i?.method==='POST')[0][1]?.body).toBe(ack.mock.calls.filter(([,i])=>i?.method==='POST')[0][1]?.body);
    expect(await state(u.id)).toMatchObject({status:'sent',pendingEmailId:null,sentAt:retry}); await collectGuides(new Date(retry.getTime()+100*DAY),[u.id]); expect(await mails(u.id)).toHaveLength(1);
  });
  it('defers stale search before first attempt, then renders current data when it is useful again', async () => {
    const {u,b} = await owner(); await organic(u.id,new Date(now.getTime()-10*DAY)); await gsc(b.id); await collectGuides(now,[u.id]); const due = new Date(now.getTime()+DAY); vi.setSystemTime(due);
    await db.update(schema.gscConnections).set({status:'error'}).where(eq(schema.gscConnections.businessId,b.id)); await collectGuides(due,[u.id]); const fake=provider(); await send(u.id,due,fake);
    const refresh=(await mails(u.id)).find(m=>unpack(m).data.guide?.id==='search_refresh')!; expect(refresh.firstAttemptAt).toBeNull();
    const later=new Date(due.getTime()+DAY); vi.setSystemTime(later); await gsc(b.id,'2026-11-10'); await send(u.id,later,fake); expect((await state(u.id,'search_refresh')).status).toBe('sent');
  });
  it('blocks a continuously unavailable search guide at the unattempted delivery deadline', async () => {
    const {u,b}=await owner(); await organic(u.id,new Date(now.getTime()-10*DAY)); await gsc(b.id); await collectGuides(now,[u.id]);
    const due=new Date(now.getTime()+DAY); vi.setSystemTime(due); await collectGuides(due,[u.id]);
    await db.update(schema.gscConnections).set({status:'error'}).where(eq(schema.gscConnections.businessId,b.id));
    const refresh=(await mails(u.id)).find(m=>unpack(m).data.guide?.id==='search_refresh')!;
    const expired=new Date(refresh.expiresAt.getTime()+1); vi.setSystemTime(expired); const fake=provider(); await send(u.id,expired,fake);
    expect(fake).not.toHaveBeenCalled(); expect(await state(u.id,'search_refresh')).toMatchObject({status:'blocked',reason:'expired_delivery_window'});
    await collectGuides(expired,[u.id]); expect((await mails(u.id)).filter(m=>unpack(m).data.guide?.id==='search_refresh')).toHaveLength(1);
  });
  it('resumes an unattempted paused guide under the same key after old TTL, but cannot reset an attempted opt-out', async () => {
    const {u}=await owner(); await collectGuides(now,[u.id]); const due=new Date(now.getTime()+DAY); vi.setSystemTime(due); await collectGuides(due,[u.id]); const [initial]=await mails(u.id); await updateEducationPreference(u.id,false,due);
    const later=new Date(due.getTime()+40*DAY); vi.setSystemTime(later); const fake=provider(); await send(u.id,later,fake); expect(fake).not.toHaveBeenCalled(); await updateEducationPreference(u.id,true,later); await send(u.id,later,fake); expect((await mails(u.id))[0].id).toBe(initial.id); expect((await state(u.id)).status).toBe('sent');
    const again=await owner(); await collectGuides(later,[again.u.id]); const next=new Date(later.getTime()+DAY); vi.setSystemTime(next); await collectGuides(next,[again.u.id]); await send(again.u.id,next,provider(503)); await updateEducationPreference(again.u.id,false,next); await updateEducationPreference(again.u.id,true,next); expect((await state(again.u.id)).status).toBe('blocked');
  });
  it('prioritizes essential and weekly mail before guides, and guides before founder within the shared cap', async () => {
    const {u}=await owner(); await collectGuides(now,[u.id]); const due=new Date(now.getTime()+DAY); vi.setSystemTime(due); await collectGuides(due,[u.id]); await collectEducation(due,[u.id]);
    await queueLifecycle(db,{type:'founder_note',userId:u.id,eventKey:'founder:'+u.id,data:{},sendAt:due});
    await send(u.id,due,provider(),1); expect((await state(u.id)).status).toBe('queued');
    const sent=(await db.select().from(M).where(and(eq(M.userId,u.id),eq(M.status,'sent'))))[0]; expect(sent.type).toBe('weekly_education');
    const tomorrow=new Date(due.getTime()+DAY); vi.setSystemTime(tomorrow); await send(u.id,tomorrow,provider(),1); expect((await state(u.id)).status).toBe('sent');
    const [founder]=await db.select().from(M).where(eq(M.eventKey,'founder:'+u.id)); expect(founder.firstAttemptAt).toBeNull();
  });
  it('protects pending outbox history and skips a deleted source without rebinding another business', async () => {
    const {u,b}=await owner(); await collectGuides(now,[u.id]); const due=new Date(now.getTime()+DAY); vi.setSystemTime(due); await collectGuides(due,[u.id]); const [mail]=await mails(u.id); await expect(db.delete(M).where(eq(M.id,mail.id))).rejects.toThrow();
    await db.delete(B).where(eq(B.id,b.id)); await F.biz(u); const fake=provider(); await send(u.id,due,fake); expect(fake).not.toHaveBeenCalled(); expect((await state(u.id)).status).toBe('skipped');
    await db.delete(B).where(eq(B.ownerId,u.id)); await db.delete(schema.users).where(eq(schema.users.id,u.id)); expect(await state(u.id)).toBeUndefined();
  });
});
