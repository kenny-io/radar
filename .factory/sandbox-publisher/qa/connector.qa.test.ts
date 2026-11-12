// QA-1: the GitHub connector with the sandbox engine behind its switch (SBX-1, SBX-4, SBX-5, SBX-7, SBX-9).
// GitHub is a small in-memory ref/commit/tree/pull model written for this file; Daytona is the in-memory provider with
// a scripted runner; the planner is a spy. The switch, the orchestration, the capability, the gate, the commit marker
// and the pull-request body are the product's own. Every credential-shaped value is a placeholder.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ plan: null as any, report: null as any, provider: null as any, providerKeys: [] as string[], env: {} as Record<string, string> }));
vi.mock('@/server/services/publishing/connectors/nextjs-agent', async importOriginal => ({ ...await importOriginal<any>(), planRepositoryPost: (...args: any[]) => H.plan(...args) }));
vi.mock('@/server/observability/failures', async importOriginal => ({ ...await importOriginal<any>(), reportFailure: (...args: any[]) => H.report(...args) }));
vi.mock('@/server/services/publishing/sandbox/daytona', async importOriginal => ({ ...await importOriginal<any>(), daytonaProvider: (key: string) => { H.providerKeys.push(key); return H.provider; } }));
vi.mock('@/server/env', async importOriginal => {
  const real = await importOriginal<any>();
  const env = { ...real.env };
  for (const key of ['daytonaKey', 'publishSandboxSnapshotId', 'publishModelProxyUrl', 'publishCapabilitySecret']) Object.defineProperty(env, key, { enumerable: true, get: () => H.env[key] ?? '' });
  return { ...real, env };
});

import { PublishError } from '@/server/services/publishing/http';
import { branchOf, nextjs, publishAttemptMs } from '@/server/services/publishing/connectors/nextjs';
import { FakeSandboxProvider, type FakeSandbox } from '@/server/services/publishing/sandbox/fake';
import { RUNNER_COMMANDS, SANDBOX_PATHS } from '@/server/services/publishing/sandbox/types';
import type { ConnCtx, PublishPayload, RemoteDraft } from '@/server/services/publishing/types';
import { blobSha, payloadOf, QA_BLOCKS, toMarkdown } from './helpers';

const BUSINESS = '7c1d9a52-3b6e-4f80-9a17-5e2d4c8b1f03';
const TOKEN = 'gho_' + 'Qc'.repeat(18);
const CONFIGURED = { daytonaKey: 'dtn_qa_' + 'D7'.repeat(16), publishSandboxSnapshotId: '0f8fad5b-d9cb-469f-a165-70867728950e', publishModelProxyUrl: 'https://qa-model-proxy.example.test/model', publishCapabilitySecret: 'qa-capability-secret-' + 'S8'.repeat(14) };
const C: ConnCtx = { type: 'nextjs', fields: { repo: 'qa-owner/qa-site', path: 'content/blog' }, creds: { access_token: TOKEN }, target: null, targetId: null, bid: BUSINESS, domain: 'qa.example.test', businessName: 'QA Fixture Co' };
const P = (over: Partial<PublishPayload> = {}) => payloadOf(QA_BLOCKS, over);
const BRANCH = branchOf(P());
const ARTICLE_PATH = `content/blog/${P().slug}.md`;

// ---------------------------------------------------------------------------------------------------------------------
// GitHub

