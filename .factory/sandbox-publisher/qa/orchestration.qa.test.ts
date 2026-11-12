// QA-1: one sandbox attempt, driven through the in-memory provider (SBX-2, SBX-3, SBX-5, SBX-6, SBX-7).
// The orchestration, the capability and the publication gate are real; Daytona, the runner and the model are not.
// Every credential-shaped value is a placeholder made for this file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishError } from '@/server/services/publishing/http';
import { verifyPublishCapability } from '@/server/services/publishing/sandbox/capability';
import { FakeSandboxProvider, type FakeCall, type FakeExecCall, type FakeSandbox } from '@/server/services/publishing/sandbox/fake';
import { integrateWithSandbox, SANDBOX_COMMANDS } from '@/server/services/publishing/sandbox/run';
import { RUNNER_COMMANDS, RUNNER_SCRIPTS, SANDBOX_BUDGET, SANDBOX_PATHS, type AgentReport, type RunnerResult, type SandboxExecResult, type SandboxIntegrationInput, type SandboxPublisherConfig } from '@/server/services/publishing/sandbox/types';
import { QA_BLOCKS, payloadOf, toMarkdown, treeOf } from './helpers';

const SECRETS = {
  daytona: 'dtn_qa_placeholder_' + 'D1'.repeat(16),
  capabilitySecret: 'qa-capability-signing-' + 'S2'.repeat(14),
  github: 'gho_' + 'Qg'.repeat(18),
  anthropic: 'sk-ant-qa-placeholder-' + 'A3'.repeat(14),
  database: 'postgres://radar:qa-db-password-Z9@db.example.test:5432/radar',
  radarSecret: 'qa-radar-secret-key-' + 'K4'.repeat(14),
  openRouter: 'sk-or-qa-placeholder-' + 'R5'.repeat(14),
};
const CONFIG: SandboxPublisherConfig = {
  enabled: true, daytonaKey: SECRETS.daytona, snapshotId: '0f8fad5b-d9cb-469f-a165-70867728950e', proxyUrl: new URL('https://qa-model-proxy.example.test/model'),
  capabilitySecret: SECRETS.capabilitySecret, model: { catalogueId: 'claude-opus-5.5', apiId: 'claude-opus-5-5' }, maxUsd: 6, maxCalls: 200, attemptMs: 810_000, transcriptDir: null,
};
const P = payloadOf();
const ARTICLE_PATH = `content/blog/${P.slug}.md`;
const ARCHIVE_MARKER = 'QA-ARCHIVE-BYTES-7f3a';
const REPO = () => treeOf({ 'content/blog/first-post.md': '---\ntitle: "First"\n---\n\nHello.\n', 'README.md': '# QA\n' });

type Turn = (sandbox: FakeSandbox, call: FakeExecCall) => { files?: Record<string, string>; report?: Partial<AgentReport> | null; result?: Partial<RunnerResult> | null; exit?: number; output?: string };
const goodTurn: Turn = () => ({ files: { [ARTICLE_PATH]: `---\ntitle: "${P.title}"\n---\n\n${toMarkdown(QA_BLOCKS)}` } });

