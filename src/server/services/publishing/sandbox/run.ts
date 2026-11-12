// One sandbox publishing attempt (.factory/sandbox-publisher/architecture.md §0, §3, §5, §6, §8, §9):
//   1 delete leftover sandboxes for the entry   2 create (egress = the proxy host only)   3 prove egress is restricted
//   4 upload the pinned archive and the article  5 run the trusted runner                 6 collect and gate
//   7 at most one repair turn, then gate again   8 destroy the sandbox, always, before returning or throwing
// Nothing from the repository or the article enters the sandbox before step 3 has passed. The sandbox never receives the
// GitHub token (it stays in the connector's closures), the Daytona key or the capability secret; the only secret that
// enters is the per-run capability, in the exec environment of the runner. One absolute deadline governs the attempt:
// every provider call takes its timeout from the time remaining and nothing is awaited past it.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import type { PublishDiagnostic, PublishDiagnosticReason } from '@/lib/types';
import { env } from '@/server/env';
import { reportFailure } from '@/server/observability/failures';
import { PublishError, publishingDeadlineError, publishingDiagnosticText } from '../http';
import { daytonaProvider } from './daytona';
import { articleFiles, buildPublishTask, feedbackFile, taskFile, withPinnedArchive, workspaceTooLarge } from './workspace';
import {
  AgentReportSchema, GATE_LIMITS, REPAIRABLE_GATE_CODES, RUN_OUTPUT_MAX_BYTES, RUNNER_COMMANDS, RUNNER_ENV, RUNNER_SCRIPTS, RUNNER_SOURCE_DIR,
  RunnerResultSchema, SANDBOX_BUDGET, SANDBOX_NOT_RUN, SANDBOX_OPERATIONS, SANDBOX_PATHS, SANDBOX_TEARDOWN_FAILED_CODE, SANDBOX_WORKLOAD,
  type AgentReport, type ArticleUnitsOf, type IntegrateWithSandbox, type MintPublishCapability, type PublicationGateResult, type RepairFeedback,
  type RunnerResult, type RunPublicationGate, type SandboxDiagnosticCode, type SandboxExecResult, type SandboxHandle, type SandboxIntegration,
  type SandboxIntegrationInput, type SandboxLabels,
} from './types';

type Stage = PublishDiagnostic['stage'];
const B = SANDBOX_BUDGET;

/** Sandbox-wide variables (§5). Settings only: a credential never travels this way. */
export const SANDBOX_ENV = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTO_COMPACT: '1', USE_API_CONTEXT_MANAGEMENT: '0' } as const;
/** Checksums of the uploaded runner scripts, verified in the sandbox before any of them runs. */
export const RUNNER_MANIFEST = '.radar-runner.sha256';
/** Trusted commands that are not runner scripts. None uses shell syntax and none takes a value from the repository. */
export const SANDBOX_COMMANDS = {
  verifyRunner: `sha256sum --check ${RUNNER_MANIFEST}`,
  makeInput: `mkdir -p ${SANDBOX_PATHS.inputDir}`,
  /** Prints the first object under the repository that is neither a regular file nor a directory, without following
   *  links. No output means every candidate, and every directory above it, is what it appears to be. */
  findNonRegular: `find ${SANDBOX_PATHS.repo} ! -type f ! -type d -print -quit`,
} as const;
/** prepare.mjs exits with this code, and prints a `code=..._too_large` token, when an archive or expansion ceiling is passed. */
const PREPARE_TOO_LARGE = { exitCode: 3, token: /code=[a-z_-]*too[-_]large/ } as const;
/** Development and QA only (config.transcriptDir is always null in production). */
const TRANSCRIPT_MAX_BYTES = 5_000_000;

