import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '@/lib/types';
import type { PublishPayload } from '../types';
import { PublishError } from '../http';
import { FakeSandboxProvider, type FakeCall, type FakeExecCall, type FakeSandbox, type FakeSandboxOptions } from './fake';
import { classifyAgentError, integrateWithSandbox, RUNNER_MANIFEST, SANDBOX_COMMANDS, SANDBOX_ENV, type SandboxRunDependencies } from './run';
import {
  RUNNER_COMMANDS, RUNNER_SCRIPTS, SANDBOX_DIAGNOSTIC_CODES, SANDBOX_NOT_RUN, SANDBOX_PATHS,
  type AgentReport, type ArticleUnit, type PublicationGateInput, type PublicationGateResult, type RunnerResult, type SandboxExecResult,
  type SandboxIntegrationInput, type SandboxProvider, type SandboxPublisherConfig,
} from './types';

// No network, no Daytona, no model: the provider is fake.ts and the gate, capability and unit functions are injected.
// Every value below is a placeholder made for this test; none is a real credential, host or snapshot.
const T0 = Date.UTC(2026, 10, 12, 9, 0, 0);
const ATTEMPT_MS = 810_000;
const SECRET = {
  githubToken: 'ghp_' + 'G7'.repeat(18),
  daytonaKey: 'dtn_placeholder_' + 'D4'.repeat(14),
  capabilitySecret: 'capability-secret-' + 'S9'.repeat(16),
  anthropicKey: 'sk-ant-placeholder-' + 'A1'.repeat(16),
  openRouterKey: 'sk-or-placeholder-' + 'R2'.repeat(16),
  openAiKey: 'sk-proj-placeholder-' + 'O3'.repeat(16),
  databaseUrl: 'postgres://radar:database-password-Q8@db.example.test:5432/radar',
  radarSecretKey: 'radar-secret-key-' + 'K5'.repeat(16),
};
const CAPABILITY = `rdrcap1.${'c'.repeat(64)}.${'s'.repeat(43)}`;
const RUN_ID = '5b0c7f0e-3a51-4c0e-9d1f-2f6a8f1f4b10';
const PROXY = 'https://model-proxy.example.test/model';
const ARTICLE_PATH = 'content/posts/a-title.mdx';
const ARTICLE_BODY = '---\ntitle: A title\n---\n\n## Why it matters\n\nA first paragraph of the article.\n';
const RUN = RUNNER_COMMANDS.run;

const config = (over: Partial<SandboxPublisherConfig> = {}): SandboxPublisherConfig => ({
  enabled: true, daytonaKey: SECRET.daytonaKey, snapshotId: '0f8fad5b-d9cb-469f-a165-70867728950e', proxyUrl: new URL(PROXY), capabilitySecret: SECRET.capabilitySecret,
  model: { catalogueId: 'claude-opus-5.5', apiId: 'claude-opus-5-5' }, maxUsd: 6, maxCalls: 200, attemptMs: 810_000, transcriptDir: null, ...over,
});
const BLOCKS: Block[] = [['h2', 'Why it matters'], ['p', 'A first paragraph of the article.']];
const payload: PublishPayload = {
  entryId: 'e_test', title: 'A title', slug: 'a-title', html: '<h2>Why it matters</h2><p>A first paragraph of the article.</p>', markdown: '## Why it matters\n\nA first paragraph of the article.\n',
  blocks: BLOCKS, meta: 'A description', keyword: 'a keyword', date: '2026-11-12', image: null, canonical: null, mode: 'new', refreshUrl: null, sources: [], videos: [], author: 'An Author',
};
const units = (blocks: Block[]): ArticleUnit[] => blocks.map((block, index) => ({ index, kind: block[0] === 'p' ? 'paragraph' : 'heading', text: String(block[1]) }));
const SCRIPTS = RUNNER_SCRIPTS.map(name => ({ name, data: Buffer.from(`// trusted ${name}\n`) }));

const goodResult = (over: Partial<RunnerResult> = {}): RunnerResult => ({ version: 1, status: 'completed', agentError: null, sessionId: 'session-1', turns: 12, changed: [{ path: ARTICLE_PATH, bytes: ARTICLE_BODY.length }], ...over });
const goodReport = (over: Partial<AgentReport> = {}): AgentReport => ({
  version: 1, status: 'integrated', slug: 'a-title', articlePath: ARTICLE_PATH, route: '/blog/a-title', summary: 'Added the post under `content/posts` like its peers.',
  evidence: [{ role: 'content', path: 'content/posts/existing.mdx', note: 'peer post' }], conventions: [{ path: 'scripts/seo-audit.mjs', rule: 'No em dashes in body text' }],
  deviations: [{ kind: 'media-omitted', detail: 'The format has no inline images' }], reason: null, ...over,
});
/** What a runner turn leaves in the sandbox. `null` leaves that output out. */
interface Outputs { result?: unknown; report?: unknown; files?: Record<string, string | Buffer>; exit?: SandboxExecResult }
function leave(sandbox: FakeSandbox, outputs: Outputs = {}): SandboxExecResult | void {
  const put = (file: string, value: unknown) => { if (value === null) sandbox.files.delete(file); else sandbox.files.set(file, Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))); };
  put(SANDBOX_PATHS.result, outputs.result === undefined ? goodResult() : outputs.result);
  put(SANDBOX_PATHS.report, outputs.report === undefined ? goodReport() : outputs.report);
  for (const [file, content] of Object.entries(outputs.files ?? { [ARTICLE_PATH]: ARTICLE_BODY })) put(`${SANDBOX_PATHS.repo}/${file}`, content);
  return outputs.exit;
}
type Turn = (sandbox: FakeSandbox, call: FakeExecCall) => SandboxExecResult | void;
interface Script { verify?: SandboxExecResult; probe?: SandboxExecResult; makeInput?: SandboxExecResult; prepare?: SandboxExecResult | (() => SandboxExecResult | void); find?: SandboxExecResult; turns?: Turn[] }
/** Stands in for everything that executes in the sandbox. The integrity check really compares the uploaded manifest. */
function runner(script: Script = {}) {
  let turn = 0;
  return (call: FakeExecCall, sandbox: FakeSandbox): SandboxExecResult | void => {
    switch (call.command) {
      case SANDBOX_COMMANDS.verifyRunner: {
        if (script.verify) return script.verify;
        const lines = (sandbox.files.get(`${call.cwd}/${RUNNER_MANIFEST}`)?.toString() ?? '').split('\n').filter(Boolean);
        const intact = lines.length === RUNNER_SCRIPTS.length && lines.every(line => {
          const [digest, name] = line.split('  ');
          const file = sandbox.files.get(`${call.cwd}/${name}`);
          return !!file && createHash('sha256').update(file).digest('hex') === digest;
        });
        return { exitCode: intact ? 0 : 1, output: intact ? '' : 'sha256sum: WARNING: 1 computed checksum did NOT match' };
      }
      case RUNNER_COMMANDS.probe: return script.probe;
      case SANDBOX_COMMANDS.makeInput: return script.makeInput;
      case RUNNER_COMMANDS.prepare: return typeof script.prepare === 'function' ? script.prepare() : script.prepare;
      case SANDBOX_COMMANDS.findNonRegular: return script.find;
      case RUN: return (script.turns?.[turn++] ?? (box => leave(box)))(sandbox, call);
      default: return { exitCode: 127, output: 'unexpected command' };
    }
  };
}

const passingGate = (input: PublicationGateInput): PublicationGateResult => ({
  files: [...input.finals].map(([file, bytes]) => ({ path: file, content: bytes.toString('utf8') })),
  checks: [{ id: 'paths', outcome: 'passed', detail: '1 changed file' }, { id: 'article-fidelity', outcome: 'passed', detail: '2 of 2 units present' }],
  mediaOmitted: [], unchanged: false,
});
const gateFailure = (code: string, extra: Record<string, unknown> = {}) => new PublishError(422, `gate refused: ${code}`, '', 'config', { code, stage: 'validation', reason: `gate refused: ${code}`, ...extra });

