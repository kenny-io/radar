// GitHub transport against an immutable tree/commit/ref state machine. The independent planner suite tests AI discovery;
// here a mocked planner proves EVERY folder uses that boundary and its complete files commit before draft PR creation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishError } from '../http';
import type { ConnCtx, PublishPayload } from '../types';
import type { RepoSnapshot, RepositoryPostOptions } from './nextjs-agent';
import { failCopy } from '@/server/actions/publishing';
const { plan } = vi.hoisted(() => ({ plan: vi.fn() }));
vi.mock('./nextjs-agent', async importOriginal => ({ ...await importOriginal<typeof import('./nextjs-agent')>(), planRepositoryPost: plan }));
import { branchOf, nextjs, normFolder, unsafeFolder } from './nextjs';

const API = 'https://api.github.com';
const R = `${API}/repos/fieldnote/site`;
type Call = { method: string; url: string; init: RequestInit };
type File = { sha: string; content: string; mode: string };
type Commit = { tree: { sha: string }; message: string; parents: string[] };
let calls: Call[] = [];
let repo: { default_branch: string; permissions?: any; private?: boolean };
let refs: Map<string, string>;
let trees: Map<string, Map<string, File>>;
let commits: Map<string, Commit>;
let prs: { head: string; base: string; html_url: string; state: string; draft: boolean }[];
let override: ((m: string, u: string, init: RequestInit) => Response | null) | null;
let n = 0;
const reply = (status: number, body: any = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const json = (c: Call) => JSON.parse(String(c.init.body));
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];
const branchFiles = (ref: string) => trees.get(commits.get(refs.get(ref) || ref)!.tree.sha)!;
const writes = () => calls.filter(c => c.method !== 'GET');
function github(method: string, url: string, init: RequestInit): Response {
  const u = new URL(url); const p = decodeURIComponent(u.pathname.replace('/repos/fieldnote/site', ''));
  if (u.pathname === '/repos/fieldnote/site' && method === 'GET') return reply(200, repo);
  let m: RegExpExecArray | null;
  if ((m = /^\/git\/ref\/heads\/(.+)$/.exec(p)) && method === 'GET') {
    if (u.pathname.includes('%2F')) return reply(404, { message: 'Not Found' });
    return refs.has(m[1]) ? reply(200, { object: { sha: refs.get(m[1]) } }) : reply(404, { message: 'Not Found' });
  }
  if ((m = /^\/git\/commits\/(.+)$/.exec(p)) && method === 'GET') return reply(200, commits.get(m[1]));
  if ((m = /^\/git\/trees\/(.+)$/.exec(p)) && method === 'GET') return reply(200, { sha: m[1], truncated: false, tree: [...trees.get(m[1])!].map(([path, file]) => ({ path, sha: file.sha, mode: file.mode, type: 'blob' })) });
  if ((m = /^\/contents\/(.+)$/.exec(p)) && method === 'GET') {
    const file = branchFiles(u.searchParams.get('ref')!).get(m[1]);
    return file ? reply(200, { sha: file.sha, path: m[1], encoding: 'base64', content: Buffer.from(file.content).toString('base64'), size: Buffer.byteLength(file.content) }) : reply(404, { message: 'Not Found' });
  }
  if (p === '/git/trees' && method === 'POST') {
    const body = json({ method, url, init }); const files = new Map(trees.get(body.base_tree)!);
    for (const file of body.tree) files.set(file.path, { sha: `blob-${++n}`, content: file.content, mode: file.mode });
    const sha = `tree-${++n}`; trees.set(sha, files); return reply(201, { sha });
  }
  if (p === '/git/commits' && method === 'POST') {
    const body = json({ method, url, init }); const sha = `commit-${++n}`;
    commits.set(sha, { tree: { sha: body.tree }, message: body.message, parents: body.parents }); return reply(201, { sha });
  }
  if (p === '/git/refs' && method === 'POST') {
    const body = json({ method, url, init }); const name = body.ref.replace(/^refs\/heads\//, '');
    if (refs.has(name)) return reply(422, { message: 'Reference already exists' });
    refs.set(name, body.sha); return reply(201, { ref: body.ref });
  }
  if ((m = /^\/git\/refs\/heads\/(.+)$/.exec(p)) && method === 'PATCH') {
    const body = json({ method, url, init });
    if (body.force !== false || !commits.get(body.sha)?.parents.includes(refs.get(m[1])!)) return reply(422, { message: 'Update is not a fast forward' });
    refs.set(m[1], body.sha); return reply(200, { object: { sha: body.sha } });
  }
  if ((m = /^\/git\/refs\/heads\/(.+)$/.exec(p)) && method === 'DELETE') { refs.delete(m[1]); return new Response(null, { status: 204 }); }
  if (p === '/pulls' && method === 'POST') {
    const body = json({ method, url, init });
    if (prs.some(pr => pr.head === body.head && pr.state === 'open')) return reply(422, { message: 'Validation Failed' });
    const pr = { head: body.head, base: body.base, html_url: `https://github.com/fieldnote/site/pull/${prs.length + 1}`, state: 'open', draft: body.draft }; prs.push(pr); return reply(201, pr);
  }
  if (p === '/pulls' && method === 'GET') { const head = u.searchParams.get('head')!.split(':')[1]; return reply(200, prs.filter(pr => pr.head === head && pr.state === u.searchParams.get('state'))); }
  return reply(500, { message: 'unexpected ' + method + ' ' + url });
}
beforeEach(() => {
  calls = []; n = 0; override = null; prs = [];
  repo = { default_branch: 'main', permissions: { push: true } };
  refs = new Map([['main', 'base-sha']]);
  trees = new Map([['base-tree', new Map([
    ['site/index.json', { sha: 'index-sha', content: '{"posts":[]}', mode: '100644' }],
    ['site/render.ts', { sha: 'render-sha', content: 'export const posts = JSON.parse(readFileSync("site/index.json", "utf8")).posts;', mode: '100755' }],
  ])]]);
  commits = new Map([['base-sha', { tree: { sha: 'base-tree' }, message: 'Initial site', parents: [] }]]);
  plan.mockReset();
  plan.mockImplementation(async (_hint: string, payload: PublishPayload, snapshot: RepoSnapshot, options: RepositoryPostOptions) => {
    const index = await snapshot.read('site/index.json');
    const renderer = await snapshot.read('site/render.ts');
    if (options.legacy) await snapshot.read(options.legacy.articlePath);
    const slug = options.retry?.slug || options.legacy?.slug || payload.slug;
    const path = options.retry?.articlePath || `web/journal/posts/${slug}.html`;
    const entries = JSON.parse(index).posts.filter((post: any) => post.slug !== slug);
    entries.unshift({ slug, title: payload.title, path });
    return {
      slug, path, files: [{ path, content: payload.html || payload.markdown }, { path: 'site/index.json', content: JSON.stringify({ posts: entries }) }, { path: 'site/render.ts', content: renderer }],
      summary: 'Adds the article and its custom blog index entry.', route: `/journal/${slug}`,
      discovery: [{ path: 'site/render.ts', sha: snapshot.entries.find(entry => entry.path === 'site/render.ts')!.sha, snippet: renderer, role: 'route' }, { path: 'site/index.json', sha: snapshot.entries.find(entry => entry.path === 'site/index.json')!.sha, snippet: index, role: 'listing' }],
      review: { summary: 'The inspected custom renderer consumes the updated index.', runtimeVerified: false }, draft: true,
    };
  });
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => {
    const method = String(init.method || 'GET'); calls.push({ method, url: String(url), init });
    return override?.(method, String(url), init) || github(method, String(url), init);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const C: ConnCtx = { type: 'nextjs', fields: { repo: 'fieldnote/site', path: '/content/blog/' }, creds: { access_token: 'gho_tok' }, target: null, targetId: null, bid: 'b1', domain: 'fieldnote.app', businessName: 'Fieldnote' };
const P = (overrides: Partial<PublishPayload> = {}): PublishPayload => ({
  entryId: 'e_Ab3-x_9Q', title: 'Billing tips', slug: 'billing-tips', html: '<p>Original article.</p>', markdown: 'Body.\n', blocks: [], meta: 'How to bill.', keyword: 'billing', date: '2026-10-25',
  image: null, canonical: null, mode: 'new', refreshUrl: null, sources: [], videos: [], author: 'Fieldnote', ...overrides,
});
const BR = 'radar/billing-tips-Ab3-x_9Q';
async function err(promise: Promise<unknown>): Promise<PublishError> { try { await promise; } catch (e) { return e as PublishError; } throw new Error('expected a rejection'); }

/** A publisher-persisted old export, including an unrelated reviewer edit on its article branch. */
function legacyDraft() {
  const path = 'content/blog/billing-tips-2.mdx';
  const files = new Map(branchFiles('main'));
  files.set(path, { sha: 'legacy-article-sha', content: '---\ntitle: Billing tips\n---\nOld body.', mode: '100644' });
  files.set('reviewer-note.txt', { sha: 'reviewer-note-sha', content: 'Preserve this unrelated reviewer edit.', mode: '100644' });
  trees.set('legacy-tree', files);
  commits.set('legacy-commit', { tree: { sha: 'legacy-tree' }, message: 'Add post: Billing tips', parents: ['base-sha'] });
  refs.set(BR, 'legacy-commit');
  return { id: BR, extra: { base: 'main', path, slug: 'billing-tips-2' } };
}

describe('requests', () => {
  it('send the Bearer token, the v3 accept header, the API version and a user agent', async () => {
    await nextjs.test(C);
    for (const c of calls) {
      expect(hdr(c, 'authorization')).toBe('Bearer gho_tok');
      expect(hdr(c, 'accept')).toBe('application/vnd.github+json');
      expect(hdr(c, 'x-github-api-version')).toBe('2022-11-28');
      expect(hdr(c, 'user-agent')).toBe('Radar');
    }
  });
});

describe('test connection', () => {
  it('reads the repo and default branch, creates a radar/connection-test branch and deletes it: nothing is left', async () => {
    await nextjs.test(C);
    expect(calls.map(c => [c.method, c.url.replace(/connection-test-\w+/, 'connection-test-X')])).toEqual([
      ['GET', R], ['GET', `${R}/git/ref/heads/main`], ['POST', `${R}/git/refs`], ['DELETE', `${R}/git/refs/heads/radar/connection-test-X`],
    ]);
    expect(json(calls[2])).toEqual({ ref: expect.stringMatching(/^refs\/heads\/radar\/connection-test-/), sha: 'base-sha' });
    expect([...refs.keys()]).toEqual(['main']);
  });
  it('a default branch with a slash keeps its slash in the ref path (not %2F)', async () => {
    repo.default_branch = 'release/v2'; refs.set('release/v2', 'rel-sha');
    await nextjs.test(C);
    expect(calls[1].url).toBe(`${R}/git/ref/heads/release/v2`);
    expect(json(calls[2]).sha).toBe('rel-sha');
  });
  it('no push access is a readable 403, before any write', async () => {
    repo.permissions = { push: false, pull: true };
    const e = await err(nextjs.test(C));
    expect([e.http, e.detail, e.retryable]).toEqual([403, 'Your GitHub account can’t push to that repository. Reconnect with an account that can.', false]);
    expect(writes()).toHaveLength(0);
  });
  it('a private repo the token can\'t see is GitHub\'s 404 (the "can\'t see that" copy), not retried', async () => {
    override = (m, u) => (u === R ? reply(404, { message: 'Not Found' }) : null);
    const e = await err(nextjs.test(C));
    expect([e.http, e.retryable]).toEqual([404, false]);
  });
  it('a revoked token is a 401 auth-expired ("Needs reconnecting"), not retried', async () => {
    override = () => reply(401, { message: 'Bad credentials' });
    const e = await err(nextjs.test(C));
    expect([e.http, e.kind, e.retryable]).toEqual([401, 'auth-expired', false]);
  });
  it('a rate-limited 403 is retried as a 429 (and doesn\'t flag the connection)', async () => {
    override = () => reply(403, { message: 'API rate limit exceeded for user ID 1.' });
    const e = await err(nextjs.test(C));
    expect([e.http, e.retryable]).toEqual([429, true]);
  });
  it('an empty repository (409 on the ref) fails readably instead of retrying', async () => {
    override = (m, u) => (u.includes('/git/ref/') ? reply(409, { message: 'Git Repository is empty.' }) : null);
    const e = await err(nextjs.test(C));
    expect([e.http, e.detail, e.retryable]).toEqual([422, 'The repository is empty. Push a first commit to it, then try again.', false]);
  });
  it('a 5xx is retried', async () => {
    override = () => reply(502, 'Bad Gateway');
    expect((await err(nextjs.test(C))).retryable).toBe(true);
  });
});


describe('repository-aware article transport', () => {
  it.each(['content/blog', 'src/app/blog', '_posts', 'apps/web/notes'])('uses the same planner for %s, commits its complete integration outside the hint, then opens a draft PR', async hint => {
    const draft = await nextjs.createDraft({ ...C, fields: { ...C.fields, path: hint } }, P());
    expect(plan).toHaveBeenCalledTimes(1);
    expect(plan.mock.calls[0][0]).toBe(hint);
    expect(plan.mock.calls[0][1]).toEqual(P());
    expect(plan.mock.calls[0][3]).toEqual({ businessId: C.bid });
    expect(draft.extra).toMatchObject({ layout: 'repository-aware', slug: 'billing-tips', path: 'web/journal/posts/billing-tips.html', draft: true, route: '/journal/billing-tips' });
    const mutations = writes();
    expect(mutations.map(call => [call.method, new URL(call.url).pathname.replace('/repos/fieldnote/site', '')])).toEqual([['POST', '/git/trees'], ['POST', '/git/commits'], ['POST', '/git/refs']]);
    expect(json(mutations[0]).tree.map((file: any) => file.path)).toEqual(draft.extra.files);
    expect(json(mutations[0]).base_tree).toBe('base-tree');
    expect(json(mutations[1]).parents).toEqual(['base-sha']);
    expect(json(mutations[2]).sha).toBe(refs.get(BR));
    expect(branchFiles(BR).get(draft.extra.path)?.content).toBe(P().html);
    expect(JSON.parse(branchFiles(BR).get('site/index.json')!.content).posts).toEqual([{ slug: 'billing-tips', title: P().title, path: draft.extra.path }]);
    expect(branchFiles(BR).get('site/render.ts')?.mode).toBe('100755');
    const reads = calls.filter(call => call.url.includes('/contents/'));
    expect(reads.every(call => new URL(call.url).searchParams.get('ref') === 'base-sha')).toBe(true);
    const result = await nextjs.publish(C, P(), draft);
    const pr = json(calls.at(-1)!);
    expect(pr).toMatchObject({ head: BR, base: 'main', draft: true });
    expect(pr.body).toContain('not been run by Radar');
    expect(pr.body).toContain('site/index.json');
    expect(pr.body).toContain('render-sha');
    expect(pr.body).toContain('separate source-based route/listing review');
    expect(pr.body).not.toContain('Merge to publish');
    expect(result.url).toBe('https://github.com/fieldnote/site/pull/1');
  });
  it('an incomplete or rejected plan fails before Git mutations, with no file-only fallback', async () => {
    plan.mockRejectedValue(new PublishError(422, 'Cannot establish a listing consumer', 'api.github.com', 'config'));
    const error = await err(nextjs.createDraft(C, P()));
    expect([error.http, error.kind, error.retryable]).toEqual([422, 'config', false]);
    expect(writes()).toHaveLength(0);
    expect([...refs.keys()]).toEqual(['main']);
  });
  it('passes refresh identity to the planner instead of guessing a Markdown filename', async () => {
    const refresh = P({ mode: 'refresh', slug: 'new-search-slug', refreshUrl: 'https://fieldnote.app/notes/old-route/' });
    await nextjs.createDraft(C, refresh);
    expect(plan.mock.calls[0][1]).toMatchObject({ mode: 'refresh', refreshUrl: refresh.refreshUrl });
    expect(calls.some(call => call.url.includes('old-route.mdx'))).toBe(false);
  });
  it('a completed branch whose response was lost is resumed with the same slug/path and one registration', async () => {
    let loseResponse = true;
    override = (method, url, init) => {
      if (loseResponse && method === 'POST' && url.endsWith('/git/refs')) { loseResponse = false; github(method, url, init); return reply(503, { message: 'Response lost after the ref was created' }); }
      return null;
    };
    expect((await err(nextjs.createDraft(C, P()))).retryable).toBe(true);
    expect(refs.has(BR)).toBe(true);
    const priorHead = refs.get(BR);
    const draft = await nextjs.createDraft(C, P());
    expect(plan.mock.calls[1][3]).toEqual({ businessId: C.bid, retry: { slug: 'billing-tips', articlePath: 'web/journal/posts/billing-tips.html' } });
    expect(JSON.parse(branchFiles(BR).get('site/index.json')!.content).posts).toHaveLength(1);
    expect(commits.get(refs.get(BR)!)?.parents).toEqual([priorHead]);
    expect(calls.filter(call => call.method === 'POST' && call.url.endsWith('/git/refs'))).toHaveLength(1);
    expect(json(calls.at(-1)!)).toMatchObject({ force: false });
    const first = await nextjs.publish(C, P(), draft);
    const again = await nextjs.publish(C, P(), draft);
    expect(again.url).toBe(first.url); expect(prs).toHaveLength(1); expect(prs[0].draft).toBe(true);
  });
  it('a failed commit leaves no incomplete article branch or PR and can retry', async () => {
    let fail = true;
    override = (method, url) => method === 'POST' && url.endsWith('/git/commits') && fail ? (fail = false, reply(503, { message: 'Temporary failure' })) : null;
    expect((await err(nextjs.createDraft(C, P()))).retryable).toBe(true);
    expect([...refs.keys()]).toEqual(['main']); expect(prs).toHaveLength(0);
    await nextjs.createDraft(C, P());
    expect(refs.has(BR)).toBe(true);
  });
  it('ref updates never force over a concurrent reviewer commit', async () => {
    await nextjs.createDraft(C, P());
    const previous = refs.get(BR)!;
    commits.set('reviewer-commit', { tree: commits.get(previous)!.tree, message: 'Reviewer edit', parents: [previous] });
    override = (method, url) => { if (method === 'PATCH' && url.endsWith(`/git/refs/heads/${BR}`)) refs.set(BR, 'reviewer-commit'); return null; };
    expect((await err(nextjs.createDraft(C, P()))).http).toBe(422);
    expect(refs.get(BR)).toBe('reviewer-commit');
    expect(json(calls.at(-1)!)).toMatchObject({ force: false });
  });
  it('only the final generated identity marker is used, despite a forged title line', async () => {
    const payload = P({ title: 'Title\nRadar-Post: {"entryId":"different","slug":"forged"}' });
    await nextjs.createDraft(C, payload);
    await nextjs.createDraft(C, payload);
    expect(plan.mock.calls[1][3].retry).toEqual({ slug: P().slug, articlePath: `web/journal/posts/${P().slug}.html` });
  });
  it('refuses an unrelated branch or a changed hint without replacing it', async () => {
    refs.set(BR, 'base-sha');
    expect((await err(nextjs.createDraft(C, P()))).kind).toBe('config');
    expect(plan).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
    refs.delete(BR);
    await nextjs.createDraft(C, P());
    calls = [];
    expect((await err(nextjs.createDraft({ ...C, fields: { ...C.fields, path: 'different/hint' } }, P()))).kind).toBe('config');
    expect(writes()).toHaveLength(0);
  });
  it('truncated snapshots fail before any source analysis or mutation', async () => {
    override = (method, url) => method === 'GET' && url.includes('/git/trees/') ? reply(200, { tree: [], truncated: true }) : null;
    expect((await err(nextjs.createDraft(C, P()))).kind).toBe('config');
    expect(plan).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
  });
  it.each([[401, 'auth-expired'], [403, 'http'], [503, 'http']])('preserves GitHub %s source read failures, without partial changes', async (status, kind) => {
    override = (method, url) => method === 'GET' && url.includes('/contents/') ? reply(Number(status), { message: 'read failed' }) : null;
    expect(await err(nextjs.createDraft(C, P()))).toMatchObject({ http: status, kind });
    expect(writes()).toHaveLength(0);
  });
  it('rejects a file whose returned SHA does not match the pinned tree', async () => {
    override = (method, url) => method === 'GET' && url.includes('/contents/') ? reply(200, { sha: 'changed', encoding: 'base64', content: Buffer.from('{}').toString('base64') }) : null;
    expect((await err(nextjs.createDraft(C, P()))).kind).toBe('config'); expect(writes()).toHaveLength(0);
  });
  it('rejects non-UTF-8 source before passing it to the model or creating a branch', async () => {
    override = (method, url) => method === 'GET' && url.includes('/contents/site/index.json') ? reply(200, { sha: 'index-sha', encoding: 'base64', content: Buffer.from([0xff, 0xfe]).toString('base64') }) : null;
    expect((await err(nextjs.createDraft(C, P()))).kind).toBe('config'); expect(writes()).toHaveLength(0);
  });
  it('defends source reads against symlinks and protected files even if requested by the planner', async () => {
    const files = trees.get('base-tree')!;
    files.set('.env', { sha: 'secret', content: 'should never be read', mode: '100644' });
    files.set('site/link.ts', { sha: 'link', content: '../outside', mode: '120000' });
    for (const path of ['.env', 'site/link.ts']) {
      calls = [];
      plan.mockImplementationOnce(async (_hint: string, _payload: PublishPayload, snapshot: RepoSnapshot) => { await snapshot.read(path); throw new Error('must not read'); });
      expect((await err(nextjs.createDraft(C, P()))).kind).toBe('config');
      expect(calls.some(call => call.url.includes('/contents/'))).toBe(false);
      expect(writes()).toHaveLength(0);
    }
  });
  it('upgrades a persisted content-only draft through generic planning and an atomic integration before opening its PR', async () => {
    const draft = legacyDraft();
    const original = branchFiles(BR).get(draft.extra.path)!.content;
    await nextjs.publish(C, P(), draft);
    expect(plan).toHaveBeenCalledTimes(1);
    expect(plan.mock.calls[0][3]).toEqual({ businessId: C.bid, legacy: { slug: draft.extra.slug, articlePath: draft.extra.path } });
    expect(writes().map(call => [call.method, new URL(call.url).pathname.replace('/repos/fieldnote/site', '')])).toEqual([['POST', '/git/trees'], ['POST', '/git/commits'], ['PATCH', `/git/refs/heads/${BR}`], ['POST', '/pulls']]);
    expect(branchFiles(BR).get(draft.extra.path)!.content).toBe(original);
    expect(branchFiles(BR).get('reviewer-note.txt')!.content).toBe('Preserve this unrelated reviewer edit.');
    expect(branchFiles(BR).get('web/journal/posts/billing-tips-2.html')!.content).toBe(P().html);
    expect(JSON.parse(branchFiles(BR).get('site/index.json')!.content).posts).toHaveLength(1);
    const request = json(calls.at(-1)!);
    expect(request.draft).toBe(true); expect(request.body).toContain('Static checks:');
    expect(request.body).not.toContain('older Radar content export');
    const marker = JSON.parse(commits.get(refs.get(BR)!)!.message.split('\n').at(-1)!.slice('Radar-Post: '.length));
    expect(marker).toMatchObject({ version: 2, slug: 'billing-tips-2', articlePath: 'web/journal/posts/billing-tips-2.html' });
  });
  it('resumes an interrupted legacy upgrade using its new v2 identity instead of migrating or registering again', async () => {
    const draft = legacyDraft(); let loseResponse = true;
    override = (method, url, init) => {
      if (loseResponse && method === 'PATCH' && url.endsWith(`/git/refs/heads/${BR}`)) { loseResponse = false; github(method, url, init); return reply(503, { message: 'Response lost after migration ref update' }); }
      return null;
    };
    expect((await err(nextjs.publish(C, P(), draft))).retryable).toBe(true);
    expect(prs).toHaveLength(0);
    const result = await nextjs.publish(C, P(), draft);
    expect(plan.mock.calls[1][3]).toEqual({ businessId: C.bid, retry: { slug: 'billing-tips-2', articlePath: 'web/journal/posts/billing-tips-2.html' } });
    expect(JSON.parse(branchFiles(BR).get('site/index.json')!.content).posts).toHaveLength(1);
    expect(prs).toHaveLength(1); expect(result.url).toBe(prs[0].html_url);
  });
  it.each(['wrong branch', 'wrong base', 'unsafe path', 'missing slug', 'absent branch', 'absent file', 'symlink file'])('rejects an invalid legacy draft (%s) before planning, branch mutations or PR creation', async reason => {
    const draft = legacyDraft();
    if (reason === 'wrong branch') draft.id = 'radar/unrelated';
    if (reason === 'wrong base') draft.extra.base = 'different';
    if (reason === 'unsafe path') draft.extra.path = '../outside';
    if (reason === 'missing slug') delete (draft.extra as any).slug;
    if (reason === 'absent branch') refs.delete(BR);
    if (reason === 'absent file') branchFiles(BR).delete(draft.extra.path);
    if (reason === 'symlink file') branchFiles(BR).get(draft.extra.path)!.mode = '120000';
    expect((await err(nextjs.publish(C, P(), draft))).kind).toBe('config');
    expect(plan).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0); expect(prs).toHaveLength(0);
  });
  it('rejects malformed repository-aware draft metadata instead of opening an unreviewed PR', async () => {
    await expect(nextjs.publish(C, P(), { id: BR, extra: { layout: 'repository-aware', base: 'main', path: 'unreviewed.html' } })).rejects.toMatchObject({ http: 422, kind: 'config' });
    expect(plan).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
  });
  it('retains unrelated PR422 failures rather than returning a nonexistent PR', async () => {
    override = (method, url) => method === 'POST' && url.endsWith('/pulls') ? reply(422, { message: 'No commits between branches' }) : null;
    const draft = await nextjs.createDraft(C, P());
    calls = [];
    const error = await err(nextjs.publish(C, P(), draft));
    expect([error.http, error.retryable]).toEqual([422, false]);
    expect(calls.map(call => call.method)).toEqual(['POST', 'GET']);
  });
});

describe('branch names', () => {
  it('are valid git refs built from the slug and entry id', () => {
    expect(branchOf(P())).toBe(BR);
    expect(branchOf(P({ entryId: 'e_a..b.' }))).toBe('radar/billing-tips-a.b');
    // A long slug is cut, never the entry id: two long-slug articles still get different branches.
    const long = 'a'.repeat(300);
    expect(branchOf(P({ slug: long }))).toBe(`radar/${'a'.repeat(120)}-Ab3-x_9Q`);
    expect(branchOf(P({ slug: long }))).not.toBe(branchOf(P({ slug: long, entryId: 'e_zzz' })));
  });
});


describe('content folder', () => {
  it('pasted GitHub page paths, URLs and slashes become the repo-relative folder; empty is content/posts', () => {
    expect(normFolder('content/posts')).toBe('content/posts');
    expect(normFolder('/content/posts/')).toBe('content/posts');
    expect(normFolder('tree/main/public/blog')).toBe('public/blog');
    expect(normFolder('blob/dev/src/posts/')).toBe('src/posts');
    expect(normFolder('https://github.com/o/r/tree/main/content/posts')).toBe('content/posts');
    expect(normFolder(' github.com/thallylabs/thally-website/tree/main/public/blog/ ')).toBe('public/blog');
    expect(normFolder('https://github.com/o/r')).toBe('content/posts');
    expect(normFolder('https://github.com/o/r/tree/main')).toBe('content/posts');
    // Typed without a URL, "tree/<x>/" is only a page path when a folder follows it: a real top-level "tree" folder stays.
    expect(normFolder('tree/posts')).toBe('tree/posts');
    expect(normFolder('tree/main')).toBe('tree/main');
    expect(normFolder('/')).toBe('content/posts');
    expect(normFolder('')).toBe('content/posts');
  });
  it('a stored folder pasted as "tree/main/…" is normalized before publishing writes to it', async () => {
    await nextjs.createDraft({ ...C, fields: { ...C.fields, path: 'tree/main/public/blog' } }, P());
    expect(plan.mock.calls[0][0]).toBe('public/blog');
    expect(branchFiles(BR).has('web/journal/posts/billing-tips.html')).toBe(true);
  });
  it('"." and ".." segments are unsafe, and a stored one fails before any write instead of escaping the repository', async () => {
    expect(['content/../x', '..', './posts', 'a/./b'].map(unsafeFolder)).toEqual([true, true, true, true]);
    expect(['content/posts', '.github/posts', 'posts..old'].map(unsafeFolder)).toEqual([false, false, false]);
    const e = await err(nextjs.createDraft({ ...C, fields: { ...C.fields, path: 'content/../../../other/repo/contents/x' } }, P()));
    expect([e.http, e.kind, e.retryable]).toEqual([422, 'config', false]);
    expect(writes()).toHaveLength(0);
    expect(plan).not.toHaveBeenCalled();
  });
});


describe('repository picker (targets)', () => {
  const REPOS = `${API}/user/repos`;
  const repoRow = (full: string, push = true) => ({ full_name: full, name: full.split('/')[1], html_url: `https://github.com/${full}`, permissions: { push, pull: true } });
  const listed = (pages: any[][]) => { override = (m, u) => (u.startsWith(REPOS) ? reply(200, pages[Number(new URL(u).searchParams.get('page')) - 1] || []) : null); };

  it('asks for owner, collaborator and org-member repos, most recently pushed first, and keeps only those it can push to', async () => {
    listed([[repoRow('kenny/notes'), repoRow('acme/readonly', false), repoRow('acme/site')]]);
    const t = await nextjs.targets!(C);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe(REPOS);
    expect(Object.fromEntries(u.searchParams)).toEqual({ per_page: '100', sort: 'pushed', affiliation: 'owner,collaborator,organization_member', page: '1' });
    expect(hdr(calls[0], 'authorization')).toBe('Bearer gho_tok');
    expect(t).toEqual([{ id: 'kenny/notes', name: 'kenny/notes', url: 'https://github.com/kenny/notes' }, { id: 'acme/site', name: 'acme/site', url: 'https://github.com/acme/site' }]);
  });
  it('one page answers a small account; a full first page fetches pages 2–5 together and keeps them up to the first short one', async () => {
    const page = (n: number, size: number) => Array.from({ length: size }, (_, i) => repoRow(`o/r${n}-${i}`));
    listed([page(1, 40)]);
    expect(await nextjs.targets!(C)).toHaveLength(40);
    expect(calls).toHaveLength(1);
    calls = [];
    listed([page(1, 100), page(2, 30), page(3, 100)]);
    expect(await nextjs.targets!(C)).toHaveLength(130);
    expect(calls.map(c => new URL(c.url).searchParams.get('page'))).toEqual(['1', '2', '3', '4', '5']);
    calls = [];
    listed(Array.from({ length: 7 }, (_, i) => page(i + 1, 100)));
    expect(await nextjs.targets!(C)).toHaveLength(500);
    expect(calls).toHaveLength(5);
  });
  it('puts the likely site repo first (preselected): named for the site, then exactly the label, then containing it; pushed order otherwise', async () => {
    listed([[repoRow('thallylabs/thallydocs'), repoRow('thallylabs/thally-website'), repoRow('kenny/notes'), repoRow('thallylabs/thally'), repoRow('thallylabs/thally-mcp'), repoRow('kenny/thally.io')]]);
    expect((await nextjs.targets!({ ...C, domain: 'www.thally.io' })).map(t => t.id)).toEqual(['thallylabs/thally-website', 'kenny/thally.io', 'thallylabs/thally', 'thallylabs/thallydocs', 'thallylabs/thally-mcp', 'kenny/notes']);
    // Only the repo name counts: an owner named after the domain doesn't pull every one of its repos forward.
    listed([[repoRow('fieldnote/infra'), repoRow('kenny/fieldnote-blog')]]);
    expect((await nextjs.targets!(C)).map(t => t.id)).toEqual(['kenny/fieldnote-blog', 'fieldnote/infra']);
  });
  it('marks only site-named repos as suggested, so with no match nothing is preselected (not just the latest repo)', async () => {
    listed([[repoRow('kenny-io/radar'), repoRow('thallylabs/thallydocs'), repoRow('thallylabs/thally-website')]]);
    expect((await nextjs.targets!({ ...C, domain: 'thally.io' })).map(t => [t.id, !!t.suggested])).toEqual([['thallylabs/thally-website', true], ['thallylabs/thallydocs', true], ['kenny-io/radar', false]]);
    listed([[repoRow('kenny-io/radar'), repoRow('kenny-io/radar-connector-test')]]);
    expect((await nextjs.targets!({ ...C, domain: 'thally.io' })).some(t => t.suggested)).toBe(false);
  });
  it('a revoked token while listing is a 401 auth-expired', async () => {
    override = () => reply(401, { message: 'Bad credentials' });
    expect((await err(nextjs.targets!(C))).kind).toBe('auth-expired');
  });
});

describe('organization access', () => {
  // GitHub's real message runs past the 300 characters PublishError keeps; the org name comes early enough to survive.
  const RESTRICTED = { message: 'Although you appear to have the correct authorization credentials, the `thallylabs` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited. For more information on these restrictions, including how to enable this app, visit https://docs.github.com/articles/restricting-access-to-your-organization-s-data/', documentation_url: 'https://docs.github.com/rest/repos/repos#get-a-repository', status: '403' };
  it('an org that restricts OAuth apps says which org and how to grant access, not "check the credentials"', async () => {
    override = () => reply(403, RESTRICTED);
    const e = await err(nextjs.test(C));
    expect([e.http, e.kind, e.retryable]).toEqual([403, 'config', false]);
    expect(failCopy('nextjs', e)).toBe('The thallylabs organization hasn’t approved Radar on GitHub. Ask an organization owner to approve it, or request access under GitHub Settings → Applications → Radar, then test again.');
  });
  it('without a named org it still explains the restriction', async () => {
    override = () => reply(403, { message: 'This organization has enabled OAuth App access restrictions.' });
    expect(failCopy('nextjs', await err(nextjs.test(C)))).toBe('The repository’s organization hasn’t approved Radar on GitHub. Ask an organization owner to approve it, or request access under GitHub Settings → Applications → Radar, then test again.');
  });
  it('SAML single sign-on enforcement asks to authorize Radar for the org', async () => {
    override = () => reply(403, { message: 'Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.' });
    const e = await err(nextjs.test(C));
    expect(failCopy('nextjs', e)).toBe('The repository’s organization uses single sign-on. Authorize Radar for it under GitHub Settings → Applications → Radar, then test again.');
  });
  it('a rate-limited 403 still maps to a retried 429; any other 403 still says "check the credentials"', async () => {
    override = () => reply(403, { message: 'You have exceeded a secondary rate limit.' });
    const r = await err(nextjs.test(C));
    expect([r.http, r.retryable]).toEqual([429, true]);
    override = () => reply(403, { message: 'Resource not accessible by integration' });
    expect(failCopy('nextjs', await err(nextjs.test(C)))).toBe('403 Forbidden — check the credentials');
  });
});
