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
  env: {} as Record<string, string>,
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
// src/server/env.ts freezes its values at import; the four sandbox settings are read from H.env instead.
vi.mock('@/server/env', async importOriginal => {
  const real = await importOriginal<typeof import('@/server/env')>();
  const env = { ...real.env };
  for (const key of ['daytonaKey', 'publishSandboxSnapshotId', 'publishModelProxyUrl', 'publishCapabilitySecret']) Object.defineProperty(env, key, { enumerable: true, get: () => H.env[key] ?? '' });
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
import { branchOf, nextjs, publishAttemptMs } from './nextjs';
import { FakeSandboxProvider, type FakeExecCall, type FakeSandbox } from '../sandbox/fake';
import { SANDBOX_COMMANDS } from '../sandbox/run';
import { PUBLISH_CHECK_IDS, RUNNER_COMMANDS, SANDBOX_BUDGET, SANDBOX_NOT_RUN, SANDBOX_OPERATIONS, SANDBOX_PATHS, type AgentReport, type RunnerResult, type SandboxExecResult } from '../sandbox/types';
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
  H.provider = provider; H.providerKeys = []; H.runCalls = []; H.env = {};
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
    expect(markerOf(BR)).toEqual({ version: 3, entryId: P().entryId, hint: HINT, slug: P().slug, articlePath: REGISTRY_PATH, route: REGISTRY_ROUTE(P().slug), engine: 'sandbox', body: expect.stringMatching(/^[0-9a-f]{16}$/) });

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

  it('lists only Radar’s checks as run, however the agent describes its own work', async () => {
    turns = [payload => ({ ...registryIntegration(registry(), payload), report: {
      summary: 'Added the record. I ran `npm run build` and the build passed; lint and tests passed too. cc @acme/owners',
      conventions: [{ path: 'package.json', rule: 'npm run build completed successfully' }],
      deviations: [{ kind: 'media-omitted', detail: 'BlogSection has no image field, so the body image was left out' }],
    } })];
    const draft = await createDraft();
    expect(draft.extra.review.runtimeVerified).toBe(false);
    await publish(draft);
    const body = prs[0].body;
    const section = (title: string) => body.split(/\n### /).find(part => part.startsWith(title))!;
    const ran = section('Checks Radar ran');
    // Exactly the control-plane checks, each with the gate's own detail.
    expect(ran.split('\n').filter(line => line.startsWith('- ')).map(line => /^- \*\*(.+?)\*\*: /.exec(line)![1])).toEqual(['Protected paths', 'Credential scan', 'Size and count limits', 'Regular files only', 'Syntax', 'Existing content preserved', 'Article fidelity', 'Article identity']);
    for (const check of draft.extra.checks) expect(ran).toContain(check.detail);
    expect(ran).not.toMatch(/build|lint|tests? passed|npm/i);
    // The peer-content count is disclosed: no original line of the registry was removed or altered.
    expect(ran).toMatch(/Existing content preserved\*\*: 1 existing file edited; 0 of \d+ original lines removed or altered/);
    // The agent's claim is printed, under the unverified heading only, and cannot mention anyone.
    const agent = section('What the agent reported (not verified by Radar)');
    expect(agent).toContain('Radar did not verify them and none of them is a check that ran.');
    expect(agent).toContain('the build passed');
    expect(agent).toContain('`@acme/owners`');
    expect(body.split('the build passed')).toHaveLength(2);
    // Media and links the typed registry cannot carry are disclosed, with the fixed not-run list.
    const omitted = section('Media and links not carried over');
    for (const reference of draft.extra.mediaOmitted) expect(omitted).toContain('`' + reference + '`');
    expect(draft.extra.mediaOmitted.length).toBeGreaterThan(0);
    expect(section('Not run').split('\n').filter(line => line.startsWith('- '))).toEqual(SANDBOX_NOT_RUN.map(item => `- ${item}`));
    expect(body).toContain('Radar did not install dependencies, build, lint, test or preview this repository');
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
    } };
    // A persisted entry outside the fixed check list fails validation rather than being printed as a check.
    await expect(publish(draft, payload)).rejects.toMatchObject({ http: 422, kind: 'config' });
    draft.extra.checks.pop();
    await publish(draft, payload);
    expect(prs[0].body).toMatchInlineSnapshot(`
      "An independent six-week review of Larkfield Commons covering rent, fees, noise and transport.

      **Draft for review.** The article is not live. Radar did not install dependencies, build, lint, test or preview this repository, so nothing below is a build or runtime result.

      Scheduled for 2026-11-12. Article file: \`apps/web/app/blog/posts.ts\`. Public route reported by the agent: \`/blog/larkfield-commons-review\` (not checked against a running site).

      ### Checks Radar ran

      Radar ran these itself, on the exact file contents it committed. All of them passed; a failed check stops publishing before any commit is written.

      - **Protected paths**: 1 candidate path passes the repository write rules, with no duplicate or nested path
      - **Existing content preserved**: 1 existing file edited; 0 of 2528 original lines removed or altered (at most 24 in all), 96 lines added
      - **Article fidelity**: 23 of 23 paragraphs and list items present; 9 of 9 headings present; 3 media or link references not carried

      ### What the agent reported (not verified by Radar)

      An AI agent made this change in an isolated sandbox with file tools only. It could not run anything. The statements below are its own; Radar did not verify them and none of them is a check that ran.

      Summary: Added the article as one record at the end of the posts registry. The build passed.

      Repository rules it says it followed:
      - apps/web/app/blog/posts.ts: records use single-quoted strings and trailing commas

      Deviations it reported:
      - media-omitted: BlogSection has no image field

      ### Media and links not carried over

      Radar did not find these 2 references from the article (image addresses, video ids, source and link addresses) in the changed files. The site’s content format may not be able to carry them:

      - \`https://files.radar.example/b_demo/body/costs-chart.png\`
      - \`Qm3xT7kLp9A\`

      ### Not run

      Neither Radar nor the agent ran any of these:

      - dependency installation
      - repository build
      - lint
      - tests
      - deployment preview

      ### Files

      - \`apps/web/app/blog/posts.ts\`

      Before marking this pull request ready: run the repository’s build and CI checks and use its deployment preview to verify the article route, blog listing and navigation.

      Opened by Radar."
    `);
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
    // The resumed pull request says what it does not know instead of repeating details nobody kept.
    expect(prs[0].body).toContain('No agent ran this time.');
    expect(prs[0].body).toContain('Not available: the agent’s statements from the earlier attempt were not kept.');
    expect(prs[0].body).toContain('Not available for this pull request. Compare the article’s images, videos and links with the diff.');
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
    expect(prs[0].body).toContain('wrote no new commit');
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
    expect(prs[0].body).not.toContain('### Checks Radar ran');
  });

  it('a sandbox draft saved before the switch was turned off still opens its pull request', async () => {
    sandboxOn();
    const draft = await createDraft();
    vi.stubEnv('RADAR_PUBLISH_SANDBOX', undefined); calls = [];
    await publish(draft);
    expect(written()).toEqual([['POST', '/pulls']]);
    expect(H.plan).not.toHaveBeenCalled();
    expect(prs[0].body).toContain('### Checks Radar ran');
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