interface Setup { script?: Script; fake?: Omit<FakeSandboxOptions, 'exec'>; deadlineAt?: number; config?: Partial<SandboxPublisherConfig>; options?: Record<string, unknown>; provider?: (fake: FakeSandboxProvider) => SandboxProvider }
function setup(given: Setup = {}) {
  const provider = new FakeSandboxProvider({ exec: runner(given.script), ...given.fake });
  const deps = {
    gate: vi.fn(async (input: PublicationGateInput) => passingGate(input)),
    mintCapability: vi.fn(() => CAPABILITY),
    articleUnits: vi.fn(units),
    readRunnerScripts: vi.fn(async () => SCRIPTS),
    report: vi.fn(async () => {}),
    newRunId: () => RUN_ID,
    log: vi.fn(),
  } satisfies SandboxRunDependencies;
  const deadlineAt = given.deadlineAt ?? T0 + ATTEMPT_MS;
  // The token lives only in this closure, as it does in the connector.
  const token = SECRET.githubToken;
  const fetchArchive = vi.fn(async (_signal: AbortSignal) => {
    const headers = { authorization: `Bearer ${token}` }; void headers;
    return { stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Buffer.from('PINNED-ARCHIVE-BYTES')); controller.close(); } }) };
  });
  const readBlob = vi.fn(async () => Buffer.from('blob'));
  const input: SandboxIntegrationInput = {
    config: config(given.config), hint: 'content/posts', payload, repo: 'acme/site', commitSha: 'a'.repeat(40),
    entries: [{ path: 'content/posts/existing.mdx', type: 'blob', sha: 'b'.repeat(40), mode: '100644', size: 120 }],
    fetchArchive, readBlob, options: { businessId: 'biz_1', deadlineAt, ...given.options }, provider: given.provider ? given.provider(provider) : provider,
  };
  const start = () => integrateWithSandbox(input, deps);
  const outcome = () => start().then(value => ({ value, error: undefined }), (error: any) => ({ value: undefined, error }));
  return { provider, deps, input, deadlineAt, fetchArchive, readBlob, start, outcome };
}
/** Lets real file I/O and microtasks run without moving the fake clock. */
async function reached(predicate: () => boolean) {
  for (let turn = 0; turn < 20_000 && !predicate(); turn++) await new Promise(resolve => setImmediate(resolve));
  expect(predicate()).toBe(true);
}
const isRun = (call: FakeCall) => call.op === 'exec' && call.command === RUN;
const failOn = (matches: (call: FakeCall) => boolean, error: unknown = new Error('provider request failed')) => (call: FakeCall) => (matches(call) ? error : undefined);
const destroys = (provider: FakeSandboxProvider) => provider.count('destroy');
const contentUploads = (provider: FakeSandboxProvider) => provider.calls.filter(call => call.op === 'uploadFile' || (call.op === 'upload' && call.files.some(file => !file.path.startsWith(`${SANDBOX_PATHS.runnerDir}/`))));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: T0 });
  // What the worker process holds. None of it may cross the provider boundary.
  vi.stubEnv('ANTHROPIC_API_KEY', SECRET.anthropicKey);
  vi.stubEnv('OPEN_ROUTER_API_KEY', SECRET.openRouterKey);
  vi.stubEnv('OPENAI_API_KEY', SECRET.openAiKey);
  vi.stubEnv('DATABASE_URL', SECRET.databaseUrl);
  vi.stubEnv('RADAR_SECRET_KEY', SECRET.radarSecretKey);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('a successful run', () => {
  it('makes exactly these provider calls, in this order', async () => {
    const { provider, start } = setup();
    await start();
    expect(provider.ops()).toEqual([
      'destroyMatching',
      'create',
      `upload:${[...RUNNER_SCRIPTS, RUNNER_MANIFEST].map(name => `/opt/radar-agent/${name}`).join(',')}`,
      'exec:sha256sum --check .radar-runner.sha256',
      'exec:node /opt/radar-agent/probe.mjs',
      'exec:mkdir -p /workspace/input',
      'uploadFile:/workspace/input/repo.tar.gz',
      'upload:/workspace/input/article.md,/workspace/input/article.html,/workspace/input/article.json',
      'exec:node /opt/radar-agent/prepare.mjs',
      'upload:/workspace/input/task.json',
      'exec:node /opt/radar-agent/run.mjs',
      'stat:/output/result.json',
      'download:/output/result.json',
      'stat:/output/report.json',
      'download:/output/report.json',
      'exec:find /workspace/repo ! -type f ! -type d -print -quit',
      `stat:/workspace/repo/${ARTICLE_PATH}`,
      `download:/workspace/repo/${ARTICLE_PATH}`,
      'destroy',
    ]);
  });

  it('deletes leftovers for the entry, then creates one sandbox whose only egress is the proxy host', async () => {
    const { provider, start } = setup();
    await start();
    expect(provider.calls[0]).toEqual({ op: 'destroyMatching', labels: { workload: 'radar-publisher', env: 'development', entry: 'e_test' }, timeoutSec: 30 });
    expect(provider.calls[1]).toEqual({ op: 'create', spec: {
      snapshotId: '0f8fad5b-d9cb-469f-a165-70867728950e', allowDomain: 'model-proxy.example.test', ttlMinutes: 30,
      labels: { workload: 'radar-publisher', env: 'development', entry: 'e_test', run: RUN_ID }, env: { ...SANDBOX_ENV }, timeoutSec: 120,
    } });
    expect(provider.count('create')).toBe(1);
  });

  it('uploads the pinned archive bytes, the article and the task, and nothing else, as content', async () => {
    const { provider, start, fetchArchive } = setup();
    await start();
    const box = provider.sandboxes[0];
    expect(fetchArchive).toHaveBeenCalledOnce();
    expect(box.files.get(SANDBOX_PATHS.archive)?.toString()).toBe('PINNED-ARCHIVE-BYTES');
    expect(box.files.get(SANDBOX_PATHS.articleMarkdown)?.toString()).toBe(payload.markdown);
    expect(box.files.get(SANDBOX_PATHS.articleHtml)?.toString()).toBe(payload.html);
    expect(JSON.parse(box.files.get(SANDBOX_PATHS.articleJson)!.toString())).toEqual({ blocks: BLOCKS, units: units(BLOCKS) });
    expect(JSON.parse(box.files.get(SANDBOX_PATHS.task)!.toString())).toMatchObject({ version: 1, runId: RUN_ID, mode: 'new', hint: 'content/posts', repository: { fullName: 'acme/site', commitSha: 'a'.repeat(40) }, identity: { retry: null, legacy: null } });
    expect(contentUploads(provider).flatMap(call => call.op === 'upload' ? call.files.map(file => file.path) : call.op === 'uploadFile' ? [call.remotePath] : [])).toEqual([
      SANDBOX_PATHS.archive, SANDBOX_PATHS.articleMarkdown, SANDBOX_PATHS.articleHtml, SANDBOX_PATHS.articleJson, SANDBOX_PATHS.task,
    ]);
  });

  it('removes the temporary archive from the worker once it is uploaded', async () => {
    const { provider, start } = setup();
    await start();
    const upload = provider.calls.find(call => call.op === 'uploadFile') as Extract<FakeCall, { op: 'uploadFile' }>;
    await expect(readFile(upload.localPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('hands the gate the parsed outputs and the bytes it downloaded, and returns what the gate verified', async () => {
    const { deps, input, start } = setup({ options: { retry: { slug: 'a-title', articlePath: ARTICLE_PATH } } });
    const integration = await start();
    expect(deps.gate).toHaveBeenCalledOnce();
    const given = deps.gate.mock.calls[0][0];
    expect(given.payload).toBe(payload);
    expect(given.hint).toBe('content/posts');
    expect([...given.entries]).toEqual([['content/posts/existing.mdx', input.entries[0]]]);
    expect(given.result).toEqual(goodResult());
    expect(given.report).toEqual(goodReport());
    expect([...given.finals].map(([file, bytes]) => [file, bytes.toString()])).toEqual([[ARTICLE_PATH, ARTICLE_BODY]]);
    expect(given.readBlob).toBe(input.readBlob);
    expect(given.options).toBe(input.options);
    expect(given.capability).toBe(CAPABILITY);
    expect(integration).toEqual({
      engine: 'sandbox', slug: 'a-title', path: ARTICLE_PATH, route: '/blog/a-title', files: [{ path: ARTICLE_PATH, content: ARTICLE_BODY }],
      summary: 'Added the post under content/posts like its peers.', discovery: [], draft: true,
      review: { summary: expect.stringContaining('paths, article-fidelity'), runtimeVerified: false },
      checks: [{ id: 'paths', outcome: 'passed', detail: '1 changed file' }, { id: 'article-fidelity', outcome: 'passed', detail: '2 of 2 units present' }],
      agentNotes: { conventions: ['scripts/seo-audit.mjs: No em dashes in body text'], deviations: ['media-omitted: The format has no inline images'] },
      notRun: [...SANDBOX_NOT_RUN], mediaOmitted: [],
    });
  });

  it('passes through media the gate found missing and a retry the gate found already complete', async () => {
    const { deps, start } = setup();
    deps.gate.mockResolvedValue({ files: [], checks: [{ id: 'article-fidelity', outcome: 'passed', detail: 'pinned article' }], mediaOmitted: ['https://cdn.example.test/body.png'], unchanged: true });
    expect(await start()).toMatchObject({ files: [], mediaOmitted: ['https://cdn.example.test/body.png'], unchanged: true });
  });

  it('mints one capability for this run, entry, business and model, expiring a minute after the deadline', async () => {
    const { deps, start, deadlineAt } = setup();
    await start();
    expect(deps.mintCapability).toHaveBeenCalledExactlyOnceWith(
      { runId: RUN_ID, bid: 'biz_1', entryId: 'e_test', model: 'claude-opus-5-5', maxUsd: 6, maxCalls: 200, exp: Math.floor(deadlineAt / 1000) + 60 }, SECRET.capabilitySecret);
  });

  it('writes one log line with identifiers and the outcome, and no content', async () => {
    const { deps, start } = setup();
    await start();
    expect(deps.log).toHaveBeenCalledExactlyOnceWith({ entry: 'e_test', sandbox: 'fake-sandbox-1', ms: 0, turns: 12, repaired: false, destroyed: true, outcome: 'integrated' });
  });
});

describe('egress is proven before any content is uploaded (SBX-3)', () => {
  it('uploads repository and article content only after the allow-list check and the probe have passed', async () => {
    const { provider, start } = setup();
    await start();
    const probeAt = provider.ops().indexOf(`exec:${RUNNER_COMMANDS.probe}`);
    const firstContent = provider.calls.indexOf(contentUploads(provider)[0]);
    expect(probeAt).toBeGreaterThan(provider.ops().indexOf('create'));
    expect(firstContent).toBeGreaterThan(probeAt);
    // Before the probe the only thing uploaded is Radar's own runner.
    for (const call of provider.calls.slice(0, probeAt)) if (call.op === 'upload') for (const file of call.files) expect(file.path.startsWith('/opt/radar-agent/')).toBe(true);
  });

  it('gives the probe the proxy URL and nothing else', async () => {
    const { provider, start } = setup();
    await start();
    expect(provider.execs().find(call => call.command === RUNNER_COMMANDS.probe)).toMatchObject({ cwd: '/opt/radar-agent', env: { ANTHROPIC_BASE_URL: PROXY }, timeoutSec: 30 });
  });

  it.each([['a wider list', 'model-proxy.example.test,api.github.com'], ['another host', 'app.example.test'], ['an empty list', '']])(
    'fails closed when the provider reports %s: nothing is uploaded or executed and the sandbox is destroyed', async (_label, applied) => {
      const { provider, outcome, fetchArchive, deps } = setup({ fake: { appliedAllowDomain: () => applied } });
      const { error } = await outcome();
      expect(error).toBeInstanceOf(PublishError);
      expect(error).toMatchObject({ http: 503, kind: 'http', retryable: true, diagnostic: { code: 'sandbox-egress-unverified', stage: 'plan' } });
      expect(provider.ops()).toEqual(['destroyMatching', 'create', 'destroy']);
      expect(fetchArchive).not.toHaveBeenCalled();
      expect(deps.mintCapability).not.toHaveBeenCalled();
    });

  it('accepts the reported allow-list whatever its letter case', async () => {
    const { outcome } = setup({ fake: { appliedAllowDomain: () => ' Model-Proxy.Example.TEST ' } });
    expect((await outcome()).error).toBeUndefined();
  });

  it('leaves the decision to the probe when the provider reports no allow-list at all', async () => {
    const passing = setup({ fake: { appliedAllowDomain: () => null } });
    expect((await passing.outcome()).error).toBeUndefined();
    const failing = setup({ fake: { appliedAllowDomain: () => null }, script: { probe: { exitCode: 1, output: 'probe-failure code=canary_reachable host=registry.npmjs.org' } } });
    expect((await failing.outcome()).error).toMatchObject({ diagnostic: { code: 'sandbox-egress-unverified' } });
    expect(contentUploads(failing.provider)).toEqual([]);
  });

  it('fails closed when the probe exits non-zero: no content upload, no archive request, no capability, sandbox destroyed', async () => {
    const { provider, outcome, fetchArchive, deps } = setup({ script: { probe: { exitCode: 1, output: 'probe-failure code=canary_reachable host=api.github.com\nsecond line is dropped' } } });
    const { error } = await outcome();
    expect(error).toMatchObject({ http: 503, retryable: true, diagnostic: { code: 'sandbox-egress-unverified', stage: 'plan' } });
    expect(error.diagnostic.reason).toContain('probe-failure code=canary_reachable host=api.github.com');
    expect(error.diagnostic.reason).not.toContain('second line');
    expect(contentUploads(provider)).toEqual([]);
    expect(provider.ops().slice(-2)).toEqual([`exec:${RUNNER_COMMANDS.probe}`, 'destroy']);
    expect(destroys(provider)).toBe(1);
    expect(fetchArchive).not.toHaveBeenCalled();
    expect(deps.mintCapability).not.toHaveBeenCalled();
    expect(deps.gate).not.toHaveBeenCalled();
  });

  it('fails closed when the probe cannot run', async () => {
    const { provider, outcome } = setup({ fake: { fail: failOn(call => call.op === 'exec' && call.command === RUNNER_COMMANDS.probe) } });
    expect((await outcome()).error).toMatchObject({ http: 503, diagnostic: { code: 'sandbox-egress-unverified' } });
    expect(contentUploads(provider)).toEqual([]);
    expect(destroys(provider)).toBe(1);
  });

  it('fails closed when the probe hangs, after its 30 second budget', async () => {
    const { provider, outcome } = setup({ fake: { hang: call => call.op === 'exec' && call.command === RUNNER_COMMANDS.probe } });
    const run = outcome();
    await reached(() => provider.execs().some(call => call.command === RUNNER_COMMANDS.probe));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(destroys(provider)).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect((await run).error).toMatchObject({ http: 503, diagnostic: { code: 'sandbox-egress-unverified' } });
    expect(contentUploads(provider)).toEqual([]);
    expect(destroys(provider)).toBe(1);
  });

  it('does not run the probe, or anything else, when the uploaded runner fails its integrity check', async () => {
    const { provider, outcome } = setup({ script: { verify: { exitCode: 1, output: 'run.mjs: FAILED' } } });
    expect((await outcome()).error).toMatchObject({ http: 502, retryable: true, diagnostic: { code: 'sandbox-unavailable' } });
    expect(provider.ops().slice(-2)).toEqual([`exec:${SANDBOX_COMMANDS.verifyRunner}`, 'destroy']);
  });

  it('builds the integrity manifest from the scripts it uploads', async () => {
    const { provider, start } = setup();
    await start();
    const manifest = provider.sandboxes[0].files.get(`/opt/radar-agent/${RUNNER_MANIFEST}`)!.toString();
    expect(manifest).toBe(SCRIPTS.map(script => `${createHash('sha256').update(script.data).digest('hex')}  ${script.name}\n`).join(''));
  });

  it('refuses to start when a runner script is missing', async () => {
    const { deps, provider, outcome } = setup();
    deps.readRunnerScripts.mockResolvedValue(SCRIPTS.slice(1));
    expect((await outcome()).error).toMatchObject({ diagnostic: { code: 'sandbox-unavailable' } });
    expect(provider.count('upload')).toBe(0);
    expect(destroys(provider)).toBe(1);
  });
});

describe('no credential crosses the provider boundary (SBX-2)', () => {
  const everySecret = Object.entries(SECRET);

  it.each([['a first-pass success', {}], ['a run with a repair round', { repair: true }]])('nothing recorded during %s contains a worker secret', async (_label, mode: { repair?: boolean }) => {
    const { provider, deps, start } = setup();
    if (mode.repair) deps.gate.mockRejectedValueOnce(gateFailure('article-fidelity', { issues: ['paragraph 2 of 2 missing'] }));
    await start();
    const recorded = provider.transcript();
    expect(recorded).toContain('PINNED-ARCHIVE-BYTES');
    for (const [name, secret] of everySecret) expect(recorded, name).not.toContain(secret);
    expect(recorded).not.toContain('Bearer ');
    expect(recorded).not.toContain('database-password-Q8');
  });

  it('the capability enters only the exec environment of the runner', async () => {
    const { provider, deps, start } = setup();
    deps.gate.mockRejectedValueOnce(gateFailure('article-fidelity'));
    await start();
    const runs = provider.calls.filter(isRun) as FakeExecCall[];
    expect(runs).toHaveLength(2);
    for (const call of runs) {
      expect(call.env).toEqual({ ANTHROPIC_API_KEY: CAPABILITY, ANTHROPIC_BASE_URL: PROXY, RADAR_AGENT_MODEL: 'claude-opus-5-5' });
      expect(call.cwd).toBe('/workspace/repo');
      expect(call.command).toBe('node /opt/radar-agent/run.mjs');
    }
    const elsewhere = new FakeSandboxProvider();
    elsewhere.calls.push(...provider.calls.map(call => (isRun(call) ? { ...(call as FakeExecCall), env: {} } : call)));
    expect(elsewhere.transcript()).not.toContain('rdrcap1.');
  });

  it('gives no other command an environment beyond the proxy URL', async () => {
    const { provider, start } = setup();
    await start();
    for (const call of provider.execs()) {
      if (call.command === RUN) continue;
      expect(call.env ?? {}, call.command).toEqual(call.command === RUNNER_COMMANDS.probe ? { ANTHROPIC_BASE_URL: PROXY } : {});
    }
  });

  it('keeps the provider key, the capability secret and the capability out of a failure it reports', async () => {
    const leaky = new Error(`request failed: x-api-key ${SECRET.daytonaKey} secret ${SECRET.capabilitySecret} ${CAPABILITY} at https://user:pass@app.example.test/api?token=abc ${'x'.repeat(5000)}`);
    for (const fail of [failOn(call => call.op === 'create', leaky), failOn(call => call.op === 'download', leaky), failOn(call => call.op === 'destroy', leaky)]) {
      const { outcome, deps } = setup({ fake: { fail } });
      const { error } = await outcome();
      const said = JSON.stringify([error?.message, error?.detail, error?.diagnostic, deps.report.mock.calls.map(([reported, context]: any[]) => [reported.message, context]), deps.log.mock.calls]);
      for (const hidden of [SECRET.daytonaKey, SECRET.capabilitySecret, CAPABILITY, 'user:pass', 'token=abc']) expect(said).not.toContain(hidden);
      if (error) { expect(error.detail.length).toBeLessThanOrEqual(300); expect(error.diagnostic.reason.length).toBeLessThanOrEqual(300); }
    }
  });

  it('redacts a credential or capability the agent wrote into its own statements', async () => {
    const { start } = setup({ script: { turns: [box => leave(box, { report: goodReport({ summary: `Used ${CAPABILITY} and ${SECRET.githubToken}\u0007 to finish`, conventions: [{ path: 'a.md', rule: `key ${CAPABILITY}` }] }) })] } });
    const integration = await start();
    const said = JSON.stringify([integration.summary, integration.agentNotes]);
    expect(said).not.toContain('rdrcap1.');
    expect(said).not.toContain(SECRET.githubToken);
    expect(said).not.toContain('\\u0007');
  });
});

describe('the sandbox is destroyed exactly once on every path (SBX-6)', () => {
  const paths: [string, Setup, (s: ReturnType<typeof setup>) => void, string][] = [
    ['a gate failure', {}, s => { s.deps.gate.mockRejectedValue(gateFailure('credential-detected')); }, 'credential-detected'],
    ['a failed upload', { fake: { fail: failOn(call => call.op === 'uploadFile') } }, () => {}, 'sandbox-unavailable'],
    ['an exec that fails in transport', { fake: { fail: failOn(call => call.op === 'exec' && call.command === RUNNER_COMMANDS.prepare) } }, () => {}, 'sandbox-unavailable'],
    ['a preparation script that exits non-zero', { script: { prepare: { exitCode: 1, output: 'prepare-failure phase=extract code=archive_invalid' } } }, () => {}, 'sandbox-unavailable'],
    ['a runner that exits non-zero', { script: { turns: [box => leave(box, { result: goodResult({ status: 'agent_error', agentError: 'AgentResult:error_max_turns', changed: [] }), exit: { exitCode: 1, output: '' } })] } }, () => {}, 'agent-failed'],
    ['a runner that crashes without a result', { script: { turns: [box => leave(box, { result: null, report: null, exit: { exitCode: 134, output: 'Aborted' } })] } }, () => {}, 'agent-failed'],
    ['an agent run that fails in transport', { fake: { fail: failOn(isRun) } }, () => {}, 'sandbox-unavailable'],
    ['a download that fails', { fake: { fail: failOn(call => call.op === 'download') } }, () => {}, 'sandbox-unavailable'],
    ['a gate that throws something unexpected', {}, s => { s.deps.gate.mockRejectedValue(new TypeError('cannot read properties of undefined')); }, 'sandbox-unavailable'],
    ['a capability that cannot be minted', {}, s => { s.deps.mintCapability.mockImplementation(() => { throw new Error('mint failed'); }); }, 'sandbox-unavailable'],
  ];
  it.each(paths)('after %s', async (_label, given, arrange, code) => {
    const s = setup(given);
    arrange(s);
    const { error } = await s.outcome();
    expect(error).toBeInstanceOf(PublishError);
    expect(error.diagnostic.code).toBe(code);
    expect(destroys(s.provider)).toBe(1);
    expect(s.provider.ops().at(-1)).toBe('destroy');
    expect(s.provider.calls.at(-1)).toMatchObject({ op: 'destroy', timeoutSec: 30 });
    expect(s.deps.report).not.toHaveBeenCalled();
  });

  it('after success, before the result is returned', async () => {
    const { provider, start } = setup();
    let destroyedWhenReturned = false;
    await start().then(() => { destroyedWhenReturned = provider.sandboxes[0].destroyed; });
    expect(destroyedWhenReturned).toBe(true);
    expect(destroys(provider)).toBe(1);
  });

  it('after the deadline stops a hung agent run', async () => {
    const { provider, outcome } = setup({ fake: { hang: isRun } });
    const run = outcome();
    await reached(() => provider.calls.some(isRun));
    await vi.advanceTimersByTimeAsync(540_000);
    expect((await run).error).toMatchObject({ http: 422, retryable: false, diagnostic: { code: 'publishing-deadline', stage: 'plan' } });
    expect(destroys(provider)).toBe(1);
    expect(provider.ops().at(-1)).toBe('destroy');
  });

  it('has nothing to destroy when no sandbox was created', async () => {
    const { provider, outcome, deps } = setup({ fake: { fail: failOn(call => call.op === 'create') } });
    expect((await outcome()).error).toMatchObject({ http: 502, retryable: true, diagnostic: { code: 'sandbox-unavailable', stage: 'plan' } });
    expect(provider.ops()).toEqual(['destroyMatching', 'create']);
    expect(deps.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sandbox: null, outcome: 'sandbox-unavailable' }));
  });

  it('does not create a second sandbox while leftovers cannot be deleted', async () => {
    const { provider, outcome } = setup({ fake: { fail: failOn(call => call.op === 'destroyMatching') } });
    expect((await outcome()).error).toMatchObject({ http: 502, diagnostic: { code: 'sandbox-unavailable' } });
    expect(provider.ops()).toEqual(['destroyMatching']);
  });

  it('deletes a sandbox that only appears after creation was given up on', async () => {
    let fake!: FakeSandboxProvider;
    const { outcome } = setup({ provider: inner => { fake = inner; return { destroyMatching: (labels, timeoutSec) => inner.destroyMatching(labels, timeoutSec), create: spec => new Promise(resolve => setTimeout(() => resolve(inner.create(spec)), 200_000)) }; } });
    const run = outcome();
    await reached(() => fake.count('destroyMatching') === 1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await run).error).toMatchObject({ http: 502, diagnostic: { code: 'sandbox-unavailable' } });
    expect(fake.count('create')).toBe(0);
    await vi.advanceTimersByTimeAsync(80_000);
    await reached(() => destroys(fake) === 1);
    expect(fake.ops()).toEqual(['destroyMatching', 'create', 'destroy']);
  });

  describe('when the delete itself fails', () => {
    const TEARDOWN = { source: 'publishing', operation: 'publishing.sandbox.teardown', businessId: 'biz_1', ref: 'e_test', provider: 'daytona', code: 'sandbox-teardown-failed' };

    it('a successful run still returns its integration, and the failure is reported once', async () => {
      const { provider, deps, start } = setup({ fake: { fail: failOn(call => call.op === 'destroy', new Error('delete refused')) } });
      const integration = await start();
      expect(integration.files).toEqual([{ path: ARTICLE_PATH, content: ARTICLE_BODY }]);
      expect(destroys(provider)).toBe(1);
      expect(deps.report).toHaveBeenCalledExactlyOnceWith(expect.any(Error), TEARDOWN);
      expect((deps.report.mock.calls[0] as any[])[0].message).toMatch(/fake-sandbox-1 was not destroyed.*delete refused.*30-minute TTL/);
      expect(deps.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ destroyed: false, outcome: 'integrated' }));
    });

    it('a failed run still fails with its own error, not the teardown error', async () => {
      const { provider, deps, outcome } = setup({ fake: { fail: failOn(call => call.op === 'destroy', new Error('delete refused')) } });
      const refusal = gateFailure('credential-detected');
      deps.gate.mockRejectedValue(refusal);
      expect((await outcome()).error).toBe(refusal);
      expect(destroys(provider)).toBe(1);
      expect(deps.report).toHaveBeenCalledExactlyOnceWith(expect.any(Error), TEARDOWN);
    });

    it('a delete that hangs is given up on after its 30 seconds and reported', async () => {
      const { provider, deps, outcome } = setup({ fake: { hang: call => call.op === 'destroy' } });
      const run = outcome();
      await reached(() => destroys(provider) === 1);
      await vi.advanceTimersByTimeAsync(30_000);
      const { value } = await run;
      expect(value?.engine).toBe('sandbox');
      expect(deps.report).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: expect.stringContaining('within 30 seconds') }), TEARDOWN);
    });

    it('a reporter that throws or hangs changes nothing', async () => {
      const thrown = setup({ fake: { fail: failOn(call => call.op === 'destroy') } });
      thrown.deps.report.mockRejectedValue(new Error('alerting is down'));
      expect((await thrown.outcome()).value?.engine).toBe('sandbox');
      const hung = setup({ fake: { fail: failOn(call => call.op === 'destroy') } });
      hung.deps.report.mockReturnValue(new Promise<void>(() => {}));
      const run = hung.outcome();
      await reached(() => hung.deps.report.mock.calls.length === 1);
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await run).value?.engine).toBe('sandbox');
    });
  });
});

