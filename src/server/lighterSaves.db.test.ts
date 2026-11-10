// "Lighter saves" on the wire (.factory/first-five-optimizations/architecture.md §3, §12), through the real route handlers
// and a real database: what a debounced save gets back, what the workspace carries per article, how one article is
// loaded, and that every writer of `articles` moves the version (`v`) the client decides reloads by.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const M = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>(), render: vi.fn() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => M.jar));
vi.mock('@/server/services/images', async orig => ({ ...(await orig<typeof import('@/server/services/images')>()), renderImage: M.render }));
// The real loadWorkspace, counted: a revision-only reply must not build a workspace at all.
vi.mock('@/server/workspace', async orig => { const m = await orig<typeof import('@/server/workspace')>(); return { ...m, loadWorkspace: vi.fn(m.loadWorkspace) }; });

import { eq } from 'drizzle-orm';
import { db, schema } from './db';
import { Fixtures, type TUser } from './testing/fixtures';
import { entryFromRow, loadWorkspace } from './workspace';
import { getJob, jobDefs, type JobCtx } from './jobs/queue';
import { POST as ACT } from '@/app/api/b/[bid]/act/route';
import { GET as WORKSPACE } from '@/app/api/b/[bid]/workspace/route';
import { buildPayload } from './services/publishing/publisher';
import { startDraft } from './services/drafting/start';
import { startBodyImages } from './services/drafting/bodyImages';
import './services/drafting/jobs';
import { defaultArticle } from '@/features/article/blocks';
import type { Article, Profile } from '@/lib/types';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const V2 = { 'x-radar-client': '2' };
const p = (bid: string) => ({ params: Promise.resolve({ bid }) });
/** `headers`: V2 for the current client, {} for a tab opened before this shipped. */
const act = (bid: string, body: { action: string; input?: any; reply?: 'rev' }, headers: Record<string, string> = V2) =>
  ACT(new Request('http://t/api/b/x/act', { method: 'POST', body: JSON.stringify(body), headers: { ...headers, 'x-forwarded-for': `10.${F.tag.length}.0.2` } }), p(bid));
const ws = (bid: string, headers: Record<string, string> = V2) => WORKSPACE(new Request('http://t/w', { headers }), p(bid));
const as = async (u: TUser) => { M.jar.clear(); await F.signIn(u, M.jar); };
const built = () => vi.mocked(loadWorkspace).mock.calls.length;
const profile = (domain: string): Profile => ({
  domain, business: { name: 'Fieldnote', description: 'Documentation tools', offerings: ['Docs'], industry: 'Software', positioning: '', differentiators: ['Keeps docs current'] },
  audience: { segments: ['Developers'], buyers: ['Team leads'], needs: ['Keep docs current'], competitors: [] }, keywords: { list: [] },
  brand: { logo: null, primary: '#123456', secondary: '#abcdef', voice: 'Clear', language: 'English', markets: [] },
});

