// The sandbox publisher at the connector seam (.factory/sandbox-publisher/architecture.md §1.1, §8, §9, §11).
// GitHub is a mocked tree/commit/ref state machine, Daytona is the in-memory provider from sandbox/fake.ts with a
// scripted runner, and the planner is a mock. Everything between them is real: the rollout switch, the orchestration in
// sandbox/run.ts, the capability, the publication gate and the article-fidelity check. No network, sandbox or model.
// Every credential-shaped value below is a placeholder made for this test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '@/lib/types';
import type { ConnCtx, PublishPayload, RemoteDraft } from '../types';
import type { RepoSnapshot, RepositoryPostOptions } from './nextjs-agent';
import type { SandboxIntegrationInput } from '../sandbox/types';

const H = vi.hoisted(() => ({
  plan: vi.fn(), report: vi.fn(async (..._args: any[]) => {}), provider: null as any, providerKeys: [] as string[], runCalls: [] as unknown[][],
  env: {} as Record<string, string>, production: false,
  // The publisher lifecycle tests at the end of this file.
  row: null as any, article: null as any, connection: null as any, connector: null as any, business: null as any,
}));
vi.mock('./nextjs-agent', async importOriginal => ({ ...await importOriginal<typeof import('./nextjs-agent')>(), planRepositoryPost: H.plan }));
vi.mock('@/server/observability/failures', async importOriginal => ({ ...await importOriginal<typeof import('@/server/observability/failures')>(), reportFailure: H.report }));
// The real orchestration, with its arguments recorded so the tests can see exactly what the connector hands it.
vi.mock('../sandbox/run', async importOriginal => {
  const real = await importOriginal<typeof import('../sandbox/run')>();
  return { ...real, integrateWithSandbox: (...args: Parameters<typeof real.integrateWithSandbox>) => { H.runCalls.push(args); return real.integrateWithSandbox(...args); } };
});
vi.mock('../sandbox/daytona', async importOriginal => ({ ...await importOriginal<typeof import('../sandbox/daytona')>(), daytonaProvider: (key: string) => { H.providerKeys.push(key); return H.provider; } }));
// src/server/env.ts freezes its values at import; the four sandbox settings and the application secret are read from
// H.env instead, and H.production stands in for NODE_ENV=production where a test needs it.
vi.mock('@/server/env', async importOriginal => {
  const real = await importOriginal<typeof import('@/server/env')>();
  const env = { ...real.env };
  for (const key of ['daytonaKey', 'publishSandboxSnapshotId', 'publishModelProxyUrl', 'publishCapabilitySecret', 'secretKey']) Object.defineProperty(env, key, { enumerable: true, get: () => H.env[key] ?? '' });
  Object.defineProperty(env, 'isProd', { enumerable: true, get: () => H.production });
  return { ...real, env };
});
// Only the publisher lifecycle tests reach these.
vi.mock('@/server/db', async () => {
  const schema = await import('@/server/db/schema');
  const reader = (table: any) => {
    const rows = () => table === schema.calendarEntries ? [H.row] : table === schema.articles ? [{ data: H.article }] : table === schema.connections ? [H.connection] : [];
    const q: any = { where: () => q, limit: async () => rows(), orderBy: async () => rows(), then: (resolve: any) => Promise.resolve(rows()).then(resolve) };
    return q;
  };
  const db: any = { select: () => ({ from: reader }), update: () => ({ set: () => ({ where: async () => [] }) }), transaction: (fn: any) => fn(db) };
  return { db, schema };
});
vi.mock('@/server/workspace', () => ({ getBiz: async () => H.business, bump: vi.fn(async () => {}), entryFromRow: (row: any) => row, blogOf: () => ({}), connPublic: (row: any) => row, laterV: () => new Date() }));
vi.mock('@/server/services/images', () => ({ renderImage: vi.fn() }));
vi.mock('@/server/services/storage', () => ({ storedKey: vi.fn(), readLocal: vi.fn() }));
vi.mock('@/server/notify', () => ({ notify: vi.fn() }));
vi.mock('@/server/events', () => ({ trackSoon: vi.fn() }));
vi.mock('../../autopilot/guard', () => ({ canRun: vi.fn(async () => true) }));
vi.mock('../../drafting/guard', () => ({ lockArticle: async () => H.row, assertNoArticleWork: vi.fn() }));
vi.mock('../store', () => ({ ctxFromRow: (business: any, connection: any) => ({ type: connection.type, fields: {}, creds: {}, target: null, targetId: null, bid: business.id, domain: business.domain, businessName: 'Example' }) }));
vi.mock('./index', () => ({ connectorFor: () => H.connector }));

import { PublishError } from '../http';
import { branchOf, markerBindsCommit, markerSignature, nextjs, publishAttemptMs, sandboxPullRequestBody } from './nextjs';
import { FakeSandboxProvider, type FakeExecCall, type FakeSandbox } from '../sandbox/fake';
import { SANDBOX_COMMANDS } from '../sandbox/run';
import { AGENT_TEXT, PUBLISH_CHECK_IDS, RUNNER_COMMANDS, SANDBOX_BUDGET, SANDBOX_NOT_RUN, SANDBOX_OPERATIONS, SANDBOX_PATHS, type AgentReport, type RunnerResult, type SandboxExecResult } from '../sandbox/types';
import { ARTICLE, payloadFor } from '../sandbox/__fixtures__/article';
import { blobSha, treeOf, type AgentOutput } from '../sandbox/__fixtures__/tree';
import { PEER_RECORDS, REGISTRY_PATH, REGISTRY_ROUTE, recordSource, registryIntegration, registryReformatted, toRecord, typedRegistryRepository, withRecord } from '../sandbox/__fixtures__/typedRegistry';

// ---------------------------------------------------------------------------------------------------------------------
// Placeholders

const BUSINESS = '5b0c7f0e-3a51-4c0e-9d1f-2f6a8f1f4b10';
const SECRET = {
  githubToken: 'gho_' + 'T7'.repeat(18),
  daytonaKey: 'dtn_placeholder_' + 'D4'.repeat(14),
  capabilitySecret: 'capability-secret-' + 'S9'.repeat(16),
  anthropicKey: 'sk-ant-placeholder-' + 'A1'.repeat(16),
  openRouterKey: 'sk-or-placeholder-' + 'R2'.repeat(16),
  openAiKey: 'sk-proj-placeholder-' + 'O3'.repeat(16),
  databaseUrl: 'postgres://radar:database-password-Q8@db.example.test:5432/radar',
  radarSecretKey: 'radar-secret-key-' + 'K5'.repeat(16),
  githubClientSecret: 'github-client-secret-' + 'C6'.repeat(12),
};
const CONFIGURED = { daytonaKey: SECRET.daytonaKey, publishSandboxSnapshotId: '0f8fad5b-d9cb-469f-a165-70867728950e', publishModelProxyUrl: 'https://model-proxy.example.test/model', publishCapabilitySecret: SECRET.capabilitySecret };
const C: ConnCtx = { type: 'nextjs', fields: { repo: 'acme/site', path: 'apps/web/app/blog' }, creds: { access_token: SECRET.githubToken }, target: null, targetId: null, bid: BUSINESS, domain: 'example.test', businessName: 'Example Rentals' };
const HINT = 'apps/web/app/blog';
const P = (overrides: Partial<PublishPayload> = {}, blocks: Block[] = ARTICLE): PublishPayload => payloadFor(blocks, { entryId: 'e_Ab3-x_9Q', ...overrides });
const BR = branchOf(P());

// ---------------------------------------------------------------------------------------------------------------------
// GitHub: an immutable tree/commit/ref state machine with real git blob hashes

const API = 'https://api.github.com';
type Call = { method: string; url: string; init: RequestInit };
type Commit = { tree: { sha: string }; message: string; parents: string[] };
let calls: Call[] = [];
let refs: Map<string, string>;
let trees: Map<string, Map<string, string>>;
let commits: Map<string, Commit>;
let prs: { head: string; base: string; html_url: string; state: string; draft: boolean; body: string }[];
let override: ((method: string, url: string, init: RequestInit) => Response | Promise<Response> | null) | null;
let n = 0;
/** How many sandboxes had been destroyed when the first Git write arrived. */
let destroyedBeforeFirstWrite: number | null = null;
const reply = (status: number, body: any = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const json = (call: Call) => JSON.parse(String(call.init.body));
const header = (call: Call, name: string) => (call.init.headers as Record<string, string> | undefined)?.[name];
const pathOf = (call: Call) => new URL(call.url).pathname.replace('/repos/acme/site', '');
const writes = () => calls.filter(call => call.method !== 'GET');
const written = () => writes().map(call => [call.method, pathOf(call)]);
const branchFiles = (ref: string) => trees.get(commits.get(refs.get(ref) || ref)!.tree.sha)!;
const markerOf = (ref: string) => JSON.parse(commits.get(refs.get(ref) || ref)!.message.split('\n').at(-1)!.slice('Radar-Post: '.length));
function github(method: string, url: string, init: RequestInit): Response {
  const u = new URL(url);
  if (u.host === 'codeload.github.com' && method === 'GET') return new Response(Buffer.from(`PINNED-ARCHIVE ${u.pathname}`), { status: 200 });
  const p = decodeURIComponent(u.pathname.replace('/repos/acme/site', ''));
  if (u.pathname === '/repos/acme/site' && method === 'GET') return reply(200, { default_branch: 'main', permissions: { push: true } });
  let m: RegExpExecArray | null;
  if ((m = /^\/git\/ref\/heads\/(.+)$/.exec(p)) && method === 'GET') return refs.has(m[1]) ? reply(200, { object: { sha: refs.get(m[1]) } }) : reply(404, { message: 'Not Found' });
  if ((m = /^\/git\/commits\/(.+)$/.exec(p)) && method === 'GET') return reply(200, commits.get(m[1]));
  if ((m = /^\/git\/trees\/(.+)$/.exec(p)) && method === 'GET') return reply(200, { sha: m[1], truncated: false, tree: [...treeOf(trees.get(m[1])!).entries.values()] });
  if ((m = /^\/contents\/(.+)$/.exec(p)) && method === 'GET') {
    const content = branchFiles(u.searchParams.get('ref')!).get(m[1]);
    return content === undefined ? reply(404, { message: 'Not Found' }) : reply(200, { sha: blobSha(Buffer.from(content)), path: m[1], encoding: 'base64', content: Buffer.from(content).toString('base64'), size: Buffer.byteLength(content) });
  }
  if ((m = /^\/tarball\/(.+)$/.exec(p)) && method === 'GET') return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/acme/site/legacy.tar.gz/${m[1]}` } });
  if ((m = /^\/git\/blobs\/(.+)$/.exec(p)) && method === 'GET') {
    for (const files of trees.values()) for (const content of files.values()) if (blobSha(Buffer.from(content)) === m[1]) return reply(200, { sha: m[1], encoding: 'base64', content: Buffer.from(content).toString('base64'), size: Buffer.byteLength(content) });
    return reply(404, { message: 'Not Found' });
  }
  if ((m = /^\/commits\/(.+)$/.exec(p)) && method === 'GET') {
    const commit = commits.get(m[1])!; const after = trees.get(commit.tree.sha)!; const before = trees.get(commits.get(commit.parents[0])!.tree.sha)!;
    return reply(200, { sha: m[1], files: [...after].filter(([path, content]) => before.get(path) !== content).map(([path]) => ({ filename: path, status: before.has(path) ? 'modified' : 'added' })) });
  }
  if ((m = /^\/compare\/([^.]+)\.\.\.(.+)$/.exec(p)) && method === 'GET') {
    // The merge base: the first commit on the head's history that is also on the base's.
    const onBase = new Set<string>(); for (let at: string | undefined = m[1]; at && commits.has(at) && !onBase.has(at); at = commits.get(at)!.parents[0]) onBase.add(at);
    let at: string | undefined = m[2]; const seen = new Set<string>();
    while (at && !onBase.has(at) && !seen.has(at)) { seen.add(at); at = commits.get(at)?.parents[0]; }
    return at && onBase.has(at) ? reply(200, { status: 'ahead', merge_base_commit: { sha: at, commit: { tree: commits.get(at)!.tree } }, commits: [], files: [] }) : reply(404, { message: 'No common ancestor between ' + m[1] + ' and ' + m[2] });
  }
  if (p === '/git/trees' && method === 'POST') {
    const body = json({ method, url, init }); const files = new Map(trees.get(body.base_tree)!);
    for (const file of body.tree) files.set(file.path, file.content);
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
  if (p === '/pulls' && method === 'POST') {
    const body = json({ method, url, init });
    if (prs.some(pr => pr.head === body.head && pr.state === 'open')) return reply(422, { message: 'Validation Failed' });
    const pr = { head: body.head, base: body.base, html_url: `https://github.com/acme/site/pull/${prs.length + 1}`, state: 'open', draft: body.draft, body: body.body }; prs.push(pr); return reply(201, pr);
  }
  if (p === '/pulls' && method === 'GET') { const head = u.searchParams.get('head')!.split(':')[1]; return reply(200, prs.filter(pr => pr.head === head && pr.state === u.searchParams.get('state'))); }
  return reply(500, { message: 'unexpected ' + method + ' ' + url });
}

