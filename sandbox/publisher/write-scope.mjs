/**
 * Sandbox layout and the tool-scope decisions for the in-sandbox agent (.factory/sandbox-publisher/architecture.md,
 * section 3).
 *
 * The agent has file tools only. Every call passes through one PreToolUse hook built here:
 *   - Write and Edit reach only real paths inside the extracted repository, plus exactly the run report;
 *   - Read, Glob and Grep reach only real paths under the repository, the input directory and the output directory,
 *     so the model cannot read process state such as /proc;
 *   - any other tool is refused, whatever the SDK was configured with.
 *
 * Repository content and model output are untrusted. Decisions are made on resolved real paths, never on the text
 * the model supplied; refusal reasons are fixed strings and never echo a path; any error refuses.
 */

import { lstat, mkdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Mirrors SANDBOX_PATHS in src/server/services/publishing/sandbox/types.ts; runner.test.ts fails on drift. */
export const LAYOUT = Object.freeze({
  runnerDir: '/opt/radar-agent',
  baseline: '/opt/radar-agent/baseline.json',
  inputDir: '/workspace/input',
  archive: '/workspace/input/repo.tar.gz',
  task: '/workspace/input/task.json',
  articleMarkdown: '/workspace/input/article.md',
  articleHtml: '/workspace/input/article.html',
  articleJson: '/workspace/input/article.json',
  feedback: '/workspace/input/feedback.json',
  repo: '/workspace/repo',
  outputDir: '/output',
  report: '/output/report.json',
  result: '/output/result.json',
  transcript: '/output/transcript.jsonl.gz',
});

/** The complete tool surface. No shell, no network tool, no sub-agent. */
export const AGENT_TOOLS = Object.freeze(['Read', 'Write', 'Edit', 'Glob', 'Grep']);

const MAX_PATH_LENGTH = 4096;
const MAX_ANCESTOR_DEPTH = 256;
const GLOB_MAGIC = /[*?[\]{}!()]/u;

const DENIED = Object.freeze({
  tool: 'This tool is not available. Use Read, Write, Edit, Glob or Grep.',
  subagent: 'Sub-agents are not available in this run.',
  write:
    "Writes are limited to regular files inside the repository working directory and the run report at /output/report.json, addressed without '..' segments. Paths under .git or node_modules are never writable.",
  read:
    "Reads and searches are limited to the repository working directory, /workspace/input and /output, addressed without '..' segments.",
});
const ALLOWED = Object.freeze({
  write: 'Approved repository write.',
  report: 'Approved run report write.',
  read: 'Approved read inside the sandbox workspace.',
});

const allow = (reason) => ({ allow: true, reason });
const deny = (reason) => ({ allow: false, reason });

/**
 * Normalise the directories a scope is built from. Tests pass temporary directories; production uses LAYOUT.
 * @param {{ repo?: string, inputDir?: string, outputDir?: string, report?: string }} [paths]
 */
export function createScope(paths = {}) {
  const repo = resolve(paths.repo ?? LAYOUT.repo);
  const inputDir = resolve(paths.inputDir ?? LAYOUT.inputDir);
  const outputDir = resolve(paths.outputDir ?? LAYOUT.outputDir);
  const report = resolve(paths.report ?? `${outputDir}/report.json`);
  return Object.freeze({ repo, inputDir, outputDir, report });
}

/** True when `path` is `root` or lies beneath it. Lexical: callers pass resolved real paths. */
export function isInside(root, path) {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * The hook judges the path it resolves; the tool is handed the text the model wrote. Those are the same place
 * unless a `..` follows a link, where the operating system climbs from the link's target and a lexical resolve
 * climbs from the link. No repository file needs `..` to be addressed, so none may use it.
 */
export function hasParentSegment(suppliedPath) {
  return suppliedPath.split(/[\\/]/u).includes('..');
}

/**
 * `.git` in any spelling git itself refuses (`.GIT`, `.git.`, `.git `, `git~1`) and `node_modules`, as a path
 * segment. `.github`, `.gitignore` and similar names are not matched here; the publication gate owns those.
 */
export function hasProtectedSegment(relativePath) {
  return relativePath
    .split(/[\\/]/u)
    .some((segment) => /^(?:\.git|git~1)[ .]*$/iu.test(segment) || segment.toLowerCase() === 'node_modules');
}

function isUsablePathText(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH_LENGTH && !value.includes('\0');
}

const exists = (path) =>
  lstat(path).then(
    () => true,
    () => false,
  );

/** A root that is itself reached through a link is not a boundary anyone can reason about: refuse everything. */
async function isRealDirectory(path) {
  try {
    return (await realpath(path)) === path && (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve the nearest existing ancestor of a path that does not exist yet. Returns its real path, or null when a
 * component on the way is a link that does not resolve (a write or read THROUGH a dangling link would land
 * wherever it points) or is not a directory.
 */
async function nearestRealAncestor(requestedPath) {
  let ancestor = dirname(requestedPath);
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    try {
      const resolved = await realpath(ancestor);
      return (await stat(resolved)).isDirectory() ? resolved : null;
    } catch {
      if (await exists(ancestor)) return null;
      const parent = dirname(ancestor);
      if (parent === ancestor) return null;
      ancestor = parent;
    }
  }
  return null;
}

/**
 * Decide one Write or Edit.
 *
 * Allowed: exactly the run report; an existing regular file whose real path is inside the repository; for Write
 * only, a new file whose nearest existing ancestor resolves to a directory inside the repository (missing parent
 * directories are then created here, by trusted code, because the agent has no shell to make one).
 *
 * @param {ReturnType<typeof createScope>} scope
 * @param {string} toolName
 * @param {unknown} filePath
 * @param {{ createParents?: boolean }} [options]
 * @returns {Promise<{ allow: boolean, reason: string }>}
 */
export async function decideWrite(scope, toolName, filePath, { createParents = true } = {}) {
  if (toolName !== 'Write' && toolName !== 'Edit') return deny(DENIED.tool);
  if (!isUsablePathText(filePath) || hasParentSegment(filePath)) return deny(DENIED.write);
  const requested = resolve(scope.repo, filePath);

  if (requested === scope.report) {
    const outputDir = dirname(scope.report);
    if (!(await isRealDirectory(outputDir))) return deny(DENIED.write);
    const existing = await lstat(requested).catch(() => null);
    // lstat, so a link planted at the report path is refused rather than followed.
    return existing === null || existing.isFile() ? allow(ALLOWED.report) : deny(DENIED.write);
  }

  if (requested === scope.repo || !isInside(scope.repo, requested)) return deny(DENIED.write);
  if (hasProtectedSegment(relative(scope.repo, requested))) return deny(DENIED.write);
  if (!(await isRealDirectory(scope.repo))) return deny(DENIED.write);

  if (await exists(requested)) {
    let resolved;
    try {
      resolved = await realpath(requested);
    } catch {
      return deny(DENIED.write); // a link that points nowhere
    }
    if (resolved === scope.repo || !isInside(scope.repo, resolved)) return deny(DENIED.write);
    if (hasProtectedSegment(relative(scope.repo, resolved))) return deny(DENIED.write);
    const target = await stat(resolved).catch(() => null);
    return target?.isFile() ? allow(ALLOWED.write) : deny(DENIED.write);
  }

  // An Edit of a file that is not there cannot succeed, and a refusal should leave nothing behind.
  if (toolName !== 'Write') return deny(DENIED.write);
  const ancestor = await nearestRealAncestor(requested);
  if (ancestor === null || !isInside(scope.repo, ancestor)) return deny(DENIED.write);
  if (hasProtectedSegment(relative(scope.repo, ancestor))) return deny(DENIED.write);
  if (createParents) {
    try {
      await mkdir(dirname(requested), { recursive: true });
    } catch {
      return deny(DENIED.write);
    }
  }
  return allow(ALLOWED.write);
}

/** One path the model wants to read or search under: it must resolve inside a readable root. */
async function isReadablePath(scope, suppliedPath) {
  if (!isUsablePathText(suppliedPath) || hasParentSegment(suppliedPath)) return false;
  const requested = resolve(scope.repo, suppliedPath);
  const roots = [scope.repo, scope.inputDir, scope.outputDir];
  if (!roots.some((root) => isInside(root, requested))) return false;
  let resolved;
  if (await exists(requested)) {
    try {
      resolved = await realpath(requested);
    } catch {
      return false;
    }
  } else {
    // Nothing is there to read; the tool will say so. Still refuse a path that only looks inside a root.
    resolved = await nearestRealAncestor(requested);
    if (resolved === null) return false;
  }
  for (const root of roots) {
    if (isInside(root, resolved)) return isRealDirectory(root);
  }
  return false;
}

/**
 * Decide one Read, Glob or Grep.
 * @param {ReturnType<typeof createScope>} scope
 * @param {string} toolName
 * @param {unknown} toolInput
 * @returns {Promise<{ allow: boolean, reason: string }>}
 */
export async function decideRead(scope, toolName, toolInput) {
  const input = toolInput !== null && typeof toolInput === 'object' ? toolInput : {};
  const isAbsent = (value) => value === undefined || value === null || value === '';
  if (toolName === 'Read') {
    return (await isReadablePath(scope, input.file_path)) ? allow(ALLOWED.read) : deny(DENIED.read);
  }
  if (toolName === 'Glob' || toolName === 'Grep') {
    // The search root defaults to the working directory, which is the repository.
    if (!isAbsent(input.path) && !(await isReadablePath(scope, input.path))) return deny(DENIED.read);
    const pattern = toolName === 'Glob' ? input.pattern : input.glob;
    if (toolName === 'Glob' && !isUsablePathText(pattern)) return deny(DENIED.read);
    if (!isAbsent(pattern)) {
      if (!isUsablePathText(pattern) || hasParentSegment(pattern)) return deny(DENIED.read);
      if (isAbsolute(pattern)) {
        // An absolute pattern names its own search root: everything before the first wildcard segment.
        const fixed = [];
        for (const segment of pattern.split('/')) {
          if (GLOB_MAGIC.test(segment)) break;
          fixed.push(segment);
        }
        if (!(await isReadablePath(scope, fixed.join('/') || '/'))) return deny(DENIED.read);
      }
    }
    return allow(ALLOWED.read);
  }
  return deny(DENIED.tool);
}

/**
 * Decide any tool call. Unknown tools and anything issued from a sub-agent are refused.
 * @param {ReturnType<typeof createScope>} scope
 * @param {{ tool_name?: unknown, tool_input?: unknown, agent_id?: unknown }} call
 */
export async function decideToolUse(scope, call) {
  if (typeof call?.agent_id === 'string' && call.agent_id.length > 0) return deny(DENIED.subagent);
  const toolName = call?.tool_name;
  if (toolName === 'Write' || toolName === 'Edit') {
    return decideWrite(scope, toolName, call.tool_input?.file_path);
  }
  if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') {
    return decideRead(scope, toolName, call.tool_input);
  }
  return deny(DENIED.tool);
}

/**
 * The PreToolUse hook handed to the Claude Agent SDK. Fails closed: an exception while deciding is a refusal.
 * @param {ReturnType<typeof createScope>} scope
 */
export function createToolScopeHook(scope) {
  return async function enforceToolScope(input) {
    if (input?.hook_event_name !== 'PreToolUse') return { continue: true };
    let decision;
    try {
      decision = await decideToolUse(scope, input);
    } catch {
      decision = deny(DENIED.tool);
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision.allow ? 'allow' : 'deny',
        permissionDecisionReason: decision.reason,
      },
    };
  };
}