describe('one absolute deadline governs the attempt (SBX-7)', () => {
  const timeouts = (provider: FakeSandboxProvider) => Object.fromEntries(provider.calls.flatMap(call => call.op === 'stat' ? [] : [[
    call.op === 'exec' ? call.command : call.op === 'upload' ? `upload ${call.files[0].path}` : call.op === 'download' ? `download ${call.path}` : call.op,
    call.op === 'create' ? call.spec.timeoutSec : call.timeoutSec,
  ]]));

  it('gives each stage its full budget when the whole attempt is ahead', async () => {
    const { provider, start } = setup();
    await start();
    expect(timeouts(provider)).toEqual({
      destroyMatching: 30, create: 120, 'upload /opt/radar-agent/run.mjs': 120, [SANDBOX_COMMANDS.verifyRunner]: 120, [RUNNER_COMMANDS.probe]: 30,
      [SANDBOX_COMMANDS.makeInput]: 120, uploadFile: 120, [`upload ${SANDBOX_PATHS.articleMarkdown}`]: 120, [RUNNER_COMMANDS.prepare]: 180,
      [`upload ${SANDBOX_PATHS.task}`]: 120, [RUN]: 540, [`download ${SANDBOX_PATHS.result}`]: 30, [`download ${SANDBOX_PATHS.report}`]: 30,
      [SANDBOX_COMMANDS.findNonRegular]: 30, [`download ${SANDBOX_PATHS.repo}/${ARTICLE_PATH}`]: 30, destroy: 30,
    });
  });

  it('tells the runner when its turn ends: 540 seconds after it starts on a fresh attempt', async () => {
    const { provider, start } = setup();
    await start();
    expect(JSON.parse(provider.sandboxes[0].files.get(SANDBOX_PATHS.task)!.toString()).deadlineEpochMs).toBe(T0 + 540_000);
  });

  it('derives the agent budget from the time remaining, keeping 150 seconds for collection, teardown and Git', async () => {
    // Preparation takes 400 s of an 810 s attempt: 410 s remain, so the agent gets 410 - 150 = 260 s.
    const { provider, start } = setup({ script: { prepare: () => { vi.setSystemTime(T0 + 400_000); } } });
    await start();
    expect(provider.calls.find(isRun)).toMatchObject({ timeoutSec: 260 });
    expect(JSON.parse(provider.sandboxes[0].files.get(SANDBOX_PATHS.task)!.toString()).deadlineEpochMs).toBe(T0 + 660_000);
  });

  it('caps a stage by the time remaining rather than its nominal budget', async () => {
    // 175 s left: sandbox work must end 75 s before the deadline (30 s teardown, 45 s Git), so create gets 100 s, not 120.
    const { provider, outcome } = setup({ deadlineAt: T0 + 175_000 });
    await outcome();
    expect(provider.calls[1]).toMatchObject({ op: 'create', spec: { timeoutSec: 100 } });
  });

  it('makes no provider call at all when the attempt arrives with no time for sandbox work', async () => {
    const { provider, outcome, fetchArchive } = setup({ deadlineAt: T0 + 75_500 });
    expect((await outcome()).error).toMatchObject({ http: 422, kind: 'config', retryable: false, diagnostic: { code: 'publishing-deadline', stage: 'plan' } });
    expect(provider.calls).toEqual([]);
    expect(fetchArchive).not.toHaveBeenCalled();
  });

  it('fails with the deadline code before starting an agent turn that cannot fit, without minting a capability', async () => {
    // Preparation ends 640 s in: 170 s remain, 20 s of agent budget, which is no more than the runner's own stop lead.
    const { provider, deps, outcome } = setup({ script: { prepare: () => { vi.setSystemTime(T0 + 640_000); } } });
    expect((await outcome()).error).toMatchObject({ http: 422, retryable: false, diagnostic: { code: 'publishing-deadline', stage: 'plan' } });
    expect(provider.calls.some(isRun)).toBe(false);
    expect(provider.ops()).not.toContain(`upload:${SANDBOX_PATHS.task}`);
    expect(deps.mintCapability).not.toHaveBeenCalled();
    expect(destroys(provider)).toBe(1);
  });

  it('fails with the deadline code before starting a stage once sandbox work time is over', async () => {
    const { provider, outcome } = setup({ fake: { fail: call => { if (call.op === 'exec' && call.command === RUNNER_COMMANDS.probe) vi.setSystemTime(T0 + ATTEMPT_MS - 75_000); return undefined; } } });
    expect((await outcome()).error).toMatchObject({ diagnostic: { code: 'publishing-deadline' } });
    expect(provider.ops().slice(-2)).toEqual([`exec:${RUNNER_COMMANDS.probe}`, 'destroy']);
  });

  it('reports a slow stage that ends within the attempt as a retryable provider failure, not as the deadline', async () => {
    const { provider, outcome } = setup({ fake: { hang: call => call.op === 'uploadFile' } });
    const run = outcome();
    await reached(() => provider.count('uploadFile') === 1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await run).error).toMatchObject({ http: 502, retryable: true, diagnostic: { code: 'sandbox-unavailable', stage: 'plan' } });
    expect(destroys(provider)).toBe(1);
  });

  it('treats the runner reporting its own deadline as the attempt deadline', async () => {
    const { outcome } = setup({ script: { turns: [box => leave(box, { result: goodResult({ status: 'deadline', agentError: 'RunnerDeadlineExceeded', changed: [] }), exit: { exitCode: 1, output: '' } })] } });
    expect((await outcome()).error).toMatchObject({ http: 422, retryable: false, diagnostic: { code: 'publishing-deadline', stage: 'plan' } });
  });

  it('leaves the Git writes their 45 seconds or ends the attempt before anything is written', async () => {
    const { provider, outcome, deadlineAt, deps } = setup({ fake: { fail: call => { if (call.op === 'destroy') vi.setSystemTime(deadlineAt - 44_000); return undefined; } } });
    expect((await outcome()).error).toMatchObject({ diagnostic: { code: 'publishing-deadline', stage: 'plan' } });
    expect(deps.gate).toHaveBeenCalledOnce();
    expect(destroys(provider)).toBe(1);
  });

  it('settles by the deadline, with the sandbox destroyed, whichever single provider call hangs', async () => {
    const reference = setup();
    await reference.start();
    const total = reference.provider.calls.length;
    expect(total).toBe(19);
    for (let index = 0; index < total; index++) {
      vi.setSystemTime(T0);
      const label = `hang at call ${index} (${reference.provider.ops()[index]})`;
      let seen = 0;
      const { provider, outcome, deadlineAt, deps } = setup({ fake: { hang: () => seen++ === index } });
      let settledAt = -1;
      const run = outcome().then(settled => { settledAt = Date.now(); return settled; });
      await reached(() => provider.calls.length === index + 1);
      await vi.advanceTimersByTimeAsync(deadlineAt - Date.now());
      await reached(() => settledAt >= 0);
      const { error } = await run;
      expect(settledAt, label).toBeLessThanOrEqual(deadlineAt);
      const hungOp = reference.provider.calls[index].op;
      if (hungOp === 'destroy') {
        expect(deps.report, label).toHaveBeenCalledOnce();
      } else {
        expect(error, label).toBeInstanceOf(PublishError);
        expect(SANDBOX_DIAGNOSTIC_CODES, label).toContain(error.diagnostic.code);
        expect(destroys(provider), label).toBe(index >= 2 ? 1 : 0);
        expect(deps.report, label).not.toHaveBeenCalled();
      }
    }
  });
});

