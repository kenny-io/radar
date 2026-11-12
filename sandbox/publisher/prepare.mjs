/**
 * Materialise the control-plane-prepared repository archive inside the sandbox and record its baseline
 * (.factory/sandbox-publisher/architecture.md, sections 3 and 6).
 *
 * The archive is untrusted. Extraction strips the top-level directory, never preserves paths, writes regular files
 * and directories only (links and special entries are skipped, not fatal: arbitrary repositories contain harmless
 * links), refuses an entry addressed absolutely or through `..`, and stops at the expansion ceilings. Nothing is
 * executed and there is no git: the baseline is a manifest of `path -> git blob sha1` that run.mjs later walks the
 * tree against to list changed files.
 *
 * Invocation: `node /opt/radar-agent/prepare.mjs`. No environment variable is read.
 * Reads   /workspace/input/repo.tar.gz
 * Writes  /workspace/repo/** (emptied first), /opt/radar-agent/baseline.json; empties /output
 * Output  exactly one bounded line
 * Exit    0 success; 3 a size ceiling was exceeded (workspace too large); 1 any other failure
 */

import { createHash } from 'node:crypto';
import { constants as fsConstants, createReadStream, realpathSync } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Unpack } from 'tar';

import { LAYOUT } from './write-scope.mjs';

/** Mirrors WORKSPACE_LIMITS in types.ts (archiveBytes, expandedEntries, expandedBytes); runner.test.ts fails on drift. */
export const PREPARE_LIMITS = Object.freeze({
  archiveBytes: 150_000_000,
  expandedEntries: 100_000,
  expandedBytes: 1_000_000_000,
  /** The baseline manifest itself. Far above what expandedEntries real paths need. */
  baselineBytes: 64_000_000,
  /** One archive path, in bytes. */
  pathBytes: 4096,
});
/** Where run.mjs keeps the SDK session id between the first turn and the repair turn. Outside the model's reach. */
export const SESSION_FILE = `${LAYOUT.runnerDir}/session-id`;

export const EXIT = Object.freeze({ ok: 0, failed: 1, tooLarge: 3 });
const TOO_LARGE_CODES = new Set(['archive_too_large', 'workspace_too_large', 'baseline_too_large']);
const ALLOWED_ENTRY_TYPES = new Set(['File', 'OldFile', 'ContiguousFile', 'Directory']);
const FAILURE_PREFIX = 'radar_prepare:';
const PHASE = Symbol('radarPreparePhase');
const HASH_CHUNK_BYTES = 1 << 20;

/** A failure whose code is one of this file's fixed tokens. The message never carries a path or archive text. */
export function prepareError(code) {
  return new Error(`${FAILURE_PREFIX}${code}`);
}

/** Reduce any value to a short token that is safe on the one output line. */
export function boundedToken(value, fallback = 'unknown') {
  const token = String(value ?? '')
    .replace(/[^A-Za-z0-9_.:-]/gu, '_')
    .slice(0, 64);
  return token || fallback;
}

/** One printable line of bounded length. */
export function outputLine(text) {
  return `${String(text).replace(/[^\x20-\x7e]/gu, '_').slice(0, 240)}\n`;
}

/** An archive path that must never be extracted: absolute, climbing, NUL-bearing or over-long. */
export function isUnsafeArchivePath(path) {
  return (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[A-Za-z]:[\\/]/u.test(path) ||
    path.split(/[\\/]/u).includes('..') ||
    Buffer.byteLength(path) > PREPARE_LIMITS.pathBytes
  );
}

/**
 * Extract one gzip tarball into `destination`.
 *
 * Skipped without failing: symbolic links, hard links, devices, FIFOs and every other special entry.
 * Fatal: an absolute or `..` path (GitHub archives of a git tree cannot contain one, so its presence means the
 * archive is not what the control plane fetched), more than `expandedEntries` entries, more than `expandedBytes`
 * of file content, and anything node-tar reports in strict mode. The stream is aborted at the first fatal entry.
 *
 * @param {{ archive: string, destination: string, limits?: { expandedEntries: number, expandedBytes: number } }} input
 * @returns {Promise<{ entries: number, files: number, bytes: number, skipped: number }>}
 */
