// QA-3, N1 live: a second attempt after the article's title changed, on a real repository, with the real agent.
// The "article branch head" is the pinned default-branch commit of a replay case with the files the first live replay
// produced laid over it, built here on disk and in memory. Nothing is written to GitHub: this file sends GET requests
// only, and it calls integrateWithSandbox directly, which has no Git transport.
//
//   RADAR_QA_LIVE_RETRY=1 RADAR_QA_RETRY_FIRST=<path of the first replay's record, without ".json"> RADAR_QA_RETRY_CASE=<manifest case id> \
//   RADAR_QA_RETRY_MANIFEST=<manifest> RADAR_QA_RETRY_TMP=<empty scratch directory> RADAR_QA_RETRY_OUTPUT_DIR=<git-ignored directory> \
//     node --env-file=.env.local node_modules/vitest/vitest.mjs run --config .factory/sandbox-publisher/qa/vitest.config.ts .factory/sandbox-publisher/qa/live-retry.qa.test.ts
//
// One agent run, capped like any other. The record holds counts, paths and check details, never article, repository or
// agent text. The repository copy under RADAR_QA_RETRY_TMP is removed when the test ends.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import * as tar from 'tar';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Block } from '@/lib/types';
import { costOf } from '@/server/ai/prices';
import type { RepoEntry } from '@/server/services/publishing/connectors/nextjs-agent';
import { PublishError } from '@/server/services/publishing/http';
import { blocksToHtml, blocksToMarkdown } from '@/server/services/publishing/render';
import { sandboxPublisher } from '@/server/services/publishing/sandbox/config';
import { DAYTONA_API_URL } from '@/server/services/publishing/sandbox/daytona';
import { readModelUsage } from '@/server/services/publishing/sandbox/modelProxy';
import { integrateWithSandbox } from '@/server/services/publishing/sandbox/run';
import { SANDBOX_WORKLOAD, type SandboxIntegration } from '@/server/services/publishing/sandbox/types';
import type { PublishPayload } from '@/server/services/publishing/types';

const ON = process.env.RADAR_QA_LIVE_RETRY === '1';
const FIRST = process.env.RADAR_QA_RETRY_FIRST || '';
const TMP = process.env.RADAR_QA_RETRY_TMP || '';
const OUTPUT_DIR = path.resolve(process.cwd(), process.env.RADAR_QA_RETRY_OUTPUT_DIR || '.data/sandbox-publisher/qa/replays-qa3');
const NEW_TITLE = 'QA test article, second edition: seven questions to ask of a documentation pull request';
const NEW_SEO_TITLE = 'Seven Questions for a Documentation Pull Request (QA Test Article, Second Edition)';

