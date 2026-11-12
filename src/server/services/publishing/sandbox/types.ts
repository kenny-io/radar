// Shared contracts for the sandbox publisher (.factory/sandbox-publisher/architecture.md). Types, schemas and constants
// only: no behavior lives here beyond `shortenAgentText`, the one bound the orchestration and the pull request body both
// apply to agent-written text, and nothing here imports @daytona/sdk, the AI client or the database.
// Section numbers (§) refer to that design. Sizes are decimal (1 MB = 1,000,000 bytes), as in the design's task limits.
import { z } from 'zod';
import type { Block } from '@/lib/types';
import type { PublishPayload } from '../types';
import type { RepoEntry, RepositoryPostOptions, RepositoryPostPlan } from '../connectors/nextjs-agent';

// ---------------------------------------------------------------------------------------------------------------------
// Configuration (§9). config.ts implements `sandboxPublisher`.

export const SANDBOX_DEFAULT_MODEL = 'claude-opus-5.5';
export const SANDBOX_DEFAULT_MAX_USD = 6;
export const SANDBOX_DEFAULT_MAX_CALLS = 200;
/** One absolute deadline for a sandbox attempt (13.5 min). The planner keeps its own 270 s. */
export const SANDBOX_ATTEMPT_MS = 810_000;
/** Shortest accepted RADAR_PUBLISH_CAPABILITY_SECRET. The worker and the model proxy apply the same floor. */
export const CAPABILITY_SECRET_MIN_LENGTH = 32;

/** Why the planner engine is used instead. `missing` names environment variables only, never their values. */
export interface SandboxPublisherDisabled {
  enabled: false;
  /** off: switch unset, empty or `off`. not-listed: a business list that omits this business. unconfigured: switched on
   *  for this business but a variable is missing or invalid; the caller reports it and falls back to the planner. */
  reason: 'off' | 'not-listed' | 'unconfigured';
  missing?: string[];
}
/** Validated worker configuration. Holds secrets (`daytonaKey`, `capabilitySecret`): never log or serialise it, and never
 *  pass either value to a sandbox provider call. */
export interface SandboxPublisherConfig {
  enabled: true;
  daytonaKey: string;
  /** Immutable snapshot UUID. */
  snapshotId: string;
  /** https://<proxy host>/model. `proxyUrl.hostname` is the sandbox's only allowed egress host. */
  proxyUrl: URL;
  capabilitySecret: string;
  /** `catalogueId` is Radar's id (ai_calls, prices); `apiId` is what Anthropic is called with and what the capability carries. */
  model: { catalogueId: string; apiId: string };
  maxUsd: number;
  maxCalls: number;
  attemptMs: typeof SANDBOX_ATTEMPT_MS;
  /** Local directory for run transcripts in development and QA. Always null in production. */
  transcriptDir: string | null;
}
export type SandboxPublisher = SandboxPublisherDisabled | SandboxPublisherConfig;

// ---------------------------------------------------------------------------------------------------------------------
// Lifecycle budgets and ceilings (§6, §7, §8)

/** Every provider call takes its timeout from the remaining attempt deadline, capped by its stage value. */
export const SANDBOX_BUDGET = {
  attemptMs: SANDBOX_ATTEMPT_MS,
  /** publish.entry job timeout. Must stay above attemptMs plus teardown so the internal deadline always wins. */
  jobTimeoutMs: 16 * 60_000,
  createSec: 120,
  probeSec: 30,
  archiveSec: 120,
  uploadSec: 120,
  prepareSec: 180,
  /** Agent turn: min(agentMaxSec, remaining - agentReserveSec). */
  agentMaxSec: 540,
  agentReserveSec: 150,
  /** The runner stops its turn this long before its exec timeout. */
  runnerStopLeadSec: 20,
  collectGateSec: 30,
  /** Reserved outside the stage budgets; runs in `finally`. */
  destroySec: 30,
  /** Git writes need at least this much of the attempt left. */
  gitWritesSec: 45,
  /** A repair round needs at least this much agent budget left. */
  repairMinSec: 150,
  /** Daytona hard TTL: bounds a leak when the worker dies. */
  ttlMinutes: 30,
  /** Capability expiry = attempt deadline + this. */
  capabilityGraceSec: 60,
} as const;

