// Live: the sandbox publisher against a real sandbox, the deployed model proxy and the real model
// (.factory/sandbox-publisher/architecture.md §11: SBX-1, SBX-8). Every run here costs model money (up to the per-run
// cap), so nothing runs unless asked for, and one case can be selected with RADAR_IT_REPLAY_CASE.
//
//   Smoke   RADAR_IT_SANDBOX_SMOKE=1                 one short run on a three-post synthetic repository built in memory:
//                                                    proves the pinned Agent SDK drives the configured model through
//                                                    the proxy from inside the sandbox. No GitHub access at all.
//   Replay  RADAR_IT_REPLAY_MANIFEST=<file>          pinned snapshots of real repositories (see
//                                                    scripts/connectors/replay-manifest.example.json). Needs a GitHub
//                                                    token that can READ them: RADAR_IT_GITHUB_TOKEN, else `gh auth token`.
// Both need the worker's sandbox variables (DAYTONA_API_KEY, RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID,
// RADAR_PUBLISH_MODEL_PROXY_URL, RADAR_PUBLISH_CAPABILITY_SECRET):
//   RADAR_IT_REPLAY_MANIFEST=.data/sandbox-publisher/replay-manifest.json RADAR_IT_REPLAY_CASE=<id> \
//     node --env-file=.env.local node_modules/vitest/vitest.mjs run src/server/services/publishing/sandbox/replay.live.test.ts
//
// A replay cannot write to Git: this file issues GET requests only, and it calls integrateWithSandbox directly, which
// has no Git transport (the connector's tree, commit, ref and pull-request calls are never reached). It writes one
// redacted record per run under .data/sandbox-publisher/replays/ (git-ignored): outcome code, check details, changed
// paths, line and unit counts, model calls, cost and duration, and no article, repository or agent text. The pull
// request body the connector would have opened is written beside it as text. No secret is printed or recorded.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Block } from '@/lib/types';
import { costOf } from '@/server/ai/prices';
import { sandboxDraftExtra, sandboxPullRequestBody } from '../connectors/nextjs';
import type { RepoEntry } from '../connectors/nextjs-agent';
import { PublishError, publishingDiagnosticText, req } from '../http';
import { blocksToHtml, blocksToMarkdown } from '../render';
import type { PublishPayload } from '../types';
import { sandboxPublisher } from './config';
import { DAYTONA_API_URL } from './daytona';
import { articleUnits } from './fidelity';
import { readModelUsage } from './modelProxy';
import { integrateWithSandbox } from './run';
import { SANDBOX_WORKLOAD, type SandboxIntegration, type SandboxPublisherConfig } from './types';

const SANDBOX_READY = !!(process.env.DAYTONA_API_KEY && process.env.RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID && process.env.RADAR_PUBLISH_MODEL_PROXY_URL && process.env.RADAR_PUBLISH_CAPABILITY_SECRET);
const SMOKE = SANDBOX_READY && process.env.RADAR_IT_SANDBOX_SMOKE === '1';
const MANIFEST_FILE = process.env.RADAR_IT_REPLAY_MANIFEST || '';
const ONLY_CASE = process.env.RADAR_IT_REPLAY_CASE || '';
const KEEP_FILES = process.env.RADAR_IT_REPLAY_KEEP_FILES === '1';
const OUTPUT_DIR = path.resolve(process.cwd(), process.env.RADAR_IT_REPLAY_OUTPUT_DIR || '.data/sandbox-publisher/replays');
const RUN_STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, 'Z');
const ZERO_BUSINESS = '00000000-0000-4000-8000-000000000000';

// ---------------------------------------------------------------------------------------------------------------------
// Manifest and article files (both live under .data/, never committed)