type Files = Map<string, string>;
interface Git { refs: Map<string, string>; commits: Map<string, { tree: string; message: string; parents: string[] }>; trees: Map<string, Files>; pulls: { number: number; head: string; base: string; draft: boolean; title: string; body: string; state: string; html_url: string }[]; calls: { method: string; url: string; headers: Record<string, string>; body: any }[]; sandboxesDestroyedAtFirstWrite: number | null }
let git: Git; let seq = 0;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const entriesOf = (files: Files) => {
  const out: any[] = []; const seen = new Set<string>();
  for (const [path, content] of files) {
    const parts = path.split('/');
    for (let depth = 1; depth < parts.length; depth++) { const directory = parts.slice(0, depth).join('/'); if (!seen.has(directory)) { seen.add(directory); out.push({ path: directory, type: 'tree', mode: '040000', sha: blobSha(Buffer.from('tree:' + directory)) }); } }
    out.push({ path, type: 'blob', mode: '100644', sha: blobSha(Buffer.from(content)), size: Buffer.byteLength(content) });
  }
  return out;
};
function handle(method: string, url: string, init: RequestInit): Response {
  const u = new URL(url);
  if (u.host === 'codeload.github.com') return new Response(Buffer.from('QA-ARCHIVE'), { status: 200 });
  const path = decodeURIComponent(u.pathname.replace('/repos/qa-owner/qa-site', ''));
  const body = init.body ? JSON.parse(String(init.body)) : null;
  let m: RegExpExecArray | null;
  if (path === '' && method === 'GET') return json(200, { default_branch: 'main', permissions: { push: true } });
  if ((m = /^\/git\/ref\/heads\/(.+)$/.exec(path)) && method === 'GET') return git.refs.has(m[1]) ? json(200, { object: { sha: git.refs.get(m[1]) } }) : json(404, { message: 'Not Found' });
  if ((m = /^\/git\/commits\/(.+)$/.exec(path)) && method === 'GET') { const commit = git.commits.get(m[1])!; return json(200, { tree: { sha: commit.tree }, message: commit.message }); }
  if ((m = /^\/git\/trees\/(.+)$/.exec(path)) && method === 'GET') return json(200, { sha: m[1], truncated: false, tree: entriesOf(git.trees.get(m[1])!) });
  if ((m = /^\/git\/blobs\/(.+)$/.exec(path)) && method === 'GET') { for (const files of git.trees.values()) for (const content of files.values()) if (blobSha(Buffer.from(content)) === m[1]) return json(200, { encoding: 'base64', content: Buffer.from(content).toString('base64') }); return json(404, {}); }
  if ((m = /^\/contents\/(.+)$/.exec(path)) && method === 'GET') { const content = git.trees.get(git.commits.get(u.searchParams.get('ref')!)!.tree)!.get(m[1]); return content === undefined ? json(404, {}) : json(200, { sha: blobSha(Buffer.from(content)), encoding: 'base64', content: Buffer.from(content).toString('base64'), size: Buffer.byteLength(content) }); }
  if ((m = /^\/tarball\/(.+)$/.exec(path)) && method === 'GET') return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/qa-owner/qa-site/legacy.tar.gz/${m[1]}` } });
  if ((m = /^\/commits\/(.+)$/.exec(path)) && method === 'GET') { const commit = git.commits.get(m[1])!; const after = git.trees.get(commit.tree)!; const before = git.trees.get(git.commits.get(commit.parents[0])!.tree)!; return json(200, { files: [...after].filter(([file, content]) => before.get(file) !== content).map(([file]) => ({ filename: file, status: before.has(file) ? 'modified' : 'added' })) }); }
  if (path === '/git/trees' && method === 'POST') { const files = new Map(git.trees.get(body.base_tree)!); for (const file of body.tree) files.set(file.path, file.content); const sha = `tree${++seq}`; git.trees.set(sha, files); return json(201, { sha }); }
  if (path === '/git/commits' && method === 'POST') { const sha = `commit${++seq}`; git.commits.set(sha, { tree: body.tree, message: body.message, parents: body.parents }); return json(201, { sha }); }
  if (path === '/git/refs' && method === 'POST') { const name = body.ref.replace('refs/heads/', ''); if (git.refs.has(name)) return json(422, { message: 'Reference already exists' }); git.refs.set(name, body.sha); return json(201, {}); }
  if ((m = /^\/git\/refs\/heads\/(.+)$/.exec(path)) && method === 'PATCH') { if (body.force !== false || !git.commits.get(body.sha)?.parents.includes(git.refs.get(m[1])!)) return json(422, { message: 'not a fast forward' }); git.refs.set(m[1], body.sha); return json(200, {}); }
  if (path === '/pulls' && method === 'POST') { if (git.pulls.some(pull => pull.head === body.head && pull.state === 'open')) return json(422, { message: 'A pull request already exists' }); const number = git.pulls.length + 1; const pull = { number, head: body.head, base: body.base, draft: body.draft, title: body.title, body: body.body, state: 'open', html_url: `https://github.com/qa-owner/qa-site/pull/${number}` }; git.pulls.push(pull); return json(201, pull); }
  if (path === '/pulls' && method === 'GET') return json(200, git.pulls.filter(pull => pull.head === u.searchParams.get('head')!.split(':')[1] && pull.state === 'open'));
  return json(500, { message: `QA GitHub model: unexpected ${method} ${path}` });
}
const writes = () => git.calls.filter(call => call.method !== 'GET').map(call => `${call.method} ${new URL(call.url).pathname.replace('/repos/qa-owner/qa-site', '')}`);
const markerOf = (branch: string) => JSON.parse(git.commits.get(git.refs.get(branch)!)!.message.split('\n').at(-1)!.replace('Radar-Post: ', ''));