/** Over a ceiling: PublishError 422 `workspace-too-large`. */
export const WORKSPACE_LIMITS = { treeEntries: 30_000, archiveBytes: 150_000_000, expandedEntries: 100_000, expandedBytes: 1_000_000_000 } as const;
/** What the agent is told (task.json `limits`). */
export const TASK_LIMITS = { changedFiles: 16, fileBytes: 1_000_000 } as const;
/** Gate ceilings that the collector also needs. Peer-content and fidelity thresholds are named in gate.ts and fidelity.ts. */
export const GATE_LIMITS = { candidates: 64, changedFiles: TASK_LIMITS.changedFiles, fileBytes: TASK_LIMITS.fileBytes, totalBytes: 2_000_000, netGrowthBytes: 400_000 } as const;
/** report.json and result.json are each refused above this size. */
export const RUN_OUTPUT_MAX_BYTES = 64_000;

// ---------------------------------------------------------------------------------------------------------------------
// Sandbox provider (§1.2). daytona.ts implements it on @daytona/sdk through a dynamic import; fake.ts is the test double.

export const SANDBOX_WORKLOAD = 'radar-publisher';
export const SANDBOX_USER = 'radar-agent';
/** Labels on every publishing sandbox. Leftovers are found with { workload, env, entry }. */
export type SandboxLabels = { workload: typeof SANDBOX_WORKLOAD; env: 'production' | 'development'; entry: string; run: string };