describe('runner outputs are untrusted', () => {
  const turn = (outputs: Outputs): Setup => ({ script: { turns: [box => leave(box, outputs)] } });
  const downloaded = (provider: FakeSandboxProvider) => provider.calls.flatMap(call => (call.op === 'download' ? [call.path] : []));

  it('refuses an oversized result without downloading it', async () => {
    const { provider, outcome, deps } = setup(turn({ result: Buffer.alloc(64_001, 0x20) }));
    expect((await outcome()).error).toMatchObject({ http: 422, retryable: false, diagnostic: { code: 'agent-failed', stage: 'plan' } });
    expect(downloaded(provider)).toEqual([]);
    expect(deps.gate).not.toHaveBeenCalled();
  });

  it('downloads a result of exactly 64 000 bytes with that limit', async () => {
    const padded = JSON.stringify(goodResult()); const result = Buffer.from(padded + ' '.repeat(64_000 - padded.length));
    const { provider, outcome } = setup(turn({ result }));
    expect((await outcome()).error).toBeUndefined();
    expect(provider.calls.find(call => call.op === 'download')).toMatchObject({ path: SANDBOX_PATHS.result, maxBytes: 64_000 });
  });

  it.each([
    ['is not JSON', '{"version":1,'],
    ['is not UTF-8', Buffer.from([0x7b, 0xff, 0xfe, 0x7d])],
    ['has an unknown field', { ...goodResult(), exfiltrate: 'x' }],
    ['has an unknown status', { ...goodResult(), status: 'changed' }],
    ['lists a change with an unknown field', { ...goodResult(), changed: [{ path: ARTICLE_PATH, bytes: 1, mode: '120000' }] }],
    ['is empty', Buffer.alloc(0)],
  ])('fails the run when the result %s', async (_label, result) => {
    const { outcome, deps } = setup(turn({ result }));
    expect((await outcome()).error).toMatchObject({ http: 422, diagnostic: { code: 'agent-failed' } });
    expect(deps.gate).not.toHaveBeenCalled();
  });

  it.each([
    ['is missing', null, false],
    ['is oversized', Buffer.alloc(64_001, 0x20), false],
    ['has an unknown field', { ...goodReport(), buildPassed: true }, true],
    ['has a summary over 4000 characters', goodReport({ summary: 'x'.repeat(4001) }), true],
    ['is a directory', undefined, false],
  ])('fails the run when the report %s', async (label, report, fetched) => {
    const given: Setup = label === 'is a directory' ? { script: { turns: [box => { leave(box, { report: null }); box.files.set(`${SANDBOX_PATHS.report}/nested`, Buffer.from('x')); }] } } : turn({ report });
    const { provider, outcome, deps } = setup(given);
    expect((await outcome()).error).toMatchObject({ http: 422, retryable: false, diagnostic: { code: 'agent-failed', stage: 'plan' } });
    // A missing, oversized or non-file report is refused on its size check, without a download.
    expect(downloaded(provider)).toEqual(fetched ? [SANDBOX_PATHS.result, SANDBOX_PATHS.report] : [SANDBOX_PATHS.result]);
    expect(deps.gate).not.toHaveBeenCalled();
  });

  it('downloads only candidates that are plain repository paths, regular files and within the per-file limit', async () => {
    const big = Buffer.alloc(1_000_001, 0x61); const atLimit = Buffer.alloc(1_000_000, 0x62);
    const changed = [ARTICLE_PATH, '../../proc/self/environ', '/etc/passwd', 'content/../../../etc/shadow', 'content\\posts\\x.md', 'content/posts/\u0000x.md', '', 'content//double.md',
      'content/big.json', 'content/at-limit.json', 'content/a-directory', 'content/missing.md', ARTICLE_PATH].map(file => ({ path: file, bytes: 1 }));
    const { provider, deps, start } = setup(turn({ result: goodResult({ changed }), files: { [ARTICLE_PATH]: ARTICLE_BODY, 'content/big.json': big, 'content/at-limit.json': atLimit, 'content/a-directory/inner.md': 'x' } }));
    await start();
    const finals = deps.gate.mock.calls[0][0].finals;
    expect([...finals.keys()].sort()).toEqual([ARTICLE_PATH, 'content/at-limit.json'].sort());
    expect(finals.get('content/at-limit.json')!.byteLength).toBe(1_000_000);
    // The gate still sees every candidate the runner named, so it refuses the ones that were not collected.
    expect(deps.gate.mock.calls[0][0].result.changed).toEqual(changed);
    const touched = provider.calls.flatMap(call => (call.op === 'stat' || call.op === 'download' ? [call.path] : []));
    for (const remote of touched) expect(remote).toMatch(/^\/(?:output|workspace\/repo\/content)\/[A-Za-z0-9._/-]+$/);
    for (const remote of touched) expect(remote).not.toMatch(/\.\.|\/\/|passwd|environ|shadow/);
    expect(downloaded(provider).filter(remote => remote.startsWith(SANDBOX_PATHS.repo)).sort()).toEqual([`${SANDBOX_PATHS.repo}/${ARTICLE_PATH}`, `${SANDBOX_PATHS.repo}/content/at-limit.json`].sort());
    for (const call of provider.calls) if (call.op === 'download' && call.path.startsWith(SANDBOX_PATHS.repo)) expect(call.maxBytes).toBe(1_000_000);
  });

  it('downloads nothing when the runner names more candidates than the gate examines, and lets the gate refuse the count', async () => {
    const changed = Array.from({ length: 65 }, (_unused, index) => ({ path: `content/posts/p${index}.md`, bytes: 1 }));
    const { provider, deps, outcome } = setup(turn({ result: goodResult({ changed }) }));
    deps.gate.mockRejectedValue(Object.assign(gateFailure('changed-file-count', { actual: 65, limit: 64 }), { repairable: false }));
    expect((await outcome()).error).toMatchObject({ diagnostic: { code: 'changed-file-count' } });
    expect(downloaded(provider)).toEqual([SANDBOX_PATHS.result, SANDBOX_PATHS.report]);
    expect(deps.gate.mock.calls[0][0].finals.size).toBe(0);
  });

  it('refuses the run when the workspace holds a link or special file, before downloading any candidate', async () => {
    const { provider, deps, outcome } = setup({ script: { find: { exitCode: 0, output: '/workspace/repo/content/posts/a-title.mdx\n' } } });
    const { error } = await outcome();
    expect(error).toMatchObject({ http: 422, retryable: false, diagnostic: { code: 'non-regular-file', stage: 'validation' } });
    expect(error.diagnostic.reason).not.toContain('a-title');
    expect(downloaded(provider)).toEqual([SANDBOX_PATHS.result, SANDBOX_PATHS.report]);
    expect(deps.gate).not.toHaveBeenCalled();
  });

  it('does not trust a workspace it could not check', async () => {
    const { deps, outcome } = setup({ script: { find: { exitCode: 1, output: 'find: permission denied' } } });
    expect((await outcome()).error).toMatchObject({ http: 502, diagnostic: { code: 'sandbox-unavailable' } });
    expect(deps.gate).not.toHaveBeenCalled();
  });

  it('never repeats runner or probe output beyond a short run of token characters', async () => {
    const hostile = 'prepare-failure code=archive_invalid <script>alert(1)</script> "customer source line" ' + 'y'.repeat(500);
    const { outcome } = setup({ script: { prepare: { exitCode: 2, output: hostile } } });
    const { error } = await outcome();
    expect(error.diagnostic.reason).toContain('prepare-failure code=archive_invalid');
    expect(error.diagnostic.reason).not.toMatch(/[<>"]/);
    expect(error.diagnostic.reason.length).toBeLessThanOrEqual(300);
  });
});

describe('the repair round', () => {
  const fidelity = () => gateFailure('article-fidelity', { issues: ['paragraph 2 of 2 missing', 'heading 1 of 1 missing'] });

  it('runs once for a repairable gate failure: feedback goes in, the runner runs again, the gate decides again', async () => {
    const { provider, deps, start } = setup();
    deps.gate.mockRejectedValueOnce(fidelity());
    const integration = await start();
    expect(integration.engine).toBe('sandbox');
    expect(deps.gate).toHaveBeenCalledTimes(2);
    expect(deps.mintCapability).toHaveBeenCalledOnce();
    const ops = provider.ops();
    const second = ops.lastIndexOf(`exec:${RUN}`);
    expect(ops.filter(op => op === `exec:${RUN}`)).toHaveLength(2);
    expect(ops[second - 1]).toBe(`upload:${SANDBOX_PATHS.task},${SANDBOX_PATHS.feedback}`);
    expect(ops.slice(second + 1)).toEqual(['stat:/output/result.json', 'download:/output/result.json', 'stat:/output/report.json', 'download:/output/report.json',
      `exec:${SANDBOX_COMMANDS.findNonRegular}`, `stat:/workspace/repo/${ARTICLE_PATH}`, `download:/workspace/repo/${ARTICLE_PATH}`, 'destroy']);
    expect(JSON.parse(provider.sandboxes[0].files.get(SANDBOX_PATHS.feedback)!.toString())).toEqual({ version: 1, issues: [
      { code: 'article-fidelity', detail: 'paragraph 2 of 2 missing' }, { code: 'article-fidelity', detail: 'heading 1 of 1 missing' },
    ] });
    expect(deps.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ repaired: true, turns: 24, outcome: 'integrated' }));
  });

  it('gates the second turn on what the second turn left, not on the first collection', async () => {
    const repairedBody = ARTICLE_BODY + '\nThe paragraph that was missing.\n';
    const { deps, start } = setup({ script: { turns: [box => leave(box), box => leave(box, { files: { [ARTICLE_PATH]: repairedBody } })] } });
    deps.gate.mockRejectedValueOnce(fidelity());
    const integration = await start();
    expect(deps.gate.mock.calls[1][0].finals.get(ARTICLE_PATH)!.toString()).toBe(repairedBody);
    expect(integration.files).toEqual([{ path: ARTICLE_PATH, content: repairedBody }]);
  });

  it('names the path in the feedback when the gate named one', async () => {
    const { provider, deps, start } = setup();
    deps.gate.mockRejectedValueOnce(gateFailure('protected-path', { path: 'package.json' }));
    await start();
    expect(JSON.parse(provider.sandboxes[0].files.get(SANDBOX_PATHS.feedback)!.toString())).toEqual({ version: 1, issues: [{ code: 'protected-path', path: 'package.json', detail: 'gate refused: protected-path' }] });
  });

  it('shares one agent budget across both turns: the repair gets what the first turn left', async () => {
    // The first turn uses 300 s of its 540 s; the repair turn gets the remaining 240 s and the same end time.
    const { provider, deps, start } = setup({ script: { turns: [box => { vi.setSystemTime(T0 + 300_000); return leave(box); }] } });
    deps.gate.mockRejectedValueOnce(fidelity());
    await start();
    expect((provider.calls.filter(isRun) as FakeExecCall[]).map(call => call.timeoutSec)).toEqual([540, 240]);
    expect(JSON.parse(provider.sandboxes[0].files.get(SANDBOX_PATHS.task)!.toString()).deadlineEpochMs).toBe(T0 + 540_000);
  });

  it('makes the second gate result final, keeping its code and recording what the repair was for', async () => {
    const { provider, deps, outcome } = setup();
    deps.gate.mockRejectedValueOnce(fidelity()).mockRejectedValueOnce(gateFailure('syntax-invalid', { path: 'src/posts.ts' }));
    const { error } = await outcome();
    expect(error).toMatchObject({ http: 422, kind: 'config', retryable: false, diagnostic: {
      code: 'syntax-invalid', stage: 'repair', path: 'src/posts.ts',
      origin: { code: 'article-fidelity', stage: 'validation', reason: 'gate refused: article-fidelity', issues: ['paragraph 2 of 2 missing', 'heading 1 of 1 missing'] },
    } });
    expect(deps.gate).toHaveBeenCalledTimes(2);
    expect(provider.calls.filter(isRun)).toHaveLength(2);
    expect(destroys(provider)).toBe(1);
  });

  it.each(['credential-detected', 'identity-changed', 'non-regular-file', 'final-output-size', 'agent-declined', 'plan-empty'])('does not run for %s', async code => {
    const { provider, deps, outcome } = setup();
    const refusal = gateFailure(code);
    deps.gate.mockRejectedValue(refusal);
    expect((await outcome()).error).toBe(refusal);
    expect(deps.gate).toHaveBeenCalledOnce();
    expect(provider.calls.filter(isRun)).toHaveLength(1);
    expect(provider.ops()).not.toContain(`upload:${SANDBOX_PATHS.task},${SANDBOX_PATHS.feedback}`);
  });

  it.each(['article-fidelity', 'syntax-invalid', 'peer-content-changed', 'changed-file-count', 'protected-path'])('runs for %s', async code => {
    const { provider, deps, outcome } = setup();
    deps.gate.mockRejectedValueOnce(gateFailure(code));
    expect((await outcome()).error).toBeUndefined();
    expect(provider.calls.filter(isRun)).toHaveLength(2);
  });

  it('does not run when the gate marks a repairable code as not repairable this time', async () => {
    const { provider, deps, outcome } = setup();
    const refusal = Object.assign(gateFailure('changed-file-count'), { repairable: false });
    deps.gate.mockRejectedValue(refusal);
    expect((await outcome()).error).toBe(refusal);
    expect(provider.calls.filter(isRun)).toHaveLength(1);
  });

  it('does not run with less than 150 seconds of agent budget left, and reports the original failure', async () => {
    const { provider, deps, outcome } = setup({ script: { turns: [box => { vi.setSystemTime(T0 + 391_000); return leave(box); }] } });
    const refusal = fidelity();
    deps.gate.mockRejectedValue(refusal);
    expect((await outcome()).error).toBe(refusal);
    expect(provider.calls.filter(isRun)).toHaveLength(1);
    expect(deps.gate).toHaveBeenCalledOnce();
  });

  it('runs with exactly 150 seconds left', async () => {
    const { provider, deps, outcome } = setup({ script: { turns: [box => { vi.setSystemTime(T0 + 390_000); return leave(box); }] } });
    deps.gate.mockRejectedValueOnce(fidelity());
    expect((await outcome()).error).toBeUndefined();
    expect((provider.calls.filter(isRun) as FakeExecCall[])[1].timeoutSec).toBe(150);
  });

  it('reports a failure inside the repair turn under the repair stage, with the reason for the repair', async () => {
    const { deps, outcome } = setup({ script: { turns: [box => leave(box), box => leave(box, { result: goodResult({ status: 'agent_error', agentError: 'AgentResult:error_max_turns', changed: [] }), exit: { exitCode: 1, output: '' } })] } });
    deps.gate.mockRejectedValueOnce(fidelity());
    expect((await outcome()).error).toMatchObject({ http: 422, diagnostic: { code: 'agent-failed', stage: 'repair', origin: { code: 'article-fidelity' } } });
    expect(deps.gate).toHaveBeenCalledOnce();
  });

  it('never repairs twice', async () => {
    const { provider, deps, outcome } = setup();
    deps.gate.mockRejectedValue(fidelity());
    expect((await outcome()).error).toMatchObject({ diagnostic: { code: 'article-fidelity', stage: 'repair' } });
    expect(deps.gate).toHaveBeenCalledTimes(2);
    expect(provider.calls.filter(isRun)).toHaveLength(2);
  });
});