// ---------------------------------------------------------------------------------------------------------------------
// The sandbox: fake provider plus a scripted stand-in for the runner scripts

type Turn = (payload: PublishPayload) => AgentOutput;
let provider: FakeSandboxProvider;
let turns: Turn[];
let probe: SandboxExecResult | undefined;
let nonRegular: SandboxExecResult | undefined;
const RUN = RUNNER_COMMANDS.run;
const runs = () => provider.execs().filter(call => call.command === RUN);
const taskOf = (sandbox: FakeSandbox) => JSON.parse(sandbox.files.get(SANDBOX_PATHS.task)!.toString());
/** What a runner turn leaves behind: the edited files, the agent's report and the runner's result. */
function leave(sandbox: FakeSandbox, payload: PublishPayload, output: AgentOutput): void {
  for (const [path, content] of Object.entries(output.files)) sandbox.files.set(`${SANDBOX_PATHS.repo}/${path}`, Buffer.from(content));
  const report: AgentReport = {
    version: 1, status: 'integrated', slug: output.slug ?? payload.slug, articlePath: output.articlePath, route: output.route,
    summary: 'Added the article as one record in the posts registry, after the last existing record.',
    evidence: [{ role: 'listing', path: 'apps/web/app/blog/page.tsx', note: 'The listing maps over the registry.' }],
    conventions: [{ path: REGISTRY_PATH, rule: 'Records use single-quoted strings and trailing commas' }], deviations: [], reason: null, ...output.report,
  };
  const result: RunnerResult = { version: 1, status: 'completed', agentError: null, sessionId: '11111111-2222-4333-8444-555555555555', turns: 9, changed: Object.entries(output.files).map(([path, content]) => ({ path, bytes: Buffer.byteLength(content) })), ...output.result };
  sandbox.files.set(SANDBOX_PATHS.report, Buffer.from(JSON.stringify(report)));
  sandbox.files.set(SANDBOX_PATHS.result, Buffer.from(JSON.stringify(result)));
}
function runner(call: FakeExecCall, sandbox: FakeSandbox): SandboxExecResult | void {
  if (call.command === RUNNER_COMMANDS.probe) return probe;
  if (call.command === SANDBOX_COMMANDS.findNonRegular) return nonRegular;
  if (call.command !== RUN) return;
  const turn = turns[Math.min(runs().length - 1, turns.length - 1)];
  leave(sandbox, JSON.parse(JSON.stringify(currentPayload)), turn(currentPayload));
}
let currentPayload: PublishPayload;
const registry = () => trees.get('base-tree')!.get(REGISTRY_PATH)!;
/** The fixture's good output: the registry gains one record and nothing else changes. */
const good: Turn = payload => registryIntegration(registry(), payload);
const sandboxOn = (value = 'all') => { vi.stubEnv('RADAR_PUBLISH_SANDBOX', value); H.env = { ...CONFIGURED }; };
const createDraft = (payload: PublishPayload = P(), c: ConnCtx = C) => { currentPayload = payload; return nextjs.createDraft(c, payload); };
const publish = (draft: RemoteDraft, payload: PublishPayload = P()) => { currentPayload = payload; return nextjs.publish(C, payload, draft); };
async function failure(promise: Promise<unknown>): Promise<PublishError> { try { await promise; } catch (error) { return error as PublishError; } throw new Error('expected a rejection'); }

