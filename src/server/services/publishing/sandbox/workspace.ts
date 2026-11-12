// Workspace preparation for the sandbox publisher (.factory/sandbox-publisher/architecture.md §3, §6): the pinned commit
// archive streamed to a temporary file under a compressed-size ceiling, and the files the control plane writes into
// /workspace/input. Nothing here holds or sees a credential: the archive arrives through a closure owned by the
// connector, and every file built here is made of the article payload and the task contract only.
import { mkdtemp, open, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PublishPayload } from '../types';
import type { RepositoryPostOptions } from '../connectors/nextjs-agent';
import { PublishError, publishingDiagnosticText } from '../http';
import { SANDBOX_PATHS, TASK_LIMITS, WORKSPACE_LIMITS, type ArticlePayloadFile, type ArticleUnitsOf, type PublishTask, type RepairFeedback } from './types';

export interface PinnedArchive {
  /** A file only this process can read, inside its own temporary directory. Gone when `withPinnedArchive` settles. */
  path: string;
  bytes: number;
}
export interface PinnedArchiveInput {
  /** GET /repos/{repo}/tarball/{commitSha}; the connector's closure holds the token. */
  fetchArchive(signal: AbortSignal): Promise<{ stream: ReadableStream<Uint8Array> }>;
  /** The whole download must finish within this. */
  timeoutMs: number;
  /** Compressed-size ceiling. Default WORKSPACE_LIMITS.archiveBytes. */
  maxBytes?: number;
  /** Parent of the temporary directory. Default os.tmpdir(). */
  tmpRoot?: string;
}

/** `size` is what was measured when the ceiling was passed (the bytes counted so far for a streamed archive). */
export function workspaceTooLarge(what: string, limit?: number, size?: number): PublishError {
  const reason = `${what} is larger than Radar can prepare for publishing${limit === undefined ? '' : ` (the limit is ${limit} bytes)`}. Connect the website in a smaller repository and try again.`;
  return new PublishError(422, reason, '', 'config', { code: 'workspace-too-large', stage: 'plan', reason, ...(size === undefined ? {} : { size }), ...(limit === undefined ? {} : { limit }) });
}
const timedOut = () => new PublishError(0, 'timed out', '', 'network');
/** The connector's helper already throws PublishError; anything else is a transport failure, never a diagnostic. */
const transport = (error: unknown) => error instanceof PublishError ? error
  : new PublishError(0, publishingDiagnosticText(String((error as { message?: unknown })?.message || 'The repository archive could not be downloaded'), 200), '', 'network');

/** Streams the pinned commit archive to a temporary file and hands it to `use`. The archive never sits in memory, a
 *  body over the ceiling is abandoned as soon as the counter passes it, and the temporary directory is removed on every
 *  path: success, an oversized or failed download, a timeout, and a failure inside `use`. */
export async function withPinnedArchive<T>(input: PinnedArchiveInput, use: (archive: PinnedArchive) => Promise<T>): Promise<T> {
  const limit = input.maxBytes ?? WORKSPACE_LIMITS.archiveBytes;
  const directory = await mkdtemp(path.join(input.tmpRoot ?? os.tmpdir(), 'radar-publish-'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, input.timeoutMs));
  const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(timedOut()), { once: true }));
  aborted.catch(() => {});
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false;
  let settled = false;
  try {
    const file = path.join(directory, 'repo.tar.gz');
    let bytes = 0;
    const out = await open(file, 'wx', 0o600);
    try {
      const opening = input.fetchArchive(controller.signal);
      // A response that arrives after this function gave up is closed instead of left open.
      opening.then(response => { if (settled && !reader) void response.stream.cancel().catch(() => {}); }, () => {});
      let response: { stream: ReadableStream<Uint8Array> };
      try { response = await Promise.race([opening, aborted]); } catch (error) { throw transport(error); }
      reader = response.stream.getReader();
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await Promise.race([reader.read(), aborted]); } catch (error) { throw transport(error); }
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > limit) throw workspaceTooLarge('The repository archive', limit, bytes);
        await out.write(chunk.value);
      }
      finished = true;
    } finally {
      await out.close();
    }
    clearTimeout(timer);
    if (!bytes) throw new PublishError(502, 'The repository archive was empty', '', 'http');
    return await use({ path: file, bytes });
  } finally {
    settled = true;
    clearTimeout(timer);
    if (reader && !finished) void reader.cancel().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}

/** task.json. `deadlineEpochMs` is when the exec of this agent turn times out; the runner stops its turn before it. */
export function buildPublishTask(input: {
  runId: string; hint: string; payload: PublishPayload; repo: string; commitSha: string;
  options: Pick<RepositoryPostOptions, 'retry' | 'legacy'>; deadlineEpochMs: number;
}): PublishTask {
  const p = input.payload;
  const identity = (value: { slug: string; articlePath: string } | undefined) => (value ? { slug: value.slug, articlePath: value.articlePath } : null);
  return {
    version: 1,
    runId: input.runId,
    mode: p.mode,
    hint: input.hint,
    repository: { fullName: input.repo, commitSha: input.commitSha },
    article: {
      title: p.title, seoTitle: p.seoTitle || p.title, description: p.meta, slug: p.slug, date: p.date, keyword: p.keyword,
      author: p.author, authorSource: 'business-profile-fallback',
      image: p.image ? { url: p.image.url, alt: p.image.alt } : null,
      canonical: p.canonical, refreshUrl: p.refreshUrl,
      sources: p.sources.map(source => ({ title: source.title, url: source.url })),
      videos: p.videos.map(video => ({ id: video.id, title: video.title, url: video.url })),
      bodyImages: (p.bodyImages || []).map(image => ({ url: image.url, alt: image.alt })),
    },
    identity: { retry: identity(input.options.retry), legacy: identity(input.options.legacy) },
    limits: { changedFiles: TASK_LIMITS.changedFiles, fileBytes: TASK_LIMITS.fileBytes },
    deadlineEpochMs: input.deadlineEpochMs,
  };
}

const json = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8');
export type SandboxFile = { path: string; data: Buffer };

export const taskFile = (task: PublishTask): SandboxFile => ({ path: SANDBOX_PATHS.task, data: json(task) });
/** article.md and article.html are the payload's bodies unchanged; article.json carries the blocks and the exact units
 *  the fidelity check will look for, from the same function the gate calls. */
export function articleFiles(payload: PublishPayload, articleUnits: ArticleUnitsOf): SandboxFile[] {
  const article: ArticlePayloadFile = { blocks: payload.blocks, units: articleUnits(payload.blocks) };
  return [
    { path: SANDBOX_PATHS.articleMarkdown, data: Buffer.from(payload.markdown, 'utf8') },
    { path: SANDBOX_PATHS.articleHtml, data: Buffer.from(payload.html, 'utf8') },
    { path: SANDBOX_PATHS.articleJson, data: json(article) },
  ];
}
export const feedbackFile = (feedback: RepairFeedback): SandboxFile => ({ path: SANDBOX_PATHS.feedback, data: json(feedback) });
