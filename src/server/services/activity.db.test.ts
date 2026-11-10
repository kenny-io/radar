// Review loop + activity on a real database, through the real route handlers and the real job queue
// (.factory/first-five-optimizations/architecture.md §4, §8): the Activity list and its per-member read cursor, how long
// notifications live, and failed drafts / calendar runs in the workspace and in Activity.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const M = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>(), draft: vi.fn(), calendarDown: false }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => M.jar));
// The draft itself is the model's work; here it either fails or returns a finished article.
vi.mock('./drafting/draft', async orig => ({ ...(await orig<typeof import('./drafting/draft')>()), draftArticle: M.draft }));
// The calendar run fails at its third phase while `calendarDown` is set, and is the real (stubbed) run otherwise.
vi.mock('./calendar/research', async orig => { const m = await orig<typeof import('./calendar/research')>(); return { ...m, existingArticles: (bid: string) => (M.calendarDown ? Promise.reject(new Error('provider down')) : m.existingArticles(bid)) }; });

import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { Fixtures, type TUser } from '../testing/fixtures';
import { entryFromRow } from '../workspace';
import { runJobNow } from '../jobs/queue';
import { NOTIFICATION_DAYS, pruneNotifications } from '../jobs/maintenance';
import { notify } from '../notify';
import { activityUnread, failedJobsOf } from './activity';
import { POST as ACT } from '@/app/api/b/[bid]/act/route';
import { GET as WORKSPACE } from '@/app/api/b/[bid]/workspace/route';
import './drafting/jobs';
import './calendar/jobs';
import { defaultArticle } from '@/features/article/blocks';
import type { ActivityItem, Article, Profile, Workspace } from '@/lib/types';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const V2 = { 'x-radar-client': '2' };
const p = (bid: string) => ({ params: Promise.resolve({ bid }) });
const act = (bid: string, body: { action: string; input?: any }) => ACT(new Request('http://t/api/b/x/act', { method: 'POST', body: JSON.stringify(body), headers: { ...V2, 'x-forwarded-for': `10.${F.tag.length}.0.4` } }), p(bid));
const as = async (u: TUser | null) => { M.jar.clear(); if (u) await F.signIn(u, M.jar); };
const ws = async (bid: string): Promise<Workspace> => (await WORKSPACE(new Request('http://t/w', { headers: V2 }), p(bid))).json();
const list = async (bid: string, input: { before?: string; limit?: number } = {}) => { const r = await act(bid, { action: 'activity.list', input }); return { status: r.status, body: await r.json() as { ok: boolean; data: { items: ActivityItem[]; unread: number; seenAt: string } } }; };
const revOf = async (bid: string) => (await db.select({ rev: schema.businesses.rev }).from(schema.businesses).where(eq(schema.businesses.id, bid)))[0].rev;
const profile = (domain: string): Profile => ({
  domain, business: { name: 'Fieldnote', description: 'Documentation tools', offerings: ['Docs'], industry: 'Software', positioning: '', differentiators: ['Keeps docs current'] },
  audience: { segments: ['Developers'], buyers: ['Team leads'], needs: ['Keep docs current'], competitors: [] }, keywords: { list: [] },
  brand: { logo: null, primary: '#123456', secondary: '#abcdef', voice: 'Clear', language: 'English', markets: [] },
});
/** A notification written `agoMs` in the past (the database decides "now" for everything else). */
const note = async (bid: string, msg: string, agoMs = 0, userId: string | null = null) =>
  (await db.insert(schema.notifications).values({ businessId: bid, userId, payload: { msg, tone: 'ok' }, createdAt: new Date(Date.now() - agoMs) }).returning())[0];
const notesOf = (bid: string) => db.select().from(schema.notifications).where(eq(schema.notifications.businessId, bid));
let seq = 0;
async function entry(bid: string, title: string, status = 'approved') {
  const id = `e_act_${F.tag}_${++seq}`;
  const [row] = await db.insert(schema.calendarEntries).values({ id, businessId: bid, title, kw: 'docs ' + seq, type: 'Guide', date: '2026-11-20', status, audience: 'Developers', relevance: 'Docs drift' }).returning();
  await db.insert(schema.articles).values({ entryId: id, businessId: bid, data: defaultArticle(entryFromRow(row)) });
  return { id, row };
}
/** Run a queued job as its last attempt through the real queue, so a failure is final (recorded and announced). */
async function runLast(jobId: string) {
  const [j] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  await db.update(schema.jobs).set({ attempts: j.maxAttempts, status: 'running', lockedBy: 'activity-test', lockedAt: new Date() }).where(eq(schema.jobs.id, jobId));
  await runJobNow(jobId);
  return (await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)))[0];
}

