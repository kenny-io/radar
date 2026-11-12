import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Block } from '@/lib/types';
import type { PublishPayload } from '../types';
import { PublishError } from '../http';
import { articleFiles, buildPublishTask, feedbackFile, taskFile, withPinnedArchive } from './workspace';
import { SANDBOX_PATHS, WORKSPACE_LIMITS, type ArticleUnit } from './types';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'radar-workspace-test-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

/** A response body that yields `chunks` one at a time and records whether it was cancelled. */
function body(chunks: (Uint8Array | Error)[], endless = false) {
  const state = { pulled: 0, cancelled: false, signal: null as AbortSignal | null };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[state.pulled];
      if (next === undefined) { if (!endless) controller.close(); return endless ? new Promise<void>(() => {}) : undefined; }
      state.pulled++;
      if (next instanceof Error) controller.error(next); else controller.enqueue(next);
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  return { state, fetchArchive: async (signal: AbortSignal) => { state.signal = signal; return { stream }; } };
}
const leftBehind = () => readdir(root);

describe('the pinned archive', () => {
  it('is streamed to a private temporary file, handed over with its size, and removed afterwards', async () => {
    const source = body([Buffer.from('first-'), Buffer.from('second-'), Buffer.from('third')]);
    let seen = '';
    const result = await withPinnedArchive({ fetchArchive: source.fetchArchive, timeoutMs: 5_000, tmpRoot: root }, async archive => {
      expect(archive.path.startsWith(root + path.sep)).toBe(true);
      expect(archive.bytes).toBe(18);
      expect((await stat(archive.path)).mode & 0o077).toBe(0);
      seen = (await readFile(archive.path)).toString();
      return 'uploaded';
    });
    expect(result).toBe('uploaded');
    expect(seen).toBe('first-second-third');
    expect(await leftBehind()).toEqual([]);
  });

  it('stops reading as soon as the compressed ceiling is passed and fails with workspace-too-large', async () => {
    const chunk = Buffer.alloc(40, 1);
    const source = body(Array.from({ length: 50 }, () => chunk));
    let used = false;
    const error = await withPinnedArchive({ fetchArchive: source.fetchArchive, timeoutMs: 5_000, maxBytes: 100, tmpRoot: root }, async () => { used = true; }).catch(e => e);
    expect(error).toBeInstanceOf(PublishError);
    expect(error).toMatchObject({ http: 422, kind: 'config', retryable: false, diagnostic: { code: 'workspace-too-large', stage: 'plan', size: 120, limit: 100 } });
    expect(used).toBe(false);
    // Three chunks crossed the ceiling; the other forty-seven were never requested.
    expect(source.state.pulled).toBe(3);
    expect(source.state.cancelled).toBe(true);
    expect(await leftBehind()).toEqual([]);
  });

  it('accepts an archive exactly at the ceiling', async () => {
    const source = body([Buffer.alloc(60), Buffer.alloc(40)]);
    expect(await withPinnedArchive({ fetchArchive: source.fetchArchive, timeoutMs: 5_000, maxBytes: 100, tmpRoot: root }, async archive => archive.bytes)).toBe(100);
  });

  it('defaults to the design ceiling of 150 MB', () => {
    expect(WORKSPACE_LIMITS.archiveBytes).toBe(150_000_000);
  });

  it('removes the temporary file when the upload that uses it fails, and lets that failure through', async () => {
    const source = body([Buffer.from('archive')]);
    let location = '';
    await expect(withPinnedArchive({ fetchArchive: source.fetchArchive, timeoutMs: 5_000, tmpRoot: root }, async archive => { location = archive.path; throw new Error('upload failed'); })).rejects.toThrow('upload failed');
    await expect(stat(location)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await leftBehind()).toEqual([]);
  });

  it('passes a connector failure through unchanged and leaves nothing behind', async () => {
    const denied = new PublishError(404, 'Not Found', 'api.github.com');
    const error = await withPinnedArchive({ fetchArchive: async () => { throw denied; }, timeoutMs: 5_000, tmpRoot: root }, async () => 'unused').catch(e => e);
    expect(error).toBe(denied);
    expect(await leftBehind()).toEqual([]);
  });

  it('turns a broken body into a retryable network failure and leaves nothing behind', async () => {
    const source = body([Buffer.from('partial'), new Error('socket hang up')]);
    const error = await withPinnedArchive({ fetchArchive: source.fetchArchive, timeoutMs: 5_000, tmpRoot: root }, async () => 'unused').catch(e => e);
    expect(error).toBeInstanceOf(PublishError);
    expect(error).toMatchObject({ http: 0, kind: 'network', retryable: true });
    expect(await leftBehind()).toEqual([]);
  });

  it('gives up on a body that stalls: aborts the request, cancels the body, removes the file', async () => {
    const source = body([Buffer.from('partial')], true);
    const started = Date.now();
    const error = await withPinnedArchive({ fetchArchive: source.fetchArchive, timeoutMs: 40, tmpRoot: root }, async () => 'unused').catch(e => e);
    expect(error).toMatchObject({ http: 0, kind: 'network', detail: 'timed out' });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(source.state.signal?.aborted).toBe(true);
    expect(source.state.cancelled).toBe(true);
    expect(await leftBehind()).toEqual([]);
  });

  it('gives up on a request that never answers, and closes the body if it answers later', async () => {
    let answer!: (value: { stream: ReadableStream<Uint8Array> }) => void;
    const late = body([Buffer.from('late')]);
    const error = await withPinnedArchive({ fetchArchive: () => new Promise(resolve => { answer = resolve; }), timeoutMs: 30, tmpRoot: root }, async () => 'unused').catch(e => e);
    expect(error).toMatchObject({ http: 0, kind: 'network', detail: 'timed out' });
    answer({ stream: (await late.fetchArchive(new AbortController().signal)).stream });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(late.state.cancelled).toBe(true);
    expect(await leftBehind()).toEqual([]);
  });

  it('refuses an empty archive', async () => {
    const error = await withPinnedArchive({ fetchArchive: body([]).fetchArchive, timeoutMs: 5_000, tmpRoot: root }, async () => 'unused').catch(e => e);
    expect(error).toMatchObject({ http: 502, retryable: true });
    expect(await leftBehind()).toEqual([]);
  });

  it('does not let the download timeout cut the upload short', async () => {
    const source = body([Buffer.from('archive')]);
    const result = await withPinnedArchive({ fetchArchive: source.fetchArchive, timeoutMs: 30, tmpRoot: root }, async () => { await new Promise(resolve => setTimeout(resolve, 80)); return 'slow upload finished'; });
    expect(result).toBe('slow upload finished');
    expect(source.state.signal?.aborted).toBe(false);
  });
});

