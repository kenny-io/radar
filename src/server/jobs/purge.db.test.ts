// The wipe of deleted businesses (PUR-1..5, decision A) on a real database and real files on local disk. Every run is
// narrowed to this file's own users, so it never wipes another test file's fixtures on a shared database.
// Skipped without DATABASE_URL.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; process.env.STORAGE_DIR = `.data/test-purge-${process.pid}`; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import fs from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, pool, schema } from '../db';
import { env } from '../env';
import { encrypt } from '../crypto';
import { Fixtures, uniq, type TUser } from '../testing/fixtures';
import * as failures from '../observability/failures';
import * as storage from '../services/storage';
import * as google from '../services/gsc/client';
import { setAdapterForTests } from '../services/social/publish/accounts';
import { stubAdapter } from '../services/social/publish/stubs';
import { restoreBusiness } from '../deletion';
import { cronDefs } from './cron';
import { jobDefs } from './queue';
import { PURGE_BREAKER, purgeDue, purgeOne } from './purge';
import './all';
import { GET as FILE } from '@/app/api/files/[...key]/route';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const B = schema.businesses; const E = schema.calendarEntries; const AR = schema.articles;
const DAY = 864e5;
const ROOT = path.resolve(process.cwd(), process.env.STORAGE_DIR!);
const run = () => purgeDue({ ownerIds: F.users });
const row = async (bid: string) => (await db.select().from(B).where(eq(B.id, bid)))[0];
/** A deleted business whose window ended a day ago. */
const overdue = (owner: TUser, o: Parameters<Fixtures['biz']>[1] = {}) => F.biz(owner, { status: 'deleted', deletedAt: new Date(Date.now() - 8 * DAY), ...o });
const put = (bid: string, kind: string, name = uniq()) => storage.putObject(`${bid}/${kind}/${name}.png`, Buffer.from(`${kind}:${name}`), 'image/png');
const keyOf = (url: string) => url.slice('/api/files/'.length);
const stored = (url: string) => fs.stat(path.join(ROOT, keyOf(url))).then(() => true, () => false);
const filesOf = async (bid: string) => { const out: string[] = []; const walk = async (d: string) => { for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) e.isDirectory() ? await walk(path.join(d, e.name)) : out.push(path.relative(ROOT, path.join(d, e.name))); }; await walk(path.join(ROOT, bid)); return out.filter(f => !f.endsWith('.type')).sort(); };
async function article(bid: string, status: string, data: Record<string, unknown>, o: Partial<typeof E.$inferInsert> = {}) {
  const id = `e-${uniq()}`;
  await db.insert(E).values({ id, businessId: bid, title: `T ${status}`, kw: 'kw', type: 'Guide', date: '2026-11-01', status, ...(status === 'published' ? { publishedUrl: 'https://site.test/post' } : {}), ...o });
  await db.insert(AR).values({ entryId: id, businessId: bid, data: { entryId: id, generated: true, body: [{ t: 'p', text: 'Hello.' }], ...data } });
  return id;
}
/** Every table in `public`, searched row by row as text for `needle`. */
async function tablesMentioning(needle: string): Promise<string[]> {
  const tables = (await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).rows.map(r => String((r as any).table_name));
  const hits: string[] = [];
  for (const t of tables) { const n = Number(((await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.identifier(t)} AS x WHERE x::text LIKE ${'%' + needle + '%'}`)).rows[0] as any).n); if (n) hits.push(`${t}:${n}`); }
  return hits;
}
beforeEach(() => { vi.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); delete process.env.RADAR_PURGE; delete process.env.RADAR_BILLING; setAdapterForTests('x', null); H.jar.clear(); });

describe.skipIf(!ON)('the wipe of deleted businesses (database)', () => {
  afterAll(async () => {
    if (F.users.length) { await db.delete(schema.lifecycleGuideStates).where(inArray(schema.lifecycleGuideStates.userId, F.users)); await db.delete(schema.educationEnrollments).where(inArray(schema.educationEnrollments.userId, F.users)); await db.delete(schema.lifecycleEmails).where(inArray(schema.lifecycleEmails.userId, F.users)); await db.delete(schema.featureRequests).where(inArray(schema.featureRequests.userId, F.users)); }
    await F.cleanup(); await fs.rm(ROOT, { recursive: true, force: true });
  });

  it('an active business and a draft are never wiped (PUR-4)', async () => {
    const owner = await F.user(); const active = await F.biz(owner); const draft = await F.biz(owner, { status: 'onboarding' });
    const file = await put(active.id, 'logo'); const seeded = await F.seedEverything(active.id, owner.id);
    expect(await run()).toEqual({ due: 0, wiped: 0, failed: 0, filesDeleted: 0, filesKept: 0 });
    for (const b of [active, draft]) { expect(await purgeOne(b.id)).toBe('skipped'); expect(await row(b.id)).toEqual(b); }
    expect(await stored(file)).toBe(true);
    expect((await db.select().from(AR).where(eq(AR.entryId, seeded.entryId)))).toHaveLength(1);
    await expect(purgeOne('not-an-id')).rejects.toThrow('purgeOne needs a business id');
  });

  it('a deleted business whose `purgeAt` is in the future is never wiped, by the selector or by `purgeOne` called directly with its id (PUR-4)', async () => {
    const owner = await F.user();
    const fresh = await F.biz(owner, { status: 'deleted' });
    const almost = await F.biz(owner, { status: 'deleted', deletedAt: new Date(Date.now() - 7 * DAY + 60_000) });   // a minute left
    // Deleted long ago but given a later wipe time (allowed): the wipe time decides, not the age of the delete.
    const extended = await F.biz(owner, { status: 'deleted', deletedAt: new Date(Date.now() - 30 * DAY), purgeAt: new Date(Date.now() + DAY) });
    const files = await Promise.all([fresh, almost, extended].map(b => put(b.id, 'articles')));
    expect(await run()).toMatchObject({ due: 0, wiped: 0 });
    for (const b of [fresh, almost, extended]) { expect(await purgeOne(b.id)).toBe('skipped'); expect(await row(b.id)).toEqual(b); }
    for (const f of files) expect(await stored(f)).toBe(true);
  });

  it('the database refuses a deleted row with a `purge_at` less than 168 hours after `deleted_at`, and an active row with timestamps (PUR-4)', async () => {
    const owner = await F.user(); const biz = await F.biz(owner);
    const refused = (q: ReturnType<typeof sql>) => expect(db.execute(q)).rejects.toMatchObject({ cause: { constraint: 'businesses_deleted_check' } });
    // The rows a bug would need in order to get something wiped early cannot be written at all.
    await refused(sql`UPDATE businesses SET status = 'deleted', deleted_at = now() - interval '1 hour', purge_at = now() - interval '1 minute' WHERE id = ${biz.id}`);
    await refused(sql`UPDATE businesses SET status = 'deleted', deleted_at = now(), purge_at = now() + interval '167 hours' WHERE id = ${biz.id}`);
    await refused(sql`UPDATE businesses SET deleted_at = now() - interval '9 days', purge_at = now() - interval '1 day' WHERE id = ${biz.id}`);
    await refused(sql`UPDATE businesses SET status = 'deleted', purge_at = now() - interval '1 day' WHERE id = ${biz.id}`);
    await refused(sql`INSERT INTO businesses (owner_id, domain, status, profile, deleted_at, purge_at) VALUES (${owner.id}, 'x.test', 'active', '{}', now() - interval '9 days', now() - interval '1 day')`);
    expect(await run()).toMatchObject({ due: 0, wiped: 0 });
    expect(await row(biz.id)).toEqual(biz);
  });

  it('a business restored between selection and the lock is not wiped (PUR-3, PUR-4)', async () => {
    const owner = await F.user(); const biz = await overdue(owner); const file = await put(biz.id, 'logo');
    expect((await db.select({ id: B.id }).from(B).where(sql`${B.id} = ${biz.id} AND status = 'deleted' AND purge_at <= now()`))).toHaveLength(1);   // selected as due
    await db.execute(sql`UPDATE businesses SET status = 'active', deleted_at = NULL, purge_at = NULL WHERE id = ${biz.id}`);                       // then restored
    expect(await purgeOne(biz.id)).toBe('skipped');
    expect((await row(biz.id)).status).toBe('active');
    expect(await stored(file)).toBe(true);
  });

  it('while a restore holds the row the wipe skips it and the business survives; while the wipe holds it the restore gets not found (PUR-3)', async () => {
    const owner = await F.user();
    // 1. A restore's transaction holds the row lock: the wipe does not wait and does not wipe.
    const held = await F.biz(owner, { status: 'deleted', deletedAt: new Date(Date.now() - 8 * DAY) });
    const file = await put(held.id, 'logo');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT id FROM businesses WHERE id = $1 FOR UPDATE', [held.id]);
      const started = Date.now();
      expect(await purgeOne(held.id)).toBe('skipped');
      expect(await run()).toMatchObject({ due: 1, wiped: 0, failed: 0 });
      expect(Date.now() - started).toBeLessThan(5000);
      await c.query(`UPDATE businesses SET status = 'active', deleted_at = NULL, purge_at = NULL WHERE id = $1`, [held.id]);
      await c.query('COMMIT');
    } finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
    expect(await purgeOne(held.id)).toBe('skipped');
    expect((await row(held.id)).status).toBe('active');
    expect(await stored(file)).toBe(true);

    // 2. The wipe holds the row (it is inside its file step): a restore waits, then finds no business. The window is
    //    still open by the clock here only because the test back-dates nothing: use a row the wipe may take.
    const taken = await overdue(owner);
    const real = storage.deletePrefix; let inside!: () => void; const reached = new Promise<void>(r => { inside = r; }); let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    vi.spyOn(storage, 'deletePrefix').mockImplementation(async (bid, keep) => { inside(); await gate; return real(bid, keep); });
    const wipe = purgeOne(taken.id);
    await reached;
    let settled = false;
    const restore = restoreBusiness(owner.id, taken.id).then(v => ({ ok: v }), e => ({ err: e })).finally(() => { settled = true; });
    await new Promise(r => setTimeout(r, 300));
    expect(settled).toBe(false);                                // waiting on the row lock, not answered from a half-wiped state
    release();
    expect(await wipe).toEqual({ deleted: 0, kept: 0 });
    expect(await restore).toMatchObject({ err: { status: 404, code: 'restore_not_found' } });
    expect(await row(taken.id)).toBeUndefined();
  });

  it('restore is refused once the window has passed, and answers not found after the wipe (RES-3)', async () => {
    const owner = await F.user(); const biz = await overdue(owner);
    await expect(restoreBusiness(owner.id, biz.id)).rejects.toMatchObject({ status: 410, code: 'restore_expired' });
    expect(await run()).toMatchObject({ wiped: 1 });
    await expect(restoreBusiness(owner.id, biz.id)).rejects.toMatchObject({ status: 404, code: 'restore_not_found' });
  });

  it('with `RADAR_PURGE=off` nothing is wiped; with more than 50 due nothing is wiped and a failure is reported (PUR-4)', async () => {
    const owner = await F.user(); const first = await overdue(owner); const file = await put(first.id, 'logo');
    process.env.RADAR_PURGE = 'off';
    expect(await run()).toEqual({ skipped: 'off' });
    const before = (await db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.kind, 'business.purge'))).length;
    await cronDefs().find(h => h.name === 'business.purge')!.run(new Date('2030-01-01T10:23:00Z'));
    expect((await db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.kind, 'business.purge'))).length).toBe(before);
    expect((await row(first.id)).status).toBe('deleted');
    process.env.RADAR_PURGE = ' OFF ';
    expect(await run()).toEqual({ skipped: 'off' });
    delete process.env.RADAR_PURGE;

    const old = new Date(Date.now() - 9 * DAY);
    await db.insert(B).values(Array.from({ length: PURGE_BREAKER }, (_, i) => ({ ownerId: owner.id, domain: `mass-${i}.test`, status: 'deleted' as const, profile: {}, deletedAt: old, purgeAt: new Date(old.getTime() + 7 * DAY) })));
    const report = vi.spyOn(failures, 'reportFailure').mockResolvedValue(); vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run()).toEqual({ blocked: 'too_many_due', due: PURGE_BREAKER + 1 });
    expect(report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: 'cron', operation: 'business.purge', code: 'too_many_due' }));
    expect((await db.select({ id: B.id }).from(B).where(and(eq(B.ownerId, owner.id), eq(B.status, 'deleted')))).length).toBe(PURGE_BREAKER + 1);
    expect(await stored(file)).toBe(true);
    // One fewer is an ordinary hour: at most a batch per run, oldest wipe time first, the rest on later runs.
    await db.delete(B).where(eq(B.id, first.id));
    expect(await run()).toMatchObject({ due: PURGE_BREAKER, wiped: 25, failed: 0 });
    expect(await run()).toMatchObject({ due: 25, wiped: 25 });
    expect(await run()).toMatchObject({ due: 0, wiped: 0 });
  });

  it('after a wipe no table contains the business id anywhere, and `seedEverything` covers every table that has a business column (PUR-2)', async () => {
    const owner = await F.user(); const partnerOwner = await F.user(); await F.account(owner.id, { status: 'active', stripeCustomerId: `cus_${uniq()}` });
    const biz = await overdue(owner); const kept = await F.biz(owner); const partner = await F.biz(partnerOwner);
    const admin = await F.user(); await F.member(biz.id, admin, 'Admin');
    await F.seedEverything(kept.id, owner.id);                  // the same owner's other business, to prove it is untouched
    const seeded = await F.seedEverything(biz.id, owner.id);    // (the owner's one guide state now points at `biz`)
    // Rows in another account that name the business: one undecided proposal, one decided, one live link.
    const pdata = { page: `https://${biz.domain}/a`, target: `https://${partner.domain}/b`, anchor: 'b', partner: 'Fieldnote', domain: biz.domain };
    const [undecided, decided] = await db.insert(schema.proposals).values([{ businessId: partner.id, direction: 'in', partnerBusinessId: biz.id, data: pdata }, { businessId: partner.id, direction: 'in', partnerBusinessId: biz.id, data: pdata, decision: 'approved', decidedAt: new Date() }]).returning();
    const [link] = await db.insert(schema.liveLinks).values({ businessId: partner.id, proposalId: decided.id, fromUrl: pdata.page, toUrl: pdata.target, anchor: 'b', rel: 'follow', since: '2026-11-01' }).returning();
    // The owner has a lesson and a guide email pending (account mail, no business id): their RESTRICT keys must not block the wipe.
    const [lesson, guide] = await db.insert(schema.lifecycleEmails).values([{ userId: owner.id, eventKey: `lesson:${uniq()}`, type: 'weekly_education', payloadEnc: encrypt({}), expiresAt: new Date(Date.now() + DAY) }, { userId: owner.id, eventKey: `guide:${uniq()}`, type: 'lifecycle_guide', payloadEnc: encrypt({}), expiresAt: new Date(Date.now() + DAY) }]).returning();
    await db.insert(schema.educationEnrollments).values({ userId: owner.id, pendingEmailId: lesson.id });
    await db.update(schema.lifecycleGuideStates).set({ pendingEmailId: guide.id, status: 'queued' }).where(and(eq(schema.lifecycleGuideStates.userId, owner.id), eq(schema.lifecycleGuideStates.guideId, 'article_workflow')));

    // The seed covers every column the database has for a business id. A table added later fails here until it is seeded
    // (and, if it has no cascading foreign key, handled by the wipe).
    const columns = (await db.execute(sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name LIKE '%business_id%' ORDER BY 1, 2`)).rows as { table_name: string; column_name: string }[];
    expect(columns.length).toBeGreaterThanOrEqual(29);
    for (const c of columns) {
      const n = Number(((await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.identifier(c.table_name)} WHERE ${sql.identifier(c.column_name)} = ${biz.id}`)).rows[0] as any).n);
      expect([`${c.table_name}.${c.column_name}`, n > 0]).toEqual([`${c.table_name}.${c.column_name}`, true]);
    }
    expect((await tablesMentioning(biz.id)).length).toBeGreaterThan(25);
    const before = { kept: await row(kept.id), account: (await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId, owner.id)))[0], keptRows: await tablesMentioning(kept.id), user: (await db.select().from(schema.users).where(eq(schema.users.id, owner.id)))[0] };

    expect(await run()).toEqual({ due: 1, wiped: 1, failed: 0, filesDeleted: 0, filesKept: 0 });

    expect(await tablesMentioning(biz.id)).toEqual([]);
    expect(await row(biz.id)).toBeUndefined();
    // Kept: the owner, their billing row, their other business with every row it had, the member's own account.
    expect((await db.select().from(schema.users).where(eq(schema.users.id, owner.id)))[0]).toEqual(before.user);
    expect((await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId, owner.id)))[0]).toEqual(before.account);
    expect(await row(kept.id)).toEqual(before.kept);
    expect(await tablesMentioning(kept.id)).toEqual(before.keptRows);
    expect((await db.select().from(schema.users).where(eq(schema.users.id, admin.id)))).toHaveLength(1);
    // Events are bare counters and model calls keep their cost, with nothing that says whose they were.
    expect((await db.select().from(schema.events).where(eq(schema.events.id, seeded.eventId)))[0]).toMatchObject({ kind: 'article.published', businessId: null, userId: null, ref: null, props: {} });
    expect((await db.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, seeded.callId)))[0]).toMatchObject({ businessId: null, error: null, costUsd: 0.25, task: 'writing', ok: false });
    // In the other account: the undecided proposal is gone; the decided one and the live link remain as its own record.
    expect(await db.select().from(schema.proposals).where(eq(schema.proposals.id, undecided.id))).toEqual([]);
    expect((await db.select().from(schema.proposals).where(eq(schema.proposals.id, decided.id)))[0]).toMatchObject({ businessId: partner.id, partnerBusinessId: null, decision: 'approved', data: pdata });
    expect((await db.select().from(schema.liveLinks).where(eq(schema.liveLinks.id, link.id)))).toHaveLength(1);
    // The pending account mail and its states are still there; the guide only forgot which business it came from.
    expect((await db.select().from(schema.lifecycleEmails).where(inArray(schema.lifecycleEmails.id, [lesson.id, guide.id])))).toHaveLength(2);
    expect((await db.select().from(schema.educationEnrollments).where(eq(schema.educationEnrollments.userId, owner.id)))[0].pendingEmailId).toBe(lesson.id);
    expect((await db.select().from(schema.lifecycleGuideStates).where(eq(schema.lifecycleGuideStates.userId, owner.id))).map(g => [g.pendingEmailId, g.sourceBusinessId])).toEqual([[guide.id, null]]);
  });

  it('the cover and the body images of a published article are still stored and still served at the same URLs after the wipe; everything else under the prefix is deleted (decision A)', async () => {
    const owner = await F.user(); const biz = await overdue(owner);
    // A sibling business whose id differs in the last character only, and the same owner's other business.
    const near = biz.id.slice(0, -1) + (biz.id.endsWith('0') ? '1' : '0');
    await db.insert(B).values({ id: near, ownerId: owner.id, domain: 'near.test', status: 'active', profile: {} });
    const theirs = await put(near, 'articles');
    const f = { cover: await put(biz.id, 'articles'), body1: await put(biz.id, 'articles'), body2: await put(biz.id, 'articles'), replaced: await put(biz.id, 'articles'), realStale: await put(biz.id, 'articles'),
      draft: await put(biz.id, 'articles'), review: await put(biz.id, 'articles'), scheduled: await put(biz.id, 'articles'), failed: await put(biz.id, 'articles'), failedBody: await put(biz.id, 'articles'),
      remoteDraft: await put(biz.id, 'articles'), logo: await put(biz.id, 'logo'), social: await put(biz.id, 'social'), brief: await put(biz.id, 'brief') };
    // Published: its cover and body images are what went live. `replaced` was the cover before it was published and
    // nothing points at it any more; `img.real` is a stale copy and is not a reference.
    await article(biz.id, 'published', { img: { url: f.cover, real: { url: f.realStale } }, bodyImages: [{ url: f.body1 + '?v=3' }, { url: f.body2 }] });
    await article(biz.id, 'draft', { img: { url: f.draft } });
    await article(biz.id, 'review', { img: { url: f.review } });
    await article(biz.id, 'scheduled', { img: { url: f.scheduled } });
    await article(biz.id, 'failed', { img: { url: f.failed }, bodyImages: [{ url: f.failedBody }] });
    // Written to the site as a draft and then held (decision K): the owner can publish it by hand, so it counts.
    await article(biz.id, 'failed', { img: { url: f.remoteDraft } }, { publishRemote: { connId: 'c', id: 'remote-1' } });
    await db.update(B).set({ profile: { business: { name: 'Fieldnote' }, brand: { logo: f.logo } } }).where(eq(B.id, biz.id));
    await db.insert(schema.socialPacks).values({ id: `p-${uniq()}`, businessId: biz.id, data: { posts: { x: { imageUrl: f.social } } } });
    await db.insert(schema.briefDays).values({ businessId: biz.id, date: '2026-11-01', scannedAt: new Date().toISOString(), items: [{ id: 'i', img: { url: f.brief } }] });
    const bytes = await storage.readLocal(keyOf(f.cover));

    const result = await run();
    expect(result).toEqual({ due: 1, wiped: 1, failed: 0, filesDeleted: 10, filesKept: 4 });
    const keptUrls = [f.cover, f.body1, f.body2, f.remoteDraft];
    expect(await filesOf(biz.id)).toEqual(keptUrls.map(keyOf).sort());
    for (const url of keptUrls) {                               // the public route still answers, with the same bytes and type
      const res = await FILE(new Request('http://t' + url), { params: Promise.resolve({ key: keyOf(url).split('/') }) });
      expect([url, res.status, res.headers.get('content-type')]).toEqual([url, 200, 'image/png']);
    }
    expect(await storage.readLocal(keyOf(f.cover))).toEqual(bytes);
    for (const gone of [f.replaced, f.realStale, f.draft, f.review, f.scheduled, f.failed, f.failedBody, f.logo, f.social, f.brief]) expect([gone, await stored(gone)]).toEqual([gone, false]);
    expect(await stored(theirs)).toBe(true);
    // No table says which files were kept, and the result is numbers only (PUR-5).
    for (const url of keptUrls) expect(await tablesMentioning(keyOf(url))).toEqual([]);
    expect(Object.values(result).every(v => typeof v === 'number')).toBe(true);
    await db.delete(B).where(eq(B.id, near));
  });

  it('a published article whose cover or body image points outside the business’s prefix keeps nothing for that reference, and no file outside the prefix is touched (decision A)', async () => {
    const owner = await F.user(); const biz = await overdue(owner); const other = await F.biz(owner);
    const mine = await put(biz.id, 'articles'); const unreferenced = await put(biz.id, 'articles'); const theirs = await put(other.id, 'articles'); const theirsToo = await put(other.id, 'logo');
    await article(biz.id, 'published', { img: { url: theirs }, bodyImages: [{ url: 'https://images.example.com/a.png' }, { url: 'not a url' }, { url: `/api/files/${biz.id}/../${other.id}/logo/x.png` }, { url: theirsToo }, { url: mine }] });
    expect(await run()).toMatchObject({ wiped: 1, filesDeleted: 1, filesKept: 1 });
    expect(await filesOf(biz.id)).toEqual([keyOf(mine)]);
    expect(await stored(unreferenced)).toBe(false);
    expect(await filesOf(other.id)).toEqual([keyOf(theirs), keyOf(theirsToo)].sort());
  });

  it('a published image stored under an earlier public base is still recognised and kept (decision A)', async () => {
    const owner = await F.user(); const biz = await overdue(owner);
    const cover = await put(biz.id, 'articles'); const body = await put(biz.id, 'articles'); const extra = await put(biz.id, 'articles');
    await article(biz.id, 'published', { img: { url: `https://old-bucket.s3.us-east-1.amazonaws.com/${keyOf(cover)}` }, bodyImages: [{ url: `https://old.cdn.test/media/${keyOf(body)}?w=800` }] });
    expect(await run()).toMatchObject({ wiped: 1, filesDeleted: 1, filesKept: 2 });
    expect(await filesOf(biz.id)).toEqual([keyOf(cover), keyOf(body)].sort());
    expect(await stored(extra)).toBe(false);
  });

  it('when the keep set cannot be computed (a published article whose `bodyImages` is not a list; the read fails) the business is not wiped, no file is deleted, and the next run tries again (PUR-4)', async () => {
    const owner = await F.user(); const broken = await overdue(owner); const fine = await overdue(owner);
    const files = [await put(broken.id, 'articles'), await put(broken.id, 'logo')]; const fineFile = await put(fine.id, 'logo');
    const entry = await article(broken.id, 'published', { img: { url: files[0] }, bodyImages: 'body.png' });
    const seeded = await F.seedEverything(broken.id, owner.id);
    const report = vi.spyOn(failures, 'reportFailure').mockResolvedValue();
    const remove = vi.spyOn(storage, 'deletePrefix');
    for (let i = 0; i < 2; i++) {                               // it alerts and is left alone on every run until a person looks
      const r = await run();
      expect(r).toMatchObject({ failed: 1, wiped: i === 0 ? 1 : 0 });   // the business next to it is wiped on the first run all the same (PUR-3)
      expect((await row(broken.id)).status).toBe('deleted');
      for (const f of files) expect(await stored(f)).toBe(true);
      expect((await db.select().from(AR).where(eq(AR.entryId, seeded.entryId)))).toHaveLength(1);          // nothing from step 3 or 4 stuck either
      expect((await db.select().from(schema.featureRequests).where(eq(schema.featureRequests.businessId, broken.id)))).toHaveLength(1);
    }
    expect(remove.mock.calls.map(c => c[0])).toEqual([fine.id]);  // storage was never asked to touch the broken one
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining('nothing is wiped') }), { source: 'cron', operation: 'business.purge', businessId: broken.id });
    expect(await row(fine.id)).toBeUndefined(); expect(await stored(fineFile)).toBe(false);
    await expect(restoreBusiness(owner.id, broken.id)).rejects.toMatchObject({ code: 'restore_expired' });   // still not restorable
    // The read itself failing is the same: rolled back, reported, retried.
    remove.mockRestore(); report.mockClear();
    await db.update(AR).set({ data: { img: { url: files[0] }, bodyImages: [] } }).where(eq(AR.entryId, entry));
    const keys = await import('../deletion/keep');
    vi.spyOn(keys, 'publishedImageKeys').mockImplementationOnce(() => { throw new Error('the read failed'); });
    expect(await run()).toMatchObject({ due: 1, wiped: 0, failed: 1 });
    expect((await row(broken.id)).status).toBe('deleted'); for (const f of files) expect(await stored(f)).toBe(true);
    // Once the article is readable the next run finishes it, keeping the published cover.
    expect(await run()).toEqual({ due: 1, wiped: 1, failed: 0, filesDeleted: 1, filesKept: 1 });
    expect([await stored(files[0]), await stored(files[1])]).toEqual([true, false]);
  });

  it('a storage failure leaves the business deleted and unrestorable, with its articles still in the database, and the next run finishes it keeping the same published images (PUR-3)', async () => {
    const owner = await F.user(); const biz = await overdue(owner);
    const cover = await put(biz.id, 'articles'); const others = [await put(biz.id, 'articles'), await put(biz.id, 'logo'), await put(biz.id, 'social')];
    const entry = await article(biz.id, 'published', { img: { url: cover } });
    await F.seedEverything(biz.id, owner.id);
    const real = storage.deletePrefix; const report = vi.spyOn(failures, 'reportFailure').mockResolvedValue();
    // Storage removes one file and then fails: the transaction rolls back, so every row is still there.
    vi.spyOn(storage, 'deletePrefix').mockImplementationOnce(async bid => { await fs.unlink(path.join(ROOT, keyOf(others[0]))); throw new Error(`storage is away for ${bid}`); });
    expect(await run()).toEqual({ due: 1, wiped: 0, failed: 1, filesDeleted: 0, filesKept: 0 });
    expect((await row(biz.id)).status).toBe('deleted');
    expect((await db.select().from(AR).where(eq(AR.entryId, entry)))).toHaveLength(1);
    expect((await tablesMentioning(biz.id)).length).toBeGreaterThan(25);
    expect([await stored(cover), await stored(others[0]), await stored(others[1])]).toEqual([true, false, true]);
    await expect(restoreBusiness(owner.id, biz.id)).rejects.toMatchObject({ code: 'restore_expired' });
    expect(report).toHaveBeenCalledTimes(1);
    expect(storage.deletePrefix).not.toBe(real);
    // Next hour: the same articles give the same keep set.
    expect(await run()).toEqual({ due: 1, wiped: 1, failed: 0, filesDeleted: 2, filesKept: 1 });
    expect(await filesOf(biz.id)).toEqual([keyOf(cover)]);
    expect(await tablesMentioning(biz.id)).toEqual([]);
  });

  it('tokens are revoked after commit, a failed revoke does not fail the wipe, and Google is not revoked when the owner has another connected business (PUR-2)', async () => {
    const solo = await F.user(); const multi = await F.user();
    const alone = await overdue(solo); const one = await overdue(multi); const two = await F.biz(multi);
    const gsc = (bid: string, refresh: string) => db.insert(schema.gscConnections).values({ businessId: bid, status: 'connected', tokensEnc: encrypt({ access_token: 'a-' + refresh, refresh_token: refresh }) });
    await gsc(alone.id, 'r-alone'); await gsc(one.id, 'r-one'); await gsc(two.id, 'r-two');
    const acct = (bid: string, remoteId: string) => db.insert(schema.socialAccounts).values({ businessId: bid, ch: 'x', remoteId, name: 'F', tokensEnc: encrypt({ access_token: 'x-' + remoteId, refresh_token: 'r', expires_at: Date.now() + 3600e3, scope: '', stub: true }) });
    const shared = `x-shared-${uniq()}`; const own = `x-own-${uniq()}`;
    await acct(alone.id, own);
    await acct(one.id, shared); await acct(two.id, shared);
    const order: string[] = [];
    const googleRevoke = vi.spyOn(google, 'revoke').mockImplementation(async t => { order.push(`google:${t?.refresh_token}:${(await row(alone.id)) ? 'before-commit' : 'after-commit'}`); });
    const socialRevoked: string[] = [];
    setAdapterForTests('x', { ...stubAdapter('x'), revoke: async t => { socialRevoked.push(t.access_token); throw new Error('the platform said no'); } });
    const report = vi.spyOn(failures, 'reportFailure').mockResolvedValue();

    expect(await run()).toMatchObject({ due: 2, wiped: 2, failed: 0 });      // the failing revoke failed nothing
    expect(order).toEqual(['google:r-alone:after-commit']);                  // not r-one: the same owner's other business would lose its grant
    expect(googleRevoke).toHaveBeenCalledTimes(1);
    expect(socialRevoked).toEqual(['x-' + own]);                             // not the account another business still uses
    expect(report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: 'social', operation: 'social.revoke', degraded: true }));
    expect(report.mock.calls.every(c => !JSON.stringify(c[1]).includes(alone.id))).toBe(true);
    // The other business keeps its own connection rows.
    expect((await db.select().from(schema.gscConnections).where(eq(schema.gscConnections.businessId, two.id)))).toHaveLength(1);
    expect((await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.businessId, two.id)))).toHaveLength(1);
  });

  it('two runs at once wipe each business once, and one failing business does not stop the next and is wiped on the following run (PUR-3)', async () => {
    const owner = await F.user();
    const many = await Promise.all(Array.from({ length: 6 }, () => overdue(owner)));
    const files = await Promise.all(many.map(b => put(b.id, 'logo')));
    const removed: string[] = []; const real = storage.deletePrefix;
    vi.spyOn(storage, 'deletePrefix').mockImplementation(async (bid, keep) => { removed.push(bid); await new Promise(r => setTimeout(r, 30)); return real(bid, keep); });
    const [a, b] = await Promise.all([run(), run()]) as { wiped: number; failed: number; filesDeleted: number }[];
    expect(a.wiped + b.wiped).toBe(6);
    expect(a.filesDeleted + b.filesDeleted).toBe(6);
    expect(a.failed + b.failed).toBe(0);
    expect(removed.sort()).toEqual(many.map(m => m.id).sort());             // each exactly once
    for (const f of files) expect(await stored(f)).toBe(false);
    expect((await db.select({ id: B.id }).from(B).where(inArray(B.id, many.map(m => m.id))))).toEqual([]);

    // One of three fails in storage: the other two are wiped in the same run, the third on the next.
    vi.restoreAllMocks(); vi.spyOn(console, 'info').mockImplementation(() => {});
    const three = [await overdue(owner, { deletedAt: new Date(Date.now() - 10 * DAY) }), await overdue(owner, { deletedAt: new Date(Date.now() - 9 * DAY) }), await overdue(owner)];
    const report = vi.spyOn(failures, 'reportFailure').mockResolvedValue();
    vi.spyOn(storage, 'deletePrefix').mockImplementation(async (bid, keep) => { if (bid === three[0].id) throw new Error('bucket refused'); return real(bid, keep); });   // the oldest, tried first
    expect(await run()).toMatchObject({ due: 3, wiped: 2, failed: 1 });
    expect(report).toHaveBeenCalledWith(expect.any(Error), { source: 'cron', operation: 'business.purge', businessId: three[0].id });
    expect((await db.select({ id: B.id }).from(B).where(inArray(B.id, three.map(t => t.id)))).map(r => r.id)).toEqual([three[0].id]);
    vi.restoreAllMocks(); vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(await run()).toMatchObject({ due: 1, wiped: 1, failed: 0 });
  });

  it('the hourly cron only enqueues one job, and a run logs counts and nothing else: no name, domain or id of a wiped business (PUR-1, PUR-5)', async () => {
    const owner = await F.user();
    const biz = await overdue(owner, { domain: `secret-${uniq()}.test`, profile: { business: { name: 'Hidden Harbour' }, brand: {} } });
    await put(biz.id, 'logo');
    const log = vi.spyOn(console, 'info').mockImplementation(() => {}); const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await run();
    expect(result).toEqual({ due: 1, wiped: 1, failed: 0, filesDeleted: 1, filesKept: 0 });
    expect(log.mock.calls.map(c => c.join(' '))).toEqual(['[purge] due 1, wiped 1, failed 0, files deleted 1, kept 0']);
    const said = JSON.stringify([log.mock.calls, err.mock.calls, result]);
    for (const secret of [biz.id, biz.domain, 'Hidden Harbour', owner.email, owner.id]) expect(said).not.toContain(secret);
    log.mockClear();
    expect(await run()).toEqual({ due: 0, wiped: 0, failed: 0, filesDeleted: 0, filesKept: 0 });
    expect(log).not.toHaveBeenCalled();                          // nothing due, nothing logged

    // The cron: nothing before minute 23, one singleton job from then on, once per hour. The job is the run.
    const J = schema.jobs; const hook = cronDefs().find(h => h.name === 'business.purge')!;
    const mine = () => db.select().from(J).where(and(eq(J.kind, 'business.purge'), inArray(J.status, ['queued', 'running'])));
    await db.delete(J).where(eq(J.kind, 'business.purge'));
    const hour = '2031-03-04T05'; await db.delete(schema.cronMarks).where(eq(schema.cronMarks.key, `biz-purge:${hour}`));
    await hook.run(new Date(`${hour}:22:59Z`));
    expect(await mine()).toEqual([]);
    await hook.run(new Date(`${hour}:23:00Z`)); await hook.run(new Date(`${hour}:24:00Z`)); await hook.run(new Date(`${hour}:59:00Z`));
    const queued = await mine();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ businessId: null, singletonKey: 'business.purge', maxAttempts: 1, payload: {} });
    expect(jobDefs().get('business.purge')).toMatchObject({ maxAttempts: 1 });
    await db.delete(J).where(eq(J.kind, 'business.purge')); await db.delete(schema.cronMarks).where(eq(schema.cronMarks.key, `biz-purge:${hour}`));
  });
});