export interface SandboxSpec {
  snapshotId: string;
  /** Host name only (no scheme, port or path): the model proxy. */
  allowDomain: string;
  ttlMinutes: number;
  labels: Record<string, string>;
  /** Sandbox-wide variables. Never a credential: the capability travels only in the runner's exec environment. */
  env: Record<string, string>;
  timeoutSec: number;
}
export interface SandboxExecResult { exitCode: number; output: string }
export interface SandboxHandle {
  readonly id: string;
  /** The allow-list the provider reports back, when it reports one. */
  readonly appliedAllowDomain: string | null;
  upload(files: { path: string; data: Buffer }[], timeoutSec: number): Promise<void>;
  uploadFile(localPath: string, remotePath: string, timeoutSec: number): Promise<void>;
  exec(command: string, o: { cwd?: string; env?: Record<string, string>; timeoutSec: number }): Promise<SandboxExecResult>;
  /** null when the path does not exist. */
  stat(path: string): Promise<{ size: number; isDir: boolean } | null>;
  /** Stats first; throws when the file is larger than maxBytes. */
  download(path: string, maxBytes: number, timeoutSec: number): Promise<Buffer>;
  /** Resolves once deletion is observed; not-found is success. */
  destroy(timeoutSec: number): Promise<void>;
}
export interface SandboxProvider {
  create(spec: SandboxSpec): Promise<SandboxHandle>;
  /** Deletes every sandbox carrying all of these labels; resolves with how many were deleted. */
  destroyMatching(labels: Record<string, string>, timeoutSec: number): Promise<number>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sandbox layout and runner protocol (§3). The runner scripts are plain .mjs and cannot import this file; their tests
// should assert against these values.

export const SANDBOX_PATHS = {
  runnerDir: '/opt/radar-agent',
  /** path -> git blob sha1 of every extracted file, written by prepare.mjs. */
  baseline: '/opt/radar-agent/baseline.json',
  inputDir: '/workspace/input',
  archive: '/workspace/input/repo.tar.gz',
  task: '/workspace/input/task.json',
  articleMarkdown: '/workspace/input/article.md',
  articleHtml: '/workspace/input/article.html',
  articleJson: '/workspace/input/article.json',
  /** Repair round only. */
  feedback: '/workspace/input/feedback.json',
  /** Extracted tree; the agent's cwd. */
  repo: '/workspace/repo',
  outputDir: '/output',
  /** Written by the agent. */
  report: '/output/report.json',
  /** Written by the runner. */
  result: '/output/result.json',
  transcript: '/output/transcript.jsonl.gz',
} as const;
/** Where the runner scripts live in Radar's checkout (repository root). Uploaded per run and verified with sha256sum --check. */
export const RUNNER_SOURCE_DIR = 'sandbox/publisher';
export const RUNNER_SCRIPTS = ['run.mjs', 'prepare.mjs', 'probe.mjs', 'agent-environment.mjs', 'write-scope.mjs'] as const;
/** Exec commands. Exit code 0 is success; any other outcome fails the stage. Output is at most one bounded diagnostic line. */
export const RUNNER_COMMANDS = {
  /** Reads RUNNER_ENV.proxyUrl. Succeeds only when <proxy>/health answers 200 and every canary host is unreachable. */
  probe: 'node /opt/radar-agent/probe.mjs',
  prepare: 'node /opt/radar-agent/prepare.mjs',
  /** Resumes the saved session when SANDBOX_PATHS.feedback exists. */
  run: 'node /opt/radar-agent/run.mjs',
} as const;
/** Exec-environment variable names. The capability is passed to `run` only, never as a sandbox-wide variable. */
export const RUNNER_ENV = {
  /** The per-run capability, in the variable the Agent SDK reads its key from. */
  capability: 'ANTHROPIC_API_KEY',
  /** config.proxyUrl without a trailing slash. */
  proxyUrl: 'ANTHROPIC_BASE_URL',
  /** config.model.apiId, for the SDK's `model` option. The proxy enforces the capability's model whatever is sent. */
  model: 'RADAR_AGENT_MODEL',
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// Task contract and article payload (§3). workspace.ts writes them; the runner and the agent read them.

export interface ArticleIdentity { slug: string; articlePath: string }
export interface PublishTask {
  version: 1;
  /** uuid; also the capability's runId and the sandbox `run` label. */
  runId: string;
  mode: 'new' | 'refresh';
  hint: string;
  repository: { fullName: string; commitSha: string };
  article: {
    title: string; seoTitle: string; description: string; slug: string; date: string; keyword: string;
    author: string; authorSource: 'business-profile-fallback';
    image: { url: string; alt: string } | null;
    canonical: string | null; refreshUrl: string | null;
    sources: { title: string; url: string }[];
    videos: { id: string; title: string; url: string }[];
    bodyImages: { url: string; alt: string }[];
  };
  identity: { retry: ArticleIdentity | null; legacy: ArticleIdentity | null };
  limits: { changedFiles: number; fileBytes: number };
  deadlineEpochMs: number;
}

export type ArticleUnitKind = 'heading' | 'paragraph' | 'item';
/** One unit of prose the fidelity check looks for: each h2 or h3 is a heading, each p a paragraph, each ul entry an item.
 *  `index` is the unit's 0-based position in document order across all kinds. */
export interface ArticleUnit { index: number; kind: ArticleUnitKind; text: string }
/** article.json. article.md and article.html are payload.markdown and payload.html unchanged. */
export interface ArticlePayloadFile { blocks: Block[]; units: ArticleUnit[] }
/** fidelity.ts exports `articleUnits` with this signature; workspace.ts and the gate both call it so the agent is told
 *  exactly the units the gate will check. */
export type ArticleUnitsOf = (blocks: Block[]) => ArticleUnit[];

// ---------------------------------------------------------------------------------------------------------------------
// Run outputs (§3). Both files are untrusted input to the control plane: parse with these schemas after the size check.

/** Agent-written text that reaches a pull request: the summary is bounded at the report contract's own limit, each
 *  convention or deviation note at `noteChars`. A longer text is cut at a word boundary and ends with `shortenedMarker`,
 *  so a reader can see that it was shortened; `wordSearchChars` is how far back a word boundary is looked for before
 *  the cut falls inside a word. */
export const AGENT_TEXT = { summaryChars: 4000, noteChars: 400, shortenedMarker: ' … (truncated by Radar)', wordSearchChars: 80 } as const;
/** `text` unchanged when it fits in `limit` characters; otherwise its start, cut at a word boundary, plus the marker,
 *  within `limit` in all. */
export function shortenAgentText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const marker = AGENT_TEXT.shortenedMarker;
  // A limit too small to hold the marker never occurs with the limits above; the text is then simply cut.
  if (limit <= marker.length) return text.slice(0, Math.max(0, limit));
  const room = limit - marker.length;
  let cut = room;
  if (!/\s/.test(text.charAt(room))) {
    const floor = Math.max(0, room - AGENT_TEXT.wordSearchChars);
    let at = room;
    while (at > floor && !/\s/.test(text.charAt(at - 1))) at--;
    if (at > floor) cut = at;
  }
  return text.slice(0, cut).trimEnd() + marker;
}

const EvidenceRole = z.enum(['content', 'route', 'listing', 'navigation', 'config']);
/** /output/report.json, written by the agent. Its statements are shown as unverified; none of them is a check. */
export const AgentReportSchema = z.object({
  version: z.literal(1),
  status: z.enum(['integrated', 'cannot_integrate']),
  slug: z.string(),
  articlePath: z.string(),
  route: z.string(),
  summary: z.string().max(AGENT_TEXT.summaryChars),
  evidence: z.array(z.object({ role: EvidenceRole, path: z.string(), note: z.string() }).strict()).max(24),
  conventions: z.array(z.object({ path: z.string(), rule: z.string() }).strict()).max(20),
  deviations: z.array(z.object({ kind: z.enum(['punctuation', 'media-omitted', 'links-relocated', 'structure', 'other']), detail: z.string() }).strict()).max(20),
  /** Set with status cannot_integrate. */
  reason: z.string().nullable(),
}).strict();
export type AgentReport = z.infer<typeof AgentReportSchema>;

/** Bounds of RunnerResult.providerError. sandbox/publisher/run.mjs mirrors them; runner.test.ts fails on drift. */
export const PROVIDER_ERROR_LIMITS = { typeChars: 64, messageChars: 300 } as const;
/** /output/result.json, written by the runner: first as a preliminary failure, then finalised. */
export const RunnerResultSchema = z.object({
  version: z.literal(1),
  status: z.enum(['completed', 'agent_error', 'deadline']),
  /** A bounded token such as AgentResult:error_max_turns, never free text from the model. */
  agentError: z.string().nullable(),
  /** Saved SDK session, resumed by the repair round. */
  sessionId: z.string().nullable(),
  turns: z.number().int().nonnegative(),
  /** Regular files whose git blob hash differs from the baseline (lstat, links never followed). Candidates only: the
   *  gate verifies every one on bytes the control plane downloaded. */
  changed: z.array(z.object({ path: z.string(), bytes: z.number().int().nonnegative() }).strict()),
  /** Present only with status agent_error, and only when the provider or the model proxy rejected a model request:
   *  the provider's error type (a lower-case identifier such as invalid_request_error, null when it gave none) and its
   *  message, as the SDK reported them. The runner removes control characters, redacts the capability and anything
   *  capability-shaped, and cuts the message to PROVIDER_ERROR_LIMITS.messageChars. Never model output or repository
   *  text. Still untrusted here: it goes through publishingDiagnosticText before it is shown to an operator. */
  providerError: z.object({
    type: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).nullable(),
    message: z.string().min(1).max(PROVIDER_ERROR_LIMITS.messageChars),
  }).strict().nullable().optional(),
}).strict();
export type RunnerResult = z.infer<typeof RunnerResultSchema>;