export async function extractArchive({ archive, destination, limits = PREPARE_LIMITS }) {
  await mkdir(destination, { recursive: true });
  let entries = 0;
  let files = 0;
  let bytes = 0;
  let skipped = 0;
  let failure = null;
  const source = createReadStream(archive);
  let unpack = null;
  const refuse = (code) => {
    failure = prepareError(code);
    source.destroy();
    // Stops the decompressor and the parser, and rejects the extraction below with this error.
    unpack?.abort(failure);
    return false;
  };
  await new Promise((resolve, reject) => {
    unpack = new Unpack({
      cwd: destination,
      strip: 1,
      preservePaths: false,
      strict: true,
      filter: (path, entry) => {
        if (failure) return false;
        entries += 1;
        if (entries > limits.expandedEntries) return refuse('workspace_too_large');
        if (isUnsafeArchivePath(path)) return refuse('archive_unsafe_path');
        if (!ALLOWED_ENTRY_TYPES.has(entry.type)) {
          skipped += 1;
          return false;
        }
        if (entry.type !== 'Directory') {
          const size = Number.isSafeInteger(entry.size) && entry.size >= 0 ? entry.size : Number.MAX_SAFE_INTEGER;
          bytes += size;
          if (bytes > limits.expandedBytes) return refuse('workspace_too_large');
          files += 1;
        }
        return true;
      },
    });
    unpack.on('error', (error) => reject(failure ?? error));
    unpack.on('close', resolve);
    source.on('error', (error) => reject(failure ?? error));
    source.pipe(unpack);
  });
  if (failure) throw failure;
  return { entries, files, bytes, skipped };
}

/**
 * The git blob sha1 of one regular file, opened without following a link. Returns null when the path is a link or
 * is not a regular file.
 * @param {string} absolutePath
 * @returns {Promise<{ sha: string, bytes: number } | null>}
 */
export async function gitBlobSha1(absolutePath) {
  let handle;
  try {
    handle = await open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  } catch (error) {
    // ELOOP (Linux) and EMLINK (macOS, BSD) are what O_NOFOLLOW answers for a link.
    const code = Reflect.get(Object(error), 'code');
    if (code === 'ELOOP' || code === 'EMLINK') return null;
    throw error;
  }
  try {
    const details = await handle.stat();
    if (!details.isFile()) return null;
    const hash = createHash('sha1').update(`blob ${details.size}\0`);
    const buffer = Buffer.allocUnsafe(Math.max(1, Math.min(HASH_CHUNK_BYTES, details.size)));
    let total = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > details.size) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    // The header committed to a size; a file that changed underneath would hash to nothing meaningful.
    if (total !== details.size) throw prepareError('file_changed_during_hash');
    return { sha: hash.digest('hex'), bytes: details.size };
  } finally {
    await handle.close();
  }
}

/**
 * Every regular file under `root`, depth first in sorted order, as a repository-relative POSIX path. Uses the
 * directory entry's own type, so a link is never followed and never listed; devices, sockets and FIFOs are ignored.
 * @param {string} root
 * @param {{ maxEntries?: number }} [options]
 * @returns {AsyncGenerator<{ path: string, absolute: string }>}
 */
export async function* walkRegularFiles(root, { maxEntries = PREPARE_LIMITS.expandedEntries * 2 } = {}) {
  let seen = 0;
  const pending = [''];
  while (pending.length > 0) {
    const relativeDirectory = pending.pop();
    const children = await readdir(join(root, relativeDirectory), { withFileTypes: true });
    children.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    const directories = [];
    for (const child of children) {
      seen += 1;
      if (seen > maxEntries) throw prepareError('workspace_too_large');
      const path = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
      if (child.isDirectory()) directories.push(path);
      else if (child.isFile()) yield { path, absolute: join(root, path) };
    }
    // Reversed so the stack pops them in sorted order.
    for (let index = directories.length - 1; index >= 0; index -= 1) pending.push(directories[index]);
  }
}

/**
 * Hash every regular file under `root`.
 * @param {string} root
 * @returns {Promise<{ entries: Record<string, string>, files: number, bytes: number }>}
 */
export async function buildBaseline(root) {
  // No prototype: a repository may contain a file named `__proto__` or `constructor`.
  const entries = Object.create(null);
  let files = 0;
  let bytes = 0;
  for await (const file of walkRegularFiles(root)) {
    const blob = await gitBlobSha1(file.absolute);
    if (blob === null) continue;
    entries[file.path] = blob.sha;
    files += 1;
    bytes += blob.bytes;
  }
  return { entries, files, bytes };
}

/** Write the baseline manifest atomically, refusing one that is unreasonably large. */
export async function writeBaseline(baselinePath, entries, maxBytes = PREPARE_LIMITS.baselineBytes) {
  const serialized = JSON.stringify(entries);
  if (Buffer.byteLength(serialized) > maxBytes) throw prepareError('baseline_too_large');
  await mkdir(dirname(baselinePath), { recursive: true });
  const temporary = `${baselinePath}.tmp`;
  await writeFile(temporary, serialized, { mode: 0o600 });
  await rename(temporary, baselinePath);
}