// About the size of a real drafted article (the measured one was 44 KB of workspace for a single draft).
const SECRET = 'paragraph-only-the-article-body-contains';
const body: Article['body'] = [['p', 'Intro'], ['h2', 'Measure drift'], ...Array.from({ length: 40 }, (_, i): Article['body'][number] => ['p', `${SECRET} ${i}. ` + 'Compare what the docs say with what the code does, one section at a time. '.repeat(6)]), ['h2', 'Review changes'], ['p', 'Review with the pull request.'], ['h2', 'Ship safely'], ['p', 'Publish checked docs.']];
let seq = 0;
async function entryWith(bid: string, o: { status?: string; generated?: boolean; img?: Partial<Article['img']> } = {}) {
  const id = `e_ls_${F.tag}_${++seq}`;
  const [row] = await db.insert(schema.calendarEntries).values({ id, businessId: bid, title: 'Keep docs current', kw: 'docs updates ' + seq, type: 'Guide', date: '2026-11-20', status: o.status || 'review', audience: 'Developers', relevance: 'Docs drift' }).returning();
  const base = defaultArticle(entryFromRow(row));
  const a: Article = { ...base, generated: o.generated ?? true, body: o.generated === false ? [] : body, brief: { angle: 'Stay current', outline: ['Measure drift', 'Review changes', 'Ship safely'], words: 1400 }, img: { ...base.img, url: `/api/files/${bid}/hero/cover.png`, urlKey: 'branded:1', ...o.img }, sources: [{ title: 'Source', url: 'https://example.org/source', use: 'Context' }] };
  await db.insert(schema.articles).values({ entryId: id, businessId: bid, data: a }); // no updatedAt: the column default, as the calendar and refresh writers do
  return { id, a };
}
const row = async (id: string) => (await db.select().from(schema.articles).where(eq(schema.articles.entryId, id)))[0];
const vOf = async (id: string) => (await row(id)).updatedAt.getTime();
const revOf = async (bid: string) => (await db.select({ rev: schema.businesses.rev }).from(schema.businesses).where(eq(schema.businesses.id, bid)))[0].rev;
async function runDefined(id: string) {
  // Own the attempt just as the real queue worker does, so an unrelated dev worker cannot claim it mid-test.
  await db.update(schema.jobs).set({ status: 'running', lockedBy: 'lighter-saves-test', lockedAt: new Date() }).where(eq(schema.jobs.id, id));
  const job = (await getJob(id))!;
  const ctx: JobCtx = { job, payload: job.payload, businessId: job.businessId, attempt: job.attempts, progress: async progress => { await db.update(schema.jobs).set({ progress }).where(eq(schema.jobs.id, id)); }, touch: async () => {} };
  const result = await jobDefs().get(job.kind)!.run(ctx);
  await db.update(schema.jobs).set({ status: 'done', result }).where(eq(schema.jobs.id, id));
  return result;
}