const BlockSchema = z.union([
  z.tuple([z.enum(['p', 'h2', 'h3']), z.string().min(1)]),
  z.tuple([z.literal('ul'), z.array(z.string().min(1)).min(1)]),
]);
const ArticleSchema = z.object({
  title: z.string().min(1), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), meta: z.string(), seoTitle: z.string().optional(), keyword: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), author: z.string(), blocks: z.array(BlockSchema).min(1),
  sources: z.array(z.object({ title: z.string(), url: z.string().url() }).strict()).default([]),
}).strict();
const CaseSchema = z.object({
  /** Names the record files and the sandbox's entry label: letters, digits and dashes. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  hint: z.string().min(1),
  mode: z.enum(['new', 'refresh']),
  refreshUrl: z.string().nullable().default(null),
  /** A JSON file matching ArticleSchema, relative to the manifest. */
  articleFile: z.string().min(1),
  /** Model usage is recorded in ai_calls under this business. */
  businessId: z.string().uuid(),
  /** `accepted`, or the one diagnostic code this case must fail with. */
  expected: z.string().min(1),
}).strict();
const ManifestSchema = z.object({ version: z.literal(1), cases: z.array(CaseSchema).min(1) }).strict();
type ReplayCase = z.infer<typeof CaseSchema>;

function loadManifest(): ReplayCase[] {
  if (!MANIFEST_FILE || !SANDBOX_READY) return [];
  const cases = ManifestSchema.parse(JSON.parse(readFileSync(path.resolve(process.cwd(), MANIFEST_FILE), 'utf8'))).cases;
  return ONLY_CASE ? cases.filter(item => item.id === ONLY_CASE) : cases;
}
const CASES = loadManifest();

