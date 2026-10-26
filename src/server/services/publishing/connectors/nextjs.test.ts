// Next.js (GitHub) connector against a mocked fetch that behaves like a small GitHub repo. Requests must match the REST
// contract (API version 2022-11-28): docs.github.com/en/rest/repos/repos#get-a-repository, …/rest/git/refs (get, create,
// delete a reference: "heads/<branch name>"), …/rest/repos/contents (get, create or update file contents), …/rest/pulls/pulls
// (create, list with head=owner:branch), …/rest/using-the-rest-api/troubleshooting-the-rest-api (404 for private repos,
// 403/429 rate limits). Failures must map to readable, correctly retried PublishErrors. No database, no network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishError } from '../http';
import type { ConnCtx, PublishPayload } from '../types';
import { failCopy } from '@/server/actions/publishing';
import { branchOf, mdxFile, nextjs, normFolder } from './nextjs';

const API = 'https://api.github.com';
const R = `${API}/repos/fieldnote/site`;
type Call = { method: string; url: string; init: RequestInit };
let calls: Call[] = [];
let repo: { default_branch: string; permissions?: any; private?: boolean };
let refs: Map<string, string>;
let files: Map<string, string>; // `${branch}:${path}` → sha
let prs: { head: string; base: string; html_url: string; state: string }[];
let override: ((m: string, u: string, init: RequestInit) => Response | null) | null;
let n = 0;
const reply = (status: number, body: any = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const json = (c: Call) => JSON.parse(String(c.init.body));
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];