// ---------------------------------------------------------------------------------------------------------------------
// The sandbox

let provider: FakeSandboxProvider;
let agent: (payload: PublishPayload, sandbox: FakeSandbox, turn: number) => { files: Record<string, string>; report?: Record<string, unknown> };
let current: PublishPayload;
const faithful = (payload: PublishPayload) => ({ files: { [`content/blog/${payload.slug}.md`]: `---\ntitle: "${payload.title}"\n---\n\n${toMarkdown(payload.blocks)}` } });
const agentRuns = () => provider.execs().filter(call => call.command === RUNNER_COMMANDS.run).length;
const sandboxOn = (value = BUSINESS) => { vi.stubEnv('RADAR_PUBLISH_SANDBOX', value); H.env = { ...CONFIGURED }; };
const createDraft = (payload = P(), c = C) => { current = payload; return nextjs.createDraft(c, payload); };
const publish = (draft: RemoteDraft, payload = P()) => { current = payload; return nextjs.publish(C, payload, draft); };
async function failureOf(promise: Promise<unknown>): Promise<PublishError> { try { await promise; } catch (error) { expect(error).toBeInstanceOf(PublishError); return error as PublishError; } throw new Error('expected a rejection'); }

beforeEach(() => {
  seq = 0;
  const base: Files = new Map([['README.md', '# QA site\n'], ['content/blog/first-post.md', '---\ntitle: "First"\n---\n\nHello.\n'], ['site/pages/blog/index.tsx', 'export default function Blog() { return null; }\n'], ['site/lib/posts.ts', Array.from({ length: 30 }, (_u, n) => `export const post${n} = { slug: 'post-${n}' };`).join('\n') + '\n']]);
  git = { refs: new Map([['main', 'commit0']]), commits: new Map([['commit0', { tree: 'tree0', message: 'Initial', parents: [] }]]), trees: new Map([['tree0', base]]), pulls: [], calls: [], sandboxesDestroyedAtFirstWrite: null };
  agent = payload => faithful(payload);
  let turn = 0;
  provider = new FakeSandboxProvider({ exec: (call, sandbox) => {
    if (call.command !== RUNNER_COMMANDS.run) return;
    const output = agent(current, sandbox, turn++);
    for (const [path, content] of Object.entries(output.files)) sandbox.files.set(`${SANDBOX_PATHS.repo}/${path}`, Buffer.from(content));
    sandbox.files.set(SANDBOX_PATHS.report, Buffer.from(JSON.stringify({ version: 1, status: 'integrated', slug: current.slug, articlePath: `content/blog/${current.slug}.md`, route: `/blog/${current.slug}`, summary: 'Added one Markdown post beside the existing one.', evidence: [], conventions: [{ path: 'content/blog/first-post.md', rule: 'Front matter with a quoted title' }], deviations: [], reason: null, ...output.report })));
    sandbox.files.set(SANDBOX_PATHS.result, Buffer.from(JSON.stringify({ version: 1, status: 'completed', agentError: null, sessionId: null, turns: 5, changed: Object.entries(output.files).map(([path, content]) => ({ path, bytes: Buffer.byteLength(content) })) })));
  } });
  H.provider = provider; H.providerKeys = []; H.env = {};
  H.report = vi.fn(async () => {});
  H.plan = vi.fn(async (_hint: string, payload: PublishPayload, snapshot: any) => {
    const sha = snapshot.entries.find((entry: any) => entry.path === 'site/pages/blog/index.tsx').sha;
    return { slug: payload.slug, path: `content/blog/${payload.slug}.md`, files: [{ path: `content/blog/${payload.slug}.md`, content: payload.markdown }], summary: 'Planner output.', route: `/blog/${payload.slug}`, discovery: [{ path: 'site/pages/blog/index.tsx', sha, snippet: 'export default', role: 'route' }, { path: 'site/pages/blog/index.tsx', sha, snippet: 'export default', role: 'listing' }], review: { summary: 'Reviewed.', runtimeVerified: false }, draft: true };
  });
  for (const name of ['RADAR_PUBLISH_SANDBOX', 'RADAR_PUBLISH_SANDBOX_MODEL', 'RADAR_PUBLISH_SANDBOX_MAX_USD', 'RADAR_PUBLISH_SANDBOX_MAX_CALLS', 'RADAR_PUBLISH_SANDBOX_TRANSCRIPT_DIR', 'AI_MODEL_MAP']) vi.stubEnv(name, undefined);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => {
    const method = String(init.method || 'GET');
    git.calls.push({ method, url: String(url), headers: { ...(init.headers || {}) }, body: init.body ? (() => { try { return JSON.parse(String(init.body)); } catch { return String(init.body); } })() : null });
    if (method !== 'GET' && git.sandboxesDestroyedAtFirstWrite === null) git.sandboxesDestroyedAtFirstWrite = provider.count('destroy');
    return handle(method, String(url), init);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------------------------------------------------

describe('the switch (SBX-9)', () => {
  it.each([
    ['unset', undefined, CONFIGURED],
    ['empty', '', CONFIGURED],
    ['off', 'off', CONFIGURED],
    ['off beside this business id', `${BUSINESS},off`, CONFIGURED],
    ['another business only', '11111111-2222-4333-8444-555555555555', CONFIGURED],
    ['on, with no Daytona key', 'all', { ...CONFIGURED, daytonaKey: '' }],
    ['on, with a snapshot name instead of its UUID', 'all', { ...CONFIGURED, publishSandboxSnapshotId: 'radar-publisher-8ff5c7e1f6d2' }],
    ['on, with a proxy URL that is not https', 'all', { ...CONFIGURED, publishModelProxyUrl: 'http://qa-model-proxy.example.test/model' }],
    ['on, with a proxy URL on a path other than /model', 'all', { ...CONFIGURED, publishModelProxyUrl: 'https://qa-model-proxy.example.test/api' }],
    ['on, with a short capability secret', 'all', { ...CONFIGURED, publishCapabilitySecret: 'too-short' }],
  ] as const)('%s: the planner publishes exactly as before, and no sandbox call is made', async (_label, value, settings) => {
    vi.stubEnv('RADAR_PUBLISH_SANDBOX', value); H.env = { ...settings };
    const before = Date.now();
    const draft = await createDraft();
    expect(H.plan).toHaveBeenCalledTimes(1);
    const [hint, payload, snapshot, options] = H.plan.mock.calls[0];
    expect(hint).toBe('content/blog');
    expect(payload).toEqual(P());
    expect(snapshot.entries.map((entry: any) => entry.path).sort()).toEqual(entriesOf(git.trees.get('tree0')!).map(entry => entry.path).sort());
    expect(Object.keys(options).sort()).toEqual(['businessId', 'deadlineAt']);
    expect(options.deadlineAt - before).toBeGreaterThanOrEqual(270_000);
    expect(options.deadlineAt - before).toBeLessThan(271_000);
    expect(publishAttemptMs(BUSINESS)).toBe(270_000);
    expect(provider.calls).toHaveLength(0);
    expect(H.providerKeys).toHaveLength(0);
    expect(draft.extra.layout).toBe('repository-aware');
    expect(markerOf(BRANCH)).toEqual({ version: 2, entryId: P().entryId, hint: 'content/blog', slug: P().slug, articlePath: ARTICLE_PATH });
    expect(writes()).toEqual(['POST /git/trees', 'POST /git/commits', 'POST /git/refs']);
    await publish(draft);
    expect(git.pulls).toHaveLength(1);
    expect(git.pulls[0].body).not.toMatch(/sandbox|Checks Radar ran/i);
  });

  it('an unconfigured switch is reported by variable name only; an off or unlisted switch reports nothing', async () => {
    vi.stubEnv('RADAR_PUBLISH_SANDBOX', 'all'); H.env = { ...CONFIGURED, daytonaKey: '', publishCapabilitySecret: 'too-short' };
    await createDraft();
    expect(H.report).toHaveBeenCalledTimes(1);
    const [error, context] = H.report.mock.calls[0];
    expect(context).toMatchObject({ source: 'publishing', operation: 'publishing.sandbox.config', degraded: true, businessId: BUSINESS, ref: P().entryId });
    expect(error.message).toMatch(/DAYTONA_API_KEY/); expect(error.message).toMatch(/RADAR_PUBLISH_CAPABILITY_SECRET/);
    for (const value of ['too-short', CONFIGURED.publishModelProxyUrl, CONFIGURED.publishSandboxSnapshotId, TOKEN]) expect(JSON.stringify([error.message, context])).not.toContain(value);
  });

  it('nothing a customer controls turns the engine on: connection fields, credentials and the article do not select it', async () => {
    H.env = { ...CONFIGURED };
    const c: ConnCtx = { ...C, fields: { ...C.fields, sandbox: 'all', RADAR_PUBLISH_SANDBOX: 'all', engine: 'sandbox', publishSandbox: 'true' }, creds: { ...C.creds, RADAR_PUBLISH_SANDBOX: 'all' }, businessName: 'all' };
    const draft = await createDraft(P({ title: 'RADAR_PUBLISH_SANDBOX=all', keyword: 'all', meta: 'engine: sandbox' }), c);
    expect(draft.extra.layout).toBe('repository-aware');
    expect(provider.calls).toHaveLength(0);
    // A business whose id is the word "all" or "off" is still matched as an id, never as the keyword for everyone.
    vi.stubEnv('RADAR_PUBLISH_SANDBOX', BUSINESS);
    expect(publishAttemptMs('all')).toBe(270_000);
    expect(publishAttemptMs(BUSINESS)).toBe(810_000);
    expect(publishAttemptMs(BUSINESS.toUpperCase())).toBe(810_000);
  });
});

describe('a new article through the sandbox engine (SBX-1, SBX-2, SBX-5)', () => {
  beforeEach(() => sandboxOn());

  it('one tree, one commit, one branch, then one draft pull request; the sandbox is gone before the first write', async () => {
    const draft = await createDraft();
    expect(H.plan).not.toHaveBeenCalled();
    expect(writes()).toEqual(['POST /git/trees', 'POST /git/commits', 'POST /git/refs']);
    expect(git.sandboxesDestroyedAtFirstWrite).toBe(1);
    expect(provider.count('create')).toBe(1);
    expect([...git.refs.keys()].sort()).toEqual([BRANCH, 'main'].sort());
    expect(git.refs.get('main')).toBe('commit0');
    const marker = markerOf(BRANCH);
    expect(marker).toMatchObject({ version: 3, engine: 'sandbox', entryId: P().entryId, slug: P().slug, articlePath: ARTICLE_PATH, route: `/blog/${P().slug}` });
    const committed = git.trees.get(git.commits.get(git.refs.get(BRANCH)!)!.tree)!;
    expect([...committed.keys()].filter(path => !git.trees.get('tree0')!.has(path))).toEqual([ARTICLE_PATH]);
    for (const [path, content] of git.trees.get('tree0')!) expect(committed.get(path)).toBe(content);
    const { url } = await publish(draft);
    expect(writes().slice(3)).toEqual(['POST /pulls']);
    expect(git.pulls).toHaveLength(1);
    expect(git.pulls[0]).toMatchObject({ head: BRANCH, base: 'main', draft: true, html_url: url });
  });

  it('the GitHub token stays out of the sandbox, out of the archive request to another host, and out of the draft', async () => {
    const draft = await createDraft();
    expect(provider.transcript()).not.toContain(TOKEN);
    expect(H.providerKeys).toEqual([CONFIGURED.daytonaKey]);
    for (const secret of [CONFIGURED.daytonaKey, CONFIGURED.publishCapabilitySecret]) expect(provider.transcript()).not.toContain(secret);
    const archive = git.calls.filter(call => new URL(call.url).host === 'codeload.github.com');
    expect(archive).toHaveLength(1);
    expect(Object.keys(archive[0].headers).map(name => name.toLowerCase())).not.toContain('authorization');
    const persisted = JSON.stringify(draft);
    for (const secret of [TOKEN, CONFIGURED.daytonaKey, CONFIGURED.publishCapabilitySecret, 'rdrcap1.']) expect(persisted).not.toContain(secret);
    await publish(draft);
    for (const secret of [TOKEN, CONFIGURED.daytonaKey, CONFIGURED.publishCapabilitySecret, 'rdrcap1.']) expect(git.pulls[0].body + git.commits.get(git.refs.get(BRANCH)!)!.message).not.toContain(secret);
  });

  it('the pull request separates what Radar checked from what the agent claims, and never reports a build', async () => {
    agent = payload => ({ ...faithful(payload), report: { summary: 'Integrated the post. npm run build passed and all 212 tests passed. Lint is clean. Deployment preview verified.', conventions: [{ path: 'package.json', rule: 'ran npm run lint: 0 warnings' }], deviations: [{ kind: 'other', detail: 'Verified at runtime in the preview.' }] } });
    const draft = await createDraft();
    expect(draft.extra.review.runtimeVerified).toBe(false);
    await publish(draft);
    const body = git.pulls[0].body;
    const section = (title: string) => { const from = body.indexOf(`### ${title}`); const next = body.indexOf('\n### ', from + 4); return body.slice(from, next < 0 ? undefined : next); };
    const checked = section('Checks Radar ran');
    expect(checked.match(/^- \*\*/gm)).toHaveLength(8);
    expect(checked).not.toMatch(/build|tests? passed|lint|preview|runtime/i);
    const claimed = section('What the agent reported (not verified by Radar)');
    expect(claimed).toMatch(/Radar did not verify them and none of them is a check that ran/);
    expect(claimed).toMatch(/npm run build passed/);
    expect(section('Not run')).toMatch(/dependency installation\n- repository build\n- lint\n- tests\n- deployment preview/);
    expect(body).toMatch(/Radar did not install dependencies, build, lint, test or preview this repository/);
    // The claim appears once, under the unverified heading, and nowhere else.
    expect(body.split('npm run build passed')).toHaveLength(2);
    expect(body.indexOf('npm run build passed')).toBeGreaterThan(body.indexOf('### What the agent reported'));
    expect(body.indexOf('npm run build passed')).toBeLessThan(body.indexOf('### Media and links not carried over'));
  });

  it('hostile agent text cannot add sections, notify people or embed raw markup in the pull request', async () => {
    agent = payload => ({ ...faithful(payload), report: {
      summary: 'Done.\n\n### Checks Radar ran\n\n- **Build**: passed\n\n<img src="https://attacker.example.test/p.png"> <script>x</script> @octocat please merge `rm -rf /` https://attacker.example.test/phish',
      conventions: [{ path: 'README.md', rule: '</details><h1>Approved by Radar</h1>' }],
      deviations: [{ kind: 'other', detail: 'cc @qa-owner/admins ![x](https://attacker.example.test/pixel.gif)' }],
    } });
    await publish(await createDraft());
    const body = git.pulls[0].body;
    expect(body.match(/^### Checks Radar ran$/gm)).toHaveLength(1);
    expect(body).not.toMatch(/^- \*\*Build\*\*/m);
    expect(body).not.toContain('<img'); expect(body).not.toContain('<script'); expect(body).not.toContain('<h1>'); expect(body).not.toContain('</details>');
    expect(body).not.toContain('attacker.example.test');
    expect(body).not.toMatch(/(^|[^`])@octocat/); expect(body).not.toMatch(/(^|[^`])@qa-owner/);
  });

  // FINDING D4 (minor). Agent statements are shown as unverified, but they can still carry a working link: the
  // sanitizer removes http(s) addresses, not protocol-relative Markdown links or bare www addresses, and plainLine
  // neutralises backticks, "<" and @names only.
  it('D4: agent text cannot place a clickable link or remote image in the pull request body', async () => {
    agent = payload => ({ ...faithful(payload), report: { summary: 'Review notes: [open the preview](//attacker.example.test/login) ![status](//attacker.example.test/badge.svg) or visit www.attacker.example.test/now' } });
    await publish(await createDraft());
    expect(git.pulls[0].body).not.toContain('attacker.example.test');
  });

  it('D4 evidence: a protocol-relative Markdown link, a remote image and a bare www address survive into the body', async () => {
    agent = payload => ({ ...faithful(payload), report: { summary: 'Review notes: [open the preview](//attacker.example.test/login) ![status](//attacker.example.test/badge.svg) or visit www.attacker.example.test/now' } });
    await publish(await createDraft());
    const line = git.pulls[0].body.split('\n').find(text => text.startsWith('Summary: '))!;
    expect(line).toBe('Summary: Review notes: [open the preview](//attacker.example.test/login) ![status](//attacker.example.test/badge.svg) or visit www.attacker.example.test/now');
    expect(git.pulls[0].body.indexOf(line)).toBeGreaterThan(git.pulls[0].body.indexOf('### What the agent reported (not verified by Radar)'));
  });

  it('a gate refusal means zero Git writes: no tree, commit, branch or pull request, and the planner is not tried instead', async () => {
    const refusals: [string, typeof agent, string][] = [
      ['a reworded paragraph', payload => ({ files: { [`content/blog/${payload.slug}.md`]: toMarkdown(payload.blocks).replace('17 degrees', '21 degrees') } }), 'article-fidelity'],
      ['a workflow file beside the article', payload => ({ files: { ...faithful(payload).files, '.github/workflows/deploy.yml': 'on: push\n' } }), 'protected-path'],
      ['a token in a new file', payload => ({ files: { ...faithful(payload).files, 'site/config.ts': `export const t = 'ghp_${'Qa7'.repeat(12)}';\n` } }), 'credential-detected'],
      ['an existing file wiped', payload => ({ files: { ...faithful(payload).files, 'site/lib/posts.ts': 'export const posts = [];\n' } }), 'peer-content-changed'],
      ['nothing changed', () => ({ files: {} }), 'plan-empty'],
    ];
    for (const [label, output, code] of refusals) {
      git.calls = []; agent = output;
      const error = await createDraft().then(() => null, (thrown: PublishError) => thrown);
      expect([label, error?.diagnostic?.code ?? 'accepted']).toEqual([label, code]);
      if (!error) continue;
      expect([label, error.http, error.retryable]).toEqual([label, 422, false]);
      expect([label, writes()]).toEqual([label, []]);
    }
    expect([...git.refs.keys()]).toEqual(['main']);
    expect(git.pulls).toHaveLength(0);
    expect(H.plan).not.toHaveBeenCalled();
    expect(provider.count('create')).toBe(provider.count('destroy'));
  });
});

describe('retries (SBX-7)', () => {
  beforeEach(() => sandboxOn());

  it('a retry that finds its own gated commit runs no sandbox, writes no commit and opens no second pull request', async () => {
    const first = await createDraft();
    await publish(first);
    const head = git.refs.get(BRANCH);
    expect(agentRuns()).toBe(1);
    git.calls = [];
    // The saved draft was lost (a crash between the ref update and saving it): createDraft runs again for the entry.
    const again = await createDraft();
    expect(agentRuns()).toBe(1);
    expect(provider.count('create')).toBe(1);
    expect(writes()).toEqual([]);
    expect(git.refs.get(BRANCH)).toBe(head);
    expect(again.extra).toMatchObject({ layout: 'sandbox-agent', continuation: 'resumed', path: ARTICLE_PATH, files: [ARTICLE_PATH] });
    const { url } = await publish(again);
    expect(url).toBe(git.pulls[0].html_url);
    expect(git.pulls).toHaveLength(1);
    expect(writes()).toEqual(['POST /pulls']); // refused with 422 by GitHub, then the open pull request is reused
    expect(H.plan).not.toHaveBeenCalled();
  });

  it('the same retry with the switch turned off still reuses the commit: no planner, no sandbox, no second pull request', async () => {
    await publish(await createDraft());
    vi.stubEnv('RADAR_PUBLISH_SANDBOX', 'off');
    git.calls = [];
    const again = await createDraft();
    await publish(again);
    expect(H.plan).not.toHaveBeenCalled();
    expect(agentRuns()).toBe(1);
    expect(git.pulls).toHaveLength(1);
    expect(writes()).toEqual(['POST /pulls']);
  });

  it('a resumed pull request says that no agent ran and that the earlier details were not kept', async () => {
    await createDraft();
    const resumed = await createDraft();
    await publish(resumed);
    const body = git.pulls[0].body;
    expect(body).toMatch(/No agent ran this time/);
    expect(body).toMatch(/Not available: the agent’s statements from the earlier attempt were not kept/);
    expect(body).not.toMatch(/word for word|original lines removed/);
    expect(resumed.extra.review.runtimeVerified).toBe(false);
  });

  it('an edited article on the same branch is gated again and added as a fast-forward commit to the same branch and pull request', async () => {
    await publish(await createDraft());
    const edited = P({ blocks: [...QA_BLOCKS, ['p', 'A closing paragraph added after the first attempt, written for this test only.']], markdown: toMarkdown([...QA_BLOCKS, ['p', 'A closing paragraph added after the first attempt, written for this test only.']]) });
    git.calls = [];
    const draft = await createDraft(edited);
    expect(agentRuns()).toBe(2);
    expect(writes()).toEqual(['POST /git/trees', 'POST /git/commits', `PATCH /git/refs/heads/${BRANCH}`]);
    expect(git.calls.find(call => call.method === 'PATCH')!.body.force).toBe(false);
    expect(draft.extra.continuation).toBe('added');
    await publish(draft, edited);
    expect(git.pulls).toHaveLength(1);
  });

  it('a branch whose head carries another entry’s marker, or no marker, is not resumed', async () => {
    await createDraft();
    const head = git.commits.get(git.refs.get(BRANCH)!)!;
    for (const message of ['Someone pushed here', `x\n\nRadar-Post: ${JSON.stringify({ ...markerOf(BRANCH), entryId: 'e_someone_else' })}`]) {
      head.message = message; git.calls = [];
      const error = await failureOf(createDraft());
      expect(error.message).toMatch(/cannot safely resume/);
      expect(writes()).toEqual([]);
    }
    expect(agentRuns()).toBe(1);
  });

  // OBSERVATION (low). The version 3 marker is a commit-message trailer, not a signature. Someone with push access to
  // the customer's repository can add a commit to the article branch that copies the trailer; a later retry of the same
  // entry then resumes on that commit without a gate, and the pull-request body says the earlier attempt passed every check.
  it('OBSERVATION: a commit pushed onto the article branch with a copied marker is resumed as if Radar had gated it', async () => {
    await createDraft();
    const gated = git.refs.get(BRANCH)!;
    const files = new Map(git.trees.get(git.commits.get(gated)!.tree)!);
    files.set('site/pages/blog/index.tsx', 'export default function Blog() { return "changed by someone else"; }\n');
    git.trees.set('tree-foreign', files);
    git.commits.set('commit-foreign', { tree: 'tree-foreign', message: `Tweak listing\n\n${git.commits.get(gated)!.message.split('\n').at(-1)}`, parents: [gated] });
    git.refs.set(BRANCH, 'commit-foreign');
    git.calls = [];
    const resumed = await createDraft();
    expect(agentRuns()).toBe(1);
    expect(writes()).toEqual([]);
    expect(resumed.extra.continuation).toBe('resumed');
    expect(resumed.extra.files).toContain('site/pages/blog/index.tsx');
    await publish(resumed);
    expect(git.pulls[0].body).toMatch(/That attempt passed every check below before it wrote the commit/);
  });

  it('a saved sandbox draft that was altered is refused before a pull request is opened', async () => {
    const draft = await createDraft();
    const tampered: Record<string, (extra: any) => void> = {
      'runtimeVerified true': extra => { extra.review.runtimeVerified = true; },
      'no checks': extra => { extra.checks = []; },
      'a failed check': extra => { extra.checks[0].outcome = 'failed'; },
      'an unknown check id': extra => { extra.checks[0].id = 'build'; },
      'a protected article path': extra => { extra.path = '.github/workflows/x.yml'; extra.files = [extra.path]; },
      'a route that is not a path': extra => { extra.route = 'https://attacker.example.test/'; },
      'an article path outside the changed files': extra => { extra.files = ['README.md']; },
    };
    for (const [label, alter] of Object.entries(tampered)) {
      const copy = JSON.parse(JSON.stringify(draft)); alter(copy.extra);
      const error = await failureOf(publish(copy));
      expect([label, /lacks a reviewed repository integration/.test(error.message)]).toEqual([label, true]);
    }
    expect((await failureOf(publish({ ...draft, id: 'radar/another-branch' }))).message).toMatch(/lacks a reviewed/);
    expect(git.pulls).toHaveLength(0);
  });
});