beforeEach(() => {
  calls = []; n = 0; override = null; prs = []; destroyedBeforeFirstWrite = null;
  refs = new Map([['main', 'base-sha']]);
  trees = new Map([['base-tree', typedRegistryRepository()]]);
  commits = new Map([['base-sha', { tree: { sha: 'base-tree' }, message: 'Initial site', parents: [] }]]);
  turns = [good]; probe = undefined; nonRegular = undefined;
  provider = new FakeSandboxProvider({ exec: runner });
  H.provider = provider; H.providerKeys = []; H.runCalls = []; H.env = {}; H.production = false;
  H.report.mockClear(); H.plan.mockReset();
  // The planner, when it is the engine: one new file and a touched index, like the transport suite's planner.
  H.plan.mockImplementation(async (_hint: string, payload: PublishPayload, snapshot: RepoSnapshot, options: RepositoryPostOptions) => {
    const listing = await snapshot.read('apps/web/app/blog/page.tsx');
    const slug = options.retry?.slug || payload.slug; const path = options.retry?.articlePath || `content/planner/${slug}.html`;
    const sha = (file: string) => snapshot.entries.find(entry => entry.path === file)!.sha;
    return {
      slug, path, files: [{ path, content: payload.html }], summary: 'Adds the article where the planner found the blog.', route: `/blog/${slug}`,
      discovery: [{ path: 'apps/web/app/blog/page.tsx', sha: sha('apps/web/app/blog/page.tsx'), snippet: listing.slice(0, 40), role: 'route' }, { path: 'apps/web/app/blog/page.tsx', sha: sha('apps/web/app/blog/page.tsx'), snippet: listing.slice(0, 40), role: 'listing' }],
      review: { summary: 'The inspected listing consumes the registry.', runtimeVerified: false }, draft: true,
    };
  });
  for (const [name, value] of Object.entries({ ANTHROPIC_API_KEY: SECRET.anthropicKey, OPEN_ROUTER_API_KEY: SECRET.openRouterKey, OPENAI_API_KEY: SECRET.openAiKey, DATABASE_URL: SECRET.databaseUrl, RADAR_SECRET_KEY: SECRET.radarSecretKey, GITHUB_CLIENT_SECRET: SECRET.githubClientSecret })) vi.stubEnv(name, value);
  for (const name of ['RADAR_PUBLISH_SANDBOX', 'RADAR_PUBLISH_SANDBOX_MODEL', 'RADAR_PUBLISH_SANDBOX_MAX_USD', 'RADAR_PUBLISH_SANDBOX_MAX_CALLS', 'RADAR_PUBLISH_SANDBOX_TRANSCRIPT_DIR', 'AI_MODEL_MAP']) vi.stubEnv(name, undefined);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => {
    const method = String(init.method || 'GET'); calls.push({ method, url: String(url), init });
    if (method !== 'GET' && destroyedBeforeFirstWrite === null) destroyedBeforeFirstWrite = provider.count('destroy');
    return (await override?.(method, String(url), init)) || github(method, String(url), init);
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------------------------------------------------

describe('rollout switch (SBX-9)', () => {
  it.each([
    ['unset', undefined, CONFIGURED],
    ['off', 'off', CONFIGURED],
    ['a list that does not name this business', '9d2e4c11-7b6a-4f3e-8a55-0c1d2e3f4a5b', CONFIGURED],
    ['on but unconfigured', 'all', { ...CONFIGURED, daytonaKey: '', publishSandboxSnapshotId: 'radar-publisher-latest' }],
  ] as const)('%s: the planner runs with today’s arguments and 270 s deadline, and no sandbox is created', async (_label, value, settings) => {
    vi.stubEnv('RADAR_PUBLISH_SANDBOX', value); H.env = { ...settings };
    const before = Date.now();
    const draft = await createDraft();
    const after = Date.now();
    expect(H.plan).toHaveBeenCalledTimes(1);
    const [hint, payload, snapshot, options] = H.plan.mock.calls[0];
    expect(hint).toBe(HINT);
    expect(payload).toEqual(P());
    expect(snapshot.entries).toEqual([...treeOf(trees.get('base-tree')!).entries.values()]);
    expect(options).toEqual({ businessId: BUSINESS, deadlineAt: expect.any(Number) });
    expect(options.deadlineAt).toBeGreaterThanOrEqual(before + 270_000);
    expect(options.deadlineAt).toBeLessThanOrEqual(after + 270_000);
    expect(publishAttemptMs(BUSINESS)).toBe(270_000);
    expect(H.runCalls).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
    expect(draft.extra.layout).toBe('repository-aware');
    expect(markerOf(BR)).toEqual({ version: 2, entryId: P().entryId, hint: HINT, slug: P().slug, articlePath: draft.extra.path });
    expect(written()).toEqual([['POST', '/git/trees'], ['POST', '/git/commits'], ['POST', '/git/refs']]);
  });

  it('reports an unconfigured switch once per attempt, by variable name only, and reports nothing while it is off or unlisted', async () => {
    vi.stubEnv('RADAR_PUBLISH_SANDBOX', 'all'); H.env = { ...CONFIGURED, daytonaKey: '', publishSandboxSnapshotId: 'radar-publisher-latest', publishCapabilitySecret: 'too-short-to-sign-with' };
    await publish(await createDraft());
    expect(H.report).toHaveBeenCalledTimes(1);
    const [error, context] = H.report.mock.calls[0];
    expect(context).toMatchObject({ source: 'publishing', operation: SANDBOX_OPERATIONS.config, incidentKey: SANDBOX_OPERATIONS.config, businessId: BUSINESS, ref: P().entryId, degraded: true });
    expect(error.message).toContain('DAYTONA_API_KEY');
    expect(error.message).toContain('RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID');
    expect(error.message).toContain('RADAR_PUBLISH_CAPABILITY_SECRET');
    const reported = JSON.stringify([error.message, context]);
    for (const value of ['radar-publisher-latest', 'too-short-to-sign-with', CONFIGURED.publishModelProxyUrl, SECRET.githubToken]) expect(reported).not.toContain(value);

    for (const value of [undefined, 'off', '9d2e4c11-7b6a-4f3e-8a55-0c1d2e3f4a5b']) {
      H.report.mockClear(); refs.delete(BR); vi.stubEnv('RADAR_PUBLISH_SANDBOX', value);
      await createDraft();
      expect(H.report).not.toHaveBeenCalled();
    }
  });

  it('a business list enables the sandbox for the businesses it names and nobody else', async () => {
    sandboxOn(`${BUSINESS}, 9d2e4c11-7b6a-4f3e-8a55-0c1d2e3f4a5b`);
    expect((await createDraft()).extra.layout).toBe('sandbox-agent');
    expect(H.plan).not.toHaveBeenCalled();
    const other = { ...C, bid: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' };
    const second = P({ entryId: 'e_other', slug: 'another-review' });
    expect((await createDraft(second, other)).extra.layout).toBe('repository-aware');
    expect(provider.count('create')).toBe(1);
  });
});

describe('a new article through the sandbox engine (SBX-1, SBX-2)', () => {
  beforeEach(() => sandboxOn());

  it('commits the gated integration once: one tree, one commit, one ref and one draft pull request', async () => {
    const original = registry();
    expect(Buffer.byteLength(original)).toBeGreaterThan(150_000);
    const draft = await createDraft();
    expect(H.plan).not.toHaveBeenCalled();
    expect(written()).toEqual([['POST', '/git/trees'], ['POST', '/git/commits'], ['POST', '/git/refs']]);
    const [tree, commit, ref] = writes().map(json);
    expect(tree.base_tree).toBe('base-tree');
    expect(tree.tree).toEqual([{ path: REGISTRY_PATH, mode: '100644', type: 'blob', content: good(P()).files[REGISTRY_PATH] }]);
    expect(commit.parents).toEqual(['base-sha']);
    expect(commit.message.startsWith(`Add post: ${P().title}\n\nRadar-Post: `)).toBe(true);
    expect(ref).toEqual({ ref: `refs/heads/${BR}`, sha: refs.get(BR) });
    // The marker names the tree this commit was written with and is signed (retries: "retries and identity" below).
    expect(markerOf(BR)).toEqual({ version: 3, entryId: P().entryId, hint: HINT, slug: P().slug, articlePath: REGISTRY_PATH, route: REGISTRY_ROUTE(P().slug), engine: 'sandbox', body: expect.stringMatching(/^[0-9a-f]{16}$/), tree: commit.tree, sig: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(commits.get(refs.get(BR)!)!.tree.sha).toBe(commit.tree);

    // The registry gained exactly one record and every original line is still there, in order.
    const final = branchFiles(BR).get(REGISTRY_PATH)!;
    expect(final.match(/^    slug: /gm)).toHaveLength(PEER_RECORDS + 1);
    const finalLines = final.split('\n'); let at = 0;
    for (const line of original.split('\n')) { at = finalLines.indexOf(line, at) + 1; expect(at).toBeGreaterThan(0); }
    expect([...branchFiles(BR)].filter(([path, content]) => trees.get('base-tree')!.get(path) !== content).map(([path]) => path)).toEqual([REGISTRY_PATH]);

    expect(draft).toEqual({ id: BR, extra: expect.objectContaining({ base: 'main', layout: 'sandbox-agent', path: REGISTRY_PATH, slug: P().slug, route: REGISTRY_ROUTE(P().slug), files: [REGISTRY_PATH], draft: true, notRun: [...SANDBOX_NOT_RUN], review: { summary: expect.any(String), runtimeVerified: false } }) });
    expect(draft.extra.continuation).toBeUndefined();
    // A resumed pull request states that every check passed, so the gate must keep reporting every check.
    expect(draft.extra.checks.map((check: any) => check.id).sort()).toEqual([...PUBLISH_CHECK_IDS].sort());

    const { url } = await publish(draft);
    expect(written().slice(3)).toEqual([['POST', '/pulls']]);
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ head: BR, base: 'main', draft: true, html_url: url });
  });

  it('runs the whole sandbox attempt, and destroys the sandbox, before the first Git write', async () => {
    await createDraft();
    expect(provider.count('create')).toBe(1);
    expect(provider.count('destroy')).toBe(1);
    expect(destroyedBeforeFirstWrite).toBe(1);
    const ops = provider.ops();
    expect(ops.indexOf(`exec:${RUNNER_COMMANDS.probe}`)).toBeLessThan(ops.indexOf(`uploadFile:${SANDBOX_PATHS.archive}`));
    expect(ops.at(-1)).toBe('destroy');
    // The sandbox was created for this entry, limited to the proxy host, from the configured snapshot.
    expect(provider.sandboxes[0].spec).toMatchObject({ snapshotId: CONFIGURED.publishSandboxSnapshotId, allowDomain: 'model-proxy.example.test', labels: { workload: 'radar-publisher', entry: P().entryId } });
  });

  it('gives the sandbox engine the full attempt deadline and the pinned commit, tree and article', async () => {
    const before = Date.now();
    await createDraft();
    expect(publishAttemptMs(BUSINESS)).toBe(SANDBOX_BUDGET.attemptMs);
    expect(H.runCalls).toHaveLength(1);
    // Production calls the orchestration with its input only: no injected provider, gate or capability.
    expect(H.runCalls[0]).toHaveLength(1);
    const input = H.runCalls[0][0] as SandboxIntegrationInput;
    expect(input.provider).toBeUndefined();
    expect(input).toMatchObject({ hint: HINT, repo: 'acme/site', commitSha: 'base-sha', payload: P(), options: { businessId: BUSINESS } });
    expect(input.options.deadlineAt).toBeGreaterThanOrEqual(before + SANDBOX_BUDGET.attemptMs);
    expect(input.options.deadlineAt).toBeLessThanOrEqual(Date.now() + SANDBOX_BUDGET.attemptMs);
    expect(input.entries).toEqual([...treeOf(trees.get('base-tree')!).entries.values()]);
    const task = taskOf(provider.sandboxes[0]);
    expect(task).toMatchObject({ mode: 'new', hint: HINT, repository: { fullName: 'acme/site', commitSha: 'base-sha' }, identity: { retry: null, legacy: null } });
    // The archive the sandbox received is the pinned commit's, fetched through the redirect.
    expect(provider.sandboxes[0].files.get(SANDBOX_PATHS.archive)!.toString()).toBe('PINNED-ARCHIVE /acme/site/legacy.tar.gz/base-sha');
  });

  it('keeps the GitHub token and every worker secret out of the sandbox and out of the orchestration input (SBX-2)', async () => {
    await publish(await createDraft());
    const crossed = provider.transcript();
    // The scan sees what it should: the article, the task and the per-run capability did cross the boundary.
    expect(crossed).toContain(P().title);
    expect(crossed).toContain('PINNED-ARCHIVE');
    expect(runs()[0].env?.ANTHROPIC_API_KEY).toMatch(/^rdrcap1\./);
    for (const [name, value] of Object.entries(SECRET)) expect(crossed.includes(value), `${name} crossed the provider boundary`).toBe(false);
    expect(crossed).not.toContain('access_token');
    expect(crossed).not.toContain('Bearer ');
    // The capability travels only in the runner's exec environment, never as a sandbox-wide variable or in a file.
    const capability = runs()[0].env!.ANTHROPIC_API_KEY;
    expect(JSON.stringify(provider.sandboxes[0].spec)).not.toContain('rdrcap1.');
    expect(provider.calls.filter(call => JSON.stringify(call, (_key, value) => (value?.type === 'Buffer' ? Buffer.from(value.data).toString('latin1') : value)).includes(capability)).map(call => call.op === 'exec' ? call.command : call.op)).toEqual([RUN]);

    // What run.ts was handed: closures, never the credentials. The Daytona key went to the provider factory only.
    const input = H.runCalls[0][0] as SandboxIntegrationInput;
    expect(JSON.stringify(input, (_key, value) => (value instanceof URL ? value.href : value))).not.toContain(SECRET.githubToken);
    expect(Object.keys(input).sort()).toEqual(['commitSha', 'config', 'entries', 'fetchArchive', 'hint', 'options', 'payload', 'readBlob', 'repo']);
    expect(H.providerKeys).toEqual([SECRET.daytonaKey]);

    // The token authenticates api.github.com and is not sent across the archive redirect.
    const archive = calls.filter(call => call.url.includes('/tarball/') || call.url.includes('codeload.github.com'));
    expect(archive.map(call => new URL(call.url).host)).toEqual(['api.github.com', 'codeload.github.com']);
    expect(header(archive[0], 'authorization')).toBe(`Bearer ${SECRET.githubToken}`);
    expect(JSON.stringify(archive[1].init.headers ?? {})).not.toContain(SECRET.githubToken);
    // Nothing secret reaches the pull request either.
    for (const value of Object.values(SECRET)) expect(prs[0].body).not.toContain(value);
    expect(prs[0].body).not.toContain('rdrcap1.');
  });

  it('a slug the agent had to change is recorded and disclosed', async () => {
    turns = [payload => ({ ...registryIntegration(registry(), { ...payload, slug: 'larkfield-commons-review-2' }), slug: 'larkfield-commons-review-2' })];
    const draft = await createDraft();
    expect(draft.extra).toMatchObject({ slug: 'larkfield-commons-review-2', taken: true, route: '/blog/larkfield-commons-review-2' });
    await publish(draft);
    expect(prs[0].body).toContain('The proposed slug `larkfield-commons-review` was unavailable; this change uses `larkfield-commons-review-2`.');
  });
});

describe('a refused or failed sandbox attempt writes nothing to Git (SBX-4)', () => {
  beforeEach(() => sandboxOn());
  const withoutParagraph = (blocks: Block[]) => { const at = blocks.findIndex((block, index) => index > 4 && block[0] === 'p'); return blocks.filter((_block, index) => index !== at); };
  const cases: [string, string, number, Turn][] = [
    ['a protected path', 'protected-path', 422, payload => { const output = registryIntegration(registry(), payload); return { ...output, files: { ...output.files, '.github/workflows/deploy.yml': 'on: push\n' } }; }],
    ['a credential in a changed file', 'credential-detected', 422, payload => { const output = registryIntegration(registry(), payload); return { ...output, files: { ...output.files, 'apps/web/app/blog/notes.ts': `export const note = '${'ghp_' + 'Zz9'.repeat(12)}';\n` } }; }],
    ['peer records reformatted', 'peer-content-changed', 422, payload => registryReformatted(registry(), payload)],
    ['a paragraph of the article left out', 'article-fidelity', 422, payload => registryIntegration(registry(), payload, withoutParagraph(payload.blocks))],
    ['a registry that no longer parses', 'syntax-invalid', 422, payload => ({ ...registryIntegration(registry(), payload), files: { [REGISTRY_PATH]: withRecord(registry(), recordSource(toRecord(payload.blocks, payload)).replace(/\n {2}\},$/, '')) } })],
    ['a report that declines the integration', 'agent-declined', 422, () => ({ files: {}, articlePath: REGISTRY_PATH, route: '/blog/x', report: { status: 'cannot_integrate', reason: 'The listing could not be traced.' } })],
    ['a run that changed nothing', 'plan-empty', 422, payload => ({ files: {}, articlePath: REGISTRY_PATH, route: REGISTRY_ROUTE(payload.slug) })],
    ['an agent turn that ended in an error', 'agent-failed', 422, payload => ({ ...registryIntegration(registry(), payload), result: { status: 'agent_error', agentError: 'AgentResult:error_max_turns' } })],
  ];
  it.each(cases)('%s fails as %s with no tree, commit, ref or pull request', async (_label, code, http, turn) => {
    turns = [turn];
    const error = await failure(createDraft());
    expect(error).toBeInstanceOf(PublishError);
    expect(error.diagnostic?.code).toBe(code);
    expect(error.http).toBe(http);
    expect(error.retryable).toBe(false);
    expect(writes()).toHaveLength(0);
    expect([...refs.keys()]).toEqual(['main']);
    expect(prs).toHaveLength(0);
    expect(provider.count('destroy')).toBe(1);
    // A sandbox failure never falls back to the planner inside the attempt.
    expect(H.plan).not.toHaveBeenCalled();
    // Bounded and sanitized: the diagnostic carries no article or registry text.
    expect(error.diagnostic!.reason.length).toBeLessThanOrEqual(600);
    expect(JSON.stringify(error.diagnostic)).not.toContain('Larkfield');
    expect(JSON.stringify(error.diagnostic)).not.toContain('ghp_');
  });

  it('a link or special file left in the workspace is refused before anything is committed', async () => {
    nonRegular = { exitCode: 0, output: '/workspace/repo/apps/web/app/blog/link' };
    expect((await failure(createDraft())).diagnostic?.code).toBe('non-regular-file');
    expect(writes()).toHaveLength(0);
  });

  it('unverified egress fails closed and retryable: no repository content is fetched or uploaded, and nothing is written', async () => {
    probe = { exitCode: 1, output: 'canary reachable host=registry.npmjs.org' };
    const error = await failure(createDraft());
    expect(error).toMatchObject({ http: 503, retryable: true, diagnostic: { code: 'sandbox-egress-unverified', stage: 'plan' } });
    expect(calls.some(call => call.url.includes('/tarball/'))).toBe(false);
    expect(provider.count('uploadFile')).toBe(0);
    expect(runs()).toHaveLength(0);
    expect(provider.count('destroy')).toBe(1);
    expect(writes()).toHaveLength(0);
  });

  it.each([[401, 'auth-expired', false], [404, 'http', false], [503, 'http', true]] as const)('a GitHub %s on the archive keeps its meaning (%s), with the sandbox destroyed and nothing written', async (status, kind, retryable) => {
    override = (method, url) => (url.includes('/tarball/') ? reply(status, { message: 'archive request failed' }) : null);
    const error = await failure(createDraft());
    expect(error).toMatchObject({ http: status, kind, retryable });
    expect(provider.count('uploadFile')).toBe(0);
    expect(provider.count('destroy')).toBe(1);
    expect(writes()).toHaveLength(0);
  });

  it('an archive download that never answers is abandoned at its budget with a retryable error', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let requested = false;
    override = (method, url) => { if (!url.includes('/tarball/')) return null; requested = true; return new Promise<Response>(() => {}); };
    const pending = failure(createDraft());
    for (let turn = 0; turn < 20_000 && !requested; turn++) await new Promise(resolve => setImmediate(resolve));
    expect(requested).toBe(true);
    await vi.advanceTimersByTimeAsync((SANDBOX_BUDGET.archiveSec + 1) * 1000);
    const error = await pending;
    expect(error).toBeInstanceOf(PublishError);
    expect(error.retryable).toBe(true);
    expect(provider.count('uploadFile')).toBe(0);
    expect(provider.count('destroy')).toBe(1);
    expect(writes()).toHaveLength(0);
  });

  it('a blob that does not match the pinned tree stops the gate: nothing is committed', async () => {
    override = (method, url) => (url.includes('/git/blobs/') ? reply(200, { encoding: 'base64', content: Buffer.from('tampered').toString('base64') }) : null);
    expect((await failure(createDraft())).diagnostic?.code).toBe('snapshot-mismatch');
    expect(writes()).toHaveLength(0);
    expect(provider.count('destroy')).toBe(1);
  });

  it('a gate failure the agent can fix gets one repair turn, and the repaired change is what is committed', async () => {
    turns = [payload => registryReformatted(registry(), payload), good];
    const draft = await createDraft();
    expect(runs()).toHaveLength(2);
    expect(provider.count('create')).toBe(1);
    expect(written()).toEqual([['POST', '/git/trees'], ['POST', '/git/commits'], ['POST', '/git/refs']]);
    expect(branchFiles(BR).get(REGISTRY_PATH)).toBe(good(P()).files[REGISTRY_PATH]);
    expect(draft.extra.layout).toBe('sandbox-agent');
  });
});

describe('pull request body (SBX-5)', () => {
  beforeEach(() => sandboxOn());

  it('says what Radar checked and nothing the agent claims about builds: only its deviations appear, as unverified', async () => {
    turns = [payload => ({ ...registryIntegration(registry(), payload), report: {
      summary: 'Added the record. I ran `npm run build` and the build passed; lint and tests passed too. cc @acme/owners',
      conventions: [{ path: 'package.json', rule: 'npm run build completed successfully' }],
      deviations: [{ kind: 'media-omitted', detail: 'BlogSection has no image field, so the body image was left out. cc @acme/owners' }],
    } })];
    const draft = await createDraft();
    expect(draft.extra.review.runtimeVerified).toBe(false);
    await publish(draft);
    const body = prs[0].body;
    // The agent's summary and the rules it says it followed are not printed, so no claim of a build can be.
    expect(body).not.toMatch(/build passed|completed successfully|npm run|lint|tests? passed/i);
    expect(body).toContain('Radar did not build or run the site. Check the article on the deployment preview before merging.');
    // What Radar says it checked comes from the gate's own counts for this change: the registry kept every line.
    expect(draft.extra.facts).toEqual({ existingLinesChanged: 0, articleLinesReplaced: 0, notWordForWord: 0, undecided: 0, headings: expect.any(Number), headingsMissing: 0 });
    expect(body).toContain('\n- Checked by Radar: no existing line was removed or changed; the article text is carried over word for word.\n');
    // None of the operator's check details reaches the owner.
    for (const check of draft.extra.checks) expect(body).not.toContain(check.detail);
    expect(body).not.toMatch(/bytes|limit \d|###/);
    // The deviation is printed once, under the unverified label, and cannot mention anyone.
    expect(body).toContain('\n- Reported by the agent that made the change (not verified by Radar):\n  - Deviation 1: media-omitted: BlogSection has no image field, so the body image was left out. cc `@acme/owners`\n');
    // Media and links the typed registry cannot carry are listed.
    expect(draft.extra.mediaOmitted.length).toBeGreaterThan(0);
    expect(body).toContain(`\n- Not carried over: ${draft.extra.mediaOmitted.length} images, videos or links from the article, because Radar did not find them in the change:\n`);
    for (const reference of draft.extra.mediaOmitted) expect(body).toContain('\n  - `' + reference + '`\n');
  });

  it('renders a persisted sandbox draft as reviewed text', async () => {
    const payload = P();
    refs.set(BR, 'base-sha');
    const draft: RemoteDraft = { id: BR, extra: {
      base: 'main', path: REGISTRY_PATH, slug: payload.slug, layout: 'sandbox-agent', files: [REGISTRY_PATH], route: '/blog/larkfield-commons-review', draft: true,
      summary: 'Added the article as one record at the end of the posts registry. The build passed.',
      checks: [
        { id: 'paths', outcome: 'passed', detail: '1 candidate path passes the repository write rules, with no duplicate or nested path' },
        { id: 'peer-content', outcome: 'passed', detail: '1 existing file edited; 0 of 2528 original lines removed or altered (at most 24 in all), 96 lines added' },
        { id: 'article-fidelity', outcome: 'passed', detail: '23 of 23 paragraphs and list items present; 9 of 9 headings present; 3 media or link references not carried' },
        { id: 'build', outcome: 'passed', detail: 'next build completed' },
      ],
      agentNotes: { conventions: ['apps/web/app/blog/posts.ts: records use single-quoted strings and trailing commas'], deviations: ['media-omitted: BlogSection has no image field'] },
      notRun: ['nothing was skipped'], mediaOmitted: ['https://files.radar.example/b_demo/body/costs-chart.png', 'Qm3xT7kLp9A'],
      review: { summary: 'Radar ran 3 checks on the exact files in this change.', runtimeVerified: false },
      facts: { existingLinesChanged: 0, articleLinesReplaced: 0, notWordForWord: 0, undecided: 0, headings: 9, headingsMissing: 0 },
    } };
    // A persisted entry outside the fixed check list fails validation rather than being accepted as a check.
    await expect(publish(draft, payload)).rejects.toMatchObject({ http: 422, kind: 'config' });
    draft.extra.checks.pop();
    await publish(draft, payload);
    expect(prs[0].body).toMatchInlineSnapshot(`
      "An independent six-week review of Larkfield Commons covering rent, fees, noise and transport.

      **Draft for review.** The article is not live. Scheduled for 2026-11-12.

      - Article: \`apps/web/app/blog/posts.ts\`, expected at \`/blog/larkfield-commons-review\`
      - Checked by Radar: no existing line was removed or changed; the article text is carried over word for word.
      - Not carried over: 2 images, videos or links from the article, because Radar did not find them in the change:
        - \`https://files.radar.example/b_demo/body/costs-chart.png\`
        - \`Qm3xT7kLp9A\`
      - Reported by the agent that made the change (not verified by Radar):
        - Deviation 1: media-omitted: BlogSection has no image field

      Radar did not build or run the site. Check the article on the deployment preview before merging.

      Opened by Radar."
    `);
  });

  /** A valid sandbox draft as publish() would receive it, for rendering the body directly. */
  const CLEAN = { existingLinesChanged: 0, articleLinesReplaced: 0, notWordForWord: 0, undecided: 0, headings: 8, headingsMissing: 0 };
  const extraWith = (over: Record<string, unknown> = {}) => ({
    base: 'main', path: REGISTRY_PATH, slug: P().slug, layout: 'sandbox-agent', files: [REGISTRY_PATH], route: REGISTRY_ROUTE(P().slug), draft: true,
    summary: 'Added the article as one record.', checks: PUBLISH_CHECK_IDS.map(id => ({ id, outcome: 'passed', detail: `operator detail of ${id}: 196224 bytes (limit 1000000)` })),
    agentNotes: { conventions: [], deviations: [] }, notRun: [...SANDBOX_NOT_RUN], mediaOmitted: [], review: { summary: 'Radar ran 8 checks.', runtimeVerified: false }, facts: CLEAN, ...over,
  });
  const deviationsOf = (deviations: string[], over: Record<string, unknown> = {}) => extraWith({ agentNotes: { conventions: [], deviations }, ...over });
  const AGENT_LABEL = '- Reported by the agent that made the change (not verified by Radar):';
  /** The lines of the body that carry agent-written text: the deviations, each a nested item behind Radar's label. */
  const agentLines = (body: string) => body.split('\n').filter(line => line.startsWith('  - Deviation '));
  /** The agent's own text on one of those lines: what follows Radar's label. */
  const agentText = (line: string) => line.replace(/^ {2}- Deviation \d+: /, '');
  /** Text of a line with its code spans taken out: what GitHub still reads as Markdown. */
  const outsideCode = (line: string) => line.replace(/`[^`]*`/g, '');
  const FIRST = `${P().meta}\n\n**Draft for review.** The article is not live. Scheduled for ${P().date}.`;
  const ARTICLE_LINE = `- Article: \`${REGISTRY_PATH}\`, expected at \`${REGISTRY_ROUTE(P().slug)}\``;
  const CHECKED = '- Checked by Radar: no existing line was removed or changed; the article text is carried over word for word.';
  const LAST = 'Radar did not build or run the site. Check the article on the deployment preview before merging.\n\nOpened by Radar.';

  it('a plain new article is the description, the draft notice, two bullets and the closing lines, with no filler', () => {
    const body = sandboxPullRequestBody(P(), extraWith({ summary: 'I ran the build and it passed.', agentNotes: { conventions: ['package.json: npm run build passed'], deviations: [] } }));
    expect(body).toBe([FIRST, '', ARTICLE_LINE, CHECKED, '', LAST].join('\n'));
    // Nothing is said about media, links or deviations when there are none, and nothing of the removed sections is left.
    expect(body).not.toMatch(/carried over:|Reported by the agent|nothing to carry|Not run|Files|Summary|Rule \d|bytes|###/);
    // An article with no description starts at the draft notice.
    expect(sandboxPullRequestBody(P({ meta: '' }), extraWith()).startsWith('**Draft for review.**')).toBe(true);
  });

  it('lists what was not carried over and the agent’s deviations, each only when there are any', () => {
    const references = ['https://files.radar.example/b_demo/body/costs-chart.png', 'Qm3xT7kLp9A'];
    const notes = ['media-omitted: BlogSection has no image field, so two body images were left out', 'other: The supplied article ends mid-sentence'];
    expect(sandboxPullRequestBody(P(), deviationsOf(notes, { mediaOmitted: references }))).toBe([
      FIRST, '', ARTICLE_LINE, CHECKED,
      '- Not carried over: 2 images, videos or links from the article, because Radar did not find them in the change:', '  - `https://files.radar.example/b_demo/body/costs-chart.png`', '  - `Qm3xT7kLp9A`',
      AGENT_LABEL, '  - Deviation 1: media-omitted: BlogSection has no image field, so two body images were left out', '  - Deviation 2: other: The supplied article ends mid-sentence',
      '', LAST,
    ].join('\n'));
    expect(sandboxPullRequestBody(P(), extraWith({ mediaOmitted: [references[0]] }))).toBe([
      FIRST, '', ARTICLE_LINE, CHECKED, '- Not carried over: 1 image, video or link from the article, because Radar did not find it in the change:', `  - \`${references[0]}\``, '', LAST,
    ].join('\n'));
    expect(sandboxPullRequestBody(P(), deviationsOf([notes[1]]))).toBe([FIRST, '', ARTICLE_LINE, CHECKED, AGENT_LABEL, `  - Deviation 1: ${notes[1]}`, '', LAST].join('\n'));
    // Blank and non-text entries of a persisted draft are not counted or printed.
    expect(sandboxPullRequestBody(P(), deviationsOf(['  ', 7 as any], { mediaOmitted: ['', null] }))).toBe([FIRST, '', ARTICLE_LINE, CHECKED, '', LAST].join('\n'));
  });

  it('shows at most ten omitted references and eight deviations, then says how many more there are', () => {
    const references = Array.from({ length: 23 }, (_unused, index) => `https://files.radar.example/body/image-${index + 1}.png`);
    const notes = Array.from({ length: 20 }, (_unused, index) => `structure: note number ${index + 1}`);
    const lines = sandboxPullRequestBody(P(), deviationsOf(notes, { mediaOmitted: references })).split('\n');
    const from = lines.indexOf('- Not carried over: 23 images, videos or links from the article, because Radar did not find them in the change:');
    expect(lines.slice(from + 1, from + 12)).toEqual([...references.slice(0, 10).map(reference => `  - \`${reference}\``), '  - and 13 more']);
    expect(lines.slice(from + 12, from + 22)).toEqual([AGENT_LABEL, ...notes.slice(0, 8).map((note, index) => `  - Deviation ${index + 1}: ${note}`), '  - and 12 more']);
    expect(lines.slice(from + 22)).toEqual(['', ...LAST.split('\n')]);
    // Exactly at the caps nothing is hidden, so no "more" line is printed.
    const exact = sandboxPullRequestBody(P(), deviationsOf(notes.slice(0, 8), { mediaOmitted: references.slice(0, 10) }));
    expect(exact).not.toMatch(/ more$/m);
    expect(exact.split('\n').filter(line => line.startsWith('  - '))).toHaveLength(18);
    expect(sandboxPullRequestBody(P(), deviationsOf(notes.slice(0, 9))).split('\n').filter(line => line.startsWith('  - ')).at(-1)).toBe('  - and 1 more');
  });

  it('says only what the gate’s counts prove, and keeps what a reviewer must look at', () => {
    const checked = (facts: Record<string, unknown> | undefined, over: Record<string, unknown> = {}, payload: PublishPayload = P()) => sandboxPullRequestBody(payload, extraWith({ facts, ...over })).split('\n').find(line => line.startsWith('- Checked by Radar: '))?.slice('- Checked by Radar: '.length);
    expect(checked(CLEAN)).toBe('no existing line was removed or changed; the article text is carried over word for word.');
    // Existing lines the change altered are counted and pointed at: the gate proves they were kept, not what they now say.
    expect(checked({ ...CLEAN, existingLinesChanged: 1 })).toBe('no existing line was removed, and 1 existing line was changed (review it in the diff: Radar checks that existing text is kept, not what was added to it); the article text is carried over word for word.');
    expect(checked({ ...CLEAN, existingLinesChanged: 3 })).toMatch(/^no existing line was removed, and 3 existing lines were changed \(review them in the diff/);
    // Headings a template replaced, and places Radar could not decide, are said rather than covered by "word for word".
    expect(checked({ ...CLEAN, headings: 9, headingsMissing: 2 })).toBe('no existing line was removed or changed; the article’s paragraphs and list items are carried over word for word, and 2 of its 9 headings are not in the change as written.');
    expect(checked({ ...CLEAN, undecided: 1 })).toBe('no existing line was removed or changed; the article text is carried over word for word; Radar could not tell whether words were added beside 1 passage (check the diff).');
    expect(checked({ ...CLEAN, notWordForWord: 2, headings: 4, headingsMissing: 1 })).toBe('no existing line was removed or changed; 2 paragraphs or list items of the article have other words or markup between the article’s words (check the diff); 1 of its 4 headings is not in the change as written.');
    // A refresh replaces its own article, so nothing claims that no line was removed there.
    const refresh = P({ mode: 'refresh', refreshUrl: '/blog/larkfield-commons-review' });
    expect(checked({ ...CLEAN, articleLinesReplaced: 41 }, {}, refresh)).toBe('the update replaced 41 lines of the article file; outside that file no existing line was removed or changed; the article text is carried over word for word.');
    expect(checked({ ...CLEAN, articleLinesReplaced: 41, existingLinesChanged: 2 }, {}, refresh)).toMatch(/^the update replaced 41 lines of the article file; outside that file 2 existing lines were removed or changed \(review them in the diff/);
    expect(checked(CLEAN, {}, refresh)).toBe('no existing line was removed or changed; the article text is carried over word for word.');
    expect(checked({ ...CLEAN, existingLinesChanged: 1 }, {}, refresh)).toMatch(/^1 existing line was removed or changed \(review it in the diff/);
    // A draft saved before the counts were recorded, or with counts that are not counts, claims nothing specific.
    const general = 'the change passed Radar’s checks that existing content is kept and that the article text is carried over.';
    expect(checked(undefined)).toBe(general);
    for (const damaged of [{ ...CLEAN, existingLinesChanged: -1 }, { ...CLEAN, undecided: '0' }, { ...CLEAN, headings: 1.5 }, { existingLinesChanged: 0 }, 'none', []]) expect(checked(damaged as any)).toBe(general);
    // ...and without both checks on record, nothing at all.
    expect(checked(undefined, { checks: [{ id: 'paths', outcome: 'passed', detail: 'ok' }] })).toBeUndefined();
    expect(checked(undefined, { checks: [{ id: 'peer-content', outcome: 'failed', detail: 'x' }, { id: 'article-fidelity', outcome: 'passed', detail: 'ok' }] })).toBeUndefined();
  });

  it('each continuation is one short sentence, and a resumed draft leaves out what was not kept', () => {
    const body = (continuation: string, over: Record<string, unknown> = {}) => sandboxPullRequestBody(P(), deviationsOf(['other: a note'], { continuation, mediaOmitted: ['Qm3xT7kLp9A'], ...over }));
    const rest = ['- Not carried over: 1 image, video or link from the article, because Radar did not find it in the change:', '  - `Qm3xT7kLp9A`', AGENT_LABEL, '  - Deviation 1: other: a note', '', LAST];
    expect(body('added')).toBe([FIRST, '', 'This attempt added a commit to an existing article branch. Radar’s checks cover that commit and the article file, not the earlier commits on the branch.', '', ARTICLE_LINE, CHECKED, ...rest].join('\n'));
    // No commit was written, so nothing is said about existing lines: only the article file was checked.
    expect(body('unchanged')).toBe([FIRST, '', 'The article was already complete on its branch, so this attempt added no commit. Radar’s check covers the article file only.', '', ARTICLE_LINE, '- Checked by Radar: the article text is carried over word for word.', ...rest].join('\n'));
    // Resumed: the earlier attempt's counts, notes and omitted list were never kept, so none is printed, even if a draft carries some.
    expect(body('resumed')).toBe([FIRST, '', 'This continues an earlier attempt whose commit had passed Radar’s checks. Its notes were not kept, so compare the article’s images and links with the diff.', '', ARTICLE_LINE, '', LAST].join('\n'));
    // The slug note is one sentence and comes before the continuation.
    expect(body('added', { taken: true, slug: 'larkfield-commons-review-2' }).split('\n').slice(3, 6)).toEqual(['', 'The proposed slug `larkfield-commons-review` was unavailable; this change uses `larkfield-commons-review-2`.', '']);
  });

  it('D4: no form of link or image in agent text reaches the body as one, and repository paths stay readable', () => {
    const hostile: [string, string][] = [
      ['an inline link to a protocol-relative address', 'See [the preview](//evil.example.test/login) first'],
      ['an inline link with a scheme and a title', 'See [the preview](https://evil.example.test/a "Preview") first'],
      ['an inline link to a site-relative path', 'See [the settings](/acme/site/settings/keys) first'],
      ['an inline link with an angle destination', 'See [the preview](<//evil.example.test/a b>) first'],
      ['an inline link with a javascript destination', 'See [the preview](javascript:alert(1)) first'],
      ['an image', 'Status ![badge](//evil.example.test/badge.svg) here'],
      ['an image inside a link', 'Open [![badge](//evil.example.test/b.svg)](//evil.example.test/go) now'],
      ['a reference-style link and its definition', 'See [the preview][p] and [p] [p]: //evil.example.test/ref'],
      ['a link definition on its own', '[Opened by Radar]: //evil.example.test/def'],
      ['an autolink in angle brackets', 'Visit <https://evil.example.test/auto> or <mailto:owner@evil.example.test>'],
      ['a bare address with a scheme', 'Visit https://evil.example.test/bare and ftp://evil.example.test/file'],
      ['a bare www address', 'Visit www.evil.example.test/now or (www.evil.example.test)'],
      ['a bare protocol-relative address', 'Visit //evil.example.test/now'],
      ['an email address', 'Write to owner@evil.example.test'],
      ['a raw HTML link and image', '<a href="//evil.example.test/x">preview</a> <img src="//evil.example.test/p.png">'],
      ['a link whose brackets are already escaped', 'See \\[the preview](//evil.example.test/esc) first'],
      ['a character reference standing for a bracket or an at sign', 'See &#91;the preview&#93;(//evil.example.test/ent) and &#64;octocat'],
      ['an issue reference in another repository', 'Fixes evil/repository#12 and #7 and GH-9'],
      ['a task box', '[x] Build passed'],
    ];
    for (const [label, text] of hostile) {
      // The same text as the summary and as a rule is not printed at all; as a deviation it is printed neutralised.
      const body = sandboxPullRequestBody(P(), extraWith({ summary: text, agentNotes: { conventions: [text], deviations: [text] } }));
      const lines = agentLines(body);
      expect(lines.length, label).toBe(1);
      expect(body, label).toBe(sandboxPullRequestBody(P(), deviationsOf([text])));
      for (const line of lines) {
        const live = outsideCode(agentText(line));
        expect(live, label).not.toMatch(/evil\.example|:\/\/|www\./i);
        // Every bracket and backslash that is left is escaped, so nothing can pair into a link, image, definition or task box.
        expect(live.replace(/\\[\\[\]]/g, ''), label).not.toMatch(/[\\[\]]/);
        expect(live, label).not.toMatch(/<|&(?!amp;|lt;)/);
        expect(live, label).not.toMatch(/[@#]\w/);
      }
    }
    // What a reviewer still reads: the link text, the fact that something was removed, and paths as the agent wrote them.
    const body = sandboxPullRequestBody(P(), deviationsOf([
      'other: Review notes: [open the preview](//evil.example.test/login) ![status](//evil.example.test/badge.svg) or visit www.evil.example.test/now',
      'structure: apps/web/app/blog/[slug]/page.tsx reads posts.ts, see src/lib/blog.ts and app/(site)/layout.tsx',
      'links-relocated: moved 2 links (was [URL omitted]) into public/llms.txt & the registry',
    ]));
    expect(agentLines(body)).toEqual([
      '  - Deviation 1: other: Review notes: open the preview (link removed) status (image removed) or visit (address removed)',
      '  - Deviation 2: structure: apps/web/app/blog/\\[slug\\]/page.tsx reads posts.ts, see src/lib/blog.ts and app/(site)/layout.tsx',
      '  - Deviation 3: links-relocated: moved 2 links (was \\[URL omitted\\]) into public/llms.txt &amp; the registry',
    ]);
  });

  it('D4: hostile agent text goes through the whole flow without leaving an address in the pull request', async () => {
    turns = [payload => ({ ...registryIntegration(registry(), payload), report: {
      summary: 'Done. [Approve this pull request](//evil.example.test/approve) ![x](//evil.example.test/pixel.gif) www.evil.example.test',
      conventions: [{ path: '[Opened by Radar]', rule: '//evil.example.test/definition' }],
      deviations: [{ kind: 'other', detail: 'See [Opened by Radar] and evil/repository#3 [approve](//evil.example.test/approve)' }],
    } })];
    await publish(await createDraft());
    expect(prs[0].body).not.toMatch(/evil\.example/);
    expect(prs[0].body).not.toMatch(/Approve this pull request|Done\./);
    expect(agentLines(prs[0].body)).toEqual(['  - Deviation 1: other: See \\[Opened by Radar\\] and `evil/repository#3` approve (link removed)']);
  });

  it('hostile agent text in a deviation renders nothing and starts no block: a link, a heading marker, a mention, an HTML tag', () => {
    const body = sandboxPullRequestBody(P(), deviationsOf([
      '[Merge now](https://evil.example.test/merge)', '# Approved by Radar', '## Checked by Radar: build passed', 'cc @acme/owners and @octocat', '<details><summary>Radar verified this</summary><img src=x onerror=alert(1)></details>',
      '- Checked by Radar: the build passed', 'first line\n\n- Checked by Radar: the build passed\n\nOpened by Radar.',
    ]));
    expect(agentLines(body)).toEqual([
      '  - Deviation 1: Merge now (link removed)',
      '  - Deviation 2: # Approved by Radar',
      '  - Deviation 3: ## Checked by Radar: build passed',
      '  - Deviation 4: cc `@acme/owners` and `@octocat`',
      '  - Deviation 5: &lt;details>&lt;summary>Radar verified this&lt;/summary>&lt;img src=x onerror=alert(1)>&lt;/details>',
      '  - Deviation 6: - Checked by Radar: the build passed',
      '  - Deviation 7: first line - Checked by Radar: the build passed Opened by Radar.',
    ]);
    // Radar's own statements stand once each, on Radar's lines; the agent's copies are inline text behind its label.
    const lines = body.split('\n');
    expect(lines.filter(line => line.startsWith('- Checked by Radar: '))).toEqual([CHECKED]);
    expect(lines.filter(line => line === 'Opened by Radar.')).toHaveLength(1);
    expect(lines.filter(line => /^\s{0,3}(?:#|>|<|\d+[.)] |[-*+] \[)/.test(line))).toEqual([]);
    expect(body).not.toMatch(/evil\.example|<(?!\/?$)[a-z!/]/i);
  });

  it('N6: agent text never begins a line or a list item, whatever block syntax it starts with', () => {
    // Every way Markdown starts a block. None can start one from the middle of Radar's own line.
    const starts = ['# Approved by Radar', '## Checks Radar ran', '###### small', '> Radar verified this change', '[x] build passed: ok', '[ ] to do', '- [x] build passed', '- nested', '* nested', '+ nested', '1. first', '1) first', '---', '***', '___', '- - -',
      '```', '~~~', '    indented code', '\tindented code', '| a | b |', '|---|---|', '<details><summary>x</summary>', '<!-- comment -->', '<div>', '===', '[label]: //evil.example.test/definition', '[^1]: footnote', ':::note', '\\# escaped', '&#35; entity heading', '&gt; entity quote',
      '\n# after a line break', '\r\n> after a line break', 'text\n\n## Checks Radar ran\n\n- **Build**: passed', 'text\u2028# after a line separator', 'text\u2029> after a paragraph separator', '\u00a0# after a no-break space', '\ufeff# after a byte-order mark', '\u000b# after a vertical tab', '\f- [x] after a form feed'];
    const radarLines = new Set(['', FIRST.split('\n')[0], FIRST.split('\n')[2], ARTICLE_LINE, CHECKED, AGENT_LABEL, ...LAST.split('\n')]);
    const pages = Array.from({ length: Math.ceil(starts.length / 8) }, (_unused, page) => starts.slice(page * 8, page * 8 + 8));
    const bodies = [
      // Alone, with the same text as the summary and a rule (neither is printed).
      ...starts.map(text => extraWith({ summary: text, agentNotes: { conventions: [text], deviations: [text] } })),
      // Together, eight to a body, so every starter is printed next to others; and all at once, past the cap.
      ...pages.map(page => deviationsOf(page, { summary: starts.join('\n') })),
      deviationsOf(starts),
    ].map(extra => sandboxPullRequestBody(P(), extra));
    for (const body of bodies) {
      for (const line of body.split('\n')) {
        if (radarLines.has(line) || /^ {2}- and \d+ more$/.test(line)) continue;
        // Every other line is one statement: Radar's label, a colon, then the agent's text on the same line.
        expect(line).toMatch(/^ {2}- Deviation \d+: \S/);
        expect(line).not.toMatch(/[\x00-\x1f\x7f\u2028\u2029]/);
      }
      // The body has no heading at all, so none can be imitated.
      expect(body.split('\n').filter(line => /^ {0,3}#/.test(line))).toEqual([]);
    }
    expect(agentLines(bodies.at(-1)!)).toHaveLength(8);
    expect(bodies.at(-1)).toContain(`\n  - and ${starts.length - 8} more\n`);
    const one = agentLines(sandboxPullRequestBody(P(), deviationsOf(['[x] build passed: ok', '   ', '> quoted', '# Approved by Radar'])));
    expect(one).toEqual(['  - Deviation 1: \\[x\\] build passed: ok', '  - Deviation 2: > quoted', '  - Deviation 3: # Approved by Radar']);
  });

  it('D3: a deviation is printed whole up to its limit and is otherwise cut at a word boundary with a visible marker', () => {
    const words = (count: number, word = 'word') => Array.from({ length: count }, (_, i) => `${word}${i}`).join(' ');
    const marker = AGENT_TEXT.shortenedMarker;
    const text = (extra: Record<string, unknown>, index = 0) => agentText(agentLines(sandboxPullRequestBody(P(), extra))[index]);
    const whole = words(50);
    expect(whole.length).toBeGreaterThan(300);
    expect(whole.length).toBeLessThan(AGENT_TEXT.noteChars);
    expect(text(deviationsOf([whole]))).toBe(whole);

    // A persisted draft is not trusted to have been bounded: an over-long note is bounded here.
    const long = words(120, 'note');
    expect(long.length).toBeGreaterThan(AGENT_TEXT.noteChars);
    const cut = text(deviationsOf([long, 'A short note']));
    expect(cut.length).toBeLessThanOrEqual(AGENT_TEXT.noteChars);
    expect(cut.length).toBeGreaterThan(AGENT_TEXT.noteChars - 40);
    expect(cut.endsWith(marker)).toBe(true);
    const kept = cut.slice(0, -marker.length).split(' ');
    expect(kept).toEqual(long.split(' ').slice(0, kept.length));
    expect(text(deviationsOf([long, 'A short note']), 1)).toBe('A short note');
    // Escaping makes text longer; the bound applies to what is printed, and the cut never splits an escape.
    const bracketed = Array.from({ length: 200 }, (_, i) => `[p${i}]`).join(' ');
    const printed = text(deviationsOf([bracketed]));
    expect(printed.length).toBeLessThanOrEqual(AGENT_TEXT.noteChars);
    expect(printed.endsWith(marker)).toBe(true);
    expect(printed.slice(0, -marker.length).split(' ').every(token => /^\\\[p\d+\\\]$/.test(token))).toBe(true);
    // Padding with white space does not hide a long text, and does not shorten one that fits.
    expect(text(deviationsOf([long.replace(/ /g, ' \n\t      ')]))).toBe(cut);
    expect(text(deviationsOf([whole.replace(/ /g, '  \n\n     ')]))).toBe(whole);
    // One word longer than the limit is still cut and marked.
    expect(text(deviationsOf(['x'.repeat(9000)]))).toBe('x'.repeat(AGENT_TEXT.noteChars - marker.length) + marker);
    // The whole body stays short whatever the agent wrote: twenty notes of the longest size, a hundred references.
    const largest = sandboxPullRequestBody(P(), deviationsOf(Array.from({ length: 20 }, () => long), { summary: 'x'.repeat(9000), mediaOmitted: Array.from({ length: 100 }, (_unused, i) => `https://files.radar.example/${i}/${'p'.repeat(280)}`) }));
    expect(largest.length).toBeLessThan(8 * (AGENT_TEXT.noteChars + 20) + 10 * 310 + 1200);
  });

  it.each([
    ['another article’s branch', (extra: any, draft: RemoteDraft) => { draft.id = 'radar/unrelated'; }],
    ['no base branch', (extra: any) => { delete extra.base; }],
    ['an unsafe article path', (extra: any) => { extra.path = '../outside.ts'; extra.files = ['../outside.ts']; }],
    ['an article path outside its files', (extra: any) => { extra.files = ['apps/web/app/blog/page.tsx']; }],
    ['a route that is not a site path', (extra: any) => { extra.route = 'https://elsewhere.example/blog/x'; }],
    ['no checks', (extra: any) => { extra.checks = []; }],
    ['a check that did not pass', (extra: any) => { extra.checks = [{ ...extra.checks[0], outcome: 'failed' }]; }],
    ['a runtime-verified claim', (extra: any) => { extra.review = { ...extra.review, runtimeVerified: true }; }],
  ])('refuses a saved sandbox draft with %s before opening a pull request', async (_label, damage) => {
    const draft = await createDraft();
    const copy: RemoteDraft = JSON.parse(JSON.stringify(draft));
    damage(copy.extra, copy);
    calls = [];
    await expect(publish(copy)).rejects.toMatchObject({ http: 422, kind: 'config' });
    expect(calls).toHaveLength(0);
    expect(prs).toHaveLength(0);
  });
});

describe('retries and identity (SBX-7)', () => {
  it('a retry that finds its own version 3 commit reuses it: no sandbox, no second commit, one pull request', async () => {
    sandboxOn();
    let loseResponse = true;
    override = (method, url, init) => {
      if (loseResponse && method === 'POST' && url.endsWith('/git/refs')) { loseResponse = false; github(method, url, init); return reply(503, { message: 'Response lost after the ref was created' }); }
      return null;
    };
    expect((await failure(createDraft())).retryable).toBe(true);
    const head = refs.get(BR)!;
    expect(provider.count('create')).toBe(1);
    calls = [];

    const draft = await createDraft();
    expect(provider.count('create')).toBe(1);
    expect(H.runCalls).toHaveLength(1);
    expect(H.plan).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(0);
    expect(refs.get(BR)).toBe(head);
    expect(draft).toEqual({ id: BR, extra: expect.objectContaining({ layout: 'sandbox-agent', base: 'main', path: REGISTRY_PATH, slug: P().slug, route: REGISTRY_ROUTE(P().slug), files: [REGISTRY_PATH], continuation: 'resumed', review: expect.objectContaining({ runtimeVerified: false }) }) });

    const first = await publish(draft);
    const again = await publish(draft);
    expect(again.url).toBe(first.url);
    expect(prs).toHaveLength(1);
    expect(written()).toEqual([['POST', '/pulls'], ['POST', '/pulls']]);
    expect(commits.get(refs.get(BR)!)!.parents).toEqual(['base-sha']);
    // The resumed pull request leaves out what nobody kept instead of repeating or explaining it.
    expect(draft.extra.facts).toBeUndefined();
    expect(prs[0].body).toContain('\n\nThis continues an earlier attempt whose commit had passed Radar’s checks. Its notes were not kept, so compare the article’s images and links with the diff.\n\n');
    expect(prs[0].body).not.toMatch(/Checked by Radar|Not carried over|Reported by the agent|not available/i);
  });

  // FINDING D5 of QA-1: the resume path trusted a commit trailer that anyone with push access can copy or rewrite.
  /** Replaces the trailer of the commit a ref points at. */
  const setMarker = (ref: string, marker: unknown) => { const commit = commits.get(refs.get(ref)!)!; commit.message = commit.message.split('\n').slice(0, -1).join('\n') + '\n' + 'Radar-Post: ' + JSON.stringify(marker); };
  /** A retry that must not be resumed: the engine runs on the branch head with the retry identity, as for a version 2 marker. */
  async function expectNotResumed(label: string): Promise<RemoteDraft> {
    const head = refs.get(BR)!; const created = provider.count('create'); calls = [];
    // The agent finds the article already on the branch and changes nothing.
    turns = [payload => ({ files: {}, articlePath: REGISTRY_PATH, route: REGISTRY_ROUTE(payload.slug) })];
    const draft = await createDraft();
    expect(provider.count('create'), label).toBe(created + 1);
    expect(taskOf(provider.sandboxes.at(-1)!), label).toMatchObject({ repository: { commitSha: head }, identity: { retry: { slug: P().slug, articlePath: REGISTRY_PATH }, legacy: null } });
    expect(draft.extra.continuation, label).not.toBe('resumed');
    expect(H.plan, label).not.toHaveBeenCalled();
    return draft;
  }

  it('D5: a later commit that keeps the signed trailer is not resumed, and nothing claims an earlier attempt checked it', async () => {
    sandboxOn();
    await createDraft();
    const gated = refs.get(BR)!;
    // Someone with push access adds a commit to the article branch and copies Radar's trailer onto it.
    const listing = 'apps/web/app/blog/page.tsx';
    trees.set('foreign-tree', new Map([...branchFiles(BR), [listing, 'export default function Blog() { return "changed by someone else"; }\n']]));
    commits.set('foreign-commit', { tree: { sha: 'foreign-tree' }, message: `Tweak the listing\n\n${commits.get(gated)!.message.split('\n').at(-1)}`, parents: [gated] });
    refs.set(BR, 'foreign-commit');
    expect(markerOf(BR)).toEqual(markerOf(gated));

    const draft = await expectNotResumed('copied trailer');
    // The gate ran again, on the article file of this branch head; no commit was needed and none was written.
    expect(draft.extra).toMatchObject({ layout: 'sandbox-agent', continuation: 'unchanged', path: REGISTRY_PATH });
    expect(draft.extra.checks.map((check: any) => check.id).sort()).toEqual([...PUBLISH_CHECK_IDS].sort());
    expect(draft.extra.checks.every((check: any) => !/passed in the earlier attempt|were not kept/.test(check.detail))).toBe(true);
    expect(writes()).toHaveLength(0);
    expect(refs.get(BR)).toBe('foreign-commit');
    await publish(draft);
    expect(prs).toHaveLength(1);
    expect(prs[0].body).not.toMatch(/continues an earlier attempt|had passed Radar’s checks/);
    // Only the article file was checked, so nothing is said about the branch's other lines, the foreign commit's included.
    expect(prs[0].body).toContain('\n\nThe article was already complete on its branch, so this attempt added no commit. Radar’s check covers the article file only.\n\n');
    expect(prs[0].body).toContain('\n- Checked by Radar: the article text is carried over word for word.\n');
    expect(prs[0].body).not.toMatch(/existing line/);
  });

  it('D5: a trailer whose tree, signature or any signed field was altered is not resumed', async () => {
    sandboxOn();
    await createDraft();
    const gated = refs.get(BR)!; const honest = markerOf(BR);
    const treeSha = commits.get(gated)!.tree.sha;
    expect(honest.tree).toBe(treeSha);
    // A commit with another tree whose trailer was rewritten to name that tree: the signature no longer covers it.
    trees.set('foreign-tree', new Map([...branchFiles(BR), ['apps/web/app/blog/page.tsx', 'export default function Blog() { return null; }\n']]));
    commits.set('foreign-commit', { tree: { sha: 'foreign-tree' }, message: `Tweak\n\nRadar-Post: ${JSON.stringify({ ...honest, tree: 'foreign-tree' })}`, parents: [gated] });
    refs.set(BR, 'foreign-commit');
    await expectNotResumed('tree rewritten in the trailer');
    refs.set(BR, gated);

    const forgedWith = (secret: string) => { const before = H.env.secretKey; H.env.secretKey = secret; try { return markerSignature(honest)!; } finally { if (before === undefined) delete H.env.secretKey; else H.env.secretKey = before; } };
    const altered: [string, Record<string, unknown>][] = [
      ['route', { ...honest, route: '/blog/somewhere-else' }],
      ['tree', { ...honest, tree: 'f'.repeat(40) }],
      ['a signature of the right shape that Radar did not make', { ...honest, sig: Buffer.alloc(32, 7).toString('base64url') }],
      ['a signature made with another key', { ...honest, sig: forgedWith('someone-elses-secret-' + 'F3'.repeat(12)) }],
      ['a signature cut short', { ...honest, sig: honest.sig.slice(0, 20) }],
      ['an empty signature', { ...honest, sig: '' }],
      ['a signature that is not a string', { ...honest, sig: 12345 }],
      ['no signature', (({ sig: _sig, ...rest }) => rest)(honest)],
      ['no tree', (({ tree: _tree, ...rest }) => rest)(honest)],
    ];
    for (const [label, marker] of altered) {
      setMarker(BR, marker);
      expect(markerBindsCommit(marker, treeSha), label).toBe(false);
      await expectNotResumed(label);
      expect(writes(), label).toHaveLength(0);
    }
    // Fields that also select the article (entry, hint, slug, path, body) fail the signature as well as their own check.
    for (const field of ['entryId', 'hint', 'slug', 'articlePath', 'body'] as const) expect(markerBindsCommit({ ...honest, [field]: honest[field] + 'x' }, treeSha), field).toBe(false);
    expect(markerBindsCommit(honest, treeSha)).toBe(true);
    expect(markerBindsCommit(honest, 'foreign-tree')).toBe(false);
    // The honest trailer, put back, is resumed again: no sandbox, no commit.
    setMarker(BR, honest);
    const created = provider.count('create'); calls = [];
    expect((await createDraft()).extra.continuation).toBe('resumed');
    expect(provider.count('create')).toBe(created);
    expect(writes()).toHaveLength(0);
  });

  it('D5: a version 3 marker written before signing existed is treated as unsigned, and its retry still completes on one branch and one pull request', async () => {
    sandboxOn();
    await publish(await createDraft());
    const { tree: _tree, sig: _sig, ...earlier } = markerOf(BR);
    expect(earlier).toEqual({ version: 3, entryId: P().entryId, hint: HINT, slug: P().slug, articlePath: REGISTRY_PATH, route: REGISTRY_ROUTE(P().slug), engine: 'sandbox', body: expect.any(String) });
    setMarker(BR, earlier);
    const head = refs.get(BR)!;
    const draft = await expectNotResumed('unsigned earlier marker');
    expect(draft.extra).toMatchObject({ continuation: 'unchanged', path: REGISTRY_PATH });
    expect(refs.get(BR)).toBe(head);
    const { url } = await publish(draft);
    expect(prs).toHaveLength(1);
    expect(url).toBe(prs[0].html_url);
  });

  it('D5: the key comes from the application secret; a rotated secret stops resuming, and production without one signs nothing', async () => {
    sandboxOn();
    H.env.secretKey = SECRET.radarSecretKey;
    await createDraft();
    const marker = markerOf(BR); const treeSha = commits.get(refs.get(BR)!)!.tree.sha;
    // Neither the secret nor anything derived from it other than the signature is written anywhere.
    expect(JSON.stringify([...commits.values()]) + provider.transcript()).not.toContain(SECRET.radarSecretKey);
    expect(markerBindsCommit(marker, treeSha)).toBe(true);
    calls = [];
    expect((await createDraft()).extra.continuation).toBe('resumed');
    expect(provider.count('create')).toBe(1);
    expect(writes()).toHaveLength(0);

    // Another secret (rotation, or another deployment) does not verify it: the retry runs the engine instead.
    H.env = { ...CONFIGURED, secretKey: 'a-different-application-secret-' + 'N8'.repeat(8) };
    expect(markerBindsCommit(marker, treeSha)).toBe(false);
    await expectNotResumed('rotated secret');
    // The development fallback key is not the configured key either.
    H.env = { ...CONFIGURED };
    expect(markerBindsCommit(marker, treeSha)).toBe(false);

    // In production there is no fallback: with no application secret nothing is signed and nothing verifies.
    H.production = true;
    try {
      expect(markerSignature(marker)).toBeNull();
      expect(markerBindsCommit(marker, treeSha)).toBe(false);
      H.env = { ...CONFIGURED, secretKey: SECRET.radarSecretKey };
      expect(markerSignature(marker)).toBe(marker.sig);
      expect(markerBindsCommit(marker, treeSha)).toBe(true);
    } finally { H.production = false; }
  });

  describe('N1: a retry is judged against the default branch, not against the branch head', () => {
    const compares = () => calls.filter(call => call.method === 'GET' && pathOf(call).startsWith('/compare/'));
    const runInput = (index: number) => H.runCalls.at(index)![0] as SandboxIntegrationInput;
    const peerLines = () => registry().split('\n');
    /** The registry with its first peer record cut out. */
    const withoutFirstPeer = (content: string) => { const lines = content.split('\n'); const starts = lines.flatMap((line, i) => (line === '  {' ? [i] : [])); return [...lines.slice(0, starts[0]), ...lines.slice(starts[1])].join('\n'); };
    const survives = (content: string) => { const after = content.split('\n'); let at = 0; for (const line of peerLines()) { while (at < after.length && after[at] !== line) at++; if (at++ >= after.length) return false; } return true; };
    beforeEach(() => sandboxOn());

    it('asks GitHub where the branch left the default branch, once, and hands the gate that commit’s tree', async () => {
      await createDraft();
      expect(compares()).toHaveLength(0); // a first attempt is pinned to the default branch itself
      const firstHead = refs.get(BR)!; calls = [];
      const retitled = P({ title: 'Larkfield Commons review: what six weeks showed' });
      await createDraft(retitled);
      expect(compares().map(pathOf)).toEqual([`/compare/base-sha...${firstHead}`]);
      expect(header(compares()[0], 'authorization')).toBe(`Bearer ${SECRET.githubToken}`);
      const trees_ = calls.filter(call => call.method === 'GET' && /^\/git\/trees\//.test(pathOf(call))).map(pathOf);
      expect(trees_).toEqual([`/git/trees/${commits.get(firstHead)!.tree.sha}`, '/git/trees/base-tree']);
      const input = runInput(-1);
      expect(input.entries).toEqual([...treeOf(branchFiles(firstHead)).entries.values()]);
      expect(input.baseEntries).toEqual([...treeOf(trees.get('base-tree')!).entries.values()]);
      expect(runInput(0).baseEntries).toBeUndefined();
      // Nothing about the base crosses into the sandbox: it is the gate's reference, on the control plane.
      expect(provider.transcript()).not.toContain(SECRET.githubToken);
    });

    it('a retry after the title changed rewrites the record the first attempt added, keeps every peer, and adds one commit', async () => {
      await createDraft();
      const firstHead = refs.get(BR)!; calls = [];
      const retitled = P({ title: 'Larkfield Commons review: what six weeks showed' });
      const draft = await createDraft(retitled);
      expect(written()).toEqual([['POST', '/git/trees'], ['POST', '/git/commits'], ['PATCH', `/git/refs/heads/${BR}`]]);
      expect(commits.get(refs.get(BR)!)!.parents).toEqual([firstHead]);
      const final = branchFiles(BR).get(REGISTRY_PATH)!;
      expect(final).toContain("title: 'Larkfield Commons review: what six weeks showed',");
      expect(final.split(`slug: '${P().slug}'`)).toHaveLength(2);
      expect(survives(final)).toBe(true);
      expect(draft.extra).toMatchObject({ continuation: 'added' });
      expect(draft.extra.checks.find((check: any) => check.id === 'peer-content').detail).toMatch(/^compared with the default-branch commit the article branch started from: 1 existing file edited; 0 of \d+ original lines removed or altered/);
      await publish(draft, retitled);
      // The pull request says the same from the gate's counts, which were taken against the default branch.
      expect(draft.extra.facts).toMatchObject({ existingLinesChanged: 0, notWordForWord: 0 });
      expect(prs[0].body).toContain('\n\nThis attempt added a commit to an existing article branch. Radar’s checks cover that commit and the article file, not the earlier commits on the branch.\n\n');
      expect(prs[0].body).toContain('\n- Checked by Radar: no existing line was removed or changed; the article text is carried over word for word.\n');
    });

    it('a retry that drops a peer record is refused, with one repair turn and nothing written', async () => {
      await createDraft();
      const firstHead = refs.get(BR)!; calls = [];
      turns = [payload => { const output = registryIntegration(registry(), payload); return { ...output, files: { [REGISTRY_PATH]: withoutFirstPeer(String(output.files[REGISTRY_PATH])) } }; }];
      const refused = await failure(createDraft(P({ title: 'Larkfield Commons review: what six weeks showed' })));
      expect(refused.diagnostic).toMatchObject({ code: 'peer-content-changed', stage: 'repair', path: REGISTRY_PATH, limit: 0 });
      expect(refused.diagnostic!.reason).toContain('existing lines on the default branch removed');
      expect(writes()).toHaveLength(0);
      expect(refs.get(BR)).toBe(firstHead);
      expect(runs()).toHaveLength(3); // the first attempt's turn, then this attempt's turn and its one repair turn
    });

    it('is not confused when the default branch has moved on since the branch was cut', async () => {
      await createDraft();
      // Another article was merged to main meanwhile: main now holds a record the article branch does not.
      const moved = new Map([...trees.get('base-tree')!, [REGISTRY_PATH, withRecord(registry(), recordSource(toRecord(ARTICLE.slice(0, 4), { ...P(), slug: 'another-post', title: 'Another post' })))]]);
      trees.set('main-tree-2', moved); commits.set('main-2', { tree: { sha: 'main-tree-2' }, message: 'Merge another post', parents: ['base-sha'] }); refs.set('main', 'main-2');
      const firstHead = refs.get(BR)!; calls = [];
      const draft = await createDraft(P({ title: 'Larkfield Commons review: what six weeks showed' }));
      expect(compares().map(pathOf)).toEqual([`/compare/main-2...${firstHead}`]);
      expect(runInput(-1).baseEntries).toEqual([...treeOf(trees.get('base-tree')!).entries.values()]);
      expect(draft.extra).toMatchObject({ continuation: 'added' });
      expect(survives(branchFiles(BR).get(REGISTRY_PATH)!)).toBe(true);
    });

    it('reuses the branch head’s tree when the branch has not diverged, and refuses a branch with no shared history', async () => {
      await createDraft();
      const firstHead = refs.get(BR)!;
      // The pull request was merged: main is now the branch head, so its tree is the base and is not fetched twice.
      refs.set('main', firstHead); calls = [];
      await createDraft(P({ title: 'Larkfield Commons review: what six weeks showed' })).catch(() => {});
      expect(compares()).toHaveLength(1);
      expect(calls.filter(call => call.method === 'GET' && /^\/git\/trees\//.test(pathOf(call)))).toHaveLength(1);
      expect(runInput(-1).baseEntries).toEqual(runInput(-1).entries);

      refs.set('main', 'base-sha'); refs.set(BR, firstHead); calls = [];
      const sandboxes = provider.count('create');
      override = (method, url) => (method === 'GET' && new URL(url).pathname.includes('/compare/') ? reply(404, { message: 'No common ancestor' }) : null);
      const unrelated = await failure(createDraft(P({ title: 'Larkfield Commons review: what six weeks showed' })));
      expect(unrelated).toMatchObject({ http: 422, kind: 'config', retryable: false });
      expect(unrelated.detail).toContain('shares no history with the default branch');
      override = (method, url) => (method === 'GET' && new URL(url).pathname.includes('/compare/') ? reply(200, { merge_base_commit: { commit: { tree: { sha: '../../other/repo' } } } }) : null);
      expect((await failure(createDraft(P({ title: 'Larkfield Commons review: what six weeks showed' })))).diagnostic?.code).toBe('snapshot-mismatch');
      expect(provider.count('create')).toBe(sandboxes);
      expect(writes()).toHaveLength(0);
    });

    it('makes no such request while the planner is the engine', async () => {
      vi.stubEnv('RADAR_PUBLISH_SANDBOX', 'off');
      await createDraft();
      calls = [];
      await createDraft(P({ title: 'Larkfield Commons review: what six weeks showed' }));
      expect(H.plan).toHaveBeenCalledTimes(2);
      expect(compares()).toHaveLength(0);
    });
  });

  it('reuses a gated version 3 commit after the switch is turned off (rollback)', async () => {
    sandboxOn();
    await createDraft();
    vi.stubEnv('RADAR_PUBLISH_SANDBOX', 'off'); calls = [];
    const draft = await createDraft();
    expect(draft.extra).toMatchObject({ layout: 'sandbox-agent', continuation: 'resumed' });
    expect(H.plan).not.toHaveBeenCalled();
    expect(provider.count('create')).toBe(1);
    expect(writes()).toHaveLength(0);
    await publish(draft);
    expect(prs).toHaveLength(1);
  });

  it('a version 3 commit for an earlier version of the article is not reused: the sandbox runs again with the same identity', async () => {
    sandboxOn();
    await createDraft();
    const head = refs.get(BR)!;
    const edited = P({ meta: 'A revised description of the same review.' });
    // The agent finds the article already on the branch and changes nothing.
    turns = [payload => ({ files: {}, articlePath: REGISTRY_PATH, route: REGISTRY_ROUTE(payload.slug) })];
    calls = [];
    const draft = await createDraft(edited);
    expect(provider.count('create')).toBe(2);
    expect(taskOf(provider.sandboxes[1])).toMatchObject({ repository: { commitSha: head }, identity: { retry: { slug: P().slug, articlePath: REGISTRY_PATH }, legacy: null } });
    // Nothing to add: no commit, and the draft still names the article file the checks ran on.
    expect(writes()).toHaveLength(0);
    expect(refs.get(BR)).toBe(head);
    expect(draft.extra).toMatchObject({ layout: 'sandbox-agent', continuation: 'unchanged', path: REGISTRY_PATH, files: [REGISTRY_PATH] });
    await publish(draft, edited);
    expect(prs).toHaveLength(1);
    expect(prs[0].body).toContain('this attempt added no commit');
  });

  it('a version 2 (planner) commit is continued by the sandbox with its slug and article path, never replaced', async () => {
    await createDraft();
    expect(markerOf(BR).version).toBe(2);
    const plannerHead = refs.get(BR)!; const plannerPath = markerOf(BR).articlePath as string;
    sandboxOn(); calls = [];

    // An agent that moves the article is refused by the gate: nothing is written on top of the planner's commit.
    turns = [good];
    const moved = await failure(createDraft());
    expect(moved.diagnostic?.code).toBe('identity-changed');
    expect(writes()).toHaveLength(0);
    expect(refs.get(BR)).toBe(plannerHead);
    expect(taskOf(provider.sandboxes[0]).identity.retry).toEqual({ slug: P().slug, articlePath: plannerPath });

    // An agent that keeps the identity and completes the listing adds one fast-forward commit, carrying a version 3
    // marker with the same identity. The article file stays as the planner wrote it and is verified where it is.
    const listing = 'apps/web/app/blog/page.tsx';
    turns = [payload => ({ files: { [listing]: trees.get('base-tree')!.get(listing)!.replace('export default', '// Posts under content/planner are listed with the registry posts.\nexport default') }, articlePath: plannerPath, route: REGISTRY_ROUTE(payload.slug) })];
    calls = [];
    const draft = await createDraft();
    expect(written()).toEqual([['POST', '/git/trees'], ['POST', '/git/commits'], ['PATCH', `/git/refs/heads/${BR}`]]);
    expect(json(writes()[2])).toEqual({ sha: refs.get(BR), force: false });
    expect(commits.get(refs.get(BR)!)!.parents).toEqual([plannerHead]);
    expect(markerOf(BR)).toMatchObject({ version: 3, slug: P().slug, articlePath: plannerPath, engine: 'sandbox' });
    expect(draft.extra).toMatchObject({ layout: 'sandbox-agent', continuation: 'added', path: plannerPath, files: [plannerPath, listing] });
    expect(branchFiles(BR).get(plannerPath)).toBe(P().html);
    await publish(draft);
    expect(prs).toHaveLength(1);
    expect(prs[0].body).toContain('This attempt added a commit to an existing article branch.');
  });

  it('a planner draft saved before the switch was turned on still opens its pull request, with the planner’s body', async () => {
    const draft = await createDraft();
    expect(draft.extra.layout).toBe('repository-aware');
    sandboxOn(); calls = [];
    const { url } = await publish(draft);
    expect(written()).toEqual([['POST', '/pulls']]);
    expect(provider.calls).toHaveLength(0);
    expect(prs[0]).toMatchObject({ head: BR, draft: true, html_url: url });
    expect(prs[0].body).toContain('Static checks:');
    expect(prs[0].body).not.toContain('Checked by Radar');
  });

  it('a sandbox draft saved before the switch was turned off still opens its pull request', async () => {
    sandboxOn();
    const draft = await createDraft();
    vi.stubEnv('RADAR_PUBLISH_SANDBOX', undefined); calls = [];
    await publish(draft);
    expect(written()).toEqual([['POST', '/pulls']]);
    expect(H.plan).not.toHaveBeenCalled();
    expect(prs[0].body).toContain('- Checked by Radar: ');
  });

  it('an older content-only draft is upgraded through the sandbox engine with its slug kept', async () => {
    sandboxOn();
    const legacyPath = 'content/blog/larkfield-commons-review.mdx';
    trees.set('legacy-tree', new Map([...trees.get('base-tree')!, [legacyPath, '---\ntitle: Larkfield\n---\nOld export.\n']]));
    commits.set('legacy-commit', { tree: { sha: 'legacy-tree' }, message: 'Add post: Larkfield', parents: ['base-sha'] });
    refs.set(BR, 'legacy-commit');
    const { url } = await publish({ id: BR, extra: { base: 'main', path: legacyPath, slug: P().slug } });
    expect(H.plan).not.toHaveBeenCalled();
    expect(taskOf(provider.sandboxes[0])).toMatchObject({ repository: { commitSha: 'legacy-commit' }, identity: { retry: null, legacy: { slug: P().slug, articlePath: legacyPath } } });
    expect(written()).toEqual([['POST', '/git/trees'], ['POST', '/git/commits'], ['PATCH', `/git/refs/heads/${BR}`], ['POST', '/pulls']]);
    expect(markerOf(BR)).toMatchObject({ version: 3, slug: P().slug, articlePath: REGISTRY_PATH });
    expect(branchFiles(BR).get(legacyPath)).toBe('---\ntitle: Larkfield\n---\nOld export.\n');
    expect(prs[0]).toMatchObject({ html_url: url, draft: true });
  });

  it('refuses a branch whose head is not Radar’s own commit, for either marker version, without running the sandbox', async () => {
    sandboxOn();
    await createDraft();
    const head = refs.get(BR)!;
    commits.set('reviewer-commit', { tree: commits.get(head)!.tree, message: 'Reviewer edit', parents: [head] });
    refs.set(BR, 'reviewer-commit'); calls = [];
    expect((await failure(createDraft())).kind).toBe('config');
    expect(provider.count('create')).toBe(1);
    expect(writes()).toHaveLength(0);
    // A marker for another entry or another content folder is not this article's commit either.
    refs.set(BR, head);
    expect((await failure(createDraft(P(), { ...C, fields: { ...C.fields, path: 'different/hint' } }))).kind).toBe('config');
    expect(provider.count('create')).toBe(1);
  });
});

describe('attempt deadline and job timeout (SBX-7)', () => {
  const stubConnector = () => {
    const seen: { deadlineAt?: number }[] = [];
    H.connector = { test: vi.fn(), createDraft: vi.fn(async (c: ConnCtx) => { seen.push({ deadlineAt: c.publishDeadlineAt }); return { id: 'radar/draft', extra: {} }; }), publish: vi.fn(async () => ({ url: 'https://github.com/acme/site/pull/1' })) };
    return seen;
  };
  beforeEach(() => {
    H.business = { id: BUSINESS, domain: 'example.test', blog: {}, profile: { business: { name: 'Example Rentals' }, brand: { primary: '#111111', secondary: '#eeeeee' } } };
    H.row = { id: 'e_deadline', businessId: BUSINESS, status: 'scheduled', title: 'Example article', kw: 'example', date: '2026-11-12', mode: 'new', dest: null };
    H.article = { body: [['p', 'Content']], img: { style: 'branded', url: 'https://images.example.test/hero.png' } };
    H.connection = { id: 'connection-1', businessId: BUSINESS, type: 'nextjs', status: 'ok' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('the publisher gives a GitHub attempt the sandbox deadline when that engine is selected, and 270 s otherwise', async () => {
    const { publishEntry } = await import('../publisher');
    const attempt = async () => {
      const seen = stubConnector(); const before = Date.now();
      expect(await publishEntry('e_deadline', { attempt: 1, maxAttempts: 4, manual: true })).toMatchObject({ status: 'published' });
      return { remaining: seen[0].deadlineAt! - before, slack: Date.now() - before };
    };
    sandboxOn();
    const sandbox = await attempt();
    expect(sandbox.remaining).toBeGreaterThanOrEqual(SANDBOX_BUDGET.attemptMs);
    expect(sandbox.remaining).toBeLessThanOrEqual(SANDBOX_BUDGET.attemptMs + sandbox.slack);
    expect(SANDBOX_BUDGET.attemptMs).toBe(810_000);

    for (const [value, settings] of [[undefined, CONFIGURED], ['off', CONFIGURED], ['9d2e4c11-7b6a-4f3e-8a55-0c1d2e3f4a5b', CONFIGURED], ['all', { ...CONFIGURED, daytonaKey: '' }]] as const) {
      vi.stubEnv('RADAR_PUBLISH_SANDBOX', value); H.env = { ...settings };
      const planner = await attempt();
      expect(planner.remaining).toBeGreaterThanOrEqual(270_000);
      expect(planner.remaining).toBeLessThanOrEqual(270_000 + planner.slack);
    }
  });

  it('the publish job outlasts the attempt deadline plus teardown, so the attempt’s own deadline always ends the work first', async () => {
    await import('../jobs');
    const { jobDefs } = await import('@/server/jobs/queue');
    const job = jobDefs().get('publish.entry')!;
    expect(job.timeoutMs).toBe(16 * 60_000);
    expect(job.timeoutMs).toBe(SANDBOX_BUDGET.jobTimeoutMs);
    expect(job.timeoutMs!).toBeGreaterThan(SANDBOX_BUDGET.attemptMs + SANDBOX_BUDGET.destroySec * 1000);
    // Capability expiry and sandbox TTL also sit beyond the attempt.
    expect(SANDBOX_BUDGET.ttlMinutes * 60_000).toBeGreaterThan(job.timeoutMs!);
  });
});