describe.skipIf(!ON)('lighter saves (database)', () => {
  let owner: TUser; let editor: TUser; let viewer: TUser; let stranger: TUser; let biz: any; let other: any; let mine: { id: string; a: Article }; let theirs: { id: string; a: Article };
  beforeAll(async () => {
    owner = await F.user(); editor = await F.user(); viewer = await F.user(); stranger = await F.user();
    biz = await F.biz(owner, { domain: `ls-${F.tag}.test`, profile: profile(`ls-${F.tag}.test`) }); await F.member(biz.id, editor, 'Editor'); await F.member(biz.id, viewer, 'Viewer');
    other = await F.biz(stranger);
    mine = await entryWith(biz.id); theirs = await entryWith(other.id);
  });
  beforeEach(() => { M.render.mockReset(); M.render.mockImplementation(async (req: any) => `/api/files/${req.bid}/${req.kind}/${Date.now()}.png`); vi.mocked(loadWorkspace).mockClear(); });
  afterAll(() => F.cleanup());

  it('LS-1: a debounced save is answered with the new revision only, under 1 KB, and no workspace is built', async () => {
    await as(editor); const before = await revOf(biz.id);
    const r = await act(biz.id, { action: 'article.save', input: { entryId: mine.id, patch: { brief: { angle: 'A sharper angle' } } }, reply: 'rev' });
    const text = await r.text(); const j = JSON.parse(text);
    expect(r.status).toBe(200);
    expect(Object.keys(j)).toEqual(['ok', 'data', 'rev']);
    expect(j.rev).toBe(before + 1); expect(await revOf(biz.id)).toBe(before + 1);
    expect(j.data).toEqual({ ok: true, v: await vOf(mine.id), prev: expect.any(Number) });
    expect(Buffer.byteLength(text)).toBeLessThan(1024);
    expect(built()).toBe(0);
    expect(((await row(mine.id)).data as Article).brief.angle).toBe('A sharper angle'); // and it did save
    // A whole-body save (the largest autosave there is) gets the same small reply.
    const big = await act(biz.id, { action: 'article.save', input: { entryId: mine.id, patch: { body } }, reply: 'rev' });
    expect(Buffer.byteLength(await big.text())).toBeLessThan(1024); expect(built()).toBe(0);
  });

  it('a write without reply:"rev" carries the revision and a workspace whose articles are summaries, never bodies', async () => {
    await as(editor);
    const r = await act(biz.id, { action: 'article.save', input: { entryId: mine.id, patch: { seo: { title: 'Docs that stay current' } } } });
    const text = await r.text(); const j = JSON.parse(text);
    expect(Object.keys(j)).toEqual(['ok', 'data', 'rev', 'workspace']);
    expect(j.workspace.rev).toBe(j.rev); expect(built()).toBe(1);
    expect(j.workspace.articles[mine.id]).toEqual({ generated: true, outline: ['Measure drift', 'Review changes', 'Ship safely'], v: j.data.v });
    expect(text).not.toContain(SECRET);
    expect(Buffer.byteLength(text)).toBeLessThan(JSON.stringify(body).length); // smaller than one article body
  });

  it('LS-2: GET /workspace for the current client has no article body; its per-article fields are what other screens read', async () => {
    await as(viewer);
    const text = await (await ws(biz.id)).text(); const w = JSON.parse(text);
    expect(text).not.toContain(SECRET);
    expect(w.articles[mine.id]).toEqual({ generated: true, outline: ['Measure drift', 'Review changes', 'Ship safely'], v: await vOf(mine.id) });
    const fresh = await entryWith(biz.id, { generated: false });
    const w2 = await (await ws(biz.id)).json();
    expect(w2.articles[fresh.id]).toMatchObject({ generated: false, outline: ['Measure drift', 'Review changes', 'Ship safely'] });
    expect(w2.articles[fresh.id].v).toBeGreaterThan(0); // a row written with the column default still has a version
  });

  it('a tab opened before this shipped (no x-radar-client header) gets exactly the old replies: whole articles, no rev', async () => {
    await as(editor);
    const w = await (await ws(biz.id, {})).json();
    expect(w.articles[mine.id]).toEqual((await row(mine.id)).data);
    expect(JSON.stringify(w)).toContain(SECRET);
    // Its writes too, even if it somehow sent reply:"rev": it could not load an article any other way.
    for (const reply of [undefined, 'rev'] as const) {
      const r = await act(biz.id, { action: 'article.save', input: { entryId: mine.id, patch: { seo: { meta: 'Meta ' + reply } } }, ...(reply ? { reply } : {}) }, {});
      const j = await r.json();
      expect(Object.keys(j)).toEqual(['ok', 'data', 'workspace']);
      expect(j.workspace.articles[mine.id]).toEqual((await row(mine.id)).data);
      expect(j.workspace.articles[mine.id].body).toHaveLength(body.length);
    }
    // Reads are unchanged for both.
    expect(Object.keys(await (await act(biz.id, { action: 'article.get', input: { entryId: mine.id } }, {})).json())).toEqual(['ok', 'data']);
  });

  it('article.get returns the whole article and its version to any member, Viewer included, without bumping the revision', async () => {
    await as(viewer); const before = await revOf(biz.id);
    const r = await act(biz.id, { action: 'article.get', input: { entryId: mine.id } }); const j = await r.json();
    expect(r.status).toBe(200); expect(Object.keys(j)).toEqual(['ok', 'data']);
    expect(j.data.article).toEqual((await row(mine.id)).data);
    expect(j.data.v).toBe(await vOf(mine.id));
    expect(await revOf(biz.id)).toBe(before); expect(built()).toBe(0);
    // An entry that has no article row yet answers with the defaults and version 0 (what a first save reports as `prev`).
    const id = `e_ls_${F.tag}_bare`;
    const [bare] = await db.insert(schema.calendarEntries).values({ id, businessId: biz.id, title: 'No row yet', kw: 'bare', type: 'Guide', date: '2026-11-21', status: 'proposed', audience: '', relevance: 'Why' }).returning();
    const b = (await (await act(biz.id, { action: 'article.get', input: { entryId: id } })).json()).data;
    expect(b).toEqual({ article: defaultArticle(entryFromRow(bare)), v: 0 });
    await as(editor);
    const first = (await (await act(biz.id, { action: 'article.save', input: { entryId: id, patch: { brief: { angle: 'First' } } }, reply: 'rev' })).json()).data;
    expect(first.prev).toBe(0); expect(first.v).toBeGreaterThan(0);
  });

  it('article.get is tenant-checked: another business’s entry is not found, and a non-member gets nothing', async () => {
    await as(editor); // a member of `biz`, asking its own business for the other business's entry
    const r = await act(biz.id, { action: 'article.get', input: { entryId: theirs.id } }); const text = await r.text();
    expect(r.status).toBe(404); expect(text).not.toContain(SECRET); expect(text).not.toContain('Measure drift');
    // …and asking the other business directly: not a member there.
    expect((await act(other.id, { action: 'article.get', input: { entryId: theirs.id } })).status).toBe(404);
    expect((await act(other.id, { action: 'article.get', input: { entryId: mine.id } })).status).toBe(404);
    await as(stranger);
    expect((await act(biz.id, { action: 'article.get', input: { entryId: mine.id } })).status).toBe(404);
    M.jar.clear();
    expect((await act(biz.id, { action: 'article.get', input: { entryId: mine.id } })).status).toBe(401);
  });

  it('a Viewer can read an article but not save it', async () => {
    await as(viewer);
    const r = await act(biz.id, { action: 'article.save', input: { entryId: mine.id, patch: { brief: { angle: 'Viewer edit' } } }, reply: 'rev' });
    expect(r.status).toBe(403);
    expect(((await row(mine.id)).data as Article).brief.angle).not.toBe('Viewer edit');
  });

  it('a save reports the version it replaced: `prev` equals what the client loaded unless someone else saved in between', async () => {
    await as(editor);
    const save = async (angle: string) => (await (await act(biz.id, { action: 'article.save', input: { entryId: mine.id, patch: { brief: { angle } } }, reply: 'rev' })).json()).data as { v: number; prev: number };
    const loaded = (await (await act(biz.id, { action: 'article.get', input: { entryId: mine.id } })).json()).data.v as number;
    const one = await save('one'); const two = await save('two');
    expect(one.prev).toBe(loaded); expect(two.prev).toBe(one.v);          // an unbroken chain of my own saves
    expect(one.v).toBeGreaterThan(one.prev); expect(two.v).toBeGreaterThan(two.prev);
    // A teammate saves (another session; same route). My next save's `prev` is their version, not the one I hold.
    await as(owner);
    const teammate = (await (await act(biz.id, { action: 'article.save', input: { entryId: mine.id, patch: { seo: { meta: 'Teammate meta' } } } })).json()).data as { v: number; prev: number };
    await as(editor);
    const three = await save('three');
    expect(three.prev).toBe(teammate.v); expect(three.prev).not.toBe(two.v);
    const data = (await row(mine.id)).data as Article;
    expect(data.brief.angle).toBe('three'); expect(data.seo.meta).toBe('Teammate meta'); // both edits are there
    // article.source reports the same pair.
    const src = (await (await act(biz.id, { action: 'article.source', input: { entryId: mine.id, index: 0, removed: true } })).json()).data;
    expect(src).toEqual({ ok: true, v: await vOf(mine.id), prev: three.v });
  });

  it('every writer of `articles` moves v: saves, sources, videos, cover, replace topic, draft job, body-image job, publish cover', async () => {
    await as(editor);
    const seen = new Set<number>(); let last = 0;
    const moved = async (id: string, what: string) => { const v = await vOf(id); expect(v, what).toBeGreaterThan(last); expect(seen.has(v), what).toBe(false); seen.add(v); last = v; return v; };
    const ok = async (r: Response, what: string) => { expect(r.status, what + ': ' + await r.clone().text()).toBe(200); };
    const e = await entryWith(biz.id, { img: { url: null, urlKey: null } });
    last = await vOf(e.id); seen.add(last);
    // The workspace summary and article.get agree on v, before and after each write.
    const agree = async () => { const w = await (await ws(biz.id)).json(); const g = (await (await act(biz.id, { action: 'article.get', input: { entryId: e.id } })).json()).data; expect(w.articles[e.id].v).toBe(g.v); expect(g.v).toBe(last); };
    await agree();
    await ok(await act(biz.id, { action: 'article.save', input: { entryId: e.id, patch: { brief: { angle: 'New angle' } } }, reply: 'rev' }), 'save'); await moved(e.id, 'article.save');
    await ok(await act(biz.id, { action: 'article.source', input: { entryId: e.id, index: 0, removed: true } }), 'source'); await moved(e.id, 'article.source');
    await ok(await act(biz.id, { action: 'article.videos', input: { entryId: e.id, refresh: true } }), 'videos'); await moved(e.id, 'article.videos');
    await ok(await act(biz.id, { action: 'article.regenerateImage', input: { entryId: e.id } }), 'cover'); await moved(e.id, 'article.regenerateImage');
    await ok(await act(biz.id, { action: 'article.save', input: { entryId: e.id, patch: { img: { style: 'infographic' } } } }), 'style'); await moved(e.id, 'article.save (cover style)');
    await agree();
    // Publishing renders a missing cover and stores its url on the article.
    await db.update(schema.articles).set({ data: { ...(await row(e.id)).data, img: { ...(await row(e.id)).data.img, url: null, urlKey: null } }, updatedAt: new Date(last) }).where(eq(schema.articles.entryId, e.id));
    const [bizRow] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, biz.id));
    const [entryRow] = await db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.id, e.id));
    await buildPayload(bizRow, entryFromRow(entryRow), (await row(e.id)).data);
    expect(((await row(e.id)).data as Article).img.url).toBeTruthy(); await moved(e.id, 'publisher cover');
    // Body images, then a full redraft (both jobs, run as the worker runs them).
    await runDefined(await startBodyImages(biz.id, e.id)); await moved(e.id, 'article.bodyImages job');
    await runDefined(await startDraft(biz.id, e.id, 'user')); await moved(e.id, 'article.draft job');
    expect(((await row(e.id)).data as Article).draftedAt).toBeTruthy();
    await agree();
    // Replace topic (proposed entries only) rewrites the article row.
    const prop = await entryWith(biz.id, { status: 'proposed', generated: false }); last = await vOf(prop.id); seen.add(last);
    await ok(await act(biz.id, { action: 'calendar.replace', input: { entryId: prop.id, alt: { title: 'Another topic', kw: 'another topic', type: 'Guide', vol: null, kd: null, mode: 'new', audience: 'Developers', relevance: 'Because', outline: ['One', 'Two'] } } }), 'replace');
    await moved(prop.id, 'calendar.replace');
    expect((await (await ws(biz.id)).json()).articles[prop.id]).toEqual({ generated: false, outline: ['One', 'Two'], v: last });
  }, 30_000);
});