/** A branch made from main sees main's files until it commits its own. */
const fileAt = (ref: string, path: string) => files.get(`${ref}:${path}`) || (ref !== 'main' && refs.has(ref) ? files.get(`main:${path}`) : undefined);
function github(method: string, url: string, init: RequestInit): Response {
  const u = new URL(url); const p = decodeURIComponent(u.pathname.replace('/repos/fieldnote/site', ''));
  if (u.pathname === '/repos/fieldnote/site' && method === 'GET') return reply(200, repo);
  let m: RegExpExecArray | null;
  if ((m = /^\/git\/ref\/heads\/(.+)$/.exec(p)) && method === 'GET') {
    // GitHub matches the raw path: an encoded slash (%2F) is not the same ref.
    if (u.pathname.includes('%2F')) return reply(404, { message: 'Not Found' });
    return refs.has(m[1]) ? reply(200, { ref: `refs/heads/${m[1]}`, object: { sha: refs.get(m[1]) } }) : reply(404, { message: 'Not Found' });
  }
  if (p === '/git/refs' && method === 'POST') {
    const name = json({ method, url, init }).ref.replace(/^refs\/heads\//, '');
    if (refs.has(name)) return reply(422, { message: 'Reference already exists' });
    refs.set(name, json({ method, url, init }).sha); return reply(201, { ref: `refs/heads/${name}` });
  }
  if ((m = /^\/git\/refs\/heads\/(.+)$/.exec(p)) && method === 'DELETE') { refs.delete(m[1]); return new Response(null, { status: 204 }); }
  if ((m = /^\/contents\/(.+)$/.exec(p))) {
    if (method === 'GET') { const sha = fileAt(u.searchParams.get('ref')!, m[1]); return sha ? reply(200, { sha, path: m[1] }) : reply(404, { message: 'Not Found' }); }
    const b = json({ method, url, init }); const k = `${b.branch}:${m[1]}`;
    if (fileAt(b.branch, m[1]) && b.sha !== fileAt(b.branch, m[1])) return reply(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' });
    files.set(k, 'sha' + ++n); return reply(files.size ? 201 : 200, { content: { sha: files.get(k) } });
  }
  if (p === '/pulls' && method === 'POST') {
    const b = json({ method, url, init });
    if (prs.some(x => x.head === b.head && x.state === 'open')) return reply(422, { message: 'Validation Failed', errors: [{ message: `A pull request already exists for fieldnote:${b.head}.` }] });
    const pr = { head: b.head, base: b.base, html_url: `https://github.com/fieldnote/site/pull/${prs.length + 1}`, state: 'open' }; prs.push(pr); return reply(201, pr);
  }
  if (p === '/pulls' && method === 'GET') { const head = u.searchParams.get('head')!.split(':')[1]; return reply(200, prs.filter(x => x.head === head && x.state === u.searchParams.get('state'))); }
  return reply(500, { message: 'unexpected ' + method + ' ' + url });
}
beforeEach(() => {
  calls = []; n = 0; override = null; prs = [];
  repo = { default_branch: 'main', permissions: { push: true } };
  refs = new Map([['main', 'base-sha']]); files = new Map();
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => {
    const method = String(init.method || 'GET'); calls.push({ method, url: String(url), init });
    return override?.(method, String(url), init) || github(method, String(url), init);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const C: ConnCtx = { type: 'nextjs', fields: { repo: 'fieldnote/site', path: '/content/blog/' }, creds: { access_token: 'gho_tok' }, target: null, targetId: null, bid: 'b1', domain: 'fieldnote.app', businessName: 'Fieldnote' };
const P = (o: Partial<PublishPayload> = {}): PublishPayload => ({
  entryId: 'e_Ab3-x_9Q', title: 'Billing tips', slug: 'billing-tips', html: '', markdown: 'Body.\n', blocks: [], meta: 'How to bill.', keyword: 'billing', date: '2026-10-25',
  image: null, canonical: null, mode: 'new', refreshUrl: null, sources: [], videos: [], author: 'Fieldnote', ...o,
});
const BR = 'radar/billing-tips-Ab3-x_9Q';
async function err(p: Promise<unknown>): Promise<PublishError> { try { await p; } catch (e) { return e as PublishError; } throw new Error('expected a rejection'); }
const writes = () => calls.filter(c => c.method !== 'GET');
const b64 = (c: Call) => Buffer.from(json(c).content, 'base64').toString('utf8');

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

describe('createDraft + publish (new post)', () => {
  it('checks the slug is free on the default branch, commits the MDX on the article\'s own branch, then opens the PR', async () => {
    const d = await nextjs.createDraft(C, P());
    expect(calls.map(c => [c.method, c.url])).toEqual([
      ['GET', R], ['GET', `${R}/git/ref/heads/main`],
      ['GET', `${R}/contents/content/blog/billing-tips.mdx?ref=main`], ['GET', `${R}/contents/content/blog/billing-tips.md?ref=main`],
      ['GET', `${R}/git/ref/heads/${BR}`], ['POST', `${R}/git/refs`],
      ['GET', `${R}/contents/content/blog/billing-tips.mdx?ref=${encodeURIComponent(BR)}`], ['PUT', `${R}/contents/content/blog/billing-tips.mdx`],
    ]);
    expect(json(calls[5])).toEqual({ ref: `refs/heads/${BR}`, sha: 'base-sha' });
    const put = calls[7];
    expect(json(put)).toMatchObject({ message: 'Add post: Billing tips', branch: BR });
    expect(json(put)).not.toHaveProperty('sha');
    expect(b64(put)).toBe(mdxFile(P()));
    expect(d).toEqual({ id: BR, extra: { base: 'main', path: 'content/blog/billing-tips.mdx', slug: 'billing-tips' } });

    calls = [];
    const r = await nextjs.publish(C, P(), d);
    expect(calls.map(c => [c.method, c.url])).toEqual([['POST', `${R}/pulls`]]);
    expect(json(calls[0])).toEqual({ title: 'Billing tips', head: BR, base: 'main', body: 'How to bill.\n\nScheduled for 2026-10-25. File: `content/blog/billing-tips.mdx`.\n\nOpened by Radar. Merge to publish.' });
    expect(r.url).toBe('https://github.com/fieldnote/site/pull/1');
  });
  it('a 401 on the contents lookup is rethrown, never read as "no file"', async () => {
    override = (m, u) => (u.includes('/contents/') ? reply(401, { message: 'Bad credentials' }) : null);
    const e = await err(nextjs.createDraft(C, P()));
    expect([e.http, e.kind]).toEqual([401, 'auth-expired']);
    expect(writes()).toHaveLength(0);
  });
  it('a 5xx on the contents lookup is rethrown (retried), never overwrites', async () => {
    override = (m, u) => (u.includes('/contents/') && m === 'GET' ? reply(503, 'Service Unavailable') : null);
    expect((await err(nextjs.createDraft(C, P()))).retryable).toBe(true);
    expect(writes()).toHaveLength(0);
  });
  it('a 422 from the PR that isn\'t "already exists" (e.g. no commits) is not retried', async () => {
    override = (m, u) => (u.endsWith('/pulls') && m === 'POST' ? reply(422, { message: 'Validation Failed', errors: [{ message: 'No commits between main and x' }] }) : null);
    const e = await err(nextjs.publish(C, P(), { id: BR, extra: { base: 'main', path: 'p' } }));
    expect([e.http, e.retryable]).toEqual([422, false]);
    expect(calls.map(c => c.method)).toEqual(['POST', 'GET']);
  });
});

describe('taken slug never overwrites another post', () => {
  it('a merged post at {slug}.mdx (or .md) on the default branch → the next free slug, in the filename and frontmatter', async () => {
    files.set('main:content/blog/billing-tips.mdx', 'theirs'); files.set('main:content/blog/billing-tips-2.md', 'theirs2');
    const d = await nextjs.createDraft(C, P());
    expect(d.extra).toEqual({ base: 'main', path: 'content/blog/billing-tips-3.mdx', slug: 'billing-tips-3', taken: true });
    const put = calls.find(c => c.method === 'PUT')!;
    expect(put.url).toBe(`${R}/contents/content/blog/billing-tips-3.mdx`);
    expect(b64(put)).toContain('slug: "billing-tips-3"');
    expect(files.get('main:content/blog/billing-tips.mdx')).toBe('theirs');
    await nextjs.publish(C, P(), d);
    expect(json(calls.at(-1)!).body).toContain('`billing-tips` is already used by another post, so this one is `billing-tips-3`.');
  });
  it('two articles with the same slug get separate branches and PRs', async () => {
    const a = await nextjs.createDraft(C, P()); const b = await nextjs.createDraft(C, P({ entryId: 'e_other123' }));
    expect(a.id).not.toBe(b.id);
    await nextjs.publish(C, P(), a); await nextjs.publish(C, P(), b);
    expect(prs.map(x => x.head)).toEqual([a.id, b.id]);
  });
  it('fails readably (not retried) when the slug and 19 variants are taken', async () => {
    for (let i = 0; i < 20; i++) files.set(`main:content/blog/${i ? `billing-tips-${i + 1}` : 'billing-tips'}.mdx`, 's');
    const e = await err(nextjs.createDraft(C, P()));
    expect([e.http, e.retryable]).toEqual([422, false]);
    expect(writes()).toHaveLength(0);
  });
});

describe('retry never makes a second branch or PR', () => {
  it('createDraft that failed after the branch was made reuses that branch and its commit on the retry', async () => {
    let failPut = true;
    override = (m, u) => (m === 'PUT' && failPut ? (failPut = false, reply(502, 'Bad Gateway')) : null);
    expect((await err(nextjs.createDraft(C, P()))).retryable).toBe(true);
    expect([...refs.keys()]).toEqual(['main', BR]);
    const d = await nextjs.createDraft(C, P());
    expect(d.id).toBe(BR);
    expect([...refs.keys()]).toEqual(['main', BR]);
    expect(calls.filter(c => c.method === 'POST' && c.url.endsWith('/git/refs'))).toHaveLength(1);
    // A third run (createDraft succeeded but the draft wasn't saved) updates the commit with its sha instead of failing.
    const before = files.get(`${BR}:content/blog/billing-tips.mdx`);
    const again = await nextjs.createDraft(C, P());
    expect(json(calls.at(-1)!)).toMatchObject({ message: 'Update post: Billing tips', sha: before });
    expect(again.id).toBe(BR);
    expect(prs).toHaveLength(0);
  });
  it('publish after a PR was already opened (a timeout) reuses the open PR via head=owner:branch', async () => {
    const d = await nextjs.createDraft(C, P());
    const first = await nextjs.publish(C, P(), d);
    calls = [];
    const second = await nextjs.publish(C, P(), d);
    expect(second.url).toBe(first.url);
    expect(prs).toHaveLength(1);
    expect(calls[1].url).toBe(`${R}/pulls?head=${encodeURIComponent('fieldnote:' + BR)}&state=open`);
  });
});

describe('refresh updates the existing file', () => {
  const RF = P({ mode: 'refresh', slug: 'billing-tips-2026', refreshUrl: 'https://fieldnote.app/blog/billing-tips/?utm=x', canonical: 'https://fieldnote.app/blog/billing-tips/' });
  it('finds {folder}/{refresh slug}.mdx and updates it with its sha, keeping the slug', async () => {
    files.set('main:content/blog/billing-tips.mdx', 'old-sha');
    const d = await nextjs.createDraft(C, RF);
    expect(calls[2].url).toBe(`${R}/contents/content/blog/billing-tips.mdx?ref=main`);
    const put = calls.find(c => c.method === 'PUT')!;
    expect(put.url).toBe(`${R}/contents/content/blog/billing-tips.mdx`);
    expect(json(put)).toMatchObject({ message: 'Update post: Billing tips', sha: 'old-sha', branch: 'radar/billing-tips-2026-Ab3-x_9Q' });
    expect(b64(put)).toContain('slug: "billing-tips"');
    expect(b64(put)).toContain('canonical: "https://fieldnote.app/blog/billing-tips/"');
    expect(d.extra).toEqual({ base: 'main', path: 'content/blog/billing-tips.mdx', slug: 'billing-tips' });
  });
  it('falls back to a .md file', async () => {
    files.set('main:content/blog/billing-tips.md', 'md-sha');
    const d = await nextjs.createDraft(C, RF);
    expect(d.extra.path).toBe('content/blog/billing-tips.md');
    expect(json(calls.find(c => c.method === 'PUT')!).sha).toBe('md-sha');
  });
  it('no file for that slug → a new post', async () => {
    expect((await nextjs.createDraft(C, RF)).extra.path).toBe('content/blog/billing-tips-2026.mdx');
  });
  it('a failed lookup is rethrown, never turned into a new file', async () => {
    override = (m, u) => (u.includes('/contents/') ? reply(500, 'oops') : null);
    expect((await err(nextjs.createDraft(C, RF))).retryable).toBe(true);
    expect(writes()).toHaveLength(0);
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
    expect(normFolder('tree/main')).toBe('content/posts');
    expect(normFolder('/')).toBe('content/posts');
    expect(normFolder('')).toBe('content/posts');
  });
  it('a stored folder pasted as "tree/main/…" is normalized before publishing writes to it', async () => {
    await nextjs.createDraft({ ...C, fields: { ...C.fields, path: 'tree/main/public/blog' } }, P());
    expect(calls.find(c => c.method === 'PUT')!.url).toBe(`${R}/contents/public/blog/billing-tips.mdx`);
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
  it('pages until a page has fewer than 100 repos, and stops after 5 pages', async () => {
    const page = (n: number, size: number) => Array.from({ length: size }, (_, i) => repoRow(`o/r${n}-${i}`));
    listed([page(1, 100), page(2, 30), page(3, 100)]);
    expect(await nextjs.targets!(C)).toHaveLength(130);
    expect(calls.map(c => new URL(c.url).searchParams.get('page'))).toEqual(['1', '2']);
    calls = [];
    listed(Array.from({ length: 7 }, (_, i) => page(i + 1, 100)));
    expect(await nextjs.targets!(C)).toHaveLength(500);
    expect(calls).toHaveLength(5);
  });
  it('moves repos named after the business domain to the front (preselected), keeping the order otherwise', async () => {
    listed([[repoRow('fieldnote/infra'), repoRow('someone/notes'), repoRow('kenny/fieldnote-website'), repoRow('fieldnote/api'), repoRow('kenny/fieldnote-blog')]]);
    expect((await nextjs.targets!({ ...C, domain: 'www.fieldnote.app' })).map(t => t.id)).toEqual(['kenny/fieldnote-website', 'kenny/fieldnote-blog', 'fieldnote/infra', 'someone/notes', 'fieldnote/api']);
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
    expect(failCopy('nextjs', e)).toBe('The thallylabs organization hasn’t approved Radar on GitHub. An organization owner can grant access under GitHub Settings → Applications → Radar, then test again.');
  });
  it('without a named org it still explains the restriction', async () => {
    override = () => reply(403, { message: 'This organization has enabled OAuth App access restrictions.' });
    expect(failCopy('nextjs', await err(nextjs.test(C)))).toBe('The repository’s organization hasn’t approved Radar on GitHub. An organization owner can grant access under GitHub Settings → Applications → Radar, then test again.');
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