export interface SandboxRunDependencies {
  /** Default: gate.ts `runPublicationGate`. */
  gate: RunPublicationGate;
  /** Default: capability.ts `mintPublishCapability`. */
  mintCapability: MintPublishCapability;
  /** Default: fidelity.ts `articleUnits`, the same function the gate uses. */
  articleUnits: ArticleUnitsOf;
  /** Default: RUNNER_SCRIPTS read from <working directory>/sandbox/publisher. */
  readRunnerScripts(): Promise<{ name: string; data: Buffer }[]>;
  report: typeof reportFailure;
  newRunId(): string;
  /** One line per run: entry, sandbox id, duration, turns, outcome code. Never content. */
  log(line: Record<string, unknown>): void;
}
async function defaultRunnerScripts(): Promise<{ name: string; data: Buffer }[]> {
  const directory = path.resolve(process.cwd(), RUNNER_SOURCE_DIR);
  return Promise.all(RUNNER_SCRIPTS.map(async name => ({ name, data: await readFile(path.join(directory, name)) })));
}
/** The real gate, capability and fidelity modules are loaded here, on first use, and only when a caller did not supply one. */
async function resolveDependencies(given: Partial<SandboxRunDependencies>): Promise<SandboxRunDependencies> {
  return {
    gate: given.gate ?? (await import('./gate')).runPublicationGate,
    mintCapability: given.mintCapability ?? (await import('./capability')).mintPublishCapability,
    articleUnits: given.articleUnits ?? (await import('./fidelity')).articleUnits,
    readRunnerScripts: given.readRunnerScripts ?? defaultRunnerScripts,
    report: given.report ?? reportFailure,
    newRunId: given.newRunId ?? randomUUID,
    log: given.log ?? (line => console.info('[radar.publish.sandbox]', JSON.stringify(line))),
  };
}

/** How a failed agent turn is reported, from the runner's bounded error token (run.mjs writes AgentBudgetExhausted,
 *  AgentApiError:<status>, AgentThrown:<error name>, AgentResult:<subtype> and Runner* tokens). A spent run budget is
 *  final; a provider or proxy outage is retried by the queue; anything else, including a request the provider refused
 *  with a 4xx, is not retried, because a retry would spend the run budget again on the same repository. */
export function classifyAgentError(token: string | null): 'agent-budget' | 'analysis-unavailable' | 'agent-failed' {
  const value = (token || '').toLowerCase();
  if (value.includes('budget')) return 'agent-budget';
  const status = /api.?error:(\d{3})$/.exec(value)?.[1];
  if (status) return status === '408' || status === '429' || status.startsWith('5') ? 'analysis-unavailable' : 'agent-failed';
  if (/overload|unavailable|rate.?limit|api.?(?:connection|timeout|status|error)|upstream|provider|proxy|econn|etimedout|network|fetch.?failed|(?<![0-9])(?:429|5\d\d)(?![0-9])/.test(value)) return 'analysis-unavailable';
  return 'agent-failed';
}

class CallTimeout extends Error {}
/** Settles with the call or rejects after `seconds`, whichever is first. An abandoned call is left to finish alone. */
async function bounded<T>(seconds: number, call: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = call();
  work.catch(() => {});
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new CallTimeout()), seconds * 1000); })]);
  } finally { clearTimeout(timer); }
}

/** A traversal-free relative path. Policy (protected paths, credentials) is the gate's; this only keeps a candidate
 *  name from addressing anything outside the extracted repository. */