describe('writers of `articles` (source scan, no database)', () => {
  it('tripwire: every statement that writes `articles` sets updated_at (or inserts a new row, which gets the column default)', () => {
    const root = path.resolve(__dirname, '..'); const hits: string[] = [];
    const walk = (dir: string) => { for (const f of readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, f.name); if (f.isDirectory()) walk(full); else if (/\.tsx?$/.test(f.name) && !/\.test\.ts$/.test(f.name)) scan(full); } };
    const scan = (file: string) => {
      const src = readFileSync(file, 'utf8'); if (!/schema\.articles/.test(src)) return;
      for (const line of src.split('\n')) {
        const updates = /\.update\(schema\.articles\)/.test(line); const upserts = /\.insert\(schema\.articles\)/.test(line) && /onConflictDoUpdate/.test(line);
        const inserts = /\.insert\(schema\.articles\)/.test(line);
        if (!updates && !inserts) continue;
        hits.push(path.relative(root, file));
        if (updates || upserts) expect(line.slice(line.search(/onConflictDoUpdate|\.update\(schema\.articles\)/)), `${path.relative(root, file)} writes articles without updatedAt`).toMatch(/\bupdatedAt\b/);
      }
      expect(src, `${path.relative(root, file)} writes articles with raw SQL`).not.toMatch(/(update|insert into)\s+"?articles"?\s/i);
    };
    walk(root);
    // A new writer shows up here: check that it moves updated_at, then add it to the list.
    expect([...new Set(hits)].sort()).toEqual(['server/actions/article.ts', 'server/actions/calendar.ts', 'server/services/calendar/jobs.ts', 'server/services/drafting/jobs.ts', 'server/services/gsc/refresh.ts', 'server/services/publishing/publisher.ts']);
  });
});
