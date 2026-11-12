// Publication gate for the sandbox publisher (.factory/sandbox-publisher/architecture.md §7).
// The control plane's judge: it decides, from bytes Radar downloaded, whether those bytes may be committed. Everything
// the agent produced (report, result, file names, file content) is untrusted. The gate performs no Git, network or model
// call; it fails closed on the first violation with a bounded, sanitized diagnostic that carries no source, article
// text, credential or URL.
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { diffArrays } from 'diff';
import { PublishError, publishingDiagnosticText } from '../http';
import { containsCredential, routeIdentity, safeRepositoryPath, type RepoEntry } from '../connectors/nextjs-agent';
import { articleUnits, checkArticleFidelity, omittedMedia } from './fidelity';
import {
  CAPABILITY_PREFIX, GATE_LIMITS, PUBLISH_CHECK_IDS, REPAIRABLE_GATE_CODES,
  type PublicationGateInput, type PublicationGateResult, type PublishCheck, type RunPublicationGate, type SandboxDiagnosticCode,
} from './types';

/** Peer-content thresholds (§7 step 8; the new-article rule was set by the PM after QA-1, defect D1). Line counts are of
 *  the original file: the file as the default branch holds it. On a first attempt that is the pinned commit. On a retry
 *  or a legacy migration the pinned commit is the head of the article branch, so the original is read from the
 *  default-branch commit that branch started from (QA-2, finding N1): what an earlier attempt added is not original
 *  content and may be replaced, and what the default branch holds is protected by the same rule in every attempt. */
export const PEER_CONTENT = {
  /** A new article (mode `new`), for every existing file. An original line that the
   *  line diff reports as gone is *altered* when a near-identical line replaces it in the same hunk (`nearIdenticalLine`)
   *  and *removed* otherwise. Removed lines are never allowed: a line limit, however small, is room to delete whole
   *  one-line records or to replace a small file outright. */
  newRemovedLines: 0,
  /** ...altered lines: at most this many in one existing file. An honest append touches one to three existing lines (a
   *  trailing comma, a closing bracket, an import list, a counter or a date). */
  newLines: 6,
  /** ...and at most this many across every existing file of a new article. */
  newTotalLines: 24,
  /** The near-identical rule (`nearIdenticalLine`): the replacement is the original line with one run of characters
   *  edited. The original may lose at most this many characters in that run (a full ISO date-time value)... */
  twinLostChars: 24,
  /** ...and at most this share of its own text (white space at its ends not counted), so most of the line is kept. */
  twinLostShare: 0.5,
  /** Characters compared while pairing altered lines in one file. When it is spent, the lines still unpaired count as
   *  removed, so the bound can only make the gate stricter. */
  twinCompareChars: 2_000_000,
  /** A refresh (mode `refresh`), for files other than the article file: max(lineFloor, lineShare of the file's lines)
   *  original lines removed or altered, the design's original tolerance, since a refresh may need a paired type and
   *  renderer change... */
  lineFloor: 10,
  lineShare: 0.01,
  /** ...and at most this many across those files. */
  totalLines: 60,
  /** The article file of a refresh is exempt from the limits above but must satisfy
   *  removed <= replaceFactor * added + replaceAllowance: enough to replace one body, not enough to wipe peers. */
  replaceFactor: 3,
  replaceAllowance: 40,
  /** Bound on the line diff's edit script. A larger edit counts as a rewrite. */
  maxEditLength: 4000,
  /** When at least this many original lines exist nowhere in the final file and that alone breaks the limit, the file is
   *  refused on that lower bound ("at least N") without running the diff. Below it the diff runs and the count is exact. */
  lowerBoundLines: 500,
} as const;
const REASON_CHARS = 600;
const PATH_CHARS = 200;
/** Untrusted text is cut to this length before the sanitizer's patterns run over it. */
const SANITIZER_INPUT_CHARS = 4000;

// ---------------------------------------------------------------------------------------------------------------------
// Failures

const capabilityShaped = (text: string, capability: string) => text.includes(CAPABILITY_PREFIX + '.') || (capability.length >= 8 && text.includes(capability));
/** The existing sanitizer does not know the capability format, so it is removed first. */
function safeText(value: string, limit: number): string {
  return publishingDiagnosticText(String(value).slice(0, SANITIZER_INPUT_CHARS).replace(/rdrcap1\.[A-Za-z0-9._~+/=-]*/g, '[redacted]'), limit);
}
const safePath = (path: string) => safeText(path, PATH_CHARS);