describe.skipIf(!ON)('activity and failed states (database)', () => {
  let owner: TUser; let editor: TUser; let viewer: TUser; let stranger: TUser; let biz: any; let other: any;
  beforeAll(async () => {
    owner = await F.user(); editor = await F.user(); viewer = await F.user(); stranger = await F.user();
    biz = await F.biz(owner, { domain: `act-${F.tag}.test`, profile: profile(`act-${F.tag}.test`) }); await F.member(biz.id, editor, 'Editor'); await F.member(biz.id, viewer, 'Viewer');
    other = await F.biz(stranger, { domain: `act-other-${F.tag}.test`, profile: profile(`act-other-${F.tag}.test`) });
    // Read cursors start well in the past, so every row below begins unread for everybody.
    await db.update(schema.members).set({ activitySeenAt: new Date(Date.now() - 3600e3) }).where(eq(schema.members.businessId, biz.id));
  });
  afterAll(() => F.cleanup());

  it('RL-4: unread is counted per member, and reading the list as one member leaves the other’s count alone', async () => {
    await note(biz.id, 'Draft ready. Edit anything, then approve.', 3000); await note(biz.id, '3 drafts are ready for review.', 2000);
    expect(await activityUnread(biz.id, owner.id)).toBe(2); expect(await activityUnread(biz.id, editor.id)).toBe(2);
    await as(owner); expect((await ws(biz.id)).counts.activityUnread).toBe(2);

    await as(editor); const seen = await act(biz.id, { action: 'activity.seen', input: {} });
    expect(seen.status).toBe(200); expect(await seen.json()).toEqual({ ok: true, data: { ok: true } });
    expect((await ws(biz.id)).counts.activityUnread).toBe(0);
    await as(owner); expect((await ws(biz.id)).counts.activityUnread).toBe(2);

    // A notification written afterwards is unread for both; each cursor is its own.
    await note(biz.id, 'Calendar refreshed.');
    expect(await activityUnread(biz.id, editor.id)).toBe(1); expect(await activityUnread(biz.id, owner.id)).toBe(3);
    // Somebody who is not a member has no cursor and counts nothing.
    expect(await activityUnread(biz.id, stranger.id)).toBe(0);
  });

  it('RL-4: activity.seen and activity.list do not bump the shared revision, and a Viewer may use both', async () => {
    const before = await revOf(biz.id);
    await as(viewer);
    const l = await list(biz.id); expect(l.status).toBe(200); expect(Object.keys(l.body).sort()).toEqual(['data', 'ok']);
    expect(l.body.data.unread).toBe(3);
    const r = await act(biz.id, { action: 'activity.seen', input: {} }); const body = await r.json();
    expect(Object.keys(body).sort()).toEqual(['data', 'ok']); // no rev, no workspace
    expect(await revOf(biz.id)).toBe(before);
    expect(await activityUnread(biz.id, viewer.id)).toBe(0);
    // The list reports the cursor it found, so the panel can mark what was new when it opened.
    const again = await list(biz.id); expect(again.body.data.unread).toBe(0);
    expect(new Date(again.body.data.seenAt).getTime()).toBeGreaterThan(new Date(l.body.data.seenAt).getTime());
  });

  it('RL-4: the list is newest first, carries message, tone, action and time, and pages with before/limit', async () => {
    await db.delete(schema.notifications).where(eq(schema.notifications.businessId, biz.id));
    const at = new Date(Date.now() - 60e3); // five rows, three of them written in the same instant
    const rows = await db.insert(schema.notifications).values([
      { businessId: biz.id, payload: { msg: 'n1', tone: 'ok' }, createdAt: new Date(at.getTime() - 2000) },
      { businessId: biz.id, payload: { msg: 'n2', tone: 'warn' }, createdAt: at }, { businessId: biz.id, payload: { msg: 'n3' }, createdAt: at }, { businessId: biz.id, payload: { msg: 'n4', tone: 'bad', action: { label: 'Open', href: '/article/e_1' } }, createdAt: at },
      { businessId: biz.id, payload: { msg: 'n5', tone: 'ok' }, createdAt: new Date(at.getTime() + 2000) },
    ]).returning();
    await as(owner);
    const all = (await list(biz.id)).body.data.items;
    expect(all.map(i => i.msg)[0]).toBe('n5'); expect(all.map(i => i.msg)[4]).toBe('n1'); expect(all.map(i => i.msg).slice(1, 4).sort()).toEqual(['n2', 'n3', 'n4']);
    const n4 = all.find(i => i.msg === 'n4')!;
    expect(n4).toEqual({ id: rows[3].id, msg: 'n4', tone: 'bad', action: { label: 'Open', href: '/article/e_1' }, at: at.toISOString() });
    expect(all.find(i => i.msg === 'n3')).toEqual({ id: rows[2].id, msg: 'n3', at: at.toISOString() }); // no tone, no action

    // Two at a time: every row exactly once, in the same order, even across the three that share a timestamp.
    const paged: ActivityItem[] = []; let before: string | undefined;
    for (let i = 0; i < 4; i++) { const page = (await list(biz.id, { limit: 2, before })).body.data.items; expect(page.length).toBeLessThanOrEqual(2); paged.push(...page); if (page.length < 2) break; before = page[page.length - 1].id; }
    expect(paged.map(i => i.id)).toEqual(all.map(i => i.id));
    expect((await list(biz.id, { limit: 2, before: all[4].id })).body.data.items).toEqual([]); // nothing older than the oldest

    // Limits: at most 50 a page; a malformed cursor is refused.
    expect((await list(biz.id, { limit: 50 })).status).toBe(200);
    expect((await list(biz.id, { limit: 51 })).status).toBe(400);
    expect((await list(biz.id, { limit: 0 })).status).toBe(400);
    expect((await list(biz.id, { before: 'not-an-id' })).status).toBe(400);
  });

  it('RL-4: tenant-scoped: another business’s rows never appear, and a non-member is refused', async () => {
    const theirs = await note(other.id, 'THEIR-SECRET draft is ready');
    await as(owner);
    const mine = (await list(biz.id, { limit: 50 })).body.data.items;
    expect(mine.length).toBeGreaterThan(0); expect(JSON.stringify(mine)).not.toContain('THEIR-SECRET');
    // Their row's id as my cursor gives nothing, not their neighbours.
    expect((await list(biz.id, { before: theirs.id })).body.data.items).toEqual([]);
    // I am not a member of their business: both actions answer as if it did not exist, and their cursor does not move.
    const refused = await list(other.id); expect(refused.status).toBe(404); expect(JSON.stringify(refused.body)).not.toContain('THEIR-SECRET');
    const cursor = async () => (await db.select({ at: schema.members.activitySeenAt }).from(schema.members).where(and(eq(schema.members.businessId, other.id), eq(schema.members.userId, stranger.id))))[0].at.getTime();
    const was = await cursor();
    expect((await act(other.id, { action: 'activity.seen', input: {} })).status).toBe(404); expect(await cursor()).toBe(was);
    // Signed out: 401.
    await as(null); expect((await list(biz.id)).status).toBe(401);
    // The stranger sees their own.
    await as(stranger); expect((await list(other.id)).body.data.items.map(i => i.msg)).toEqual(['THEIR-SECRET draft is ready']);
  });

  it('RL-4: a private row is listed and counted only for the member it belongs to', async () => {
    await as(owner); await act(biz.id, { action: 'activity.seen', input: {} }); await as(editor); await act(biz.id, { action: 'activity.seen', input: {} });
    await new Promise(r => setTimeout(r, 15));
    await db.insert(schema.notifications).values({ businessId: biz.id, userId: editor.id, payload: { msg: 'PRIVATE-TO-EDITOR', tone: 'ok' } });
    await as(editor); const e = await list(biz.id);
    expect(e.body.data.items[0].msg).toBe('PRIVATE-TO-EDITOR'); expect(e.body.data.unread).toBe(1);
    await as(owner); const o = await list(biz.id, { limit: 50 });
    expect(JSON.stringify(o.body)).not.toContain('PRIVATE-TO-EDITOR'); expect(o.body.data.unread).toBe(0);
    expect((await ws(biz.id)).counts.activityUnread).toBe(0);
  });

  it('RL-4: notifications live 30 days: one from 29 days ago survives the prune, one from 30 days ago does not', async () => {
    expect(NOTIFICATION_DAYS).toBe(30);
    const day = 864e5; const now = new Date();
    const recent = await note(biz.id, 'kept: 29 days old', 29 * day); const edge = await note(biz.id, 'kept: a minute short of 30 days', 30 * day - 60e3);
    const old = await note(biz.id, 'pruned: 30 days and a minute', 30 * day + 60e3); const older = await note(biz.id, 'pruned: 45 days', 45 * day);
    // Yesterday's one-day rule would have removed all four.
    await pruneNotifications(now);
    const left = (await notesOf(biz.id)).map(n => n.id);
    expect(left).toContain(recent.id); expect(left).toContain(edge.id);
    expect(left).not.toContain(old.id); expect(left).not.toContain(older.id);
    // ...and the survivors are still in the list.
    await as(owner); expect((await list(biz.id, { limit: 50 })).body.data.items.map(i => i.msg)).toContain('kept: 29 days old');
  });

  it('RL-5: a failed draft names the article in Activity and is in B.failed until a later run for it succeeds', async () => {
    const title = 'Keep docs current'; const { id } = await entry(biz.id, title);
    await db.delete(schema.notifications).where(eq(schema.notifications.businessId, biz.id));
    await as(owner);
    M.draft.mockRejectedValueOnce(new Error('model overloaded'));
    const started = await (await act(biz.id, { action: 'article.draft', input: { entryId: id } })).json();
    // While it is queued it is not a failure.
    expect((await failedJobsOf(biz.id)).drafts[id]).toBeUndefined();
    const job = await runLast(started.data.jobId);
    expect(job.status).toBe('failed');

    // Activity: the notification names the article and links to it. No model or provider detail reaches the user.
    const items = (await list(biz.id)).body.data.items;
    expect(items[0]).toMatchObject({ msg: `Radar couldn’t draft “${title}”. Try again.`, tone: 'bad', action: { label: 'Open', href: `/article/${id}` } });
    expect(JSON.stringify(items)).not.toContain('overloaded');
    // Workspace: the failure is recorded for this entry, and the entry is back at "approved" so Retry can start it.
    const w = await ws(biz.id);
    expect(w.failed.drafts[id]).toEqual({ jobId: job.id, error: 'Radar couldn’t finish this. Try again.', at: job.createdAt.toISOString() });
    expect(w.calendar.entries.find(e => e.id === id)!.status).toBe('approved');
    expect(w.failed.calendar).toBeNull();
    // Another business sees none of it.
    expect((await failedJobsOf(other.id)).drafts).toEqual({});

    // Retry (the same action the button calls): queued hides the failure, and a successful run keeps it gone.
    M.draft.mockImplementationOnce(async (_ctx: any, e: any, a0: Article | null) => ({ ...defaultArticle(e), ...(a0 || {}), generated: true, body: [['p', 'Drafted.']], draftedAt: new Date().toISOString() }));
    const retry = await (await act(biz.id, { action: 'article.draft', input: { entryId: id } })).json();
    expect(retry.data.jobId).not.toBe(job.id);
    expect(retry.workspace.failed.drafts[id]).toBeUndefined();
    expect((await runLast(retry.data.jobId)).status).toBe('done');
    const after = await ws(biz.id);
    expect(after.failed.drafts[id]).toBeUndefined(); expect(after.calendar.entries.find(e => e.id === id)!.status).toBe('review');
    // The failed job row is still there (it lives 14 days); it is simply no longer the newest for the article.
    expect((await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)))[0].status).toBe('failed');
  });

  it('RL-5: a failure in one article does not mark another, and a long title is shortened in the notification', async () => {
    const long = 'How independent designers can keep client documentation current without losing a whole day every week';
    const a = await entry(biz.id, long); const b = await entry(biz.id, 'Second article');
    await as(owner); M.draft.mockRejectedValueOnce(new Error('boom'));
    const started = await (await act(biz.id, { action: 'article.draft', input: { entryId: a.id } })).json();
    await runLast(started.data.jobId);
    const failed = await failedJobsOf(biz.id);
    expect(Object.keys(failed.drafts)).toContain(a.id); expect(failed.drafts[b.id]).toBeUndefined();
    const msg = (await list(biz.id)).body.data.items[0].msg;
    expect(msg).toBe('Radar couldn’t draft “How independent designers can keep clien…”. Try again.');
  });

  it('RL-5: a failed calendar run names the calendar in Activity and is in B.failed until a later run succeeds', async () => {
    await db.delete(schema.notifications).where(eq(schema.notifications.businessId, biz.id));
    await as(owner); const settings = (await ws(biz.id)).calendar.settings;
    M.calendarDown = true;
    const started = await (await act(biz.id, { action: 'calendar.generate', input: { settings, keep: true } })).json();
    expect((await failedJobsOf(biz.id)).calendar).toBeNull(); // queued is not failed
    const job = await runLast(started.data.jobId);
    M.calendarDown = false;
    expect(job.status).toBe('failed');

    const items = (await list(biz.id)).body.data.items;
    expect(items[0]).toMatchObject({ msg: 'Radar couldn’t finish your content calendar. Try again.', tone: 'bad', action: { label: 'Open calendar', href: '/calendar' } });
    expect(JSON.stringify(items)).not.toContain('provider down');
    const w = await ws(biz.id);
    expect(w.failed.calendar).toEqual({ jobId: job.id, error: 'Radar couldn’t finish this. Try again.', at: job.createdAt.toISOString(), keep: true });
    expect((await failedJobsOf(other.id)).calendar).toBeNull();

    // Retry with the same settings and keep flag: the real (stubbed) run. Queued already hides the failure.
    const retry = await (await act(biz.id, { action: 'calendar.generate', input: { settings, keep: !!w.failed.calendar!.keep } })).json();
    expect(retry.workspace.failed.calendar).toBeNull();
    expect((await runLast(retry.data.jobId)).status).toBe('done');
    expect((await ws(biz.id)).failed.calendar).toBeNull();
  }, 60_000);
});