/**
 * Leave `path` as an empty real directory. The directory itself is kept when it already is one: `/output` sits
 * under a root-owned `/` and cannot be recreated, and the image's working directory should not be unlinked under
 * a running process. A link or a file found in its place is removed first.
 */
async function emptyDirectory(path) {
  const existing = await lstat(path).catch(() => null);
  if (existing && !existing.isDirectory()) await rm(path, { force: true });
  await mkdir(path, { recursive: true });
  const children = await readdir(path);
  await Promise.all(children.map((child) => rm(join(path, child), { recursive: true, force: true })));
}

async function stage(phase, run) {
  try {
    return await run();
  } catch (error) {
    if (error && typeof error === 'object' && !(PHASE in error)) {
      try {
        Object.defineProperty(error, PHASE, { value: phase });
      } catch {
        // A non-extensible error keeps its own identity; the phase is lost.
      }
    }
    throw error;
  }
}

/**
 * Reduce a preparation failure to one operator-safe line and an exit code.
 *
 * The controller sees only this process's exit code and output. The line carries the failing phase and a bounded
 * code: one of this file's own tokens, a node-tar code, or an errno with its syscall. It never includes a message
 * or a path, which can name untrusted repository content.
 * @returns {{ line: string, exitCode: number }}
 */
export function describePreparationFailure(error) {
  const source = Object(error);
  const phase =
    String(source[PHASE] ?? '')
      .replace(/[^a-z_]/gu, '_')
      .slice(0, 32) || 'unknown';
  const message = String(source.message ?? '');
  let code = 'unknown';
  if (message.startsWith(FAILURE_PREFIX) && /^[a-z0-9_]{1,48}$/u.test(message.slice(FAILURE_PREFIX.length))) {
    code = message.slice(FAILURE_PREFIX.length);
  } else if (typeof source.code === 'string') {
    code = source.syscall ? `${source.code}.${boundedToken(source.syscall)}` : source.code;
  }
  return {
    line: outputLine(`radar-prepare-failure phase=${phase} code=${boundedToken(code)}`),
    exitCode: TOO_LARGE_CODES.has(code) ? EXIT.tooLarge : EXIT.failed,
  };
}

/**
 * Prepare the working tree, the empty output directory and the baseline manifest.
 *
 * The paths default to the sandbox layout and are overridable only so tests can run the exact production flow
 * against a temporary tree.
 * @returns {Promise<{ entries: number, files: number, bytes: number, skipped: number }>}
 */
export async function prepareWorkspace({
  archive = LAYOUT.archive,
  repo = LAYOUT.repo,
  outputDir = LAYOUT.outputDir,
  baseline = LAYOUT.baseline,
  session = SESSION_FILE,
  limits = PREPARE_LIMITS,
} = {}) {
  await stage('reset', async () => {
    await Promise.all([emptyDirectory(repo), emptyDirectory(outputDir)]);
    await Promise.all([rm(baseline, { force: true }), rm(session, { force: true })]);
  });
  await stage('archive', async () => {
    const details = await lstat(archive);
    if (!details.isFile()) throw prepareError('archive_missing');
    if (details.size > limits.archiveBytes) throw prepareError('archive_too_large');
  });
  const extracted = await stage('extract', () => extractArchive({ archive, destination: repo, limits }));
  const hashed = await stage('baseline', async () => {
    const built = await buildBaseline(repo);
    await writeBaseline(baseline, built.entries, limits.baselineBytes);
    return built;
  });
  return { entries: extracted.entries, files: hashed.files, bytes: hashed.bytes, skipped: extracted.skipped };
}

// The controller runs this file directly and reads only its exit code plus the one line, so the guard must not
// fail open: compare real paths, because Node resolves links for the entry module while process.argv[1] is the
// path as typed.
const entryPath = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  let line;
  let exitCode = EXIT.ok;
  try {
    const summary = await prepareWorkspace();
    line = outputLine(
      `radar-prepare ok files=${summary.files} bytes=${summary.bytes} entries=${summary.entries} skipped=${summary.skipped}`,
    );
  } catch (error) {
    ({ line, exitCode } = describePreparationFailure(error));
  }
  // Exit as soon as the line has reached the pipe: an aborted extraction may still hold open handles.
  process.stdout.write(line, () => process.exit(exitCode));
}