interface World { provider: FakeSandboxProvider; reports: unknown[][]; logs: Record<string, unknown>[]; archiveFetches: number; turns: Turn[]; probe?: SandboxExecResult | Error; prepare?: SandboxExecResult; nonRegular?: SandboxExecResult; capabilitiesSeen: string[] }
function world(options: ConstructorParameters<typeof FakeSandboxProvider>[0] = {}): World {
  const w: World = { provider: null as any, reports: [], logs: [], archiveFetches: 0, turns: [goodTurn], capabilitiesSeen: [] };
  let runs = 0;
  w.provider = new FakeSandboxProvider({
    ...options,
    exec: (call, sandbox) => {
      if (call.command === RUNNER_COMMANDS.probe) { if (w.probe instanceof Error) throw w.probe; return w.probe; }
      if (call.command === RUNNER_COMMANDS.prepare) return w.prepare;
      if (call.command === SANDBOX_COMMANDS.findNonRegular) return w.nonRegular;
      if (call.command !== RUNNER_COMMANDS.run) return;
      if (call.env?.ANTHROPIC_API_KEY) w.capabilitiesSeen.push(call.env.ANTHROPIC_API_KEY);
      const turn = w.turns[Math.min(runs++, w.turns.length - 1)](sandbox, call);
      const files = turn.files ?? {};
      for (const [path, content] of Object.entries(files)) sandbox.files.set(`${SANDBOX_PATHS.repo}/${path}`, Buffer.from(content));
      if (turn.report !== null) sandbox.files.set(SANDBOX_PATHS.report, Buffer.from(JSON.stringify({ version: 1, status: 'integrated', slug: P.slug, articlePath: ARTICLE_PATH, route: `/blog/${P.slug}`, summary: 'Added one Markdown file.', evidence: [], conventions: [], deviations: [], reason: null, ...turn.report })));
      if (turn.result !== null) sandbox.files.set(SANDBOX_PATHS.result, Buffer.from(JSON.stringify({ version: 1, status: 'completed', agentError: null, sessionId: null, turns: 4, changed: Object.entries(files).map(([path, content]) => ({ path, bytes: Buffer.byteLength(content) })), ...turn.result })));
      return { exitCode: turn.exit ?? (turn.result?.status && turn.result.status !== 'completed' ? 1 : 0), output: turn.output ?? '' };
    },
  });
  return w;
}
function inputOf(w: World, over: Partial<SandboxIntegrationInput> = {}, deadlineMs = CONFIG.attemptMs): SandboxIntegrationInput {
  const tree = REPO();
  return {
    config: CONFIG, hint: 'content/blog', payload: P, repo: 'qa-owner/qa-site', commitSha: 'a'.repeat(40), entries: [...tree.entries.values()],
    // The connector's closure holds the token; the stream it returns carries archive bytes only.
    fetchArchive: async () => { w.archiveFetches++; void SECRETS.github; return { stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(ARCHIVE_MARKER)); controller.close(); } }) }; },
    readBlob: tree.readBlob, options: { businessId: 'b_qa_business', deadlineAt: Date.now() + deadlineMs }, provider: w.provider, ...over,
  };
}
const run = (w: World, input = inputOf(w)) => integrateWithSandbox(input, { report: (async (...args: unknown[]) => { w.reports.push(args); }) as any, log: line => { w.logs.push(line); } });
async function failureOf(promise: Promise<unknown>): Promise<PublishError> { try { await promise; } catch (error) { expect(error).toBeInstanceOf(PublishError); return error as PublishError; } throw new Error('expected the attempt to fail'); }
/** Fake clock, real file I/O: step the clock a second at a time and let pending I/O callbacks run between steps. */
async function drive<T>(promise: Promise<T>, maxSeconds: number): Promise<T> {
  let done = false; let value: T | undefined; let thrown: unknown; let failed = false;
  promise.then(result => { done = true; value = result; }, error => { done = true; failed = true; thrown = error; });
  for (let second = 0; second < maxSeconds && !done; second++) { await vi.advanceTimersByTimeAsync(1000); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); }
  if (!done) throw new Error(`the attempt had not settled after ${maxSeconds} simulated seconds`);
  if (failed) throw thrown;
  return value as T;
}
const FAKE = { now: Date.UTC(2026, 10, 12, 9, 0, 0), toFake: ['setTimeout', 'clearTimeout', 'Date'] as ('setTimeout' | 'clearTimeout' | 'Date')[] };
const uploadedText = (call: FakeCall) => call.op === 'upload' ? call.files.map(file => file.data.toString('latin1')).join('\n') : call.op === 'uploadFile' ? call.data.toString('latin1') : '';

