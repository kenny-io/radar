// Types for run.mjs, so Radar's TypeScript tests can import the runner script.
import type { Scope, ToolScopeHookOutput } from './write-scope.mjs';

export declare const RUN_ENV: Readonly<{ capability: string; proxyUrl: string; model: string }>;
export interface RunLimits {
  outputBytes: number; rawReportBytes: number; taskBytes: number; feedbackBytes: number; feedbackIssues: number; maxTurns: number;
  agentMaxSec: number; stopLeadSec: number; minimumTurnMs: number; abortGraceMs: number; changedListed: number;
  transcriptBytes: number; transcriptLineBytes: number;
}
export declare const RUN_LIMITS: Readonly<RunLimits>;
export interface RunPaths {
  repo: string; inputDir: string; outputDir: string; task: string; feedback: string; report: string; result: string;
  transcript: string; baseline: string; session: string;
}
export declare const RUN_PATHS: Readonly<RunPaths>;
export declare const PROVIDER_ERROR_LIMITS: Readonly<{ typeChars: number; messageChars: number; scannedChars: number }>;
export interface ProviderError { type: string | null; message: string }
export interface RunnerTask { mode: 'new' | 'refresh'; limits: { changedFiles: number; fileBytes: number }; deadlineEpochMs: number | null }
export interface ChangedFile { path: string; bytes: number }
export interface RunnerResultValue {
  version: 1; status: 'completed' | 'agent_error' | 'deadline'; agentError: string | null; sessionId: string | null; turns: number; changed: ChangedFile[];
  /** agent_error only: what the provider or proxy said when it rejected a model request. Bounded and redacted. */
  providerError?: ProviderError;
}
export interface AgentHookMatcher { matcher?: string; hooks: ((input: unknown) => Promise<ToolScopeHookOutput>)[] }
export interface AgentOptions {
  cwd: string; additionalDirectories: string[]; model: string; settingSources: string[]; skills: string[];
  mcpServers: Record<string, never>; strictMcpConfig: boolean; tools: string[]; allowedTools: string[];
  hooks: { PreToolUse: AgentHookMatcher[] }; permissionMode: string; allowDangerouslySkipPermissions: boolean; maxTurns: number;
  env: Record<string, string | undefined>; abortController: AbortController; resume?: string;
}
export type AgentQuery = (parameters: { prompt: string; options: AgentOptions }) => AsyncIterable<unknown>;

export declare function readTask(taskPath: string, limits?: RunLimits): Promise<RunnerTask>;
export declare function readFeedback(feedbackPath: string, limits?: RunLimits): Promise<{ codes: string[] } | null>;
export declare function readBaseline(baselinePath: string, maxBytes?: number): Promise<Map<string, string>>;
export declare function findChangedFiles(repo: string, baseline: Map<string, string>): Promise<{ changed: ChangedFile[]; deleted: string[]; unchanged: number }>;
export declare function normalizeReport(value: unknown, maxBytes?: number): { ok: true; report: Record<string, unknown> } | { ok: false; code: 'AgentReportInvalid' | 'AgentReportTooLarge' };
export declare function finalizeReport(reportPath: string, limits?: RunLimits, secret?: string): Promise<{ ok: true } | { ok: false; code: string }>;
export declare function buildResult(
  input: { status: RunnerResultValue['status']; agentError?: string | null; sessionId?: string | null; turns?: number; changed?: ChangedFile[]; providerError?: { type?: unknown; message?: unknown } | null },
  limits?: RunLimits,
): RunnerResultValue;
export declare function buildPrompt(input: {
  mode: 'new' | 'refresh'; limits: { changedFiles: number; fileBytes: number };
  paths?: Pick<RunPaths, 'repo' | 'inputDir' | 'report' | 'task' | 'feedback'>; repair?: { codes: string[]; resumed: boolean } | null;
}): string;
export declare function buildAgentOptions(input: {
  scope: Scope; model: string; environment: Record<string, string | undefined>; abortController: AbortController; resume?: string | null; maxTurns?: number;
}): AgentOptions;
export declare function classifyResultMessage(message: unknown): string | null;
export declare function readProviderError(message: unknown, secret?: string): ProviderError | null;
export declare function computeStopAt(input: { startedAt: number; deadlineEpochMs: number | null }, limits?: RunLimits): number;
export declare function runAgent(input: {
  query: AgentQuery; paths?: RunPaths; environment?: Record<string, string | undefined>; limits?: RunLimits; now?: () => number; stopSignal?: AbortSignal;
}): Promise<{ exitCode: number; line: string; result: RunnerResultValue }>;
