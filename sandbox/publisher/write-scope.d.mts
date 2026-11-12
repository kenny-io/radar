// Types for write-scope.mjs, so Radar's TypeScript tests can import the runner script.
export declare const LAYOUT: Readonly<Record<
  'runnerDir' | 'baseline' | 'inputDir' | 'archive' | 'task' | 'articleMarkdown' | 'articleHtml' | 'articleJson' | 'feedback' | 'repo' | 'outputDir' | 'report' | 'result' | 'transcript',
  string
>>;
export declare const AGENT_TOOLS: readonly string[];
export interface Scope { readonly repo: string; readonly inputDir: string; readonly outputDir: string; readonly report: string }
export interface ScopeDecision { allow: boolean; reason: string }
export interface ToolScopeHookOutput {
  continue?: boolean;
  hookSpecificOutput?: { hookEventName: 'PreToolUse'; permissionDecision: 'allow' | 'deny'; permissionDecisionReason: string };
}
export declare function createScope(paths?: { repo?: string; inputDir?: string; outputDir?: string; report?: string }): Scope;
export declare function isInside(root: string, path: string): boolean;
export declare function hasParentSegment(suppliedPath: string): boolean;
export declare function hasProtectedSegment(relativePath: string): boolean;
export declare function decideWrite(scope: Scope, toolName: string, filePath: unknown, options?: { createParents?: boolean }): Promise<ScopeDecision>;
export declare function decideRead(scope: Scope, toolName: string, toolInput: unknown): Promise<ScopeDecision>;
export declare function decideToolUse(scope: Scope, call: { tool_name?: unknown; tool_input?: unknown; agent_id?: unknown }): Promise<ScopeDecision>;
export declare function createToolScopeHook(scope: Scope): (input: unknown) => Promise<ToolScopeHookOutput>;