describe('error mapping', () => {
  const agentError = (token: string | null, exitCode = 1): Setup => ({ script: { turns: [box => leave(box, { result: goodResult({ status: 'agent_error', agentError: token, changed: [] }), exit: { exitCode, output: '' } })] } });

  it.each([
    ['a provider outage', 'AgentApiError:529', 502, true, 'analysis-unavailable'],
    ['a rate-limited provider', 'AgentApiError:429', 502, true, 'analysis-unavailable'],
    ['a provider error with no status', 'AgentApiError:unknown', 502, true, 'analysis-unavailable'],
    ['an unreachable proxy', 'AgentThrown:APIConnectionError', 502, true, 'analysis-unavailable'],
    ['a spent run budget', 'AgentBudgetExhausted', 422, false, 'agent-budget'],
    ['a request the provider refused', 'AgentApiError:400', 422, false, 'agent-failed'],
    ['a capability the proxy refused', 'AgentApiError:401', 422, false, 'agent-failed'],
    ['the turn limit', 'AgentResult:error_max_turns', 422, false, 'agent-failed'],
    ['a runner fault', 'RunnerTaskInvalid', 422, false, 'agent-failed'],
    ['an execution error', 'AgentResult:error_during_execution', 422, false, 'agent-failed'],
    ['no token at all', null, 422, false, 'agent-failed'],
  ])('reports %s (%s) as %i, retryable %s, %s', async (_label, token, http, retryable, code) => {
    const { outcome, deps } = setup(agentError(token));
    expect((await outcome()).error).toMatchObject({ http, retryable, diagnostic: { code, stage: 'plan' } });
    expect(deps.gate).not.toHaveBeenCalled();
  });

  it('classifies the same way when the runner reports the error and still exits 0', async () => {
    const { outcome, deps } = setup(agentError('AgentApiError:503', 0));
    expect((await outcome()).error).toMatchObject({ http: 502, diagnostic: { code: 'analysis-unavailable' } });
    expect(deps.gate).not.toHaveBeenCalled();
  });

  it('does not accept a completed result from a runner that exited non-zero', async () => {
    const { outcome, deps } = setup({ script: { turns: [box => leave(box, { exit: { exitCode: 1, output: '' } })] } });
    expect((await outcome()).error).toMatchObject({ http: 422, diagnostic: { code: 'agent-failed' } });
    expect(deps.gate).not.toHaveBeenCalled();
  });

  it('keeps only token characters of the runner error token in the reason', async () => {
    const { outcome } = setup(agentError('AgentResult:error <b>customer text</b> ' + 'z'.repeat(400)));
    const { error } = await outcome();
    expect(error.diagnostic.reason).not.toMatch(/[<> ]customer/);
    expect(error.diagnostic.reason.length).toBeLessThanOrEqual(300);
  });

  it.each([
    [null, 'agent-failed'], ['', 'agent-failed'], ['UnknownError', 'agent-failed'], ['AgentResult:error_max_turns', 'agent-failed'], ['AgentResult:error_max_budget_usd', 'agent-budget'],
    ['proxy_budget_exhausted', 'agent-budget'], ['APIError:500', 'analysis-unavailable'], ['api_error_429', 'analysis-unavailable'], ['RateLimitError', 'analysis-unavailable'],
    ['upstream_unavailable', 'analysis-unavailable'], ['turns_1500', 'agent-failed'], ['error_4290', 'agent-failed'], ['AgentApiError:404', 'agent-failed'],
    ['AgentApiError:408', 'analysis-unavailable'], ['AgentApiError:500', 'analysis-unavailable'], ['AgentThrown:Error', 'agent-failed'], ['AgentNoResult', 'agent-failed'],
  ])('classifyAgentError(%j) is %s', (token, expected) => {
    expect(classifyAgentError(token)).toBe(expected);
  });

  it.each([
    ['its too-large exit code', { exitCode: 3, output: '' }],
    ['an expanded-size token', { exitCode: 3, output: 'radar-prepare-failure phase=extract code=workspace_too_large' }],
    ['an archive-size token', { exitCode: 1, output: 'radar-prepare-failure phase=archive code=archive_too_large' }],
  ])('reports a ceiling passed during workspace preparation (%s) as workspace-too-large, which is not retried', async (_label, prepare) => {
    const { provider, outcome } = setup({ script: { prepare } });
    expect((await outcome()).error).toMatchObject({ http: 422, kind: 'config', retryable: false, diagnostic: { code: 'workspace-too-large', stage: 'plan' } });
    expect(destroys(provider)).toBe(1);
  });

  it('passes a GitHub failure of the archive request through with its own status', async () => {
    const forbidden = new PublishError(403, 'Resource not accessible', 'api.github.com');
    const { provider, outcome, fetchArchive } = setup();
    fetchArchive.mockRejectedValue(forbidden);
    expect((await outcome()).error).toBe(forbidden);
    expect(contentUploads(provider)).toEqual([]);
    expect(destroys(provider)).toBe(1);
  });

  it('reports an archive download that outlives its 120 seconds as a retryable network failure', async () => {
    const { provider, outcome, fetchArchive } = setup();
    fetchArchive.mockReturnValue(new Promise(() => {}));
    const run = outcome();
    await reached(() => fetchArchive.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await run).error).toMatchObject({ http: 0, kind: 'network', retryable: true });
    expect(fetchArchive.mock.calls[0][0].aborted).toBe(true);
    expect(destroys(provider)).toBe(1);
  });

  it.each([
    ['leftover deletion', (call: FakeCall) => call.op === 'destroyMatching'], ['creation', (call: FakeCall) => call.op === 'create'], ['the runner upload', (call: FakeCall) => call.op === 'upload'],
    ['the integrity check', (call: FakeCall) => call.op === 'exec' && call.command === SANDBOX_COMMANDS.verifyRunner], ['the archive upload', (call: FakeCall) => call.op === 'uploadFile'],
    ['preparation', (call: FakeCall) => call.op === 'exec' && call.command === RUNNER_COMMANDS.prepare], ['the agent run', isRun], ['a stat', (call: FakeCall) => call.op === 'stat'], ['a download', (call: FakeCall) => call.op === 'download'],
  ])('reports a provider failure during %s as 502 sandbox-unavailable, which the queue retries', async (_label, matches) => {
    const { outcome } = setup({ fake: { fail: failOn(matches, new Error('socket hang up')) } });
    const { error } = await outcome();
    expect(error).toMatchObject({ http: 502, kind: 'http', retryable: true, diagnostic: { code: 'sandbox-unavailable', stage: 'plan' } });
    expect(error.diagnostic.reason).toBe(error.detail);
  });

  it('always fails with a PublishError carrying one of the design codes', async () => {
    const { outcome, deps } = setup();
    deps.articleUnits.mockImplementation(() => { throw new RangeError('unexpected'); });
    const { error } = await outcome();
    expect(error).toBeInstanceOf(PublishError);
    expect(SANDBOX_DIAGNOSTIC_CODES).toContain(error.diagnostic.code);
  });
});

