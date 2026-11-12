// QA-1: the GitHub connector with the sandbox engine behind its switch (SBX-1, SBX-4, SBX-5, SBX-7, SBX-9).
// GitHub is a small in-memory ref/commit/tree/pull model written for this file; Daytona is the in-memory provider with
// a scripted runner; the planner is a spy. The switch, the orchestration, the capability, the gate, the commit marker
// and the pull-request body are the product's own. Every credential-shaped value is a placeholder.
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ plan: null as any, report: null as any, provider: null as any, providerKeys: [] as string[], env: {} as Record<string, string>, over: {} as Record<string, unknown> }));
vi.mock('@/server/services/publishing/connectors/nextjs-agent', async importOriginal => ({ ...await importOriginal<any>(), planRepositoryPost: (...args: any[]) => H.plan(...args) }));
vi.mock('@/server/observability/failures', async importOriginal => ({ ...await importOriginal<any>(), reportFailure: (...args: any[]) => H.report(...args) }));
vi.mock('@/server/services/publishing/sandbox/daytona', async importOriginal => ({ ...await importOriginal<any>(), daytonaProvider: (key: string) => { H.providerKeys.push(key); return H.provider; } }));
vi.mock('@/server/env', async importOriginal => {
  const real = await importOriginal<any>();
  const env = { ...real.env };
  for (const key of ['daytonaKey', 'publishSandboxSnapshotId', 'publishModelProxyUrl', 'publishCapabilitySecret']) Object.defineProperty(env, key, { enumerable: true, get: () => H.env[key] ?? '' });
  // QA-2: single settings a test may override (the application secret and the production flag, for the commit marker).
  for (const key of ['secretKey', 'isProd', 'allowPrivateHosts']) Object.defineProperty(env, key, { enumerable: true, get: () => (key in H.over ? H.over[key] : real.env[key]) });
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
interface Git { truncated?: Set<string>; compare?: (base: string, head: string) => Response | null; refs: Map<string, string>; commits: Map<string, { tree: string; message: string; parents: string[] }>; trees: Map<string, Files>; pulls: { number: number; head: string; base: string; draft: boolean; title: string; body: string; state: string; html_url: string }[]; calls: { method: string; url: string; headers: Record<string, string>; body: any }[]; sandboxesDestroyedAtFirstWrite: number | null }
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
  if ((m = /^\/git\/trees\/(.+)$/.exec(path)) && method === 'GET') return json(200, { sha: m[1], truncated: !!git.truncated?.has(m[1]), tree: entriesOf(git.trees.get(m[1])!) });
  if ((m = /^\/git\/blobs\/(.+)$/.exec(path)) && method === 'GET') { for (const files of git.trees.values()) for (const content of files.values()) if (blobSha(Buffer.from(content)) === m[1]) return json(200, { encoding: 'base64', content: Buffer.from(content).toString('base64') }); return json(404, {}); }
  if ((m = /^\/contents\/(.+)$/.exec(path)) && method === 'GET') { const content = git.trees.get(git.commits.get(u.searchParams.get('ref')!)!.tree)!.get(m[1]); return content === undefined ? json(404, {}) : json(200, { sha: blobSha(Buffer.from(content)), encoding: 'base64', content: Buffer.from(content).toString('base64'), size: Buffer.byteLength(content) }); }
  if ((m = /^\/tarball\/(.+)$/.exec(path)) && method === 'GET') return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/qa-owner/qa-site/legacy.tar.gz/${m[1]}` } });
  if ((m = /^\/commits\/(.+)$/.exec(path)) && method === 'GET') { const commit = git.commits.get(m[1])!; const after = git.trees.get(commit.tree)!; const before = git.trees.get(git.commits.get(commit.parents[0])!.tree)!; return json(200, { files: [...after].filter(([file, content]) => before.get(file) !== content).map(([file]) => ({ filename: file, status: before.has(file) ? 'modified' : 'added' })) }); }
  // QA-3: where the article branch left the default branch. The nearest commit that both histories contain; 404 when none.
  if ((m = /^\/compare\/([^.]+)\.\.\.(.+)$/.exec(path)) && method === 'GET') {
    const overridden = git.compare?.(m[1], m[2]); if (overridden) return overridden;
    const ancestors = (sha: string) => { const seen: string[] = []; for (let queue = [sha]; queue.length;) { const at = queue.shift()!; if (seen.includes(at) || !git.commits.has(at)) continue; seen.push(at); queue.push(...git.commits.get(at)!.parents); } return seen; };
    const ofBase = ancestors(m[1]); const base = ancestors(m[2]).find(sha => ofBase.includes(sha));
    return base ? json(200, { merge_base_commit: { sha: base, commit: { tree: { sha: git.commits.get(base)!.tree } } }, commits: [] }) : json(404, { message: 'No common ancestor' });
  }
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
  H.provider = provider; H.providerKeys = []; H.env = {}; H.over = {};
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
// The sandbox engine's pull request body (QA-4, 12 Nov 2026: the short body of 0f89aa2a, architecture section 15)

const AGENT_LABEL = '- Reported by the agent that made the change (not verified by Radar):';
const CLOSING = 'Radar did not build or run the site. Check the article on the deployment preview before merging.';
const NOTICE = `**Draft for review.** The article is not live. Scheduled for ${P().date}.`;
const ARTICLE_LINE = `- Article: \`${ARTICLE_PATH}\`, expected at \`/blog/${P().slug}\``;
const CHECKED_CLEAN = '- Checked by Radar: no existing line was removed or changed; the article text is carried over word for word.';
/** The one sentence each kind of retry adds under the draft notice. */
const CONTINUATION = {
  added: 'This attempt added a commit to an existing article branch. Radar’s checks cover that commit and the article file, not the earlier commits on the branch.',
  unchanged: 'The article was already complete on its branch, so this attempt added no commit. Radar’s check covers the article file only.',
  resumed: 'This continues an earlier attempt whose commit had passed Radar’s checks. Its notes were not kept, so compare the article’s images and links with the diff.',
};
/** The whole body for the QA article when the agent reported nothing and nothing was left out. */
const PLAIN_BODY = [P().meta, '', NOTICE, '', ARTICLE_LINE, CHECKED_CLEAN, '', CLOSING, '', 'Opened by Radar.'].join('\n');
/** The lines that carry agent-written text, and the agent's own text on one of them (what follows Radar's label). */
const agentLines = (body: string) => body.split('\n').filter(line => /^ {2}- Deviation \d+: /.test(line));
const agentText = (line: string) => line.replace(/^ {2}- Deviation \d+: /, '');
/** Every other line: what Radar says in its own voice. */
const radarLines = (body: string) => body.split('\n').filter(line => !/^ {2}- Deviation \d+: /.test(line));
/** The separation the body is built on. Every line is either one that Radar wrote whole (a fixed sentence, or a fixed
 *  frame around a path, a reference or a count), or one statement of the agent's: a single line behind Radar's
 *  "Deviation n:", in one unbroken run directly under the one label that says Radar did not verify it. Radar's closing
 *  statement that nothing was built or run comes after everything the agent wrote, exactly once. */
function expectBodyShape(body: string, meta = P().meta) {
  const lines = body.split('\n');
  const fixed = new Set([meta, AGENT_LABEL, CLOSING, 'Opened by Radar.', ...Object.values(CONTINUATION)]);
  const framed = [/^$/, /^\*\*Draft for review\.\*\* The article is not live\. Scheduled for \d{4}-\d{2}-\d{2}\.$/, /^The proposed slug `[^`]+` was unavailable; this change uses `[^`]+`\.$/, /^- Article: `[^`]+`, expected at `[^`]+`$/, /^- Checked by Radar: [^`[\]<>#@]+\.$/,
    /^- Not carried over: \d+ (?:image, video or link|images, videos or links) from the article, because Radar did not find (?:it|them) in the change:$/, /^ {2}- `[^`]+`$/, /^ {2}- and \d+ more$/];
  lines.forEach((line, index) => {
    if (fixed.has(line) || framed.some(shape => shape.test(line))) return;
    expect([index, line]).toEqual([index, expect.stringMatching(/^ {2}- Deviation \d+: \S/)]);
    expect([index, /[\x00-\x1f\x7f\u2028\u2029]/.test(line)]).toEqual([index, false]);
  });
  const agent = lines.flatMap((line, index) => (/^ {2}- Deviation \d+: /.test(line) ? [index] : []));
  expect(lines.filter(line => line === AGENT_LABEL)).toHaveLength(agent.length ? 1 : 0);
  if (agent.length) {
    expect(agent).toEqual(agent.map((_unused, n) => lines.indexOf(AGENT_LABEL) + 1 + n));
    expect(agent.map(index => Number(/^ {2}- Deviation (\d+): /.exec(lines[index])![1]))).toEqual(agent.map((_unused, n) => n + 1));
    expect(agent.length).toBeLessThanOrEqual(8);
  }
  expect(lines.slice(-4)).toEqual(['', CLOSING, '', 'Opened by Radar.']);
  expect(lines.filter(line => line === CLOSING || line === 'Opened by Radar.')).toHaveLength(2);
  expect(lines.filter(line => line.startsWith('- Checked by Radar: ')).length).toBeLessThanOrEqual(1);
  expect(lines.filter(line => /^ {0,3}#/.test(line))).toEqual([]);
}

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
    // The planner's own body, not the sandbox engine's (whose marks are its draft notice, its checked line and its agent label).
    expect(git.pulls[0].body).toContain('**Draft for build and deployment-preview review.**');
    expect(git.pulls[0].body).not.toMatch(/sandbox|\*\*Draft for review\.\*\*|Checked by Radar|not verified by Radar/i);
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

  // QA-4 (12 Nov 2026): rewritten for the short body of 0f89aa2a (architecture section 15, "PR body shortened").
  // The body has no headings and no sections. Radar's statements are whole lines Radar wrote. Of the agent's report
  // only its deviations are printed, each behind Radar's "Deviation n:" under one label that says they are not
  // verified. The agent's summary and the rules it says it followed are no longer printed anywhere, so the probes that
  // used to check how those were neutralised now send the same hostile text three ways (summary, rule, deviation) and
  // check that the first two are absent and the third is neutralised.
  it('the pull request separates what Radar checked from what the agent claims, and never reports a build', async () => {
    agent = payload => ({ ...faithful(payload), report: { summary: 'Integrated the post. npm run build passed and all 212 tests passed. Lint is clean. Deployment preview verified.', conventions: [{ path: 'package.json', rule: 'ran npm run lint: 0 warnings' }], deviations: [{ kind: 'other', detail: 'Verified at runtime in the preview.' }, { kind: 'other', detail: 'npm run build passed and all 212 tests passed.' }] } });
    const draft = await createDraft();
    expect(draft.extra.review.runtimeVerified).toBe(false);
    await publish(draft);
    const body = git.pulls[0].body; const lines = body.split('\n');
    expectBodyShape(body);
    // What Radar checked: one line, written from the gate's counts. It names no build, test, lint, preview or runtime.
    expect(lines.filter(line => line.startsWith('- Checked by Radar: '))).toEqual([CHECKED_CLEAN]);
    // What the agent says: its deviations only, directly under the label that says Radar did not verify them.
    expect(agentLines(body)).toEqual(['  - Deviation 1: other: Verified at runtime in the preview.', '  - Deviation 2: other: npm run build passed and all 212 tests passed.']);
    expect(lines[lines.indexOf(agentLines(body)[0]) - 1]).toBe(AGENT_LABEL);
    expect(lines.indexOf(AGENT_LABEL)).toBeGreaterThan(lines.indexOf(CHECKED_CLEAN));
    // Each claim appears once, on an agent line, and nowhere else.
    for (const claim of ['npm run build passed', 'Verified at runtime']) { expect(body.split(claim)).toHaveLength(2); expect(agentLines(body).join('\n')).toContain(claim); }
    // Nothing Radar says in its own voice reports a result of something it did not run. Its only words about building
    // are the closing sentence, which says that it did not. (The first line is the article's description, not a statement.)
    const radar = radarLines(body).filter(line => ![P().meta, AGENT_LABEL, CLOSING].includes(line)).join('\n');
    expect(radar).not.toMatch(/build|tests?\b|lint|preview|runtime|deploy|install|verified|passed|succe/i);
    expect(lines.filter(line => line === CLOSING)).toHaveLength(1);
    expect(lines.indexOf(CLOSING)).toBeGreaterThan(lines.indexOf(agentLines(body).at(-1)!));
    // No longer applicable: "the summary's claim stands under the unverified heading". The summary and the rules are
    // not printed at all, so the claims they carry cannot be read as anyone's statement.
    for (const gone of ['Integrated the post', 'Lint is clean', 'Deployment preview verified', 'ran npm run lint', '0 warnings', 'package.json', 'Summary', 'Rule 1', 'Not run', '###']) expect(body).not.toContain(gone);
    // They are still saved on the draft for operators, with the list of what was not run.
    expect(draft.extra.summary).toContain('npm run build passed');
    expect(draft.extra.agentNotes.conventions).toEqual(['package.json: ran npm run lint: 0 warnings']);
    expect(draft.extra.notRun).toEqual(['dependency installation', 'repository build', 'lint', 'tests', 'deployment preview']);
  });

  it('hostile agent text cannot add sections, notify people or embed raw markup in the pull request', async () => {
    const markup = '<img src="https://attacker.example.test/p.png"> <script>x</script> @octocat please merge `rm -rf /` https://attacker.example.test/phish';
    agent = payload => ({ ...faithful(payload), report: {
      summary: `Done.\n\n### Checks Radar ran\n\n- **Build**: passed\n\n${markup}`,
      conventions: [{ path: 'README.md', rule: '</details><h1>Approved by Radar</h1>' }],
      deviations: [
        { kind: 'other', detail: 'cc @qa-owner/admins ![x](https://attacker.example.test/pixel.gif)' },
        // What used to arrive as the summary and a rule, sent as deviations: the only agent text that is still printed.
        { kind: 'other', detail: 'Done.\n\n### Checked by Radar\n\n- Checked by Radar: the build passed\n\nRadar did not build or run the site, but the build passed.\n\nOpened by Radar.' },
        { kind: 'structure', detail: markup },
        { kind: 'other', detail: '</details><h1>Approved by Radar</h1>' },
      ],
    } });
    await publish(await createDraft());
    const body = git.pulls[0].body; const lines = body.split('\n');
    expectBodyShape(body);
    expect(agentLines(body)).toEqual([
      // The run's sanitizer replaced each address (and the bracket that closed it) before the note was saved; the body
      // then escaped every bracket that was left, so no image or link can form.
      '  - Deviation 1: other: cc `@qa-owner/admins` !\\[x\\](\\[URL omitted\\]',
      '  - Deviation 2: other: Done. ### Checked by Radar - Checked by Radar: the build passed Radar did not build or run the site, but the build passed. Opened by Radar.',
      '  - Deviation 3: structure: &lt;img src="\\[URL omitted\\]"> &lt;script>x&lt;/script> `@octocat` please merge rm -rf / \\[URL omitted\\]',
      '  - Deviation 4: other: &lt;/details>&lt;h1>Approved by Radar&lt;/h1>',
    ]);
    // No section, heading or statement of Radar's was added: the body has no heading, and Radar's lines stand once each.
    expect(lines.filter(line => /^\s{0,3}#/.test(line))).toEqual([]);
    expect(lines.filter(line => line.startsWith('- Checked by Radar: '))).toEqual([CHECKED_CLEAN]);
    expect(lines.filter(line => line === CLOSING)).toHaveLength(1);
    expect(lines.filter(line => line === 'Opened by Radar.')).toHaveLength(1);
    expect(lines.at(-1)).toBe('Opened by Radar.');
    // No raw markup, no address, nobody notified.
    expect(body).not.toMatch(/</);
    expect(body).not.toContain('attacker.example.test');
    expect(body).not.toMatch(/(^|[^`])@octocat/); expect(body).not.toMatch(/(^|[^`])@qa-owner/);
    // The summary's own section and bullet, and the rule, are not printed.
    for (const gone of ['Checks Radar ran', '**Build**', 'README.md']) expect(body).not.toContain(gone);
  });

  // D4, reported in QA-1 and fixed in 3d3dd9c7: links, images, addresses, mentions and references in agent text are
  // neutralised. What GitHub actually renders from this text is checked in live-markdown.qa.test.ts.
  it('D4: agent text cannot place a clickable link or remote image in the pull request body', async () => {
    const text = 'Review notes: [open the preview](//attacker.example.test/login) ![status](//attacker.example.test/badge.svg) or visit www.attacker.example.test/now';
    agent = payload => ({ ...faithful(payload), report: { summary: text, conventions: [{ path: 'README.md', rule: text }], deviations: [{ kind: 'other', detail: text }] } });
    await publish(await createDraft());
    const body = git.pulls[0].body;
    expectBodyShape(body);
    expect(body).not.toContain('attacker.example.test');
    expect(agentLines(body)).toEqual(['  - Deviation 1: other: Review notes: open the preview (link removed) status (image removed) or visit (address removed)']);
    // The copies sent as the summary and as a rule are not printed: the text is in the body once.
    expect(body.split('open the preview')).toHaveLength(2);
  });
  it('D4: other spellings of a link, an image, a mention and a reference are neutralised too', async () => {
    const hostile = [
      '[a](<//attacker.example.test/a b>)', '[a](//attacker.example.test/x "title")', '[a [b] c](//attacker.example.test/n)', '[![img](//attacker.example.test/i.png)](//attacker.example.test/l)',
      '[ref][1] [1]: //attacker.example.test/r', '<//attacker.example.test/angle>', '<a href="//attacker.example.test/h">x</a>', '&#60;a href=//attacker.example.test&#62;',
      'ftp://attacker.example.test/f', 'WWW.attacker.example.test', '(www.attacker.example.test)', '_www.attacker.example.test_', 'mailto:admin@attacker.example.test', 'admin@attacker.example.test',
      '@octocat', '@qa-owner/admins', '#9', 'qa-owner/qa-site#9', 'GH-9', '15045b102ad681c946eb1ca117166a174aa27ab9', '\\[x\\](//attacker.example.test/e)', '$\\href{//attacker.example.test}{x}$', '- [ ] task',
    ];
    // The body shows eight deviations, so the vectors go three to a note; every note fits its limit, so none is cut.
    const notes = Array.from({ length: 8 }, (_unused, index) => hostile.slice(index * 3, index * 3 + 3).join(' | '));
    expect(notes.join(' | ')).toBe(hostile.join(' | '));
    agent = payload => ({ ...faithful(payload), report: { summary: hostile.join(' | '), conventions: hostile.slice(0, 20).map(rule => ({ path: 'README.md', rule })), deviations: notes.map(detail => ({ kind: 'other', detail })) } });
    await publish(await createDraft());
    const body = git.pulls[0].body;
    expectBodyShape(body);
    expect(agentLines(body)).toHaveLength(8);
    expect(body).not.toContain('truncated by Radar');
    const section = agentLines(body).map(agentText).join('\n');
    expect(section).not.toMatch(/(?<!\\)\]\(/);        // no "](": every bracket is escaped
    expect(section).not.toMatch(/(?<!\\)[\[\]]/);       // no unescaped square bracket at all
    expect(section).not.toMatch(/</);                       // no tag or angle autolink
    expect(section).not.toMatch(/:\/\//);                 // no scheme address
    expect(section).not.toMatch(/(^|[\s(*_~])www\./im);   // no bare www address where GitHub would link it
    expect(section).not.toMatch(/&#/);                      // character references were written out as text
    for (const reference of ['@octocat', '@qa-owner/admins', '#9', 'qa-owner/qa-site#9', 'GH-9', '15045b102ad681c946eb1ca117166a174aa27ab9', '@attacker']) expect(section).toContain('`' + reference + '`');
    expect(section).not.toMatch(/(^|[^`\w/])@[A-Za-z0-9]/m); // no mention outside a code span
    // Outside the agent's lines the body is exactly what it is for an agent that reported nothing.
    expect(radarLines(body).filter(line => line !== AGENT_LABEL).join('\n')).toBe(PLAIN_BODY);
    expect(body).not.toContain('attacker.example.test');
  });
  it('D4: a repository path with brackets still reads as written, and a long neutralised note is cut with the marker', async () => {
    const long = 'Edited app/[slug]/page.tsx and src/lib/blog.ts. ' + Array.from({ length: 520 }, (_u, n) => `[n${n}]`).join(' ');
    agent = payload => ({ ...faithful(payload), report: { summary: long, deviations: [{ kind: 'structure', detail: long }] } });
    await publish(await createDraft());
    const body = git.pulls[0].body;
    expectBodyShape(body);
    expect(agentLines(body)).toHaveLength(1);
    const text = agentText(agentLines(body)[0]);
    expect(text.startsWith('structure: Edited app/\\[slug\\]/page.tsx and src/lib/blog.ts. \\[n0\\] \\[n1\\] ')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(400);
    expect(text.endsWith(' … (truncated by Radar)')).toBe(true);
    // The cut never leaves half of an escape: every token before the marker is a whole escaped "[nN]".
    expect(text.slice(text.indexOf('\\[n0\\]'), -' … (truncated by Radar)'.length).split(' ').every(token => /^\\\[n\d+\\\]$/.test(token))).toBe(true);
    // No longer applicable: "a long summary is cut at 4,000 characters". The summary (over 3,000 characters here) is not
    // printed, so the whole body stays short.
    expect(body.length).toBeLessThan(PLAIN_BODY.length + AGENT_LABEL.length + 440);
  });
  // B1, found in QA-4 on fe167d86 and OPEN: this probe fails until the cut is fixed. The body shows a reference as
  // code by putting a backtick on each side of it, and then bounds the note at 400 characters. When the note has no
  // space in the 80 characters before the bound, the cut falls inside a word, and it can fall between a reference and
  // its closing backtick. The reference is then outside any code span. GitHub's renderer links "#9", "owner/repo#9"
  // and "GH-9" in that position (seen through its Markdown API on 12 Nov 2026; live-markdown.qa.test.ts repeats it).
  // A mention or a commit hash left there was not linked, but stands outside a code span all the same. The note is
  // 400 characters as the agent writes it, so the run saves it whole; the two backticks carry it over the bound.
  it('B1: a reference at the point where a long note is cut stays inside its code span', async () => {
    const MARKER = ' … (truncated by Radar)'; const room = 400 - MARKER.length;
    const found: [string, string][] = [];
    for (const reference of ['#9', 'qa-owner/qa-site#9', 'GH-9', '@octocat', '15045b102ad681c946eb1ca117166a174aa27ab9']) {
      // "other: " + filler + "`" + reference ends exactly where the cut falls; the closing backtick is the next character.
      const detail = '='.repeat(room - 'other: '.length - 1 - reference.length) + reference + ' is not in the new post.';
      expect(`other: ${detail}`.length).toBe(400);
      git.refs.delete(BRANCH); git.pulls.length = 0;
      agent = payload => ({ ...faithful(payload), report: { deviations: [{ kind: 'other', detail }] } });
      const draft = await createDraft();
      expect(draft.extra.agentNotes.deviations).toEqual([`other: ${detail}`]); // saved whole: the run did not cut it
      await publish(draft);
      expectBodyShape(git.pulls[0].body);
      const text = agentText(agentLines(git.pulls[0].body)[0]);
      // What GitHub still reads as Markdown: the line with its closed code spans taken out.
      const live = text.replace(/`[^`]*`/g, '');
      if (/`|#\d|GH-\d|@[A-Za-z0-9]|[0-9a-f]{40}/.test(live)) found.push([reference, text.slice(-60)]);
    }
    expect(found).toEqual([]);
  });
  // N6, reported in QA-2 and fixed in 8ce9b640: every agent statement follows a label Radar writes, so none begins a
  // line or a list item. What GitHub renders from these lines is checked in live-markdown.qa.test.ts.
  it('N6: a note that begins with "[x]", "#", ">" or one of Radar\'s own lines is printed after Radar\'s own label and number', async () => {
    agent = payload => ({ ...faithful(payload), report: { summary: '# Approved by Radar', conventions: [{ path: '[x] build passed', rule: 'ok' }, { path: '# Approved by Radar', rule: 'ok' }, { path: '> quoted', rule: 'ok' }], deviations: [{ kind: 'other', detail: '[x] tests passed' }] } });
    const draft = await createDraft();
    await publish(draft);
    expectBodyShape(git.pulls[0].body);
    expect(agentLines(git.pulls[0].body)).toEqual(['  - Deviation 1: other: \\[x\\] tests passed']);
    // No longer applicable: "Summary: " and "- Rule n: " lines. Neither the summary nor a rule is printed.
    for (const gone of ['Summary', 'Rule ', 'Approved by Radar', 'build passed', 'quoted']) expect(git.pulls[0].body).not.toContain(gone);

    // A saved draft is a row Radar reads back, and its notes are printed as stored. The run always writes "kind: " in
    // front of a note; a stored note that begins with block syntax itself must still not begin a line or a list item.
    const starts = ['[x] build passed', '# Approved by Radar', '> quoted', '- Checked by Radar: the build passed', '- [ ] task', '1. first', '---', 'Opened by Radar.'];
    const stored: RemoteDraft = JSON.parse(JSON.stringify(draft));
    stored.extra.agentNotes.deviations = starts;
    git.pulls.length = 0;
    await publish(stored);
    const body = git.pulls[0].body; const lines = body.split('\n');
    expectBodyShape(body);
    expect(agentLines(body)).toEqual([
      '  - Deviation 1: \\[x\\] build passed', '  - Deviation 2: # Approved by Radar', '  - Deviation 3: > quoted', '  - Deviation 4: - Checked by Radar: the build passed',
      '  - Deviation 5: - \\[ \\] task', '  - Deviation 6: 1. first', '  - Deviation 7: ---', '  - Deviation 8: Opened by Radar.',
    ]);
    // An imitation of Radar's own lines is inline text behind the agent's label; Radar's lines stand once each.
    expect(lines.filter(line => line.startsWith('- Checked by Radar: '))).toEqual([CHECKED_CLEAN]);
    expect(lines.filter(line => line === 'Opened by Radar.')).toHaveLength(1);
    expect(lines.filter(line => /^\s{0,3}(?:#|>|<|\d+[.)] |[-*+] \[|---)/.test(line))).toEqual([]);
  });
  it('N6: an empty or unreadable note is dropped or says so, and the label and numbering stay in place', async () => {
    // No longer applicable: "Summary: none given" and an unreadable rule. Neither is printed; nothing stands in for them.
    agent = payload => ({ ...faithful(payload), report: { summary: '   ', conventions: [{ path: '\u0000', rule: '\u0007' }], deviations: [{ kind: 'other', detail: '\u0007' }] } });
    const draft = await createDraft();
    await publish(draft);
    expectBodyShape(git.pulls[0].body);
    expect(git.pulls[0].body).not.toMatch(/Summary|none given|Rule \d/);
    expect(agentLines(git.pulls[0].body)).toEqual(['  - Deviation 1: other:']);
    // Stored notes: blank ones and values that are not text are not printed or counted; one made only of control
    // characters says that nothing in it was readable; the numbers Radar writes run on without a gap.
    const stored: RemoteDraft = JSON.parse(JSON.stringify(draft));
    stored.extra.agentNotes.deviations = ['\u0000\u0007', '   ', '', 7, null, { detail: 'x' }, '`', 'other: a real note'];
    git.pulls.length = 0;
    await publish(stored);
    expectBodyShape(git.pulls[0].body);
    expect(agentLines(git.pulls[0].body)).toEqual(['  - Deviation 1: nothing readable', "  - Deviation 2: '", '  - Deviation 3: other: a real note']);
    expect(git.pulls[0].body).not.toMatch(/ more$/m);
  });

  it('nothing is said about media, links or the agent when there is nothing to say; what Radar did not find is listed', async () => {
    // No longer applicable: the sentence "The article has no images, videos, sources or links, so there was nothing to
    // carry over." It was removed with the other filler; the bullet is simply absent.
    const draft = await createDraft();
    await publish(draft);
    expect(git.pulls[0].body).toBe(PLAIN_BODY);
    expect(git.pulls[0].body).not.toMatch(/nothing to carry|Not carried over|Radar found every|Reported by the agent|Deviation/);
    // The gate recorded its counts on the draft; the checked sentence is written from them.
    expect(draft.extra.facts).toEqual({ existingLinesChanged: 0, articleLinesReplaced: 0, notWordForWord: 0, undecided: 0, headings: 4, headingsMissing: 0 });
    expect(draft.extra.mediaOmitted).toEqual([]);

    // An article with a source and a video that the change leaves out: the gate lists them, and the body prints the
    // list as code (never as links) under Radar's own bullet, between the checked line and the closing sentence.
    git.refs.delete(BRANCH); git.pulls.length = 0;
    const withMedia = P({ sources: [{ title: 'A synthetic source about damp', url: 'https://example.test/damp-notes' }], videos: [{ id: 'Qm3xT7kLp9A', title: 'How gutters work', channel: 'Synthetic Channel', url: 'https://www.youtube.com/watch?v=Qm3xT7kLp9A' }] });
    const second = await createDraft(withMedia);
    expect(second.extra.mediaOmitted.length).toBeGreaterThan(0);
    await publish(second, withMedia);
    const body = git.pulls[0].body; const lines = body.split('\n');
    expectBodyShape(body);
    const from = lines.findIndex(line => line.startsWith('- Not carried over: '));
    expect(lines[from]).toBe(`- Not carried over: ${second.extra.mediaOmitted.length} ${second.extra.mediaOmitted.length === 1 ? 'image, video or link from the article, because Radar did not find it in the change:' : 'images, videos or links from the article, because Radar did not find them in the change:'}`);
    expect(lines.slice(from + 1, from + 1 + second.extra.mediaOmitted.length)).toEqual(second.extra.mediaOmitted.map((reference: string) => `  - \`${reference}\``));
    expect(lines[from - 1]).toBe(CHECKED_CLEAN);
    expect(lines[from + 1 + second.extra.mediaOmitted.length]).toBe('');
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

  // QA-4: rewritten for the short body. The old body said "No agent ran this time" and "Not available: the agent's
  // statements from the earlier attempt were not kept". The new one says it in one sentence and prints nothing that a
  // resumed draft no longer has: no checked sentence (the gate's counts were never kept), no list of what was not
  // carried over, and none of the earlier agent's notes.
  it('a resumed pull request says that it continues an earlier attempt and vouches for no detail it no longer has', async () => {
    const withMedia = P({ sources: [{ title: 'A synthetic source about damp', url: 'https://example.test/damp-notes' }] });
    agent = payload => ({ ...faithful(payload), report: { deviations: [{ kind: 'links-relocated', detail: 'The source list was left out of the post.' }] } });
    const first = await createDraft(withMedia);
    expect(first.extra.agentNotes.deviations).toHaveLength(1);
    expect(first.extra.mediaOmitted.length).toBeGreaterThan(0);
    expect(first.extra.facts).toBeDefined();
    const resumed = await createDraft(withMedia);
    expect(agentRuns()).toBe(1);
    expect(resumed.extra.continuation).toBe('resumed');
    expect(resumed.extra.review.runtimeVerified).toBe(false);
    expect(resumed.extra.facts).toBeUndefined();
    await publish(resumed, withMedia);
    const body = git.pulls[0].body;
    expectBodyShape(body);
    expect(body).toBe([P().meta, '', NOTICE, '', CONTINUATION.resumed, '', ARTICLE_LINE, '', CLOSING, '', 'Opened by Radar.'].join('\n'));
    expect(body).not.toMatch(/Checked by Radar|word for word|existing line|Not carried over|Reported by the agent|Deviation|source list|damp-notes/);
    // A resumed draft that somehow carries counts, notes and references (a row edited or written by other code) still
    // prints none of them: they would describe an attempt whose details this one never saw.
    const stored: RemoteDraft = JSON.parse(JSON.stringify(resumed));
    Object.assign(stored.extra, { facts: first.extra.facts, mediaOmitted: ['https://example.test/damp-notes'], agentNotes: { conventions: ['README.md: a rule'], deviations: ['other: a note from another attempt'] }, summary: 'A summary from another attempt.' });
    git.pulls.length = 0;
    await publish(stored, withMedia);
    expect(git.pulls[0].body).toBe(body);
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

  // D5, reported in QA-1 and fixed in 3d3dd9c7: the marker names the committed tree and carries an HMAC; a retry
  // resumes without a sandbox run only when the signature verifies and the head commit's tree is the signed tree.
  // QA-4: the short body vouches for an earlier attempt's commit in one sentence (it used to read "That attempt passed
  // every check below before it wrote the commit"). Only a verified resume may print it.
  const VOUCH = /This continues an earlier attempt whose commit had passed Radar’s checks/;
  const headOf = () => git.commits.get(git.refs.get(BRANCH)!)!;
  const withMarker = (marker: Record<string, unknown>, subject = 'Add post') => `${subject}\n\nRadar-Post: ${JSON.stringify(marker)}`;
  it('D5: the marker of a sandbox commit names its tree and is signed', async () => {
    await createDraft();
    const marker = markerOf(BRANCH);
    expect(marker.tree).toBe(headOf().tree);
    expect(marker.sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Object.keys(marker).sort()).toEqual(['articlePath', 'body', 'engine', 'entryId', 'hint', 'route', 'sig', 'slug', 'tree', 'version']);
  });
  it('D5: a later commit that copies the marker is not resumed: the engine runs again and the pull request does not vouch for it', async () => {
    await createDraft();
    const gated = git.refs.get(BRANCH)!;
    const files = new Map(git.trees.get(git.commits.get(gated)!.tree)!);
    files.set('site/pages/blog/index.tsx', 'export default function Blog() { return "changed by someone else"; }\n');
    git.trees.set('tree-foreign', files);
    git.commits.set('commit-foreign', { tree: 'tree-foreign', message: `Tweak listing\n\n${git.commits.get(gated)!.message.split('\n').at(-1)}`, parents: [gated] });
    git.refs.set(BRANCH, 'commit-foreign');
    git.calls = [];
    const again = await createDraft();
    expect(agentRuns()).toBe(2);
    expect(again.extra.continuation).toBe('unchanged'); // the agent found the article complete and changed nothing
    expect(writes()).toEqual([]);
    await publish(again);
    const body = git.pulls[0].body;
    expectBodyShape(body);
    expect(body).not.toMatch(VOUCH);
    // It says what this attempt did and what its check covers, and claims nothing about existing lines: the listing
    // that someone else changed on the branch is not something this attempt looked at.
    expect(body).toBe([P().meta, '', NOTICE, '', CONTINUATION.unchanged, '', ARTICLE_LINE, '- Checked by Radar: the article text is carried over word for word.', '', CLOSING, '', 'Opened by Radar.'].join('\n'));
    expect(body).not.toMatch(/existing line|existing content|removed or changed/);
  });
  it.each([
    ['a route edited in place', (m: any) => ({ ...m, route: '/blog/somewhere-else' })],
    ['the tree field pointed at another tree', (m: any) => ({ ...m, tree: 'tree0' })],
    ['a random signature', (m: any) => ({ ...m, sig: 'A'.repeat(43) })],
    ['an empty signature', (m: any) => ({ ...m, sig: '' })],
    ['no signature', (m: any) => { const { sig: _sig, ...rest } = m; return rest; }],
    ['no tree', (m: any) => { const { tree: _tree, ...rest } = m; return rest; }],
    ['a marker as written before signing existed (no tree, no signature)', (m: any) => ({ version: 3, entryId: m.entryId, hint: m.hint, slug: m.slug, articlePath: m.articlePath, route: m.route, engine: 'sandbox', body: m.body })],
    ['a signature made with another key', (m: any) => ({ ...m, sig: createHmac('sha256', createHmac('sha256', 'not-the-application-secret').update('radar:publishing:commit-marker:v1').digest()).update(JSON.stringify(['Radar-Post', 3, 'sandbox', m.entryId, m.hint, m.slug, m.articlePath, m.route, m.body, m.tree])).digest('base64url') })],
    ['a signature made with the application secret used directly, without the purpose derivation', (m: any) => ({ ...m, sig: createHmac('sha256', 'radar-dev-only-key').update(JSON.stringify(['Radar-Post', 3, 'sandbox', m.entryId, m.hint, m.slug, m.articlePath, m.route, m.body, m.tree])).digest('base64url') })],
    ['a number where the signature should be', (m: any) => ({ ...m, sig: 12345 })],
  ])('D5: %s on the gated commit itself is not resumed', async (_label, alter) => {
    await createDraft();
    headOf().message = withMarker(alter(markerOf(BRANCH)));
    git.calls = [];
    const again = await createDraft().then(draft => draft, error => error);
    expect(agentRuns()).toBe(2);
    if (!(again instanceof Error)) { expect(again.extra.continuation).not.toBe('resumed'); await publish(again); expect(git.pulls[0].body).not.toMatch(VOUCH); expect(git.pulls[0].body.split('\n')).not.toContain(CONTINUATION.resumed); expectBodyShape(git.pulls[0].body); }
  });
  it('D5: the honest resume still works, including after a message-only amend that keeps the tree', async () => {
    const first = await createDraft();
    git.calls = [];
    const resumed = await createDraft();
    expect(agentRuns()).toBe(1);
    expect(writes()).toEqual([]);
    expect(resumed.extra).toMatchObject({ continuation: 'resumed', path: first.extra.path, route: first.extra.route });
    // The same tree under a reworded subject line: what is on the branch is still exactly what Radar gated.
    git.commits.set('commit-amended', { tree: headOf().tree, message: withMarker(markerOf(BRANCH), 'Add post (reworded by a maintainer)'), parents: headOf().parents });
    git.refs.set(BRANCH, 'commit-amended');
    expect((await createDraft()).extra.continuation).toBe('resumed');
    expect(agentRuns()).toBe(1);
    await publish(resumed);
    expect(git.pulls[0].body).toMatch(VOUCH);
    expect(git.pulls[0].body.split('\n')).toContain(CONTINUATION.resumed);
    expectBodyShape(git.pulls[0].body);
  });
  it('D5: in production without an application secret nothing is signed, so nothing is resumed', async () => {
    H.over = { isProd: true, secretKey: '', allowPrivateHosts: true };
    await createDraft();
    expect(markerOf(BRANCH).sig).toBeUndefined();
    expect(markerOf(BRANCH).tree).toBe(headOf().tree);
    const again = await createDraft();
    expect(agentRuns()).toBe(2);
    expect(again.extra.continuation).toBe('unchanged');
  });
  it('D5: a marker signed under one application secret is not resumed under another', async () => {
    H.over = { secretKey: 'qa-first-application-secret-0123456789abcdef' };
    await createDraft();
    H.over = { secretKey: 'qa-second-application-secret-0123456789abcdef' };
    await createDraft();
    expect(agentRuns()).toBe(2);
    H.over = { secretKey: 'qa-first-application-secret-0123456789abcdef' };
    expect((await createDraft()).extra.continuation).toBe('resumed');
    expect(agentRuns()).toBe(2);
  });

  // N1, reported in QA-2 and fixed in 8ce9b640: on a retry the connector asks GitHub where the article branch left the
  // default branch and hands that commit's tree to the gate.
  const LISTING = 'site/lib/posts.ts';
  const baseListing = () => git.trees.get('tree0')!.get(LISTING)!;
  const withListing = (payload: PublishPayload, listing: string) => ({ files: { ...faithful(payload).files, [LISTING]: listing } });
  const mine = (title: string) => `export const mine = { slug: '${P().slug}', title: '${title}' };\n`;
  const EDITED = () => P({ title: 'A quite different title after an edit', blocks: [...QA_BLOCKS, ['p', 'A closing paragraph added after the first attempt, written for this test only.']], markdown: toMarkdown([...QA_BLOCKS, ['p', 'A closing paragraph added after the first attempt, written for this test only.']]) });
  const compares = () => git.calls.filter(call => /\/compare\//.test(call.url));
  /** A commit placed on the article branch by someone else, carrying the gated commit's trailer (not resumable: its tree differs). */
  const pushForeign = (sha: string, files: Files, parents: string[]) => { git.trees.set(`tree-of-${sha}`, files); git.commits.set(sha, { tree: `tree-of-${sha}`, message: `Foreign\n\n${git.commits.get(git.refs.get(BRANCH)!)!.message.split('\n').at(-1)}`, parents }); git.refs.set(BRANCH, sha); };

  it('N1: only a sandbox retry asks for the merge base: one compare request and one more tree', async () => {
    await createDraft();
    expect(compares()).toHaveLength(0); // a first attempt
    await createDraft();
    expect(compares()).toHaveLength(0); // a resumed retry
    git.calls = [];
    const head = git.refs.get(BRANCH)!;
    await createDraft(EDITED());
    expect(compares().map(call => new URL(call.url).pathname)).toEqual([`/repos/qa-owner/qa-site/compare/commit0...${head}`]);
    expect(git.calls.filter(call => call.method === 'GET' && /\/git\/trees\//.test(call.url)).map(call => new URL(call.url).pathname.split('/').at(-1))).toEqual([git.commits.get(head)!.tree, 'tree0']);
    expect(compares()[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(provider.transcript()).not.toContain(TOKEN);
  });
  it('N1: the planner makes no compare request, on a first attempt or a retry', async () => {
    vi.stubEnv('RADAR_PUBLISH_SANDBOX', 'off');
    await createDraft();
    await createDraft(EDITED());
    expect(H.plan).toHaveBeenCalledTimes(2);
    expect(H.plan.mock.calls[1][3].retry).toEqual({ slug: P().slug, articlePath: ARTICLE_PATH });
    expect(compares()).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
  });
  it('N1: a retry that removes default-branch lines is refused with zero Git writes', async () => {
    agent = (payload, _sandbox, turn) => (turn === 0 ? withListing(payload, baseListing() + mine('first title')) : withListing(payload, baseListing().split('\n').slice(3).join('\n') + mine(payload.title)));
    await createDraft();
    git.calls = [];
    const error = await failureOf(createDraft(EDITED()));
    expect(error.diagnostic?.code).toBe('peer-content-changed');
    expect(error.diagnostic?.reason).toMatch(/site\/lib\/posts\.ts has 3 of its 30 existing lines on the default branch removed/);
    expect(writes()).toEqual([]);
    expect(provider.count('create')).toBe(provider.count('destroy'));
  });
  it('N1: a retry after a title change rewrites its own listing line and adds a fast-forward commit', async () => {
    agent = (payload, _sandbox, turn) => withListing(payload, baseListing() + mine(turn === 0 ? 'first title' : payload.title));
    await publish(await createDraft());
    git.calls = [];
    const draft = await createDraft(EDITED());
    expect(writes()).toEqual(['POST /git/trees', 'POST /git/commits', `PATCH /git/refs/heads/${BRANCH}`]);
    expect(draft.extra.continuation).toBe('added');
    expect(draft.extra.checks.find((check: any) => check.id === 'peer-content').detail).toMatch(/^compared with the default-branch commit the article branch started from: 1 existing file edited; 0 of 30 original lines removed or altered/);
    const committed = git.trees.get(git.commits.get(git.refs.get(BRANCH)!)!.tree)!.get(LISTING)!;
    expect(committed).toBe(baseListing() + mine('A quite different title after an edit'));
    await publish(draft, EDITED());
    expect(git.pulls).toHaveLength(1);
  });
  it('N1: the default branch moving on afterwards does not change what the retry is compared with', async () => {
    agent = (payload, _sandbox, turn) => withListing(payload, baseListing() + mine(turn === 0 ? 'first title' : payload.title));
    await createDraft();
    // The default branch drops five of those lines and gains a file. The article branch has neither change.
    const moved = new Map(git.trees.get('tree0')!); moved.set(LISTING, baseListing().split('\n').slice(5).join('\n')); moved.set('site/lib/new.ts', 'export const added = true;\n');
    git.trees.set('tree-main1', moved); git.commits.set('main1', { tree: 'tree-main1', message: 'Main moves on', parents: ['commit0'] }); git.refs.set('main', 'main1');
    git.calls = [];
    const draft = await createDraft(EDITED());
    expect(compares().map(call => new URL(call.url).pathname.split('/compare/')[1].split('...')[0])).toEqual(['main1']);
    expect(draft.extra.checks.find((check: any) => check.id === 'peer-content').detail).toMatch(/0 of 30 original lines removed or altered/);
  });
  it('N1: after the default branch is merged into the article branch, what the merge brought in is protected', async () => {
    await createDraft();
    const head = git.refs.get(BRANCH)!;
    const main1 = new Map(git.trees.get('tree0')!); main1.set('site/lib/extra.ts', Array.from({ length: 10 }, (_u, n) => `export const extra${n} = ${n};`).join('\n') + '\n');
    git.trees.set('tree-main1', main1); git.commits.set('main1', { tree: 'tree-main1', message: 'Add extra', parents: ['commit0'] }); git.refs.set('main', 'main1');
    const merged = new Map(git.trees.get(git.commits.get(head)!.tree)!); merged.set('site/lib/extra.ts', main1.get('site/lib/extra.ts')!);
    pushForeign('merge1', merged, [head, 'main1']);
    agent = payload => ({ files: { ...faithful(payload).files, 'site/lib/extra.ts': 'export const extra0 = 0;\n' } });
    const error = await failureOf(createDraft(EDITED()));
    expect(error.diagnostic?.reason).toMatch(/site\/lib\/extra\.ts has 9 of its 10 existing lines on the default branch removed/);
  });
  // RESIDUAL (low), the connector side of the gate test in qa3.qa.test.ts: the same file brought over by a cherry-pick.
  it('RESIDUAL: a default-branch file copied onto the article branch without a merge is treated as the earlier attempt\'s own', async () => {
    await createDraft();
    const head = git.refs.get(BRANCH)!;
    const extra = Array.from({ length: 10 }, (_u, n) => `export const extra${n} = ${n};`).join('\n') + '\n';
    const main1 = new Map(git.trees.get('tree0')!); main1.set('site/lib/extra.ts', extra);
    git.trees.set('tree-main1', main1); git.commits.set('main1', { tree: 'tree-main1', message: 'Add extra', parents: ['commit0'] }); git.refs.set('main', 'main1');
    const picked = new Map(git.trees.get(git.commits.get(head)!.tree)!); picked.set('site/lib/extra.ts', extra);
    pushForeign('picked1', picked, [head]);
    agent = payload => ({ files: { ...faithful(payload).files, 'site/lib/extra.ts': 'export const extra0 = 0;\n' } });
    const draft = await createDraft(EDITED());
    expect(draft.extra.checks.find((check: any) => check.id === 'peer-content').detail).toMatch(/no file of that commit was edited; .*2 changed files exist only on the article branch, written by an earlier attempt, and are not compared/);
    // Nine of the ten lines the default branch holds in that file are gone from the commit Radar would open a pull request for.
    expect(git.trees.get(git.commits.get(git.refs.get(BRANCH)!)!.tree)!.get('site/lib/extra.ts')).toBe('export const extra0 = 0;\n');
  });
  it('N1: an article branch with no shared history, an unreadable merge base, or a truncated base tree is refused before any sandbox run', async () => {
    await createDraft();
    const head = git.refs.get(BRANCH)!; const headFiles = new Map(git.trees.get(git.commits.get(head)!.tree)!);
    const runsBefore = provider.count('create');
    // 1. No common ancestor.
    pushForeign('orphan1', headFiles, []);
    expect((await failureOf(createDraft(EDITED()))).message).toMatch(/shares no history with the default branch/);
    // 2. GitHub answers without a merge base.
    git.refs.set(BRANCH, head); pushForeign('foreign2', new Map(headFiles).set('README.md', '# changed\n'), [head]);
    git.compare = () => json(200, { commits: [] });
    expect((await failureOf(createDraft(EDITED()))).diagnostic?.code).toBe('snapshot-mismatch');
    git.compare = () => json(200, { merge_base_commit: { commit: { tree: { sha: '../../user' } } } });
    expect((await failureOf(createDraft(EDITED()))).diagnostic?.code).toBe('snapshot-mismatch');
    // 3. GitHub fails the compare request: the attempt is retried by the queue, and no sandbox was created.
    git.compare = () => json(502, { message: 'Bad gateway' });
    const outage = await failureOf(createDraft(EDITED()));
    expect([outage.http, outage.retryable]).toEqual([502, true]);
    // 4. The base tree is too large to list.
    git.compare = undefined; git.truncated = new Set(['tree0']);
    expect((await failureOf(createDraft(EDITED()))).diagnostic?.code).toBe('tree-unavailable');
    expect(provider.count('create')).toBe(runsBefore);
    expect(writes().filter(write => !write.startsWith('POST /git/trees') && !write.startsWith('POST /git/commits') && !write.startsWith('POST /git/refs'))).toEqual([]);
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