/** Gate failures the agent may fix in the single repair round. */
export const REPAIRABLE_GATE_CODES = ['article-fidelity', 'syntax-invalid', 'peer-content-changed', 'changed-file-count', 'protected-path'] as const;
export type RepairableGateCode = typeof REPAIRABLE_GATE_CODES[number];
/** feedback.json. Text is written by the control plane and carries no source or article excerpts. */
export interface RepairFeedback { version: 1; issues: { code: string; path?: string; detail: string }[] }

// ---------------------------------------------------------------------------------------------------------------------
// Model capability and proxy (§4). capability.ts implements mint and verify; modelProxy.ts serves the routes.

export const CAPABILITY_PREFIX = 'rdrcap1';
export const CAPABILITY_AUDIENCE = 'radar-publish-model';
/** A capability is refused when `exp` is further ahead than this, or when the token is longer than the length cap. */
export const CAPABILITY_MAX_TTL_SEC = 20 * 60;
export const CAPABILITY_MAX_LENGTH = 4096;
/** Token: rdrcap1.<base64url(JSON claims)>.<base64url(HMAC-SHA256(secret, 'rdrcap1.' + claims))>. */
export interface PublishCapabilityClaims {
  v: 1;
  aud: typeof CAPABILITY_AUDIENCE;
  /** uuid */
  runId: string;
  bid: string;
  entryId: string;
  /** Provider API id the proxy forces on every request. */
  model: string;
  maxUsd: number;
  maxCalls: number;
  /** Issued at and expiry, in epoch seconds. */
  iat: number;
  exp: number;
}
/** `now` is epoch milliseconds (default Date.now()); `iat` is derived from it. */
export type MintPublishCapability = (input: Omit<PublishCapabilityClaims, 'v' | 'aud' | 'iat'>, secret: string, now?: number) => string;
/** null for any token that is malformed, tampered with, expired, for another audience or over the TTL or length cap. */
export type VerifyPublishCapability = (token: string, secret: string, now?: number) => PublishCapabilityClaims | null;