const plainRelativePath = (value: string) => value.length > 0 && value.length <= 500 && !value.startsWith('/') && !/[\\\x00-\x1f\x7f]/.test(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..');
/** Exec output is untrusted and may quote repository text: only a short run of token characters from its first line survives. */
const outputToken = (output: string) => (output.split('\n').find(line => line.trim()) || '').replace(/[^A-Za-z0-9_.:= -]/g, '').replace(/ +/g, ' ').trim().slice(0, 80) || 'no diagnostic';
const errorToken = (value: string | null) => (value || '').replace(/[^A-Za-z0-9_:.-]/g, '').slice(0, 80) || 'unknown';
const errorName = (error: unknown) => (error instanceof Error ? error.name : 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 60) || 'Error';

export async function integrateWithSandbox(input: SandboxIntegrationInput, dependencies: Partial<SandboxRunDependencies> = {}): Promise<SandboxIntegration> {
  const { config, payload } = input;
  const startedAt = Date.now();
  const deadlineAt = input.options.deadlineAt;
  /** Sandbox work ends here, so teardown and then the Git writes always have their reserved time. */
  const workEndsAt = deadlineAt - (B.destroySec + B.gitWritesSec) * 1000;
  const proxyHost = config.proxyUrl.hostname.toLowerCase();
  const proxyUrl = config.proxyUrl.href.replace(/\/$/, '');
  const secrets = [config.daytonaKey, config.capabilitySecret];

  // ---- failures: bounded, sanitized, and never carrying a secret this module holds --------------------------------
  const safe = (text: string, limit = 300) => publishingDiagnosticText(secrets.reduce((value, secret) => (secret ? value.split(secret).join('[redacted]') : value), text).replace(/rdrcap1\.[A-Za-z0-9._~+/=-]*/g, '[redacted]'), limit);
  const failure = (http: number, kind: 'http' | 'config', code: SandboxDiagnosticCode, stage: Stage, text: string) => {
    const reason = safe(text);
    return new PublishError(http, reason, '', kind, { code, stage, reason });
  };
  const unavailable = (stage: Stage, what: string, cause?: unknown) => failure(502, 'http', 'sandbox-unavailable', stage,
    `${what}${cause === undefined ? '' : ` (${errorName(cause)}${cause instanceof Error && cause.message ? `: ${cause.message}` : ''})`}.`);
  const egressUnverified = (why: string) => failure(503, 'http', 'sandbox-egress-unverified', 'plan',
    `Radar could not confirm that the sandbox reaches only the model proxy: ${why}. No repository content was uploaded.`);
  const atDeadline = () => Date.now() >= workEndsAt - 1000;

  // ---- time: every stage is a window that also ends when sandbox work must end ------------------------------------
  const windowOf = (budgetSec: number) => Math.min(Date.now() + budgetSec * 1000, workEndsAt);
  /** Whole seconds left before `endsAt`. An attempt that cannot fit the next call fails here, before starting it. */
  const secondsLeft = (endsAt: number, stage: Stage, what: string): number => {
    const seconds = Math.floor((Math.min(endsAt, workEndsAt) - Date.now()) / 1000);
    if (seconds >= 1) return seconds;
    throw atDeadline() ? publishingDeadlineError(stage) : unavailable(stage, `${what} did not fit in the time budgeted for its stage`);
  };
  /** One provider call: timeout from the time remaining, a backstop timer so a hung call is abandoned, and the design's mapping. */
  const provide = async <T>(what: string, endsAt: number, stage: Stage, call: (timeoutSec: number) => Promise<T>): Promise<T> => {
    const seconds = secondsLeft(endsAt, stage, what);
    try { return await bounded(seconds, () => call(seconds)); } catch (error) {
      if (error instanceof PublishError) throw error;
      if (atDeadline()) throw publishingDeadlineError(stage);
      throw error instanceof CallTimeout ? unavailable(stage, `${what} did not finish within ${seconds} seconds`) : unavailable(stage, `${what} failed`, error);
    }
  };

  let handle: SandboxHandle | null = null;
  let turns = 0;
  let repaired = false;
  let deps: SandboxRunDependencies;
  try { deps = await resolveDependencies(dependencies); } catch (error) { throw unavailable('plan', 'The sandbox publisher could not be loaded', error); }

  const attempt = async (): Promise<SandboxIntegration> => {
    secondsLeft(workEndsAt, 'plan', 'The sandbox run');
    const provider = input.provider ?? daytonaProvider(config.daytonaKey);
    const runId = deps.newRunId();
    const labels: SandboxLabels = { workload: SANDBOX_WORKLOAD, env: env.isProd ? 'production' : 'development', entry: payload.entryId, run: runId };

    // 1 A previous attempt's sandbox may still be running after a worker restart. The job key allows one run per entry.
    await provide('Deleting leftover sandboxes', windowOf(B.destroySec), 'plan', timeoutSec => provider.destroyMatching({ workload: labels.workload, env: labels.env, entry: labels.entry }, timeoutSec));

    // 2 Create. A sandbox that appears after this call gave up is deleted rather than left to its TTL.
    const createSeconds = secondsLeft(windowOf(B.createSec), 'plan', 'Creating the sandbox');
    const creating = provider.create({ snapshotId: config.snapshotId, allowDomain: proxyHost, ttlMinutes: B.ttlMinutes, labels: { ...labels }, env: { ...SANDBOX_ENV }, timeoutSec: createSeconds });
    try { handle = await bounded(createSeconds, () => creating); } catch (error) {
      creating.then(late => late.destroy(B.destroySec).catch(() => {}), () => {});
      if (atDeadline()) throw publishingDeadlineError('plan');
      throw error instanceof CallTimeout ? unavailable('plan', `Creating the sandbox did not finish within ${createSeconds} seconds`) : unavailable('plan', 'Creating the sandbox failed', error);
    }
    const sandbox = handle;

    // 3 Fail closed (SBX-3). First what the provider says it applied, then what the sandbox can actually reach.
    if (sandbox.appliedAllowDomain !== null && sandbox.appliedAllowDomain.trim().toLowerCase() !== proxyHost) throw egressUnverified('the sandbox reports a different network allow-list than the one requested');
    const scripts = await deps.readRunnerScripts().catch(error => { throw unavailable('plan', 'The runner scripts could not be read', error); });
    if (scripts.length !== RUNNER_SCRIPTS.length || RUNNER_SCRIPTS.some(name => !scripts.some(script => script.name === name))) throw unavailable('plan', 'The runner scripts are incomplete');
    const manifest = scripts.map(script => `${createHash('sha256').update(script.data).digest('hex')}  ${script.name}\n`).join('');
    const installEndsAt = windowOf(B.uploadSec);
    await provide('Uploading the runner', installEndsAt, 'plan', timeoutSec => sandbox.upload([
      ...scripts.map(script => ({ path: `${SANDBOX_PATHS.runnerDir}/${script.name}`, data: script.data })),
      { path: `${SANDBOX_PATHS.runnerDir}/${RUNNER_MANIFEST}`, data: Buffer.from(manifest) },
    ], timeoutSec));
    const verified = await provide('Verifying the runner', installEndsAt, 'plan', timeoutSec => sandbox.exec(SANDBOX_COMMANDS.verifyRunner, { cwd: SANDBOX_PATHS.runnerDir, timeoutSec }));
    if (verified.exitCode !== 0) throw unavailable('plan', 'The runner scripts failed their integrity check in the sandbox');
    const probeSeconds = secondsLeft(windowOf(B.probeSec), 'plan', 'The egress probe');
    let probe: SandboxExecResult;
    try { probe = await bounded(probeSeconds, () => sandbox.exec(RUNNER_COMMANDS.probe, { cwd: SANDBOX_PATHS.runnerDir, env: { [RUNNER_ENV.proxyUrl]: proxyUrl }, timeoutSec: probeSeconds })); } catch (error) {
      if (atDeadline()) throw publishingDeadlineError('plan');
      throw egressUnverified(error instanceof CallTimeout ? `the egress probe did not finish within ${probeSeconds} seconds` : `the egress probe could not run (${errorName(error)})`);
    }
    if (probe.exitCode !== 0) throw egressUnverified(`the egress probe failed (${outputToken(probe.output)})`);

    // 4 Only now does repository or article content enter the sandbox. The archive goes from GitHub to a temporary file
    // to the sandbox; the token that fetched it stays in the connector.
    const archiveSeconds = secondsLeft(windowOf(B.archiveSec), 'plan', 'Downloading the repository archive');
    try {
      await withPinnedArchive({ fetchArchive: input.fetchArchive, timeoutMs: archiveSeconds * 1000 }, async archive => {
        const uploadEndsAt = windowOf(B.uploadSec);
        const made = await provide('Preparing the input directory', uploadEndsAt, 'plan', timeoutSec => sandbox.exec(SANDBOX_COMMANDS.makeInput, { timeoutSec }));
        if (made.exitCode !== 0) throw unavailable('plan', 'The sandbox input directory could not be created');
        await provide('Uploading the repository archive', uploadEndsAt, 'plan', timeoutSec => sandbox.uploadFile(archive.path, SANDBOX_PATHS.archive, timeoutSec));
        await provide('Uploading the article', uploadEndsAt, 'plan', timeoutSec => sandbox.upload(articleFiles(payload, deps.articleUnits), timeoutSec));
      });
    } catch (error) {
      if (error instanceof PublishError && error.diagnostic) throw error;
      if (atDeadline()) throw publishingDeadlineError('plan');
      // A GitHub or network failure from the connector's own request keeps its status and retry behavior.
      throw error instanceof PublishError ? error : unavailable('plan', 'The repository archive could not be staged', error);
    }
    const prepared = await provide('Preparing the workspace', windowOf(B.prepareSec), 'plan', timeoutSec => sandbox.exec(RUNNER_COMMANDS.prepare, { cwd: '/workspace', timeoutSec }));
    if (prepared.exitCode !== 0) throw prepared.exitCode === PREPARE_TOO_LARGE.exitCode || PREPARE_TOO_LARGE.token.test(prepared.output) ? workspaceTooLarge('The repository') : unavailable('plan', `The workspace could not be prepared (${outputToken(prepared.output)})`);

    // 5 The agent budget is one window shared by the first turn and the repair turn.
    const agentEndsAt = Math.min(Date.now() + B.agentMaxSec * 1000, deadlineAt - B.agentReserveSec * 1000);
    let capability = '';
    const entries = new Map(input.entries.map(entry => [entry.path, entry]));

    const readOutput = async <S extends z.ZodTypeAny>(file: string, schema: S, endsAt: number, stage: Stage): Promise<z.infer<S> | null> => {
      const found = await provide('Reading the run output', endsAt, stage, () => sandbox.stat(file));
      if (!found || found.isDir || found.size < 1 || found.size > RUN_OUTPUT_MAX_BYTES) return null;
      const bytes = await provide('Reading the run output', endsAt, stage, timeoutSec => sandbox.download(file, RUN_OUTPUT_MAX_BYTES, timeoutSec));
      try {
        const parsed = schema.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
        return parsed.success ? parsed.data : null;
      } catch { return null; }
    };

    /** One runner execution and the collection of what it left. Everything read back is untrusted. */
    const turn = async (stage: Stage, feedback?: RepairFeedback): Promise<{ result: RunnerResult; report: AgentReport; finals: Map<string, Buffer> }> => {
      const fits = () => agentEndsAt - Date.now() > B.runnerStopLeadSec * 1000;
      if (!fits()) throw publishingDeadlineError(stage);
      capability ||= deps.mintCapability({
        runId, bid: input.options.businessId, entryId: payload.entryId, model: config.model.apiId, maxUsd: config.maxUsd, maxCalls: config.maxCalls,
        exp: Math.floor(deadlineAt / 1000) + B.capabilityGraceSec,
      }, config.capabilitySecret);
      if (!secrets.includes(capability)) secrets.push(capability);
      const task = buildPublishTask({ runId, hint: input.hint, payload, repo: input.repo, commitSha: input.commitSha, options: input.options, deadlineEpochMs: agentEndsAt });
      await provide('Uploading the task', Math.min(windowOf(B.uploadSec), agentEndsAt), stage, timeoutSec => sandbox.upload([taskFile(task), ...(feedback ? [feedbackFile(feedback)] : [])], timeoutSec));
      if (!fits()) throw publishingDeadlineError(stage);
      const runSeconds = Math.floor((agentEndsAt - Date.now()) / 1000);
      let ran: SandboxExecResult;
      try {
        ran = await bounded(runSeconds, () => sandbox.exec(RUNNER_COMMANDS.run, {
          cwd: SANDBOX_PATHS.repo, timeoutSec: runSeconds,
          env: { [RUNNER_ENV.capability]: capability, [RUNNER_ENV.proxyUrl]: proxyUrl, [RUNNER_ENV.model]: config.model.apiId },
        }));
      } catch (error) {
        // The runner stops itself before its timeout, so a turn that is still running then has used its whole budget.
        if (error instanceof CallTimeout || atDeadline() || Date.now() >= agentEndsAt - 1000) throw publishingDeadlineError(stage);
        throw unavailable(stage, 'Running the agent failed', error);
      }

      // 6 Collect: result, then report, then each changed-file candidate, every one size-checked before download.
      const collectEndsAt = windowOf(B.collectGateSec);
      const result = await readOutput(SANDBOX_PATHS.result, RunnerResultSchema, collectEndsAt, stage);
      if (result) turns += result.turns;
      if (ran.exitCode !== 0 || !result || result.status !== 'completed') {
        if (result?.status === 'deadline') throw publishingDeadlineError(stage);
        if (result?.status === 'agent_error') {
          const token = errorToken(result.agentError);
          const kind = classifyAgentError(result.agentError);
          if (kind === 'analysis-unavailable') throw failure(502, 'http', kind, stage, `The model provider was unavailable during the agent run (${token}).`);
          if (kind === 'agent-budget') throw failure(422, 'config', kind, stage, `The agent run reached its model budget before finishing (${token}).`);
          throw failure(422, 'config', kind, stage, `The agent run ended with an error (${token}) after ${result.turns} turns.`);
        }
        throw failure(422, 'config', 'agent-failed', stage, result ? `The runner exited with code ${ran.exitCode}, which contradicts the result it wrote.` : `The runner exited with code ${ran.exitCode} and left no valid result.`);
      }
      const report = await readOutput(SANDBOX_PATHS.report, AgentReportSchema, collectEndsAt, stage);
      if (!report) throw failure(422, 'config', 'agent-failed', stage, 'The agent finished without a valid report, so its changes cannot be published.');

      const finals = new Map<string, Buffer>();
      const candidates = result.changed.length > GATE_LIMITS.candidates ? [] : [...new Set(result.changed.map(change => change.path))].filter(plainRelativePath);
      if (candidates.length) {
        const odd = await provide('Checking the workspace', collectEndsAt, stage, timeoutSec => sandbox.exec(SANDBOX_COMMANDS.findNonRegular, { cwd: '/workspace', timeoutSec }));
        if (odd.exitCode !== 0) throw unavailable(stage, 'The sandbox workspace could not be checked for non-regular files');
        if (odd.output.trim()) throw failure(422, 'config', 'non-regular-file', 'validation', 'The agent run left a link or special file in the repository workspace; only regular files can be published.');
      }
      for (let at = 0; at < candidates.length; at += 8) {
        await Promise.all(candidates.slice(at, at + 8).map(async candidate => {
          const remote = `${SANDBOX_PATHS.repo}/${candidate}`;
          const found = await provide('Reading a changed file', collectEndsAt, stage, () => sandbox.stat(remote));
          // A candidate left out here is refused by the gate, which reports the path under its own code.
          if (!found || found.isDir || found.size > GATE_LIMITS.fileBytes) return;
          finals.set(candidate, await provide('Reading a changed file', collectEndsAt, stage, timeoutSec => sandbox.download(remote, GATE_LIMITS.fileBytes, timeoutSec)));
        }));
      }
      return { result, report, finals };
    };

    const gate = async (collected: Awaited<ReturnType<typeof turn>>): Promise<PublicationGateResult> => {
      const seconds = Math.floor((workEndsAt - Date.now()) / 1000);
      if (seconds < 1) throw publishingDeadlineError('validation');
      try {
        return await bounded(seconds, () => deps.gate({ payload, hint: input.hint, entries, report: collected.report, result: collected.result, finals: collected.finals, readBlob: input.readBlob, options: input.options, capability }));
      } catch (error) {
        if (error instanceof CallTimeout) throw publishingDeadlineError('validation');
        throw error;
      }
    };

    let collected = await turn('plan');
    let gated: PublicationGateResult;
    try { gated = await gate(collected); } catch (error) {
      // 7 One repair turn, when the failure is one the agent can fix and enough of the agent budget is left.
      const diagnostic = error instanceof PublishError ? error.diagnostic : undefined;
      const repairable = !!diagnostic && (REPAIRABLE_GATE_CODES as readonly string[]).includes(diagnostic.code) && (error as { repairable?: unknown }).repairable !== false;
      if (!repairable || agentEndsAt - Date.now() < B.repairMinSec * 1000) throw error;
      repaired = true;
      const { origin: _origin, ...origin } = diagnostic;
      const issues = (diagnostic.issues?.length ? diagnostic.issues : [diagnostic.reason]).slice(0, 20);
      const feedback: RepairFeedback = { version: 1, issues: issues.map(detail => ({ code: diagnostic.code, ...(diagnostic.path ? { path: safe(diagnostic.path, 500) } : {}), detail: safe(detail, 500) })) };
      try {
        collected = await turn('repair', feedback);
        gated = await gate(collected);
      } catch (second) {
        // The second result is final. It keeps its own code and retry behavior and records what the repair was for.
        if (!(second instanceof PublishError) || !second.diagnostic) throw second;
        throw new PublishError(second.http, second.detail, second.host, second.kind, { ...second.diagnostic, stage: 'repair', origin: origin as PublishDiagnosticReason });
      }
    }

    const { report } = collected;
    const statement = (text: string, limit: number) => safe(text.replace(/`([^`\n]{1,200})`/g, '$1'), limit);
    return {
      engine: 'sandbox',
      slug: report.slug,
      path: report.articlePath,
      files: gated.files,
      summary: statement(report.summary, 4000),
      route: report.route,
      discovery: [],
      review: { summary: `Radar ran ${gated.checks.length} checks on the exact files in this change: ${gated.checks.map(check => check.id).join(', ')}. Nothing from the repository was installed, built or executed.`, runtimeVerified: false },
      draft: true,
      checks: gated.checks,
      agentNotes: {
        conventions: report.conventions.map(note => statement(`${note.path}: ${note.rule}`, 400)).filter(Boolean),
        deviations: report.deviations.map(note => statement(`${note.kind}: ${note.detail}`, 400)).filter(Boolean),
      },
      notRun: [...SANDBOX_NOT_RUN],
      mediaOmitted: gated.mediaOmitted,
      ...(gated.unchanged ? { unchanged: true as const } : {}),
    };
  };

  /** Development and QA only. Best effort: a transcript that cannot be saved never changes the outcome. */
  const saveTranscript = async (sandbox: SandboxHandle, directory: string): Promise<void> => {
    const seconds = Math.min(10, Math.floor((workEndsAt - Date.now()) / 1000));
    if (seconds < 1) return;
    await bounded(seconds, async () => {
      const found = await sandbox.stat(SANDBOX_PATHS.transcript);
      if (!found || found.isDir || found.size < 1 || found.size > TRANSCRIPT_MAX_BYTES) return;
      const bytes = await sandbox.download(SANDBOX_PATHS.transcript, TRANSCRIPT_MAX_BYTES, seconds);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, `${payload.entryId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)}-${startedAt}.jsonl.gz`), bytes, { mode: 0o600 });
    });
  };

  /** 8 Always, and before any Git write. A sandbox that could not be deleted is reported; its hard TTL still removes
   *  it, so the attempt's own outcome stands (SBX-6). */
  const teardown = async (): Promise<boolean> => {
    const sandbox = handle as SandboxHandle | null;
    if (!sandbox) return true;
    if (config.transcriptDir) await saveTranscript(sandbox, config.transcriptDir).catch(() => {});
    const seconds = Math.min(B.destroySec, Math.max(1, Math.ceil((deadlineAt - Date.now()) / 1000)));
    try { await bounded(seconds, () => sandbox.destroy(seconds)); return true; } catch (error) {
      const text = safe(`Sandbox ${sandbox.id} was not destroyed${error instanceof CallTimeout ? ` within ${seconds} seconds` : ` (${errorName(error)}${error instanceof Error && error.message ? `: ${error.message}` : ''})`}. Its ${B.ttlMinutes}-minute TTL will remove it.`);
      try {
        await bounded(5, () => deps.report(new Error(text), { source: 'publishing', operation: SANDBOX_OPERATIONS.teardown, businessId: input.options.businessId, ref: payload.entryId, provider: 'daytona', code: SANDBOX_TEARDOWN_FAILED_CODE }));
      } catch { /* Reporting never replaces the attempt's outcome. */ }
      return false;
    }
  };

  let integration: SandboxIntegration | undefined;
  let failed: PublishError | undefined;
  let destroyed = true;
  try { integration = await attempt(); } catch (error) {
    failed = error instanceof PublishError ? error : unavailable('plan', 'The sandbox run failed unexpectedly', error);
  } finally {
    destroyed = await teardown();
  }
  // Git writes follow. Without their reserved time the attempt ends here, before anything is written.
  if (!failed && deadlineAt - Date.now() < B.gitWritesSec * 1000) failed = publishingDeadlineError('plan');
  try {
    deps.log({ entry: payload.entryId, sandbox: (handle as SandboxHandle | null)?.id ?? null, ms: Date.now() - startedAt, turns, repaired, destroyed, outcome: failed ? failed.diagnostic?.code ?? `http-${failed.http}` : 'integrated' });
  } catch { /* A log line never changes the outcome. */ }
  if (failed) throw failed;
  return integration!;
}
integrateWithSandbox satisfies IntegrateWithSandbox;