const BLOCKS: Block[] = [['h2', 'Why it matters'], ['p', 'A first paragraph of the article.'], ['ul', ['One item', 'Another item']]];
const payload = (over: Partial<PublishPayload> = {}): PublishPayload => ({
  entryId: 'e_test', title: 'A title', slug: 'a-title', html: '<h2>Why it matters</h2><p>A first paragraph of the article.</p>', markdown: '## Why it matters\n\nA first paragraph of the article.\n',
  blocks: BLOCKS, bodyImages: [{ id: 'img1', after: { heading: 'Why it matters', occurrence: 0, block: 1 }, url: 'https://cdn.example.test/body.png', alt: 'A diagram', prompt: 'internal image prompt', seed: 7 }],
  meta: 'A description', seoTitle: 'An SEO title', keyword: 'a keyword', date: '2026-11-12',
  image: { url: 'https://cdn.example.test/cover.png', alt: 'Cover', bytes: async () => ({ buf: Buffer.from('image-bytes'), type: 'image/png', name: 'cover.png' }) },
  canonical: null, mode: 'new', refreshUrl: null, sources: [{ title: 'A source', url: 'https://source.example.test/a' }],
  videos: [{ id: 'vid1', title: 'A video', channel: 'A channel', url: 'https://video.example.test/vid1' }], author: 'An Author', ...over,
});
/** A stand-in for fidelity.ts `articleUnits`, with the contract's shape. */
const units = (blocks: Block[]): ArticleUnit[] => {
  const out: Omit<ArticleUnit, 'index'>[] = [];
  for (const block of blocks) {
    if (block[0] === 'ul') for (const text of block[1]) out.push({ kind: 'item', text });
    else out.push({ kind: block[0] === 'p' ? 'paragraph' : 'heading', text: block[1] });
  }
  return out.map((unit, index) => ({ index, ...unit }));
};