/** The proxy URL's path must end with this; the proxy serves nothing outside it. */
export const MODEL_PROXY_BASE_PATH = '/model';
/** Routes relative to the proxy URL. `health` answers 200 without authentication and is the egress probe's target. */
export const MODEL_PROXY_ROUTES = { health: '/health', messages: '/v1/messages', countTokens: '/v1/messages/count_tokens' } as const;
/** ai_calls.purpose for every upstream call the proxy makes. */
export const SANDBOX_AI_PURPOSE = 'github.integration.agent';

// ---------------------------------------------------------------------------------------------------------------------
// Publication gate (§7). gate.ts exports `runPublicationGate` with this signature; run.ts depends on the signature only.

export const PUBLISH_CHECK_IDS = ['paths', 'credentials', 'ceilings', 'file-modes', 'syntax', 'peer-content', 'article-fidelity', 'identity'] as const;
/** A check the control plane ran on the exact bytes that will be committed. A failing check never produces one: the gate throws. */
export interface PublishCheck { id: typeof PUBLISH_CHECK_IDS[number]; outcome: 'passed'; detail: string }
/** Always printed in the pull request as not run. No v1 run installs, builds or executes anything from the repository. */
export const SANDBOX_NOT_RUN = ['dependency installation', 'repository build', 'lint', 'tests', 'deployment preview'] as const;

export interface PublicationGateInput {
  payload: PublishPayload;
  hint: string;
  /** The pinned tree by path. */
  entries: Map<string, RepoEntry>;
  report: AgentReport;
  result: RunnerResult;
  /** Bytes the control plane downloaded, by repository path: every `result.changed` candidate that was a regular file
   *  within GATE_LIMITS.fileBytes. A candidate missing from this map fails the gate. When `result.changed` holds more
   *  than GATE_LIMITS.candidates paths nothing needs downloading: the gate fails on the count. */
  finals: Map<string, Buffer>;
  /** Pinned blob content, for original-versus-final comparison. */
  readBlob(sha: string): Promise<Buffer>;
  options: RepositoryPostOptions;
  /** This run's capability string, so the gate can refuse any file that contains it. */
  capability: string;
}
export interface PublicationGateResult {
  /** Verified changed files, as they will be committed. */
  files: { path: string; content: string }[];
  /** One passed entry per check id that ran. Details carry positions and counts, never article or source text; headings
   *  a template did not carry are listed in the article-fidelity detail. */
  checks: PublishCheck[];
  /** Body-image URLs, video ids, source URLs and links not found in the final files. Disclosed in the pull request, not fatal. */
  mediaOmitted: string[];
  /** A retry that found the branch already complete: no commit is written. */
  unchanged: boolean;
}
/** Throws PublishError(422, reason, '', 'config', { code, stage: 'validation', reason, path?, actual?, limit?, issues? })
 *  on the first violation; every reason has passed publishingDiagnosticText. */
export type RunPublicationGate = (input: PublicationGateInput) => Promise<PublicationGateResult>;

// ---------------------------------------------------------------------------------------------------------------------
// Integration result and connector seam (§1.1). run.ts exports `integrateWithSandbox`.

/** What the sandbox engine hands to the existing transport. Successor of RepositoryPostPlan. */
export interface SandboxIntegration extends RepositoryPostPlan {
  engine: 'sandbox';
  discovery: [];
  /** Executed by the control plane only. */
  checks: PublishCheck[];
  /** Sanitized agent statements, shown as unverified. */
  agentNotes: { conventions: string[]; deviations: string[] };
  notRun: string[];
  /** From the gate: media and links the destination format did not carry. */
  mediaOmitted: string[];
  /** A retry found the branch already complete; no new commit. */
  unchanged?: true;
}
export interface SandboxIntegrationInput {
  config: SandboxPublisherConfig;
  hint: string;
  payload: PublishPayload;
  /** owner/name */
  repo: string;
  /** The pinned parent the transport commits onto. */
  commitSha: string;
  entries: RepoEntry[];
  /** GET /repos/{repo}/tarball/{commitSha}. A closure in nextjs.ts that holds the token; run.ts never sees credentials. */
  fetchArchive(signal: AbortSignal): Promise<{ stream: ReadableStream<Uint8Array> }>;
  /** GET /repos/{repo}/git/blobs/{sha} */
  readBlob(sha: string): Promise<Buffer>;
  options: RepositoryPostOptions & { deadlineAt: number };
  /** Tests inject fake.ts. */
  provider?: SandboxProvider;
}
/** Resolves with a gated integration or throws PublishError; the sandbox is destroyed before it settles either way. */
export type IntegrateWithSandbox = (input: SandboxIntegrationInput) => Promise<SandboxIntegration>;