function payloadOf(article: z.infer<typeof ArticleSchema>, entryId: string, mode: 'new' | 'refresh', refreshUrl: string | null): PublishPayload {
  const blocks = article.blocks as Block[];
  const options = { videos: [], sources: article.sources.map(source => ({ ...source, use: 'cited' })) };
  return {
    entryId, title: article.title, slug: article.slug, html: blocksToHtml(blocks, options), markdown: blocksToMarkdown(blocks, options), blocks, bodyImages: [],
    meta: article.meta, seoTitle: article.seoTitle || article.title, keyword: article.keyword, date: article.date, image: null,
    canonical: refreshUrl, mode, refreshUrl, sources: article.sources, videos: [], author: article.author,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// GitHub, read-only. Every request in this file goes through `githubGet`, which cannot send a method or a body.

let githubToken: string | null = null;
function token(): string {
  githubToken ??= (process.env.RADAR_IT_GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim();
  if (!githubToken) throw new Error('No GitHub token: set RADAR_IT_GITHUB_TOKEN or sign in with the GitHub CLI.');
  return githubToken;
}
const githubGet = (pathAndQuery: string, timeoutMs = 60_000) => req(`https://api.github.com${pathAndQuery}`, { headers: { authorization: `Bearer ${token()}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'Radar-IT' }, timeoutMs });
const gitBlobSha = (data: Buffer) => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');

interface Repository { entries: RepoEntry[]; fetchArchive(signal: AbortSignal): Promise<{ stream: ReadableStream<Uint8Array> }>; readBlob(sha: string): Promise<Buffer> }
/** The pinned commit of a real repository, through the same redirect-following, credential-stripping helper the connector uses. */
async function pinnedRepository(repository: string, commitSha: string): Promise<Repository> {
  const commit = await (await githubGet(`/repos/${repository}/git/commits/${commitSha}`)).json() as { tree: { sha: string } };
  const tree = await (await githubGet(`/repos/${repository}/git/trees/${commit.tree.sha}?recursive=1`)).json() as { truncated?: boolean; tree: RepoEntry[] };
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('The repository tree is truncated; the connector would refuse it too.');
  const pinned = new Set(tree.tree.filter(entry => entry.type === 'blob').map(entry => entry.sha));
  return {
    entries: tree.tree,
    async fetchArchive(signal) {
      const opening = githubGet(`/repos/${repository}/tarball/${commitSha}`, 120_000);
      const aborted = new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new PublishError(0, 'timed out', 'api.github.com', 'network')), { once: true }));
      aborted.catch(() => {});
      const response = await Promise.race([opening, aborted]);
      if (!response.body) throw new PublishError(502, 'The repository archive was empty', 'api.github.com');
      return { stream: response.body };
    },
    async readBlob(sha) {
      if (!pinned.has(sha)) throw new Error('A blob outside the pinned tree was requested.');
      const blob = await (await githubGet(`/repos/${repository}/git/blobs/${sha}`)).json() as { content: string; encoding: string };
      const data = Buffer.from(blob.content, 'base64');
      if (blob.encoding !== 'base64' || gitBlobSha(data) !== sha) throw new Error('A blob did not match the pinned tree.');
      return data;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The smoke's repository: three Markdown posts and the script that lists them, as a GitHub-shaped archive in memory

const SMOKE_FILES: Record<string, string> = {
  'README.md': '# Harbour Notes\n\nA small static blog. Every post is one Markdown file in `content/posts/` with front matter (`title`, `date`, `description`).\n`scripts/build.mjs` lists every file in that folder on the blog index and serves each one at `/blog/<file name without .md>`. There is no other registry.\n',
  'package.json': '{\n  "name": "harbour-notes",\n  "private": true,\n  "type": "module",\n  "scripts": { "build": "node scripts/build.mjs" }\n}\n',
  'scripts/build.mjs': "import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';\n\nconst posts = readdirSync('content/posts').filter(name => name.endsWith('.md')).map(name => {\n  const [, front, body] = /^---\\n([\\s\\S]*?)\\n---\\n([\\s\\S]*)$/.exec(readFileSync(`content/posts/${name}`, 'utf8'));\n  const field = key => new RegExp(`^${key}: (.*)$`, 'm').exec(front)?.[1] ?? '';\n  return { slug: name.replace(/\\.md$/, ''), title: field('title'), date: field('date'), description: field('description'), body };\n}).sort((a, b) => b.date.localeCompare(a.date));\n\nmkdirSync('dist/blog', { recursive: true });\nwriteFileSync('dist/blog/index.html', posts.map(post => `<a href=\"/blog/${post.slug}\">${post.title}</a>`).join('\\n'));\nfor (const post of posts) writeFileSync(`dist/blog/${post.slug}.html`, `<h1>${post.title}</h1>\\n${post.body}`);\n",
  'content/posts/choosing-a-mooring.md': '---\ntitle: Choosing a mooring for the winter\ndate: 2026-09-14\ndescription: What to check before you sign a winter mooring agreement.\n---\n\nA winter mooring is mostly a question of shelter and access.\n\n## Shelter\n\nLook at the prevailing wind and how much fetch the berth has.\n\n## Access\n\n- Check the gate hours\n- Ask where the water tap is\n',
  'content/posts/reading-tide-tables.md': '---\ntitle: Reading tide tables without a calculator\ndate: 2026-10-02\ndescription: A quick way to estimate the height of tide between high and low water.\n---\n\nThe rule of twelfths is close enough for most small harbours.\n\n## The rule\n\nThe tide moves one twelfth of its range in the first hour, two in the second and three in the third.\n',
  'content/posts/first-post.md': '---\ntitle: Why this blog exists\ndate: 2026-08-01\ndescription: Notes from a small harbour, written down so they are not lost.\n---\n\nThese are working notes, published in case they help someone else.\n',
};
const SMOKE_ARTICLE: z.infer<typeof ArticleSchema> = {
  title: 'Radar sandbox smoke test: packing a dry bag', slug: 'radar-smoke-packing-a-dry-bag', meta: 'Test content written for a publishing smoke test: how to pack a dry bag.', keyword: 'packing a dry bag', date: '2026-11-12', author: 'Harbour Notes',
  blocks: [
    ['p', 'This is test content for a publishing smoke test. A dry bag only works when it is packed in the right order and closed properly.'],
    ['h2', 'Pack in layers'],
    ['p', 'Put the things you will need last at the bottom and the things you will need first at the top, so the bag is opened as rarely as possible.'],
    ['ul', ['Spare clothes at the bottom', 'Food in the middle', 'Torch and first aid kit at the top']],
    ['h2', 'Close it properly'],
    ['p', 'Squeeze the air out, fold the top over three times and clip the buckle. Fewer than three folds lets water creep in.'],
  ],
  sources: [],
};
/** A gzip-compressed ustar archive with one top-level directory, the shape GitHub's tarball endpoint returns. */
function archiveOf(files: Record<string, string>, root: string): Buffer {
  const header = (name: string, size: number, type: '0' | '5') => {
    const block = Buffer.alloc(512);
    block.write(name, 0, 100, 'utf8'); block.write(type === '5' ? '0000755\0' : '0000644\0', 100); block.write('0000000\0', 108); block.write('0000000\0', 116);
    block.write(size.toString(8).padStart(11, '0') + '\0', 124); block.write('00000000000\0', 136); block.write('        ', 148); block.write(type, 156); block.write('ustar\0' + '00', 257);
    let sum = 0; for (const byte of block) sum += byte;
    block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return block;
  };
  const parts: Buffer[] = [header(`${root}/`, 0, '5')];
  const directories = new Set<string>();
  for (const [file, content] of Object.entries(files)) {
    const segments = file.split('/');
    for (let depth = 1; depth < segments.length; depth++) { const directory = segments.slice(0, depth).join('/'); if (!directories.has(directory)) { directories.add(directory); parts.push(header(`${root}/${directory}/`, 0, '5')); } }
    const data = Buffer.from(content, 'utf8');
    parts.push(header(`${root}/${file}`, data.length, '0'), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}
function syntheticRepository(files: Record<string, string>): Repository {
  const blobs = new Map(Object.values(files).map(content => { const data = Buffer.from(content, 'utf8'); return [gitBlobSha(data), data] as const; }));
  const entries: RepoEntry[] = []; const directories = new Set<string>();
  for (const [file, content] of Object.entries(files)) {
    const segments = file.split('/');
    for (let depth = 1; depth < segments.length; depth++) { const directory = segments.slice(0, depth).join('/'); if (!directories.has(directory)) { directories.add(directory); entries.push({ path: directory, type: 'tree', mode: '040000', sha: createHash('sha1').update('tree ' + directory).digest('hex') }); } }
    const data = Buffer.from(content, 'utf8');
    entries.push({ path: file, type: 'blob', mode: '100644', sha: gitBlobSha(data), size: data.length });
  }
  const archive = archiveOf(files, 'radar-it-smoke-0000000');
  return {
    entries,
    async fetchArchive() { return { stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(archive); controller.close(); } }) }; },
    async readBlob(sha) { const data = blobs.get(sha); if (!data) throw new Error('A blob outside the synthetic tree was requested.'); return data; },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// One run and its redacted record

interface RunInput { id: string; repository: string; commitSha: string; hint: string; businessId: string; payload: PublishPayload; source: Repository; expected: string }

/** Model usage from the run's transcript (development only; the transcript itself is deleted unless files are kept).
 *  The proxy's ai_calls rows are the authoritative cost; this is the same arithmetic on what the SDK reported. */
async function usageFrom(directory: string, catalogueId: string) {
  const usage = { modelCalls: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, outputTokens: 0, costUsd: null as number | null, sdkReportedCostUsd: null as number | null, sdkTurns: [] as number[], apiErrors: [] as string[] };
  // The runner reduces a provider error to a bounded token (AgentApiError:400). The provider's own sentence is kept
  // here, sanitized and bounded, because it is what says which request field or header was refused.
  const apiError = (value: unknown) => {
    if (typeof value !== 'string' || !/api error|invalid_request|_error\b/i.test(value.slice(0, 2000))) return;
    const text = publishingDiagnosticText(value.slice(0, 2000).replace(/rdrcap1\.[A-Za-z0-9._~+/=-]*/g, '[redacted]'), 600);
    if (text && !usage.apiErrors.includes(text) && usage.apiErrors.length < 3) usage.apiErrors.push(text);
  };
  const files = (await readdir(directory).catch(() => [])).filter(name => name.endsWith('.jsonl.gz'));
  if (!files.length) return null;
  const lastUsage = new Map<string, unknown>();
  for (const name of files) {
    for (const line of gunzipSync(await readFile(path.join(directory, name))).toString('utf8').split('\n')) {
      let message: any;
      try { message = JSON.parse(line); } catch { continue; }
      // One assistant message is one model response; the SDK repeats it per content block with the same id.
      if (message?.type === 'assistant' && typeof message.message?.id === 'string') lastUsage.set(message.message.id, message.message.usage);
      if (message?.type === 'assistant' && (message.error || message.isApiErrorMessage)) for (const block of Array.isArray(message.message?.content) ? message.message.content : []) apiError(block?.text);
      if (message?.type === 'result' && (message.is_error || message.subtype !== 'success')) { apiError(message.result); for (const text of Array.isArray(message.errors) ? message.errors.slice(0, 5) : []) apiError(text); }
      if (message?.type === 'result') {
        if (Number.isFinite(message.total_cost_usd)) usage.sdkReportedCostUsd = (usage.sdkReportedCostUsd ?? 0) + message.total_cost_usd;
        if (Number.isSafeInteger(message.num_turns)) usage.sdkTurns.push(message.num_turns);
        const total = readModelUsage(message.usage);
        if (total) {
          usage.inputTokens += total.inputTokens; usage.cacheReadTokens += total.cacheReadTokens; usage.cacheWriteTokens += total.cacheWriteTokens; usage.cacheWrite1hTokens += total.cacheWrite1hTokens; usage.outputTokens += total.outputTokens;
          const cost = costOf(catalogueId, total, 'Anthropic');
          if (cost !== null) usage.costUsd = (usage.costUsd ?? 0) + cost;
        }
      }
    }
  }
  usage.modelCalls = lastUsage.size;
  if (usage.costUsd !== null) usage.costUsd = Math.round(usage.costUsd * 1e4) / 1e4;
  if (usage.sdkReportedCostUsd !== null) usage.sdkReportedCostUsd = Math.round(usage.sdkReportedCostUsd * 1e4) / 1e4;
  return usage;
}

const countLines = (text: string) => { const lines = text.split('\n'); if (lines.at(-1) === '') lines.pop(); return lines; };
/** Lines of the original that no longer exist anywhere in the final file, and lines of the final that are new. Counts only. */
function lineStats(original: string | null, final: string) {
  const after = countLines(final);
  if (original === null) return { existed: false, linesBefore: 0, linesAfter: after.length, originalLinesGone: 0, linesAdded: after.length };
  const before = countLines(original); const remaining = new Map<string, number>();
  for (const line of after) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  let gone = 0;
  for (const line of before) { const left = remaining.get(line) ?? 0; if (left) remaining.set(line, left - 1); else gone++; }
  return { existed: true, linesBefore: before.length, linesAfter: after.length, originalLinesGone: gone, linesAdded: after.length - (before.length - gone) };
}

async function sandboxesListed(config: SandboxPublisherConfig, entry: string): Promise<string[]> {
  const { Daytona } = await import('@daytona/sdk');
  const client = new Daytona({ apiKey: config.daytonaKey, apiUrl: DAYTONA_API_URL });
  const listed = async () => { const ids: string[] = []; for await (const item of client.list({ labels: { workload: SANDBOX_WORKLOAD, entry } })) ids.push(item.id); return ids; };
  // The listing trails a completed deletion by a few seconds.
  let remaining = await listed();
  for (const startedAt = Date.now(); remaining.length && Date.now() - startedAt < 45_000;) { await new Promise(resolve => setTimeout(resolve, 3000)); remaining = await listed(); }
  return remaining;
}

async function replay(input: RunInput) {
  await mkdir(path.join(OUTPUT_DIR, '.transcripts'), { recursive: true });
  const transcripts = await mkdtemp(path.join(OUTPUT_DIR, '.transcripts', `${input.id}-`));
  vi.stubEnv('RADAR_PUBLISH_SANDBOX', 'all');
  vi.stubEnv('RADAR_PUBLISH_SANDBOX_TRANSCRIPT_DIR', transcripts);
  const config = sandboxPublisher(input.businessId);
  vi.unstubAllEnvs();
  if (!config.enabled) throw new Error(`The sandbox publisher is not configured. Missing or invalid: ${(config.missing || []).join(', ')}`);

  const lines: Record<string, unknown>[] = [];
  const startedAt = Date.now();
  let integration: SandboxIntegration | null = null; let error: PublishError | null = null;
  try {
    integration = await integrateWithSandbox({
      config, hint: input.hint, payload: input.payload, repo: input.repository, commitSha: input.commitSha, entries: input.source.entries,
      fetchArchive: input.source.fetchArchive, readBlob: input.source.readBlob, options: { businessId: input.businessId, deadlineAt: startedAt + config.attemptMs },
    }, { log: line => { lines.push(line); } });
  } catch (thrown) {
    if (!(thrown instanceof PublishError)) throw thrown;
    error = thrown;
  }
  const durationMs = Date.now() - startedAt;
  const run = lines.at(-1) ?? {};
  const usage = await usageFrom(transcripts, config.model.catalogueId);
  const units = articleUnits(input.payload.blocks);
  const entries = new Map(input.source.entries.map(entry => [entry.path, entry]));
  const files = await Promise.all((integration?.files ?? []).map(async file => {
    const entry = entries.get(file.path);
    const original = entry ? (await input.source.readBlob(entry.sha)).toString('utf8') : null;
    return { path: file.path, bytesBefore: original === null ? 0 : Buffer.byteLength(original), bytesAfter: Buffer.byteLength(file.content), ...lineStats(original, file.content) };
  }));
  const remaining = await sandboxesListed(config, input.payload.entryId);
  const outcome = integration ? 'accepted' : error!.diagnostic?.code ?? `http-${error!.http}`;
  const record = {
    case: input.id, repository: input.repository, commitSha: input.commitSha, hint: input.hint, mode: input.payload.mode, expected: input.expected,
    startedAt: new Date(startedAt).toISOString(), durationMs, outcome, matchesExpected: outcome === input.expected,
    // Diagnostics are written by the control plane and already sanitized: positions and counts, never content.
    failure: error ? { http: error.http, kind: error.kind, retryable: error.retryable, stage: error.diagnostic?.stage ?? null, reason: error.diagnostic?.reason ?? null, issues: error.diagnostic?.issues ?? null, origin: (error.diagnostic as { origin?: { code?: string } } | undefined)?.origin?.code ?? null } : null,
    checks: integration?.checks.map(check => ({ id: check.id, outcome: check.outcome, detail: check.detail })) ?? [],
    runtimeVerified: integration?.review.runtimeVerified ?? null,
    identity: integration ? { slug: integration.slug, articlePath: integration.path, route: integration.route } : null,
    changedFiles: files, mediaOmitted: integration?.mediaOmitted.length ?? null,
    agentStatements: integration ? { conventions: integration.agentNotes.conventions.length, deviations: integration.agentNotes.deviations.length } : null,
    article: { units: units.length, headings: units.filter(unit => unit.kind === 'heading').length, paragraphs: units.filter(unit => unit.kind === 'paragraph').length, items: units.filter(unit => unit.kind === 'item').length, markdownBytes: Buffer.byteLength(input.payload.markdown) },
    model: { catalogueId: config.model.catalogueId, apiId: config.model.apiId, capUsd: config.maxUsd, capCalls: config.maxCalls, usage, usageSource: usage ? 'run transcript, priced with src/server/ai/prices.ts; ai_calls on the model proxy is authoritative' : 'no transcript was collected' },
    sandbox: { id: run.sandbox ?? null, agentTurns: run.turns ?? null, repaired: run.repaired ?? null, destroyed: run.destroyed ?? null, stillListed: remaining.length },
    tree: { entries: input.source.entries.length, largestBlobBytes: Math.max(0, ...input.source.entries.map(entry => entry.size ?? 0)) },
  };
  await mkdir(OUTPUT_DIR, { recursive: true });
  const base = path.join(OUTPUT_DIR, `${input.id}-${RUN_STAMP}`);
  await writeFile(`${base}.json`, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  if (integration) {
    // What the connector would have opened, rendered by the connector's own builder. Local review only.
    const extra = sandboxDraftExtra('(default branch)', input.payload, { ...integration, files: integration.files.map(file => file.path) });
    await writeFile(`${base}.pr-body.md`, sandboxPullRequestBody(input.payload, extra) + '\n', { mode: 0o600 });
    if (KEEP_FILES) for (const file of integration.files) { const target = path.join(`${base}.files`, file.path); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, file.content, { mode: 0o600 }); }
  }
  if (KEEP_FILES) console.info('[replay.live] transcript kept in', transcripts); else await rm(transcripts, { recursive: true, force: true });
  console.info('[replay.live]', JSON.stringify({ case: record.case, outcome, expected: input.expected, durationMs, agentTurns: record.sandbox.agentTurns, repaired: record.sandbox.repaired, modelCalls: usage?.modelCalls ?? null, costUsd: usage?.costUsd ?? null, changed: files.map(file => file.path), stillListed: remaining.length, record: `${base}.json` }));
  return record;
}

// ---------------------------------------------------------------------------------------------------------------------

afterAll(() => { vi.unstubAllEnvs(); });

describe.skipIf(!SMOKE)('Sandbox publisher smoke (live, spends model budget)', { timeout: 960_000 }, () => {
  it('the pinned Agent SDK drives the configured model through the proxy from inside the sandbox', async () => {
    const payload = payloadOf(SMOKE_ARTICLE, `e_smoke_${Date.now().toString(36)}`, 'new', null);
    const record = await replay({ id: 'smoke', repository: 'radar-it/harbour-notes', commitSha: '0'.repeat(40), hint: 'content/posts', businessId: process.env.RADAR_IT_SANDBOX_BUSINESS_ID || ZERO_BUSINESS, payload, source: syntheticRepository(SMOKE_FILES), expected: 'accepted' });
    // The model answered through the proxy and the runner completed: anything else is a failure before or inside the
    // agent turn (sandbox, egress, proxy, SDK or model), which is exactly what this smoke exists to catch.
    expect(record.sandbox.agentTurns).toBeGreaterThan(0);
    expect(['sandbox-unavailable', 'sandbox-egress-unverified', 'analysis-unavailable', 'agent-failed', 'agent-budget', 'publishing-deadline', 'workspace-too-large']).not.toContain(record.outcome);
    expect(record.outcome).toBe('accepted');
    expect(record.runtimeVerified).toBe(false);
    expect(record.changedFiles.map(file => file.path)).toEqual([expect.stringMatching(/^content\/posts\/[a-z0-9-]+\.md$/)]);
    expect(record.sandbox.destroyed).toBe(true);
    expect(record.sandbox.stillListed).toBe(0);
  });
});

describe.skipIf(!CASES.length)('Sandbox publisher replays (live, spends model budget)', { timeout: 960_000 }, () => {
  it.each(CASES.map(item => [item.id, item] as const))('%s ends as its manifest expects, with the sandbox gone', async (_id, item) => {
    const manifestDir = path.dirname(path.resolve(process.cwd(), MANIFEST_FILE));
    const article = ArticleSchema.parse(JSON.parse(await readFile(path.resolve(manifestDir, item.articleFile), 'utf8')));
    const payload = payloadOf(article, `e_replay_${item.id}_${Date.now().toString(36)}`.slice(0, 60), item.mode, item.refreshUrl);
    const record = await replay({ id: item.id, repository: item.repository, commitSha: item.commitSha, hint: item.hint, businessId: item.businessId, payload, source: await pinnedRepository(item.repository, item.commitSha), expected: item.expected });
    expect(record.sandbox.destroyed).toBe(true);
    expect(record.sandbox.stillListed).toBe(0);
    // SBX-8: an outcome may describe the repository or the article, never a limit of the tool.
    expect(['workspace-too-large', 'publishing-deadline', 'sandbox-unavailable', 'sandbox-egress-unverified']).not.toContain(record.outcome);
    expect(record.outcome).toBe(item.expected);
    if (record.outcome === 'accepted') expect(record.runtimeVerified).toBe(false);
  });
});