beforeEach(() => {
  for (const [name, value] of Object.entries({ DAYTONA_API_KEY: SECRETS.daytona, RADAR_PUBLISH_CAPABILITY_SECRET: SECRETS.capabilitySecret, ANTHROPIC_API_KEY: SECRETS.anthropic, DATABASE_URL: SECRETS.database, RADAR_SECRET_KEY: SECRETS.radarSecret, OPEN_ROUTER_API_KEY: SECRETS.openRouter, GITHUB_TOKEN: SECRETS.github })) vi.stubEnv(name, value);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('order: nothing from the repository or the article enters before egress is proven (SBX-3)', () => {
  it('deletes leftovers, creates, installs and verifies the runner, probes, and only then uploads content', async () => {
    const w = world();
    const integration = await run(w);
    expect(integration.engine).toBe('sandbox');
    const ops = w.provider.ops();
    const probeAt = ops.indexOf(`exec:${RUNNER_COMMANDS.probe}`);
    expect(ops[0]).toBe('destroyMatching');
    expect(ops[1]).toBe('create');
    expect(ops.indexOf(`exec:${SANDBOX_COMMANDS.verifyRunner}`)).toBeLessThan(probeAt);
    expect(probeAt).toBeLessThan(ops.indexOf(`uploadFile:${SANDBOX_PATHS.archive}`));
    expect(ops.at(-1)).toBe('destroy');
    // Before the probe: only the five runner scripts and their checksum manifest have been uploaded.
    const before = w.provider.calls.slice(0, w.provider.calls.findIndex(call => call.op === 'exec' && call.command === RUNNER_COMMANDS.probe));
    const uploadedBefore = before.flatMap(call => (call.op === 'upload' ? call.files.map(file => file.path) : call.op === 'uploadFile' ? [call.remotePath] : []));
    expect(uploadedBefore.sort()).toEqual([...RUNNER_SCRIPTS.map(name => `${SANDBOX_PATHS.runnerDir}/${name}`), `${SANDBOX_PATHS.runnerDir}/.radar-runner.sha256`].sort());
    const textBefore = before.map(uploadedText).join('\n') + JSON.stringify(before.filter(call => call.op !== 'upload' && call.op !== 'uploadFile'));
    for (const content of [ARCHIVE_MARKER, 'Tidewater Row', P.title, P.slug, 'qa-owner/qa-site']) expect(textBefore).not.toContain(content);
    expect(w.archiveFetches).toBe(1);
    // The sandbox was created for this entry, limited to the proxy host, with a hard TTL.
    const created = w.provider.calls.find(call => call.op === 'create') as Extract<FakeCall, { op: 'create' }>;
    expect(created.spec).toMatchObject({ snapshotId: CONFIG.snapshotId, allowDomain: 'qa-model-proxy.example.test', ttlMinutes: 30 });
    expect(created.spec.labels).toMatchObject({ workload: 'radar-publisher', env: 'development', entry: P.entryId });
    expect((w.provider.calls[0] as Extract<FakeCall, { op: 'destroyMatching' }>).labels).toEqual({ workload: 'radar-publisher', env: 'development', entry: P.entryId });
  });

  it.each([
    ['the probe exits non-zero', (w: World) => { w.probe = { exitCode: 1, output: 'radar-probe-failure code=canary_reachable host=api.github.com route=direct status=200\n' }; }],
    ['the probe cannot run', (w: World) => { w.probe = new Error('exec transport closed'); }],
  ])('fails closed when %s: no archive is fetched, no content is uploaded, the sandbox is destroyed, and the queue retries', async (_label, arrange) => {
    const w = world(); arrange(w);
    const error = await failureOf(run(w));
    expect(error.diagnostic?.code).toBe('sandbox-egress-unverified');
    expect(error.http).toBe(503);
    expect(error.retryable).toBe(true);
    expect(w.archiveFetches).toBe(0);
    expect(w.provider.ops().some(op => op.startsWith('uploadFile') || op.includes(SANDBOX_PATHS.task) || op.includes(SANDBOX_PATHS.articleJson))).toBe(false);
    expect(w.provider.count('destroy')).toBe(1);
    expect(w.provider.ops().at(-1)).toBe('destroy');
    expect(w.capabilitiesSeen).toEqual([]);
  });

  it('fails closed, before uploading even the runner, when the provider reports another allow-list than the one requested', async () => {
    for (const applied of ['*', 'qa-model-proxy.example.test,api.github.com', 'evil.example.test']) {
      const w = world({ appliedAllowDomain: () => applied });
      const error = await failureOf(run(w));
      expect(error.diagnostic?.code).toBe('sandbox-egress-unverified');
      expect(w.provider.count('upload') + w.provider.count('uploadFile') + w.provider.count('exec')).toBe(0);
      expect(w.provider.count('destroy')).toBe(1);
      expect(w.archiveFetches).toBe(0);
    }
  });

  it('a hostile probe output cannot write the diagnostic: only a short run of token characters survives', async () => {
    const w = world();
    w.probe = { exitCode: 1, output: `<script>alert(1)</script> https://attacker.example.test/?k=${SECRETS.github} \u0007 ${'A'.repeat(4000)}\nsecond line ${SECRETS.daytona}` };
    const error = await failureOf(run(w));
    const said = JSON.stringify(error.diagnostic) + error.message;
    // probe.mjs is trusted (uploaded and checksum-verified before any repository content exists), and what survives of
    // its output is at most 80 characters of letters, digits and a few separators from its first line.
    const quoted = /the egress probe failed \(([^)]*)\)/.exec(error.diagnostic!.reason)![1];
    expect(quoted.length).toBeLessThanOrEqual(80);
    expect(quoted).toMatch(/^[A-Za-z0-9_.:=\[\] -]*$/);
    for (const bad of ['<', '>', '/', 'http://', 'https://', SECRETS.github, SECRETS.daytona, 'second line']) expect(said).not.toContain(bad);
  });
});

describe('secrets: what crosses the provider boundary (SBX-2)', () => {
  it('no worker secret appears in any argument of any provider call, on success or failure', async () => {
    for (const arrange of [(_w: World) => {}, (w: World) => { w.turns = [() => ({ files: { [ARTICLE_PATH]: 'not the article\n' } })]; }, (w: World) => { w.probe = { exitCode: 1, output: 'x' }; }]) {
      const w = world(); arrange(w);
      await run(w).catch(() => {});
      const everything = w.provider.transcript();
      for (const [name, secret] of Object.entries(SECRETS)) expect([name, everything.includes(secret)]).toEqual([name, false]);
      expect(everything).not.toContain('db.example.test');
    }
  });

  it('the capability travels only in the environment of the agent exec, and is a real, bounded capability for this run', async () => {
    const w = world();
    const startedAt = Date.now();
    await run(w);
    expect(w.capabilitiesSeen).toHaveLength(1);
    const capability = w.capabilitiesSeen[0];
    const claims = verifyPublishCapability(capability, SECRETS.capabilitySecret)!;
    expect(claims).toMatchObject({ aud: 'radar-publish-model', bid: 'b_qa_business', entryId: P.entryId, model: 'claude-opus-5-5', maxUsd: 6, maxCalls: 200 });
    // Expires with the attempt: deadline plus a minute, never beyond the 20-minute ceiling.
    expect(claims.exp).toBeGreaterThanOrEqual(Math.floor((startedAt + CONFIG.attemptMs) / 1000) + 59);
    expect(claims.exp).toBeLessThanOrEqual(Math.floor((Date.now() + CONFIG.attemptMs) / 1000) + 61);
    for (const call of w.provider.calls) {
      const holds = JSON.stringify(call, (_key, value) => (Buffer.isBuffer(value) ? value.toString('latin1') : value && value.type === 'Buffer' ? Buffer.from(value.data).toString('latin1') : value)).includes(capability);
      const isAgentExec = call.op === 'exec' && call.command === RUNNER_COMMANDS.run;
      expect([call.op, call.op === 'exec' ? call.command : '', holds]).toEqual([call.op, call.op === 'exec' ? call.command : '', isAgentExec]);
    }
    const created = w.provider.calls.find(call => call.op === 'create') as Extract<FakeCall, { op: 'create' }>;
    expect(Object.keys(created.spec.env).filter(name => /KEY|SECRET|TOKEN|PASSWORD/i.test(name))).toEqual([]);
    // The label that names the run is the capability's run id, so proxy logs and sandboxes can be matched.
    expect(created.spec.labels.run).toBe(claims.runId);
  });

  it('agent statements are untrusted: a capability, an address, markup and a token in the report do not reach the integration', async () => {
    const w = world();
    w.turns = [(_sandbox, call) => ({ ...goodTurn(_sandbox, call), report: {
      summary: `Build passed. Tests passed. See https://attacker.example.test/payload and \`rm -rf\`. key ${call.env!.ANTHROPIC_API_KEY} ghp_${'Zz9'.repeat(12)} <img src=x onerror=alert(1)> @octocat`,
      conventions: [{ path: 'README.md', rule: `lint passed ${call.env!.ANTHROPIC_API_KEY}` }], deviations: [{ kind: 'other', detail: 'postgres://user:pw@db.internal/x' }],
    } })];
    const integration = await run(w);
    const said = JSON.stringify([integration.summary, integration.agentNotes, integration.review, integration.checks]);
    for (const bad of [w.capabilitiesSeen[0], 'rdrcap1.', 'attacker.example.test', 'ghp_', 'db.internal', 'user:pw']) expect(said).not.toContain(bad);
    // A claimed build never becomes a check: the checks are the control plane's own, and runtimeVerified stays false.
    expect(integration.review.runtimeVerified).toBe(false);
    expect(integration.checks.map(check => check.id).sort()).toEqual(['article-fidelity', 'ceilings', 'credentials', 'file-modes', 'identity', 'paths', 'peer-content', 'syntax']);
    expect(JSON.stringify(integration.checks) + integration.review.summary).not.toMatch(/build passed|tests passed|lint passed/i);
    expect(integration.notRun).toEqual(['dependency installation', 'repository build', 'lint', 'tests', 'deployment preview']);
  });

  // FINDING D3 (minor). The report contract and the pull-request builder allow an agent summary of 4,000 characters,
  // but the shared sanitizer cuts every string to 1,600. The summary is cut mid-word with no mark that it was cut
  // (seen live: the LivedHQ refresh pull-request body ends "... community-content.ts, rent/duba").
  it.fails('D3: an agent summary within its 4,000-character limit reaches the pull request whole, or is marked as cut', async () => {
    const w = world();
    const summary = Array.from({ length: 400 }, (_unused, n) => `word${n}`).join(' '); // about 3,300 characters
    w.turns = [(sandbox, call) => ({ ...goodTurn(sandbox, call), report: { summary } })];
    const integration = await run(w);
    expect(integration.summary === summary || /…$|\.\.\.$|truncated/i.test(integration.summary)).toBe(true);
  });
  it('D3 evidence: the summary is cut at 1,600 characters, in the middle of a word', async () => {
    const w = world();
    const summary = Array.from({ length: 400 }, (_unused, n) => `word${n}`).join(' ');
    w.turns = [(sandbox, call) => ({ ...goodTurn(sandbox, call), report: { summary } })];
    const integration = await run(w);
    expect(integration.summary).toHaveLength(1600);
    expect(summary.startsWith(integration.summary)).toBe(true);
    expect(summary[1600]).toMatch(/\S/);
  });

  it('a candidate name cannot make the collector read outside the extracted repository', async () => {
    const w = world();
    w.turns = [(sandbox, call) => ({ ...goodTurn(sandbox, call), result: { changed: [{ path: ARTICLE_PATH, bytes: 10 }, { path: '../../proc/self/environ', bytes: 10 }, { path: '/etc/passwd', bytes: 10 }, { path: 'content/../../../output/transcript.jsonl', bytes: 10 }] } })];
    const error = await failureOf(run(w));
    expect(error.diagnostic?.code).toBe('protected-path');
    const touched = w.provider.calls.flatMap(call => (call.op === 'stat' || call.op === 'download' ? [call.path] : []));
    for (const path of touched) expect(path.startsWith(`${SANDBOX_PATHS.repo}/`) && !path.includes('..') || path.startsWith(SANDBOX_PATHS.outputDir + '/')).toBe(true);
    expect(touched.some(path => /environ|passwd|transcript/.test(path))).toBe(false);
  });
});

describe('teardown on every path (SBX-6)', () => {
  const paths: [string, (w: World) => void, string][] = [
    ['an accepted integration', () => {}, 'integrated'],
    ['a gate refusal that is not repairable', w => { w.turns = [(s, c) => ({ files: goodTurn(s, c).files, result: { changed: [{ path: ARTICLE_PATH, bytes: 1 }, { path: `site/ghp_${'Aa1'.repeat(12)}.md`, bytes: 1 }] } })]; }, 'credential-detected'],
    ['a repairable refusal that fails again', w => { w.turns = [() => ({ files: { [ARTICLE_PATH]: 'A summary instead of the article.\n' } })]; }, 'article-fidelity'],
    ['the agent exec throwing', w => { w.turns = [() => { throw new Error('socket hang up'); }]; }, 'sandbox-unavailable'],
    ['a runner that leaves no result', w => { w.turns = [() => ({ result: null, report: null, exit: 137 })]; }, 'agent-failed'],
    ['a runner that leaves no report', w => { w.turns = [(s, c) => ({ ...goodTurn(s, c), report: null })]; }, 'agent-failed'],
    ['the agent declining', w => { w.turns = [() => ({ files: {}, report: { status: 'cannot_integrate', reason: 'The repository has no place for articles.' } })]; }, 'agent-declined'],
    ['workspace preparation failing', w => { w.prepare = { exitCode: 1, output: 'radar-prepare-failure code=archive_invalid\n' }; }, 'sandbox-unavailable'],
    ['an oversized repository', w => { w.prepare = { exitCode: 3, output: 'radar-prepare-failure code=expanded_too_large\n' }; }, 'workspace-too-large'],
    ['a link left in the workspace', w => { w.nonRegular = { exitCode: 0, output: '/workspace/repo/content/blog/link\n' }; }, 'non-regular-file'],
    ['the provider out of budget', w => { w.turns = [() => ({ result: { status: 'agent_error', agentError: 'AgentBudgetExhausted', changed: [] }, report: null })]; }, 'agent-budget'],
    ['the provider overloaded', w => { w.turns = [() => ({ result: { status: 'agent_error', agentError: 'AgentApiError:529', changed: [] }, report: null })]; }, 'analysis-unavailable'],
    ['the runner reporting its deadline', w => { w.turns = [() => ({ result: { status: 'deadline', agentError: 'RunnerDeadline', changed: [] }, report: null })]; }, 'publishing-deadline'],
  ];
  it.each(paths)('destroys the sandbox exactly once, as the last provider call, after %s', async (_label, arrange, outcome) => {
    const w = world(); arrange(w);
    const result = await run(w).then(() => 'integrated', (error: PublishError) => error.diagnostic?.code ?? `http-${error.http}`);
    expect(result).toBe(outcome);
    expect(w.provider.count('create')).toBe(1);
    expect(w.provider.count('destroy')).toBe(1);
    expect(w.provider.ops().at(-1)).toBe('destroy');
    expect(w.provider.sandboxes[0].destroyed).toBe(true);
    expect(w.logs).toHaveLength(1);
    expect(w.logs[0]).toMatchObject({ entry: P.entryId, destroyed: true, outcome });
    expect(Object.keys(w.logs[0]).sort()).toEqual(['destroyed', 'entry', 'ms', 'outcome', 'repaired', 'sandbox', 'turns']);
  });

  it('a sandbox that cannot be created leaves nothing to destroy and is retried by the queue', async () => {
    const w = world({ fail: call => (call.op === 'create' ? new Error(`quota exceeded for key ${SECRETS.daytona}`) : undefined) });
    const error = await failureOf(run(w));
    expect(error.diagnostic?.code).toBe('sandbox-unavailable');
    expect(error.retryable).toBe(true);
    expect(JSON.stringify(error.diagnostic) + error.message).not.toContain(SECRETS.daytona);
    expect(w.provider.sandboxes).toHaveLength(0);
    expect(w.archiveFetches).toBe(0);
  });

  it('a failed delete is reported with the entry and does not change an accepted outcome', async () => {
    const w = world({ fail: call => (call.op === 'destroy' ? new Error(`delete refused, key ${SECRETS.daytona}`) : undefined) });
    const integration = await run(w);
    expect(integration.files.map(file => file.path)).toEqual([ARTICLE_PATH]);
    expect(w.reports).toHaveLength(1);
    const [error, context] = w.reports[0] as [Error, Record<string, unknown>];
    expect(context).toMatchObject({ source: 'publishing', operation: 'publishing.sandbox.teardown', ref: P.entryId, code: 'sandbox-teardown-failed', businessId: 'b_qa_business' });
    expect(error.message).toMatch(/30-minute TTL/);
    expect(error.message).not.toContain(SECRETS.daytona);
    expect(w.logs[0]).toMatchObject({ destroyed: false, outcome: 'integrated' });
  });

  it('a failed delete does not hide the reason an attempt failed', async () => {
    const w = world({ fail: call => (call.op === 'destroy' ? new Error('delete refused') : undefined) });
    w.probe = { exitCode: 1, output: 'x' };
    expect((await failureOf(run(w))).diagnostic?.code).toBe('sandbox-egress-unverified');
    expect(w.reports).toHaveLength(1);
  });
});

describe('one absolute deadline (SBX-7)', () => {
  it('the job timeout leaves room for the attempt deadline plus teardown, and the capability cannot outlive the ceiling', () => {
    expect(SANDBOX_BUDGET.jobTimeoutMs).toBeGreaterThan(SANDBOX_BUDGET.attemptMs + (SANDBOX_BUDGET.destroySec + SANDBOX_BUDGET.gitWritesSec) * 1000);
    expect(SANDBOX_BUDGET.attemptMs / 1000 + SANDBOX_BUDGET.capabilityGraceSec).toBeLessThanOrEqual(20 * 60);
    expect(SANDBOX_BUDGET.ttlMinutes * 60_000).toBeGreaterThan(SANDBOX_BUDGET.jobTimeoutMs);
  });

  it('an attempt with too little time left creates no sandbox at all', async () => {
    const w = world();
    const error = await failureOf(run(w, inputOf(w, {}, 60_000)));
    expect(error.diagnostic?.code).toBe('publishing-deadline');
    expect(w.provider.calls).toHaveLength(0);
  });

  it('a hung agent exec ends inside the attempt deadline with the deadline code, and the sandbox is still destroyed', async () => {
    vi.useFakeTimers(FAKE);
    const w = world({ hang: call => call.op === 'exec' && call.command === RUNNER_COMMANDS.run });
    const started = Date.now();
    const error = await failureOf(drive(run(w), 900));
    expect(error.diagnostic?.code).toBe('publishing-deadline');
    expect(error.retryable).toBe(false);
    expect(w.provider.count('destroy')).toBe(1);
    expect(w.provider.ops().at(-1)).toBe('destroy');
    const agentExec = w.provider.execs().find(call => call.command === RUNNER_COMMANDS.run)!;
    expect(agentExec.timeoutSec).toBeLessThanOrEqual(SANDBOX_BUDGET.agentMaxSec);
    // The attempt ends with the time reserved for Git writes still unspent, well inside the 13.5 minutes.
    expect(Date.now() - started).toBeLessThanOrEqual(CONFIG.attemptMs - SANDBOX_BUDGET.gitWritesSec * 1000);
  });

  it('a hung create is abandoned at its stage budget and is retried by the queue', async () => {
    vi.useFakeTimers(FAKE);
    const w = world({ hang: call => call.op === 'create' });
    const started = Date.now();
    const error = await failureOf(drive(run(w), 300));
    expect(error.diagnostic?.code).toBe('sandbox-unavailable');
    expect(error.retryable).toBe(true);
    expect(Date.now() - started).toBeLessThanOrEqual((SANDBOX_BUDGET.createSec + 5) * 1000);
    expect(w.archiveFetches).toBe(0);
  });

  it('a hung delete does not hold the attempt past its teardown budget, and is reported', async () => {
    vi.useFakeTimers(FAKE);
    let destroyAt = 0;
    const w = world({ hang: call => { if (call.op !== 'destroy') return false; destroyAt = Date.now(); return true; } });
    const integration = await drive(run(w), 180);
    expect(integration.engine).toBe('sandbox');
    // Measured from the delete call (simulated time): the 30 s teardown budget, then the report, bounded at 5 s.
    expect(Date.now() - destroyAt).toBeLessThanOrEqual((SANDBOX_BUDGET.destroySec + 6) * 1000);
    expect(w.reports).toHaveLength(1);
    expect(w.logs[0]).toMatchObject({ destroyed: false });
  });
});

describe('repair round', () => {
  it('feedback handed to the agent is written by the control plane and carries no article or source text', async () => {
    const w = world();
    const broken = toMarkdown(QA_BLOCKS).replace('17 degrees', '19 degrees');
    w.turns = [() => ({ files: { [ARTICLE_PATH]: `---\ntitle: "x"\n---\n\n${broken}` } }), goodTurn];
    const integration = await run(w);
    expect(integration.files).toHaveLength(1);
    expect(w.provider.execs().filter(call => call.command === RUNNER_COMMANDS.run)).toHaveLength(2);
    const feedbackUpload = w.provider.calls.find(call => call.op === 'upload' && call.files.some(file => file.path === SANDBOX_PATHS.feedback)) as Extract<FakeCall, { op: 'upload' }>;
    const feedback = feedbackUpload.files.find(file => file.path === SANDBOX_PATHS.feedback)!.data.toString();
    expect(JSON.parse(feedback).issues[0].code).toBe('article-fidelity');
    for (const phrase of ['trickle vents', '19 degrees', '17 degrees', 'Tidewater']) expect(feedback).not.toContain(phrase);
    // Both turns used the same capability: a repair does not get a second budget.
    expect(new Set(w.capabilitiesSeen).size).toBe(1);
    expect(w.logs[0]).toMatchObject({ repaired: true, outcome: 'integrated' });
    expect(w.provider.count('create')).toBe(1);
  });
});