let cached: string | null = null;
const token = () => (cached ??= execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
/** GET only: there is no way to pass a method or a body. */
const githubGet = async (pathAndQuery: string) => {
  const response = await fetch(`https://api.github.com${pathAndQuery}`, { headers: { authorization: `Bearer ${token()}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'Radar-QA' }, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} to a read`);
  return response;
};
const gitBlobSha = (data: Buffer) => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
const linesOf = (text: string) => { const lines = text.split('\n'); if (lines.at(-1) === '') lines.pop(); return lines; };
/** Lines of `before` that are nowhere in `after`, and lines of `after` that are new. Counts only. */
function lineStats(before: string | null, after: string) {
  const final = linesOf(after);
  if (before === null) return { existed: false, linesBefore: 0, linesGone: 0, linesAdded: final.length };
  const original = linesOf(before); const remaining = new Map<string, number>();
  for (const line of final) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  let gone = 0;
  for (const line of original) { const left = remaining.get(line) ?? 0; if (left) remaining.set(line, left - 1); else gone++; }
  return { existed: true, linesBefore: original.length, linesGone: gone, linesAdded: final.length - (original.length - gone) };
}
async function walk(directory: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) { const relative = prefix ? `${prefix}/${item.name}` : item.name; if (item.isDirectory()) found.push(...await walk(path.join(directory, item.name), relative)); else found.push(relative); }
  return found;
}
async function usageFrom(directory: string, catalogueId: string) {
  const ids = new Set<string>(); let costUsd: number | null = null; const turns: number[] = [];
  for (const name of (await readdir(directory).catch(() => [])).filter(file => file.endsWith('.jsonl.gz'))) {
    for (const line of gunzipSync(await readFile(path.join(directory, name))).toString('utf8').split('\n')) {
      let message: any; try { message = JSON.parse(line); } catch { continue; }
      if (message?.type === 'assistant' && typeof message.message?.id === 'string') ids.add(message.message.id);
      if (message?.type === 'result') { if (Number.isSafeInteger(message.num_turns)) turns.push(message.num_turns); const total = readModelUsage(message.usage); const cost = total ? costOf(catalogueId, total, 'Anthropic') : null; if (cost !== null) costUsd = (costUsd ?? 0) + cost; }
    }
  }
  return { modelCalls: ids.size, sdkTurns: turns, costUsd: costUsd === null ? null : Math.round(costUsd * 1e4) / 1e4 };
}

afterAll(async () => { vi.unstubAllEnvs(); if (TMP) await rm(TMP, { recursive: true, force: true }); });

describe.skipIf(!ON)('A retry after a title change, live (one agent run, no GitHub write)', { timeout: 960_000 }, () => {
  it('is judged against the default-branch commit, finishes with the new title, and leaves no sandbox', async () => {
    expect(FIRST && TMP).toBeTruthy();
    const first = JSON.parse(readFileSync(`${FIRST}.json`, 'utf8')) as { repository: string; commitSha: string; hint: string; outcome: string; identity: { slug: string; articlePath: string } };
    expect(first.outcome).toBe('accepted');
    const manifest = JSON.parse(readFileSync(path.resolve(process.cwd(), process.env.RADAR_QA_RETRY_MANIFEST!), 'utf8')) as { cases: { id: string; articleFile: string; businessId: string; repository: string; commitSha: string }[] };
    const item = manifest.cases.find(entry => entry.id === process.env.RADAR_QA_RETRY_CASE)!;
    expect([item.repository, item.commitSha]).toEqual([first.repository, first.commitSha]);
    const article = JSON.parse(readFileSync(path.resolve(path.dirname(path.resolve(process.cwd(), process.env.RADAR_QA_RETRY_MANIFEST!)), item.articleFile), 'utf8')) as { title: string; slug: string; meta: string; seoTitle?: string; keyword: string; date: string; author: string; blocks: Block[] };

    // 1. The default-branch commit: its tree, and its blobs on demand (verified against the tree's own hashes).
    const commit = await (await githubGet(`/repos/${first.repository}/git/commits/${first.commitSha}`)).json() as { tree: { sha: string } };
    const baseTree = await (await githubGet(`/repos/${first.repository}/git/trees/${commit.tree.sha}?recursive=1`)).json() as { truncated?: boolean; tree: RepoEntry[] };
    expect(baseTree.truncated).toBeFalsy();
    const baseByPath = new Map(baseTree.tree.map(entry => [entry.path, entry]));

    // 2. The article branch head: that commit with the first attempt's files laid over it.
    const firstFiles = new Map<string, Buffer>();
    for (const file of await walk(`${FIRST}.files`)) firstFiles.set(file, await readFile(path.join(`${FIRST}.files`, file)));
    expect(firstFiles.size).toBeGreaterThan(0);
    const local = new Map<string, Buffer>();
    const head = new Map(baseByPath);
    for (const [file, data] of firstFiles) {
      const sha = gitBlobSha(data); local.set(sha, data);
      const segments = file.split('/');
      for (let depth = 1; depth < segments.length; depth++) { const directory = segments.slice(0, depth).join('/'); if (!head.has(directory)) head.set(directory, { path: directory, type: 'tree', mode: '040000', sha: createHash('sha1').update(`tree ${directory}`).digest('hex') }); }
      head.set(file, { path: file, type: 'blob', mode: baseByPath.get(file)?.mode || '100644', sha, size: data.length });
    }
    const pinned = new Set([...baseTree.tree, ...head.values()].filter(entry => entry.type === 'blob').map(entry => entry.sha));
    const blobCache = new Map<string, Buffer>();
    const readBlob = async (sha: string) => {
      if (!pinned.has(sha)) throw new Error('A blob outside the two pinned trees was requested.');
      const known = local.get(sha) ?? blobCache.get(sha); if (known) return known;
      const blob = await (await githubGet(`/repos/${first.repository}/git/blobs/${sha}`)).json() as { content: string; encoding: string };
      const data = Buffer.from(blob.content, 'base64');
      if (gitBlobSha(data) !== sha) throw new Error('A blob did not match its tree entry.');
      blobCache.set(sha, data); return data;
    };

    // 3. The archive of that head: GitHub's archive of the commit, unpacked, overlaid and packed again under the same root.
    await mkdir(TMP, { recursive: true });
    const work = await mkdtemp(path.join(TMP, 'retry-'));
    const download = await githubGet(`/repos/${first.repository}/tarball/${first.commitSha}`);
    await writeFile(path.join(work, 'base.tar.gz'), Buffer.from(await download.arrayBuffer()));
    await mkdir(path.join(work, 'tree'));
    await tar.x({ file: path.join(work, 'base.tar.gz'), cwd: path.join(work, 'tree') });
    const roots = await readdir(path.join(work, 'tree'));
    expect(roots).toHaveLength(1);
    for (const [file, data] of firstFiles) { const target = path.join(work, 'tree', roots[0], file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, data); }
    await tar.c({ gzip: true, file: path.join(work, 'head.tar.gz'), cwd: path.join(work, 'tree'), portable: true }, [roots[0]]);
    const fetchArchive = async () => ({ stream: Readable.toWeb(createReadStream(path.join(work, 'head.tar.gz'))) as unknown as ReadableStream<Uint8Array> });

    // 4. The same article with another title. Body, slug and date are unchanged.
    const blocks = article.blocks; const renderOptions = { videos: [], sources: [] };
    const entryId = `e_qa3_retry_${Date.now().toString(36)}`;
    const payload: PublishPayload = {
      entryId, title: NEW_TITLE, slug: article.slug, html: blocksToHtml(blocks, renderOptions), markdown: blocksToMarkdown(blocks, renderOptions), blocks, bodyImages: [],
      meta: article.meta, seoTitle: NEW_SEO_TITLE, keyword: article.keyword, date: article.date, image: null, canonical: null, mode: 'new', refreshUrl: null, sources: [], videos: [], author: article.author,
    };
    expect(NEW_TITLE).not.toBe(article.title);

    // 5. One run, as the connector calls it on a retry.
    await mkdir(path.join(OUTPUT_DIR, '.transcripts'), { recursive: true });
    const transcripts = await mkdtemp(path.join(OUTPUT_DIR, '.transcripts', 'retry-'));
    vi.stubEnv('RADAR_PUBLISH_SANDBOX', 'all'); vi.stubEnv('RADAR_PUBLISH_SANDBOX_TRANSCRIPT_DIR', transcripts);
    const config = sandboxPublisher(item.businessId);
    vi.unstubAllEnvs();
    if (!config.enabled) throw new Error(`The sandbox publisher is not configured. Missing or invalid: ${(config.missing || []).join(', ')}`);
    const logged: Record<string, unknown>[] = []; const startedAt = Date.now();
    let integration: SandboxIntegration | null = null; let failure: PublishError | null = null;
    try {
      integration = await integrateWithSandbox({
        config, hint: first.hint, payload, repo: first.repository, commitSha: 'f'.repeat(40), entries: [...head.values()], baseEntries: baseTree.tree, fetchArchive, readBlob,
        options: { businessId: item.businessId, deadlineAt: startedAt + config.attemptMs, retry: { slug: first.identity.slug, articlePath: first.identity.articlePath } },
      }, { log: line => { logged.push(line); } });
    } catch (thrown) { if (!(thrown instanceof PublishError)) throw thrown; failure = thrown; }
    const durationMs = Date.now() - startedAt;
    const run = logged.at(-1) ?? {};

    // 6. The record: counts and check details only.
    const files = await Promise.all((integration?.files ?? []).map(async file => {
      const onBase = baseByPath.get(file.path); const onHead = head.get(file.path);
      const baseText = onBase ? (await readBlob(onBase.sha)).toString('utf8') : null; const headText = onHead ? (await readBlob(onHead.sha)).toString('utf8') : null;
      return {
        path: file.path, onDefaultBranch: !!onBase, writtenByFirstAttempt: firstFiles.has(file.path),
        againstDefaultBranch: lineStats(baseText, file.content), againstBranchHead: lineStats(headText, file.content),
        oldTitleOccurrences: file.content.split(article.title).length - 1, newTitleOccurrences: file.content.split(NEW_TITLE).length - 1,
        oldSeoTitleOccurrences: article.seoTitle ? file.content.split(article.seoTitle).length - 1 : 0, newSeoTitleOccurrences: file.content.split(NEW_SEO_TITLE).length - 1,
        emDashes: (file.content.match(/—|&mdash;|&#8212;/g) ?? []).length,
      };
    }));
    // First-attempt files the retry left alone still carry the old title? Counted, so the reader can tell.
    const untouched = [...firstFiles].filter(([file]) => !files.some(changed => changed.path === file)).map(([file, data]) => ({ path: file, oldTitleOccurrences: data.toString('utf8').split(article.title).length - 1, oldSeoTitleOccurrences: article.seoTitle ? data.toString('utf8').split(article.seoTitle).length - 1 : 0 }));
    const { Daytona } = await import('@daytona/sdk');
    const client = new Daytona({ apiKey: config.daytonaKey, apiUrl: DAYTONA_API_URL });
    const listed = async () => { const ids: string[] = []; for await (const sandbox of client.list({ labels: { workload: SANDBOX_WORKLOAD, entry: entryId } })) ids.push(sandbox.id); return ids; };
    let remaining = await listed();
    for (const since = Date.now(); remaining.length && Date.now() - since < 45_000;) { await new Promise(resolve => setTimeout(resolve, 3000)); remaining = await listed(); }
    const record = {
      case: 'qa3-retry-title-change', builtOn: path.basename(FIRST), repository: first.repository, defaultBranchCommit: first.commitSha, hint: first.hint,
      startedAt: new Date(startedAt).toISOString(), durationMs, outcome: integration ? (integration.unchanged ? 'accepted-unchanged' : 'accepted') : failure!.diagnostic?.code ?? `http-${failure!.http}`,
      failure: failure ? { http: failure.http, kind: failure.kind, retryable: failure.retryable, stage: failure.diagnostic?.stage ?? null, reason: failure.diagnostic?.reason ?? null, issues: failure.diagnostic?.issues ?? null } : null,
      checks: integration?.checks.map(check => ({ id: check.id, outcome: check.outcome, detail: check.detail })) ?? [],
      identity: integration ? { slug: integration.slug, articlePath: integration.path, route: integration.route } : null, expectedIdentity: first.identity,
      changedFiles: files, firstAttemptFilesNotChanged: untouched,
      agentStatements: integration ? { conventions: integration.agentNotes.conventions.length, deviations: integration.agentNotes.deviations.length } : null,
      model: { catalogueId: config.model.catalogueId, capUsd: config.maxUsd, usage: await usageFrom(transcripts, config.model.catalogueId) },
      sandbox: { id: run.sandbox ?? null, agentTurns: run.turns ?? null, repaired: run.repaired ?? null, destroyed: run.destroyed ?? null, stillListed: remaining.length, stillListedIds: remaining },
      trees: { defaultBranchEntries: baseTree.tree.length, branchHeadEntries: head.size },
    };
    const stamp = new Date(startedAt).toISOString().replace(/[-:]/g, '').replace(/\..*$/, 'Z');
    const base = path.join(OUTPUT_DIR, `qa3-retry-title-change-${stamp}`);
    await writeFile(`${base}.json`, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    if (integration) for (const file of integration.files) { const target = path.join(`${base}.files`, file.path); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, file.content, { mode: 0o600 }); }
    console.info('[qa3.retry]', JSON.stringify({ outcome: record.outcome, durationMs, agentTurns: record.sandbox.agentTurns, repaired: record.sandbox.repaired, usage: record.model.usage, changed: files.map(file => file.path), stillListed: remaining.length, record: path.relative(process.cwd(), `${base}.json`) }));

    expect(record.sandbox.destroyed).toBe(true);
    expect(record.sandbox.stillListed).toBe(0);
    expect(record.outcome).toBe('accepted');
    expect(record.identity).toEqual(first.identity);
    expect(record.checks.find(check => check.id === 'peer-content')!.detail).toMatch(/^compared with the default-branch commit the article branch started from: /);
    // Nothing of the default branch is gone, and the old title is in no file the retry wrote.
    for (const file of files) { expect([file.path, file.againstDefaultBranch.linesGone]).toEqual([file.path, 0]); expect([file.path, file.oldTitleOccurrences]).toEqual([file.path, 0]); }
    expect(files.reduce((sum, file) => sum + file.newTitleOccurrences + file.newSeoTitleOccurrences, 0)).toBeGreaterThan(0);
  });
});