describe('the run transcript', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'radar-transcript-test-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('is never read back when no transcript directory is configured, as in production', async () => {
    const { provider, start } = setup({ script: { turns: [box => { box.files.set(SANDBOX_PATHS.transcript, Buffer.from('gz')); return leave(box); }] } });
    await start();
    expect(provider.transcript()).not.toContain(SANDBOX_PATHS.transcript);
  });

  it('is saved to the configured directory in development, before the sandbox is destroyed', async () => {
    const { provider, start } = setup({ config: { transcriptDir: directory }, script: { turns: [box => { box.files.set(SANDBOX_PATHS.transcript, Buffer.from('gzipped-transcript')); return leave(box); }] } });
    await start();
    const saved = await readdir(directory);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(/^e_test-\d+\.jsonl\.gz$/);
    expect((await readFile(path.join(directory, saved[0]))).toString()).toBe('gzipped-transcript');
    expect(provider.ops().slice(-3)).toEqual([`stat:${SANDBOX_PATHS.transcript}`, `download:${SANDBOX_PATHS.transcript}`, 'destroy']);
  });

  it('never changes the outcome when it cannot be saved', async () => {
    const { provider, start } = setup({ config: { transcriptDir: directory }, fake: { fail: failOn(call => call.op === 'stat' && call.path === SANDBOX_PATHS.transcript) } });
    expect((await start()).engine).toBe('sandbox');
    expect(destroys(provider)).toBe(1);
  });
});