/** Every gate violation. `repairable` says whether the single repair round may be offered this failure. */
export class PublicationGateError extends PublishError {
  readonly repairable: boolean;
  constructor(code: SandboxDiagnosticCode, reason: string, extra: { path?: string; actual?: number; limit?: number; issues?: string[]; repairable?: boolean } = {}) {
    const safeReason = safeText(reason, REASON_CHARS);
    super(422, safeReason, '', 'config', {
      code, stage: 'validation', reason: safeReason,
      ...(extra.path !== undefined ? { path: safePath(extra.path) } : {}),
      ...(extra.actual !== undefined ? { actual: extra.actual } : {}),
      ...(extra.limit !== undefined ? { limit: extra.limit } : {}),
      ...(extra.issues ? { issues: extra.issues.slice(0, 8).map(issue => safeText(issue, 300)) } : {}),
    });
    this.repairable = extra.repairable ?? (REPAIRABLE_GATE_CODES as readonly string[]).includes(code);
  }
}
/** True for a gate failure the agent may fix in the repair round. */
export const isRepairableGateFailure = (error: unknown): boolean => error instanceof PublicationGateError && error.repairable;
function fail(code: SandboxDiagnosticCode, reason: string, extra: ConstructorParameters<typeof PublicationGateError>[2] = {}): never {
  throw new PublicationGateError(code, reason, extra);
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers

const gitBlobSha = (data: Buffer) => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
const REGULAR_MODES = ['100644', '100755'];
const regular = (entry: RepoEntry) => entry.type === 'blob' && !!entry.mode && REGULAR_MODES.includes(entry.mode);
function strictText(data: Buffer): string | null {
  try {
    // ignoreBOM keeps a leading byte-order mark in the string, so an existing file's first bytes are committed unchanged.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
    return text.includes('\u0000') ? null : text;
  } catch { return null; }
}
const lineEnding = (text: string): '\r\n' | '\n' | null => {
  const crlf = (text.match(/\r\n/g) ?? []).length; const all = (text.match(/\n/g) ?? []).length;
  return all === 0 ? null : crlf > all - crlf ? '\r\n' : '\n';
};
/** `git archive` may convert line endings through .gitattributes, so an edited file can come back in another style than
 *  its blob. The final content is put back into the original's dominant style before it is compared and committed. */
function matchLineEndings(original: string, final: string): string {
  const wanted = lineEnding(original); const found = lineEnding(final);
  return wanted && found && wanted !== found ? final.replace(/\r\n|\n/g, wanted) : final;
}
const splitLines = (text: string) => { const lines = text.split('\n'); if (lines.at(-1) === '') lines.pop(); return lines; };

/** The similarity rule behind an *altered* line (PEER_CONTENT.twin*). `replacement` is near-identical to `original`
 *  when it is the same line with one run of characters edited: the two share a prefix and a suffix, and the characters
 *  of the original between them (what the line lost) number at most twinLostChars and at most twinLostShare of the
 *  line's own text. What the replacement gained in that place is not limited, so a comma, a bracket or an import name
 *  added to a line, and a counter or date value changed in it, all qualify; a line rewritten, or swapped for another
 *  record, does not. A blank line only twins with a blank line. One pass over the shorter line; `budget.chars` is
 *  charged with what was compared. */
export function nearIdenticalLine(original: string, replacement: string, budget: { chars: number } = { chars: Infinity }): boolean {
  const own = original.trim().length;
  const mayLose = Math.min(PEER_CONTENT.twinLostChars, Math.floor(own * PEER_CONTENT.twinLostShare));
  budget.chars--;
  if (replacement.length < original.length - mayLose) return false;
  if (!own) return !replacement.trim() && replacement.length >= original.length && (replacement.startsWith(original) || replacement.endsWith(original));
  const shortest = Math.min(original.length, replacement.length);
  let prefix = 0;
  while (prefix < shortest && original.charCodeAt(prefix) === replacement.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < shortest - prefix && original.charCodeAt(original.length - 1 - suffix) === replacement.charCodeAt(replacement.length - 1 - suffix)) suffix++;
  budget.chars -= prefix + suffix;
  return original.length - prefix - suffix <= mayLose;
}
/** How many of a hunk's removed lines have a near-identical twin among its added lines. Pairs are taken in order and
 *  never cross (each removed line takes the first unused added line after the previous pair), and an added line serves
 *  one removed line only, so moving or reordering lines cannot stand in for keeping them. */
function alteredInHunk(removed: string[], added: string[], budget: { chars: number }): number {
  let altered = 0; let from = 0;
  for (const line of removed) {
    for (let at = from; at < added.length && budget.chars > 0; at++) {
      if (nearIdenticalLine(line, added[at], budget)) { altered++; from = at + 1; break; }
    }
  }
  return altered;
}

interface LineChange {
  /** Original lines the diff reports as gone, altered ones included. */
  removed: number;
  /** Of `removed`, the lines a near-identical line replaced in the same hunk. 0 unless pairing was asked for. */
  altered: number;
  added: number; addedText: string;
  /** False when `removed` is only a lower bound. */
  exact: boolean;
}
/** Line diff of original against final. `allowed(added)` is the caller's ceiling on removed lines; when a cheap count of
 *  original lines that no longer exist anywhere in the file is large and already exceeds it, that lower bound is returned
 *  without diffing. `pair` also classifies each removed line as altered or not. null when the edit script exceeds the
 *  diff bound, which the caller treats as a rewrite. */
function lineChange(original: string, final: string, allowed: (added: number) => number, pair = false): LineChange | null {
  const before = splitLines(original); const after = splitLines(final);
  const remaining = new Map<string, number>();
  for (const line of after) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  let gone = 0;
  for (const line of before) { const left = remaining.get(line) ?? 0; if (left) remaining.set(line, left - 1); else gone++; }
  const fresh = after.length - (before.length - gone);
  if (gone >= PEER_CONTENT.lowerBoundLines && gone > allowed(fresh)) return { removed: gone, altered: 0, added: fresh, addedText: '', exact: false };
  let head = 0; const shortest = Math.min(before.length, after.length);
  while (head < shortest && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < shortest - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  const parts = diffArrays(before.slice(head, before.length - tail), after.slice(head, after.length - tail), { maxEditLength: PEER_CONTENT.maxEditLength });
  if (!parts) return null;
  let removed = 0; let added = 0; let altered = 0; const addedLines: string[] = [];
  // A hunk is a run of removed and added parts with no unchanged line between them.
  const budget = { chars: PEER_CONTENT.twinCompareChars };
  let hunkRemoved: string[] = []; let hunkAdded: string[] = [];
  const closeHunk = () => {
    if (pair && hunkRemoved.length && hunkAdded.length) altered += alteredInHunk(hunkRemoved, hunkAdded, budget);
    hunkRemoved = []; hunkAdded = [];
  };
  for (const part of parts) {
    if (part.removed) { removed += part.value.length; if (pair) hunkRemoved.push(...part.value); }
    else if (part.added) { added += part.value.length; addedLines.push(...part.value); if (pair) hunkAdded.push(...part.value); }
    else closeHunk();
  }
  closeHunk();
  return { removed, altered, added, addedText: addedLines.join('\n'), exact: true };
}

function syntaxError(path: string, content: string): string | null {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  if (/\.json$/i.test(path)) {
    try { JSON.parse(text); return null; } catch { return 'is not valid JSON'; }
  }
  if (/\.[cm]?[jt]sx?$/i.test(path)) {
    // The planner's check: parser diagnostics only. Nothing from the repository is type-checked or executed.
    const kind = /\.tsx$/i.test(path) ? ts.ScriptKind.TSX : /\.jsx$/i.test(path) ? ts.ScriptKind.JSX : /\.[cm]?ts$/i.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    let errors: number;
    // Pathologically nested input can exhaust the parser's stack; that is a refusal, not a crash.
    try { errors = ((ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind) as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length; }
    catch { return 'could not be parsed as JavaScript or TypeScript'; }
    return errors ? `has ${errors} JavaScript or TypeScript syntax ${errors === 1 ? 'error' : 'errors'}` : null;
  }
  return null;
}
const dotSegment = (segment: string) => { try { return ['.', '..'].includes(decodeURIComponent(segment)); } catch { return true; } };

// ---------------------------------------------------------------------------------------------------------------------
// Step 2: identity. The planner's rules, reused.

function checkIdentity(input: PublicationGateInput): string {
  const { report, payload, options } = input;
  const { slug, articlePath, route } = report;
  if (capabilityShaped(slug + '\n' + articlePath + '\n' + route, input.capability) || containsCredential(slug + '\n' + route)) fail('credential-detected', 'the reported article identity contains a credential-shaped string');
  if (!slug || ['.', '..'].includes(slug) || slug.length > 200 || /[\x00-\x20\x7f/\\?#]/.test(slug)) fail('identity-changed', 'the reported article slug is not a safe single path segment');
  if (!safeRepositoryPath(articlePath, true)) fail('protected-path', 'the reported article path is unsafe or protected by the repository write rules', containsCredential(articlePath) ? {} : { path: articlePath });
  if (!route.startsWith('/') || route.startsWith('//') || route.length > 500 || /[\x00-\x20\x7f\\]/.test(route) || route.split(/[?#]/)[0].split('/').some(dotSegment)) fail('identity-changed', 'the reported public route is not a safe site path');
  const notes = ['the slug, article path and public route are well formed'];
  if (payload.mode === 'refresh') {
    const target = payload.refreshUrl;
    if (!target) fail('identity-changed', 'this is a refresh but no existing page address was supplied to compare the route with');
    let wanted: string; let actual: string;
    try {
      // Calendar refreshes historically stored root-relative paths; the route identity of one is its own path.
      wanted = target.startsWith('/') && !target.startsWith('//') ? routeIdentity(target) : routeIdentity(target, true);
      actual = routeIdentity(route);
    } catch (error) {
      if (error instanceof PublishError) fail('identity-changed', 'the page being refreshed or the reported route is not a valid website address');
      throw error;
    }
    if (wanted !== actual) fail('identity-changed', 'the refresh would change the public route of the existing page');
    notes.push('the route is the route of the page being refreshed');
  }
  if (options.retry) {
    if (slug !== options.retry.slug || articlePath !== options.retry.articlePath) fail('identity-changed', 'the retry changed the slug or article path already used on the article branch');
    notes.push('the retry keeps the slug and article path of the earlier attempt');
  }
  if (options.legacy) {
    if (slug !== options.legacy.slug) fail('identity-changed', 'the migration changed the slug of the existing unpublished article');
    notes.push('the migration keeps the existing slug');
  }
  return notes.join('; ');
}

// ---------------------------------------------------------------------------------------------------------------------
// The gate

interface ChangedFile { path: string; entry: RepoEntry | undefined; original: string | null; originalBytes: number; content: string; bytes: number }
/** Longest detail of a passed check: what the pull request prints for one check. */
export const CHECK_DETAIL_CHARS = 500;
const passed = (id: PublishCheck['id'], detail: string): PublishCheck => ({ id, outcome: 'passed', detail: safeText(detail, CHECK_DETAIL_CHARS) });

export const runPublicationGate: RunPublicationGate = async (input: PublicationGateInput): Promise<PublicationGateResult> => {
  const { payload, entries, report, result, finals, options, capability } = input;

  // 1 Outcome.
  if (result.status !== 'completed') fail('agent-failed', `the agent run did not complete (${result.status}${result.agentError ? ', ' + safeText(result.agentError, 80) : ''})`, { actual: result.turns });
  if (report.status === 'cannot_integrate') fail('agent-declined', `the agent reported that it could not integrate the article. Its explanation, not verified by Radar, was ${safeText(report.reason || '', 300) || 'not given'}`);

  // 2 Identity.
  const identityDetail = checkIdentity(input);
  const articlePath = report.articlePath;

  // 3 Paths and modes, on every candidate, before any content is looked at.
  const candidates = result.changed;
  if (candidates.length > GATE_LIMITS.candidates) fail('changed-file-count', `the agent run touched ${candidates.length} files; at most ${GATE_LIMITS.candidates} can be examined`, { actual: candidates.length, limit: GATE_LIMITS.candidates });
  const seen = new Set<string>();
  for (const { path } of candidates) {
    if (containsCredential(path) || capabilityShaped(path, capability)) fail('credential-detected', 'a changed file name contains a credential-shaped string');
    if (!safeRepositoryPath(path, true)) fail('protected-path', `the change touches ${safePath(path)}, which the repository write rules protect or which is not a safe repository path`, { path });
    if (seen.has(path)) fail('protected-path', `the change lists ${safePath(path)} more than once`, { path });
    seen.add(path);
  }
  for (const path of seen) for (const other of seen) if (other !== path && other.startsWith(path + '/')) fail('protected-path', `the change uses ${safePath(path)} as both a file and a directory`, { path });
  let directories: Set<string> | undefined;
  const isDirectory = (path: string) => {
    if (entries.get(path)?.type === 'tree') return true;
    if (!directories) { directories = new Set(); for (const key of entries.keys()) for (let at = key.indexOf('/'); at > 0; at = key.indexOf('/', at + 1)) directories.add(key.slice(0, at)); }
    return directories.has(path);
  };
  for (const { path, bytes } of candidates) {
    const parts = path.split('/');
    for (let depth = 1; depth < parts.length; depth++) {
      const ancestor = entries.get(parts.slice(0, depth).join('/'));
      if (ancestor && ancestor.type !== 'tree') fail('non-regular-file', `${safePath(path)} lies under a file, symbolic link or submodule, so it cannot be committed as a regular file`, { path });
    }
    const entry = entries.get(path);
    if (entry ? !regular(entry) : isDirectory(path)) fail('non-regular-file', `${safePath(path)} is a directory, symbolic link, submodule or special file in the repository; only regular files can be changed`, { path });
    const data = finals.get(path);
    if (data && data.length > GATE_LIMITS.fileBytes) fail('final-output-size', `${safePath(path)} is ${data.length} bytes; the limit for one file is ${GATE_LIMITS.fileBytes}`, { path, actual: data.length, limit: GATE_LIMITS.fileBytes });
    if (!data && bytes > GATE_LIMITS.fileBytes) fail('final-output-size', `${safePath(path)} is ${bytes} bytes; the limit for one file is ${GATE_LIMITS.fileBytes}`, { path, actual: bytes, limit: GATE_LIMITS.fileBytes });
    if (!data) fail('non-regular-file', `${safePath(path)} could not be collected from the sandbox as a regular file`, { path });
  }

  // 4 Change detection, on the downloaded bytes. Unchanged candidates are dropped; the rest must be UTF-8 text.
  const changed: ChangedFile[] = [];
  for (const { path } of candidates) {
    const data = finals.get(path)!;
    const entry = entries.get(path);
    if (entry && gitBlobSha(data) === entry.sha) continue;
    const originalData = entry ? await input.readBlob(entry.sha) : null;
    if (originalData && originalData.equals(data)) continue;
    const text = strictText(data);
    if (text === null) fail('syntax-invalid', `${safePath(path)} is not UTF-8 text; only text files can be published`, { path });
    const original = originalData ? originalData.toString('utf8') : null;
    const content = original === null ? text : matchLineEndings(original, text);
    if (content === original) continue;
    changed.push({ path, entry, original, originalBytes: originalData?.length ?? 0, content, bytes: Buffer.byteLength(content, 'utf8') });
  }

  // 5 Ceilings.
  if (!changed.length && !options.retry) fail('plan-empty', 'the agent run changed no files, so there is nothing to publish', { actual: 0 });
  if (changed.length > GATE_LIMITS.changedFiles) fail('changed-file-count', `the change touches ${changed.length} files; the limit is ${GATE_LIMITS.changedFiles}`, { actual: changed.length, limit: GATE_LIMITS.changedFiles });
  const largest = changed.reduce((max, file) => Math.max(max, file.bytes), 0);
  for (const file of changed) if (file.bytes > GATE_LIMITS.fileBytes) fail('final-output-size', `${safePath(file.path)} is ${file.bytes} bytes; the limit for one file is ${GATE_LIMITS.fileBytes}`, { path: file.path, actual: file.bytes, limit: GATE_LIMITS.fileBytes });
  const totalBytes = changed.reduce((sum, file) => sum + file.bytes, 0);
  if (totalBytes > GATE_LIMITS.totalBytes) fail('final-output-size', `the changed files total ${totalBytes} bytes; the limit is ${GATE_LIMITS.totalBytes}`, { actual: totalBytes, limit: GATE_LIMITS.totalBytes });
  const growth = changed.reduce((sum, file) => sum + file.bytes - file.originalBytes, 0);
  if (growth > GATE_LIMITS.netGrowthBytes) fail('final-output-size', `the change adds ${growth} bytes to the repository; the limit is ${GATE_LIMITS.netGrowthBytes}`, { actual: growth, limit: GATE_LIMITS.netGrowthBytes });

  // 6 Credentials, including this run's own model capability.
  for (const file of changed) {
    if (capabilityShaped(file.content, capability)) fail('credential-detected', `${safePath(file.path)} contains a Radar model capability, which must never leave the sandbox`, { path: file.path });
    if (containsCredential(file.content)) fail('credential-detected', `${safePath(file.path)} contains a credential-shaped string`, { path: file.path });
  }

  // 7 Syntax.
  let jsonFiles = 0; let scriptFiles = 0;
  for (const file of changed) {
    const problem = syntaxError(file.path, file.content);
    if (problem) fail('syntax-invalid', `${safePath(file.path)} ${problem}`, { path: file.path });
    if (/\.json$/i.test(file.path)) jsonFiles++; else if (/\.[cm]?[jt]sx?$/i.test(file.path)) scriptFiles++;
  }

  // 8 Peer content: existing lines of edited files survive. "Existing" is what the default branch holds. A first
  // attempt is pinned to the default branch, so that is the pinned blob. A retry or a legacy migration is pinned to the
  // head of the article branch, which also holds what an earlier attempt wrote; each changed file is then compared with
  // its content on the default-branch commit the branch started from, under exactly the first-attempt rules, whichever
  // file it is. A file that does not exist there was written by an earlier attempt and holds nothing to protect.
  const continued = !!options.retry || !!options.legacy;
  const baseOf = continued ? input.baseEntries ?? entries : null;
  const where = continued && input.baseEntries ? ' on the default branch' : '';
  const replaceable = (path: string) => path === articlePath && payload.mode === 'refresh';
  const newArticle = payload.mode !== 'refresh';
  const peerTotal = newArticle ? PEER_CONTENT.newTotalLines : PEER_CONTENT.totalLines;
  // For a new article `peerRemoved` counts altered lines only: a removed line never passes.
  let peerRemoved = 0; let peerAdded = 0; let peerLines = 0; let edited = 0; let replacedRemoved = 0; let replacedAdded = 0; let replacedFiles = 0; let ownFiles = 0;
  let articleAdded: string | null = null;
  for (const file of changed) {
    let existing = file.original;
    if (baseOf) {
      const baseEntry = baseOf.get(file.path);
      if (!baseEntry) existing = null;
      else if (!file.entry || baseEntry.sha !== file.entry.sha) {
        if (!regular(baseEntry)) fail('non-regular-file', `${safePath(file.path)} is a directory, symbolic link, submodule or special file${where || ' in the commit it is compared with'}; only regular files can be changed`, { path: file.path });
        const text = strictText(await input.readBlob(baseEntry.sha));
        if (text === null) fail('peer-content-changed', `${safePath(file.path)} is not UTF-8 text${where || ' in the commit it is compared with'}, so Radar cannot check that its existing content is kept`, { path: file.path, repairable: false });
        existing = matchLineEndings(file.content, text);
      }
      if (existing === null && file.original !== null) ownFiles++;
    }
    if (existing === null) { if (file.path === articlePath) articleAdded = file.content; continue; }
    edited++;
    const lines = splitLines(existing).length;
    const peerLimit = newArticle ? PEER_CONTENT.newLines : Math.max(PEER_CONTENT.lineFloor, Math.ceil(PEER_CONTENT.lineShare * lines));
    const replaceLimit = (added: number) => PEER_CONTENT.replaceFactor * added + PEER_CONTENT.replaceAllowance;
    const replace = replaceable(file.path);
    const change = lineChange(existing, file.content, replace ? replaceLimit : () => peerLimit, newArticle && !replace);
    if (!change) fail('peer-content-changed', `${safePath(file.path)} was rewritten: more than ${PEER_CONTENT.maxEditLength} of its lines differ${where && ' from the file' + where}. Existing lines must be left exactly as they are`, { path: file.path, limit: PEER_CONTENT.maxEditLength });
    if (file.path === articlePath) articleAdded = change.addedText;
    const atLeast = change.exact ? '' : 'at least ';
    if (replace) {
      const limit = replaceLimit(change.added);
      if (change.removed > limit) fail('peer-content-changed', `${safePath(file.path)} loses ${atLeast}${change.removed} of its ${lines} existing lines${where} while adding ${change.added}; replacing the article body may remove at most ${limit}, so other records in the file must stay`, { path: file.path, actual: change.removed, limit });
      replacedRemoved += change.removed; replacedAdded += change.added; replacedFiles++;
      continue;
    }
    const limit = peerLimit;
    if (newArticle && change.exact) {
      // An original line is either altered (a near-identical line took its place) or removed. None may be removed.
      const altered = change.altered; const removed = change.removed - altered;
      if (removed > PEER_CONTENT.newRemovedLines) fail('peer-content-changed', `${safePath(file.path)} has ${removed} of its ${lines} existing lines${where} removed${altered ? ` and ${altered} altered` : ''}; a new article may remove none (limit ${PEER_CONTENT.newRemovedLines}). A line counts as removed when it is deleted, moved, reformatted or rewritten. Keep every existing line where it is and add the article beside them; an existing line may only gain characters or have one short value changed${where && '. Lines an earlier attempt on this branch added are not existing lines and may be changed'}`, { path: file.path, actual: removed, limit: PEER_CONTENT.newRemovedLines });
      if (altered > limit) fail('peer-content-changed', `${safePath(file.path)} has ${altered} of its ${lines} existing lines${where} altered; the limit for this file is ${limit}. Add the article without reformatting or rewriting existing lines`, { path: file.path, actual: altered, limit });
      peerRemoved += altered; peerAdded += change.added; peerLines += lines;
      if (peerRemoved > peerTotal) fail('peer-content-changed', `the change alters ${peerRemoved} existing lines${where} across the edited files; the limit is ${peerTotal}`, { actual: peerRemoved, limit: peerTotal });
      continue;
    }
    if (change.removed > limit) fail('peer-content-changed', `${safePath(file.path)} has ${atLeast}${change.removed} of its ${lines} existing lines${where} removed or altered; the limit for this file is ${limit}. Add the article without reformatting or rewriting existing lines`, { path: file.path, actual: change.removed, limit });
    peerRemoved += change.removed; peerAdded += change.added; peerLines += lines;
    if (peerRemoved > peerTotal) fail('peer-content-changed', `the change removes or alters ${peerRemoved} existing lines${where} across the edited files; the limit is ${peerTotal}`, { actual: peerRemoved, limit: peerTotal });
  }

  // 9 Article fidelity. A retry may find the article already on the branch: then the pinned file is what is verified.
  const units = articleUnits(payload.blocks);
  const contents = changed.map(file => file.content);
  // The path of each content tells the fidelity check where a piece of text ends in that file's format.
  const paths = changed.map(file => file.path);
  if (!changed.some(file => file.path === articlePath)) {
    const pinned = options.retry ? entries.get(articlePath) : undefined;
    if (!pinned || !regular(pinned)) fail(changed.length ? 'article-fidelity' : 'plan-empty', changed.length ? 'the reported article file is not among the changed files, so the article was not written where the report says' : 'the retry changed no files and the article file is not on the article branch', changed.length ? { path: articlePath } : { actual: 0 });
    const text = strictText(await input.readBlob(pinned.sha));
    if (text === null) fail('article-fidelity', 'the article file on the article branch is not UTF-8 text', { path: articlePath, repairable: false });
    contents.push(text); paths.push(articlePath);
  }
  const fidelity = checkArticleFidelity({ units, contents, paths, articleAdded });
  // Each issue is written to stand alone: the repair round hands them to the agent one by one.
  const numbered = ['omitted', 'truncated', 'altered', 'interleaved', 'extended', 'headings', 'duplicated'];
  if (!fidelity.ok) fail('article-fidelity', `the article was not carried over faithfully: ${fidelity.detail}. Unit numbers are the 0-based indexes in article.json`, {
    path: articlePath, repairable: !fidelity.issues.some(issue => issue.rule === 'no-units'),
    issues: fidelity.issues.map(issue => issue.detail + (numbered.includes(issue.rule) ? ' (numbers are unit indexes in article.json, counted from 0)' : '')),
  });
  const mediaOmitted = omittedMedia(payload, contents);

  const created = changed.filter(file => file.original === null).length;
  const checks: PublishCheck[] = [
    passed('identity', identityDetail),
    passed('paths', `${candidates.length} candidate ${candidates.length === 1 ? 'path passes' : 'paths pass'} the repository write rules, with no duplicate or nested path`),
    passed('file-modes', `${candidates.length} regular ${candidates.length === 1 ? 'file' : 'files'} collected; none is or lies under a symbolic link, submodule or special file; ${created} new, ${changed.length - created} existing changed, ${candidates.length - changed.length} identical to the pinned commit`),
    passed('ceilings', `${changed.length} changed ${changed.length === 1 ? 'file' : 'files'} (limit ${GATE_LIMITS.changedFiles}); largest ${largest} bytes (limit ${GATE_LIMITS.fileBytes}); ${totalBytes} bytes in all (limit ${GATE_LIMITS.totalBytes}); net growth ${growth} bytes (limit ${GATE_LIMITS.netGrowthBytes})`),
    passed('credentials', `no credential-shaped string and no Radar model capability in ${changed.length} changed ${changed.length === 1 ? 'file' : 'files'} or their names`),
    passed('syntax', `${changed.length} changed ${changed.length === 1 ? 'file is' : 'files are'} UTF-8 text; ${jsonFiles} JSON parsed; ${scriptFiles} JavaScript or TypeScript parsed without syntax errors`),
    passed('peer-content', (continued ? (input.baseEntries ? 'compared with the default-branch commit the article branch started from: ' : 'compared with the head of the article branch: ') : '') + (edited
      ? `${edited} existing ${edited === 1 ? 'file' : 'files'} edited`
        + (edited > replacedFiles ? `; ${peerRemoved} of ${peerLines} original lines removed or altered (${newArticle ? `${peerRemoved} altered, ${PEER_CONTENT.newRemovedLines} removed; limit ${PEER_CONTENT.newLines} altered per file and ${peerTotal} in all, ${PEER_CONTENT.newRemovedLines} removed` : `limit ${peerTotal} in all`}), ${peerAdded} lines added` : '')
        + (replacedFiles ? `; in the article file being replaced, ${replacedRemoved} earlier lines gave way to ${replacedAdded} new ones (limit ${PEER_CONTENT.replaceFactor} removed per added line plus ${PEER_CONTENT.replaceAllowance})` : '')
        // The gate proves that existing text was kept. It does not judge what a changed line now says (finding N2).
        + (peerRemoved ? `. Review the ${peerRemoved} existing ${peerRemoved === 1 ? 'line' : 'lines'} ${continued ? 'the article branch' : 'this change'} ${newArticle ? 'altered' : 'removed or altered'}: Radar checks that existing text is kept, not what was added to it` : '')
      : continued ? 'no file of that commit was edited; every changed file is new or was written by an earlier attempt' : 'no existing file was edited; every changed file is new')
      + (ownFiles ? `; ${ownFiles} changed ${ownFiles === 1 ? 'file exists' : 'files exist'} only on the article branch, written by an earlier attempt, and ${ownFiles === 1 ? 'is' : 'are'} not compared` : '')),
    passed('article-fidelity', fidelity.detail + `; ${mediaOmitted.length} media or link references not carried` + (changed.length ? '' : '; verified on the article file already on the branch')),
  ];
  // Listed in the shared order of PUBLISH_CHECK_IDS, so the pull request prints them the same way every time.
  checks.sort((a, b) => PUBLISH_CHECK_IDS.indexOf(a.id) - PUBLISH_CHECK_IDS.indexOf(b.id));
  return { files: changed.map(file => ({ path: file.path, content: file.content })), checks, mediaOmitted, unchanged: changed.length === 0 };
};