/** The `Radar-Post:` trailer of a commit the sandbox engine wrote (§8, amended after QA-1 defect D5). `body` is 16 hex
 *  characters of a SHA-256 over the article (title, slug, markdown, html, meta, date, mode, refreshUrl). `tree` is the
 *  SHA of the tree the commit was written with, and `sig` an HMAC-SHA256 (base64url) over entryId, hint, slug,
 *  articlePath, route, body and tree, keyed with a key derived from the application secret (RADAR_SECRET_KEY) for
 *  COMMIT_MARKER_KEY_PURPOSE. A retry reuses the commit only when `sig` verifies and the head commit's tree is `tree`.
 *  Markers written before signing existed have neither field; they, and any marker that fails either check, are
 *  handled like a version 2 marker: the engine runs again on the branch head with the retry identity. */
export interface SandboxCommitMarker {
  version: 3; entryId: string; hint: string; slug: string; articlePath: string; route: string; engine: 'sandbox'; body: string;
  tree?: string; sig?: string;
}
/** Domain separation for the marker key: HMAC-SHA256(application secret, this string) is the key, used for nothing else. */
export const COMMIT_MARKER_KEY_PURPOSE = 'radar:publishing:commit-marker:v1';

export const SANDBOX_DRAFT_LAYOUT = 'sandbox-agent';
/** How a sandbox draft relates to what was already on the article branch. Absent for the first commit on a new branch.
 *  added: this attempt committed on top of an earlier attempt's commit. unchanged: the agent ran and the branch was
 *  already complete, so nothing was committed. resumed: an earlier attempt's gated commit was reused and no agent ran
 *  (its check details, agent notes and omitted-media list were never persisted, and the pull request says so). */
export type SandboxContinuation = 'added' | 'unchanged' | 'resumed';
/** RemoteDraft.extra for a sandbox draft, persisted on the entry and validated again by publish(). */
export interface SandboxDraftExtra {
  base: string;
  path: string;
  slug: string;
  layout: typeof SANDBOX_DRAFT_LAYOUT;
  /** Changed paths. `path` is one of them. */
  files: string[];
  summary: string;
  route: string;
  checks: PublishCheck[];
  agentNotes: SandboxIntegration['agentNotes'];
  notRun: string[];
  mediaOmitted: string[];
  review: { summary: string; runtimeVerified: false };
  draft: true;
  /** The proposed slug was unavailable. */
  taken?: true;
  continuation?: SandboxContinuation;
}

// ---------------------------------------------------------------------------------------------------------------------
// Diagnostics (§8, §9). Every sandbox failure is a PublishError with a PublishDiagnostic; stages reuse the existing
// union (sandbox and agent stages are `plan`, the gate is `validation`, the repair round is `repair`). §8 says which
// failures the queue retries.

export const SANDBOX_DIAGNOSTIC_CODES = [
  'sandbox-unavailable', 'sandbox-egress-unverified', 'analysis-unavailable', 'workspace-too-large',
  'agent-failed', 'agent-budget', 'agent-declined', 'plan-empty',
  'protected-path', 'non-regular-file', 'changed-file-count', 'final-output-size', 'credential-detected', 'syntax-invalid',
  'peer-content-changed', 'article-fidelity', 'identity-changed', 'publishing-deadline',
] as const;
export type SandboxDiagnosticCode = typeof SANDBOX_DIAGNOSTIC_CODES[number];
/** reportFailure operations outside the entry's own failure path. Neither changes the attempt's outcome. */
export const SANDBOX_OPERATIONS = { config: 'publishing.sandbox.config', teardown: 'publishing.sandbox.teardown' } as const;
export const SANDBOX_TEARDOWN_FAILED_CODE = 'sandbox-teardown-failed';