describe('the task contract', () => {
  const task = (over: Partial<PublishPayload> = {}, options = {}) => buildPublishTask({ runId: '5b0c7f0e-3a51-4c0e-9d1f-2f6a8f1f4b10', hint: 'content/posts', payload: payload(over), repo: 'acme/site', commitSha: 'a'.repeat(40), options, deadlineEpochMs: 1_800_000_000_000 });

  it('describes the run, the pinned commit, the article and the limits the agent is told', () => {
    expect(task()).toEqual({
      version: 1, runId: '5b0c7f0e-3a51-4c0e-9d1f-2f6a8f1f4b10', mode: 'new', hint: 'content/posts',
      repository: { fullName: 'acme/site', commitSha: 'a'.repeat(40) },
      article: {
        title: 'A title', seoTitle: 'An SEO title', description: 'A description', slug: 'a-title', date: '2026-11-12', keyword: 'a keyword',
        author: 'An Author', authorSource: 'business-profile-fallback', image: { url: 'https://cdn.example.test/cover.png', alt: 'Cover' },
        canonical: null, refreshUrl: null, sources: [{ title: 'A source', url: 'https://source.example.test/a' }],
        videos: [{ id: 'vid1', title: 'A video', url: 'https://video.example.test/vid1' }], bodyImages: [{ url: 'https://cdn.example.test/body.png', alt: 'A diagram' }],
      },
      identity: { retry: null, legacy: null },
      limits: { changedFiles: 16, fileBytes: 1_000_000 },
      deadlineEpochMs: 1_800_000_000_000,
    });
  });

  it('falls back to the title for the SEO title and carries a refresh target', () => {
    const refresh = task({ seoTitle: undefined, mode: 'refresh', refreshUrl: 'https://acme.example.test/blog/a-title', canonical: 'https://acme.example.test/blog/a-title', image: null, bodyImages: undefined });
    expect(refresh.article).toMatchObject({ seoTitle: 'A title', refreshUrl: 'https://acme.example.test/blog/a-title', canonical: 'https://acme.example.test/blog/a-title', image: null, bodyImages: [] });
    expect(refresh.mode).toBe('refresh');
  });

  it('carries only the slug and article path of a retry or legacy identity', () => {
    const retry = { slug: 'a-title-2', articlePath: 'content/posts/a-title-2.mdx', extra: 'not part of the contract' };
    expect(task({}, { retry }).identity).toEqual({ retry: { slug: 'a-title-2', articlePath: 'content/posts/a-title-2.mdx' }, legacy: null });
    expect(task({}, { legacy: retry }).identity).toEqual({ retry: null, legacy: { slug: 'a-title-2', articlePath: 'content/posts/a-title-2.mdx' } });
  });

  it('is written to task.json as JSON that round-trips', () => {
    const file = taskFile(task());
    expect(file.path).toBe(SANDBOX_PATHS.task);
    expect(JSON.parse(file.data.toString('utf8'))).toEqual(task());
  });
});

describe('the article files', () => {
  it('are the Markdown and HTML bodies unchanged plus the blocks with the units the gate will check', () => {
    const files = articleFiles(payload(), units);
    expect(files.map(file => file.path)).toEqual([SANDBOX_PATHS.articleMarkdown, SANDBOX_PATHS.articleHtml, SANDBOX_PATHS.articleJson]);
    expect(files[0].data.toString('utf8')).toBe(payload().markdown);
    expect(files[1].data.toString('utf8')).toBe(payload().html);
    expect(JSON.parse(files[2].data.toString('utf8'))).toEqual({
      blocks: BLOCKS,
      units: [{ index: 0, kind: 'heading', text: 'Why it matters' }, { index: 1, kind: 'paragraph', text: 'A first paragraph of the article.' }, { index: 2, kind: 'item', text: 'One item' }, { index: 3, kind: 'item', text: 'Another item' }],
    });
  });

  it('leave out everything the agent has no use for: image bytes, image prompts, the entry id', () => {
    const everything = [...articleFiles(payload(), units), taskFile(buildPublishTask({ runId: 'r', hint: 'h', payload: payload(), repo: 'acme/site', commitSha: 'b'.repeat(40), options: {}, deadlineEpochMs: 1 }))].map(file => file.data.toString('utf8')).join('\n');
    for (const absent of ['image-bytes', 'internal image prompt', 'e_test', 'A channel']) expect(everything).not.toContain(absent);
  });
});

describe('repair feedback', () => {
  it('is written to feedback.json', () => {
    const feedback = { version: 1 as const, issues: [{ code: 'article-fidelity', detail: 'paragraph 14 of 61 missing' }] };
    const file = feedbackFile(feedback);
    expect(file.path).toBe(SANDBOX_PATHS.feedback);
    expect(JSON.parse(file.data.toString('utf8'))).toEqual(feedback);
  });
});
