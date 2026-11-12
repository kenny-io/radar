// QA-1 live: ONE real draft pull request through the real connector path with the sandbox engine on (SBX-1, SBX-5,
// SBX-6, SBX-7, SBX-10). One agent run (real sandbox, real model). Repository: the owner's test repository only.
//   RADAR_QA_LIVE_PR=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run --config .factory/sandbox-publisher/qa/vitest.config.ts .factory/sandbox-publisher/qa/live-pr.qa.test.ts
// The GitHub token comes from `gh auth token` inside this process and is never printed. Afterwards the pull request is
// closed with a comment and its branch deleted, whatever the assertions did. Records go to .data/ (git-ignored).
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Block } from '@/lib/types';
import { costOf } from '@/server/ai/prices';
import { branchOf, nextjs } from '@/server/services/publishing/connectors/nextjs';
import { blocksToHtml, blocksToMarkdown } from '@/server/services/publishing/render';
import { sandboxPublisher } from '@/server/services/publishing/sandbox/config';
import { DAYTONA_API_URL } from '@/server/services/publishing/sandbox/daytona';
import { readModelUsage } from '@/server/services/publishing/sandbox/modelProxy';
import { PUBLISH_CHECK_IDS, SANDBOX_NOT_RUN, SANDBOX_WORKLOAD } from '@/server/services/publishing/sandbox/types';
import type { ConnCtx, PublishPayload, RemoteDraft } from '@/server/services/publishing/types';

const ON = process.env.RADAR_QA_LIVE_PR === '1' && !!(process.env.DAYTONA_API_KEY && process.env.RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID && process.env.RADAR_PUBLISH_MODEL_PROXY_URL && process.env.RADAR_PUBLISH_CAPABILITY_SECRET);
const REPO = 'kenny-io/radar-connector-test';
/** Model usage is recorded under this business by the model proxy (PM instruction for this repository). */
const BUSINESS = '63f88165-ccd5-4a30-895a-0fc82d33fe9d';
const RUN = Date.now().toString(36);
const OUT = path.resolve(process.cwd(), '.data/sandbox-publisher/qa/pr');
const TRANSCRIPTS = path.join(OUT, '.transcripts');

const BLOCKS: Block[] = [
  ['p', 'This is test content written by QA to check a publishing pipeline end to end. It describes how to keep a small tool shed tidy, and it mentions no real person, product or business.'],
  ['h2', 'Give every tool one place'],
  ['p', 'A shed stays tidy when each tool has exactly one home. Draw the outline of every hand tool on a board, hang the tool over its outline, and an empty outline tells you at a glance what has not come back.'],
  ['ul', ['Hand tools on a board at eye level', 'Long handles upright in one corner', 'Screws and nails in labelled jars']],
  ['h2', 'Clear the floor once a month'],
  ['p', 'Whatever is on the floor at the end of the month either gets a home or leaves the shed. Ten minutes on the first Saturday is enough, and it stops the slow build-up that makes a shed unusable by autumn.'],
  ['p', 'Keep a short list on the inside of the door of anything that is broken or running low, and take a photograph of it before you go shopping.'],
];
function payloadOf(): PublishPayload {
  const options = { videos: [], sources: [] };
  return {
    entryId: `e_qa${RUN}`, title: 'QA test article: keeping a small tool shed tidy', slug: `qa-sandbox-publisher-check-${RUN}`, html: blocksToHtml(BLOCKS, options), markdown: blocksToMarkdown(BLOCKS, options), blocks: BLOCKS, bodyImages: [],
    meta: 'Test content written by QA for a publishing check: keeping a small tool shed tidy.', seoTitle: 'Keeping a Small Tool Shed Tidy (QA Test Article)', keyword: 'tidy tool shed', date: '2026-11-12', image: null,
    canonical: null, mode: 'new', refreshUrl: null, sources: [], videos: [], author: 'Radar QA',
  };
}

describe.skipIf(!ON)('one real draft pull request through the sandbox engine (live, one agent run)', { timeout: 1_200_000 }, () => {
  let token = '';
  const gh = async (suffix: string, init: RequestInit = {}) => {
    const response = await fetch(`https://api.github.com/repos/${REPO}${suffix}`, { ...init, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'Radar-QA', ...(init.body ? { 'content-type': 'application/json' } : {}) } });
    return { status: response.status, body: response.status === 204 ? null : await response.json().catch(() => null) as any };
  };
  const p = payloadOf();
  const branch = branchOf(p);
  const ref = `/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`;
  let c: ConnCtx;
  let mainBefore = '';
  let draft: RemoteDraft | null = null;
  let prNumber = 0; let prUrl = '';
  const runLines: Record<string, unknown>[] = [];
  const record: Record<string, unknown> = { repository: REPO, branch, entry: p.entryId, revision: '', startedAt: new Date().toISOString() };
  const sandboxesFor = async () => {
    const config = sandboxPublisher(BUSINESS); if (!config.enabled) throw new Error('not configured');
    const { Daytona } = await import('@daytona/sdk');
    const client = new Daytona({ apiKey: config.daytonaKey, apiUrl: DAYTONA_API_URL });
    const ids: string[] = []; for await (const item of client.list({ labels: { workload: SANDBOX_WORKLOAD, entry: p.entryId } })) ids.push(item.id);
    return ids;
  };

  beforeAll(async () => {
    token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    record.revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    await mkdir(TRANSCRIPTS, { recursive: true });
    // The switch names this one business; the transcript directory is a development-only aid used here to count model calls.
    process.env.RADAR_PUBLISH_SANDBOX = BUSINESS;
    process.env.RADAR_PUBLISH_SANDBOX_TRANSCRIPT_DIR = TRANSCRIPTS;
    c = { type: 'nextjs', fields: { repo: REPO, path: 'content/posts' }, creds: { access_token: token }, target: null, targetId: null, bid: BUSINESS, domain: 'radar-connector-test.invalid', businessName: 'Radar QA' };
    const real = console.info.bind(console);
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => { if (args[0] === '[radar.publish.sandbox]') { try { runLines.push(JSON.parse(String(args[1]))); } catch { /* not a run line */ } } real(...args); });
    mainBefore = (await gh('/git/ref/heads/main')).body.object.sha;
    record.mainBefore = mainBefore;
  });

  afterAll(async () => {
    // Always: comment, close, delete the branch, and confirm the repository is as it was found.
    const cleanup: Record<string, unknown> = {};
    try {
      if (!prNumber) { const open = await gh(`/pulls?head=${encodeURIComponent('kenny-io:' + branch)}&state=open`); if (Array.isArray(open.body) && open.body[0]) { prNumber = open.body[0].number; prUrl = open.body[0].html_url; } }
      if (prNumber) {
        cleanup.comment = (await gh(`/issues/${prNumber}/comments`, { method: 'POST', body: JSON.stringify({ body: 'This draft pull request was opened by an automated QA test of Radar\'s sandbox publisher. It is test content only. Closing it and deleting its branch; nothing here should be merged.' }) })).status;
        cleanup.close = (await gh(`/pulls/${prNumber}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) })).status;
      }
      cleanup.deleteBranch = (await gh(ref, { method: 'DELETE' })).status;
      const after = prNumber ? (await gh(`/pulls/${prNumber}`)).body : null;
      cleanup.prState = after?.state ?? null; cleanup.prMerged = after?.merged ?? null; cleanup.prDraft = after?.draft ?? null;
      cleanup.branchAfter = (await gh(`/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`)).status;
      cleanup.branchesAfter = ((await gh('/branches?per_page=100')).body as any[]).map(item => item.name);
      cleanup.openPullsAfter = ((await gh('/pulls?state=open&per_page=100')).body as any[]).length;
      cleanup.mainAfter = (await gh('/git/ref/heads/main')).body.object.sha;
      cleanup.mainUnchanged = cleanup.mainAfter === mainBefore;
    } catch (error) { cleanup.error = String((error as Error)?.message || error).slice(0, 200); }
    record.cleanup = cleanup; record.pullRequest = prUrl || null;
    await rm(TRANSCRIPTS, { recursive: true, force: true }).catch(() => {});
    await mkdir(OUT, { recursive: true });
    await writeFile(path.join(OUT, `pr-${RUN}.json`), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    console.info('[qa.live.pr]', JSON.stringify(record));
    delete process.env.RADAR_PUBLISH_SANDBOX; delete process.env.RADAR_PUBLISH_SANDBOX_TRANSCRIPT_DIR;
    vi.restoreAllMocks();
  });

  it('createDraft: one sandbox run, then exactly one branch with one commit on top of main, and the sandbox is gone', async () => {
    expect(sandboxPublisher(BUSINESS).enabled).toBe(true);
    expect(((await gh('/branches?per_page=100')).body as any[]).map(item => item.name)).toEqual(['main']);
    const startedAt = Date.now();
    draft = await nextjs.createDraft(c, p);
    record.createDraftMs = Date.now() - startedAt;
    expect(draft.id).toBe(branch);
    expect(draft.extra.layout).toBe('sandbox-agent');
    expect(draft.extra.review.runtimeVerified).toBe(false);
    expect(draft.extra.checks.map((check: any) => check.id).sort()).toEqual([...PUBLISH_CHECK_IDS].sort());
    expect(draft.extra.continuation).toBeUndefined();
    // QA-4: the gate's counts are saved on the draft; the pull request's "Checked by Radar" sentence is written from them.
    for (const key of ['existingLinesChanged', 'articleLinesReplaced', 'notWordForWord', 'undecided', 'headings', 'headingsMissing']) expect([key, Number.isSafeInteger(draft.extra.facts?.[key]) && draft.extra.facts[key] >= 0]).toEqual([key, true]);
    expect([draft.extra.facts.articleLinesReplaced, draft.extra.facts.headings]).toEqual([0, BLOCKS.filter(block => block[0] === 'h2' || block[0] === 'h3').length]);
    record.draft = { path: draft.extra.path, slug: draft.extra.slug, route: draft.extra.route, files: draft.extra.files, checks: draft.extra.checks, facts: draft.extra.facts, mediaOmitted: draft.extra.mediaOmitted.length, deviations: draft.extra.agentNotes.deviations.length, notRun: draft.extra.notRun };

    expect(runLines).toHaveLength(1);
    expect(runLines[0]).toMatchObject({ entry: p.entryId, destroyed: true, outcome: 'integrated' });
    record.run = runLines[0];
    let remaining = await sandboxesFor();
    for (const since = Date.now(); remaining.length && Date.now() - since < 45_000;) { await new Promise(resolve => setTimeout(resolve, 3000)); remaining = await sandboxesFor(); }
    expect(remaining).toEqual([]);

    // Model calls and cost, from the run transcript (development aid). The proxy's ai_calls rows are authoritative.
    const usage = { modelCalls: 0, costUsd: 0 }; const responses = new Set<string>();
    for (const name of (await readdir(TRANSCRIPTS)).filter(file => file.endsWith('.jsonl.gz'))) {
      for (const line of gunzipSync(await readFile(path.join(TRANSCRIPTS, name))).toString('utf8').split('\n')) {
        let message: any; try { message = JSON.parse(line); } catch { continue; }
        if (message?.type === 'assistant' && typeof message.message?.id === 'string') responses.add(message.message.id);
        if (message?.type === 'result') { const total = readModelUsage(message.usage); if (total) usage.costUsd += costOf('claude-opus-5.5', total, 'Anthropic') ?? 0; }
      }
    }
    usage.modelCalls = responses.size; usage.costUsd = Math.round(usage.costUsd * 1e4) / 1e4;
    record.usage = usage;

    // GitHub: one new branch, one commit ahead of main, nothing behind, main untouched.
    expect(((await gh('/branches?per_page=100')).body as any[]).map(item => item.name).sort()).toEqual(['main', branch].sort());
    const compare = (await gh(`/compare/main...${encodeURIComponent(branch)}`)).body;
    expect([compare.ahead_by, compare.behind_by]).toEqual([1, 0]);
    expect(compare.commits).toHaveLength(1);
    expect(compare.commits[0].parents.map((parent: any) => parent.sha)).toEqual([mainBefore]);
    expect((await gh('/git/ref/heads/main')).body.object.sha).toBe(mainBefore);
    const message: string = compare.commits[0].commit.message;
    expect(message.startsWith(`Add post: ${p.title}\n\nRadar-Post: `)).toBe(true);
    const marker = JSON.parse(message.split('\n').at(-1)!.slice('Radar-Post: '.length));
    expect(marker).toMatchObject({ version: 3, engine: 'sandbox', entryId: p.entryId, hint: 'content/posts', slug: draft.extra.slug, articlePath: draft.extra.path, route: draft.extra.route });
    expect(compare.files.map((file: any) => file.filename).sort()).toEqual([...draft.extra.files].sort());
    record.commit = { sha: compare.commits[0].sha, parent: mainBefore, files: compare.files.map((file: any) => ({ filename: file.filename, status: file.status, additions: file.additions, deletions: file.deletions })) };
    // The committed article carries the article's words.
    const file = await gh(`/contents/${draft.extra.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`);
    const text = Buffer.from(file.body.content, 'base64').toString('utf8');
    const flat = text.replace(/\s+/g, ' ');
    for (const block of BLOCKS) for (const unit of (block[0] === 'ul' ? block[1] : [block[1]]) as string[]) expect(flat).toContain(unit);
    // No secret in the commit or the saved draft.
    const secrets = [token, process.env.DAYTONA_API_KEY!, process.env.RADAR_PUBLISH_CAPABILITY_SECRET!];
    for (const secret of secrets) { expect(JSON.stringify(draft).includes(secret)).toBe(false); expect((message + text).includes(secret)).toBe(false); }
    expect(JSON.stringify(draft) + message + text).not.toContain('rdrcap1.');
  });

  it('publish: exactly one draft pull request, with an honest body', async () => {
    const { url } = await nextjs.publish(c, p, draft!);
    prUrl = url; prNumber = Number(url.split('/').pop());
    const pr = (await gh(`/pulls/${prNumber}`)).body;
    expect([pr.state, pr.draft, pr.merged, pr.base.ref, pr.head.ref, pr.html_url, pr.commits]).toEqual(['open', true, false, 'main', branch, url, 1]);
    expect((await gh(`/pulls?head=${encodeURIComponent('kenny-io:' + branch)}&state=all`)).body).toHaveLength(1);
    const body: string = pr.body;
    await mkdir(OUT, { recursive: true });
    await writeFile(path.join(OUT, `pr-${RUN}.body.md`), body + '\n', { mode: 0o600 });
    // QA-4 (12 Nov 2026): expectations rewritten for the short body of 0f89aa2a (architecture section 15). Not run
    // since the rewrite: this file opens a real pull request. The same shape is checked without a network in
    // connector.qa.test.ts and pr-body.qa.test.ts, and against GitHub's renderer in live-markdown.qa.test.ts.
    const lines = body.split('\n');
    const AGENT_LABEL = '- Reported by the agent that made the change (not verified by Radar):';
    const CLOSING = 'Radar did not build or run the site. Check the article on the deployment preview before merging.';
    // The description, the draft notice, one list, the closing sentence. No heading anywhere.
    expect(lines.slice(0, 3)).toEqual([p.meta, '', `**Draft for review.** The article is not live. Scheduled for ${p.date}.`]);
    expect(lines).toContain(`- Article: \`${draft!.extra.path}\`, expected at \`${draft!.extra.route}\``);
    expect(lines.slice(-4)).toEqual(['', CLOSING, '', 'Opened by Radar.']);
    expect(lines.filter(line => /^ {0,3}#/.test(line))).toEqual([]);
    // What Radar checked: one sentence written from the gate's counts. A first attempt at a new article removed no
    // existing line, and the sentence names no build, lint, test, preview or runtime result.
    const checked = lines.filter(line => line.startsWith('- Checked by Radar: '));
    expect(checked).toHaveLength(1);
    expect(checked[0]).toMatch(/^- Checked by Radar: no existing line was removed/);
    expect(checked[0]).not.toMatch(/build|lint|tests?\b|preview|deploy|runtime|install|verified/i);
    // What the agent says: its deviations only (at most eight), each one line behind Radar's "Deviation n:", in one
    // run directly under the label that says Radar did not verify them. No label when it reported none.
    const agent = lines.flatMap((line, index) => (/^ {2}- Deviation \d+: \S/.test(line) ? [index] : []));
    const shown = Math.min(draft!.extra.agentNotes.deviations.length, 8);
    expect(agent).toHaveLength(shown);
    expect(lines.filter(line => line === AGENT_LABEL)).toHaveLength(shown ? 1 : 0);
    if (shown) expect(agent).toEqual(agent.map((_unused, n) => lines.indexOf(AGENT_LABEL) + 1 + n));
    expect(lines.filter(line => /^ {2}- and \d+ more$/.test(line)).length).toBe((draft!.extra.agentNotes.deviations.length > 8 ? 1 : 0) + (draft!.extra.mediaOmitted.length > 10 ? 1 : 0));
    // What Radar did not find in the change is listed as code, and only when there is something to list.
    expect(lines.some(line => line.startsWith('- Not carried over: '))).toBe(draft!.extra.mediaOmitted.length > 0);
    // Every line that is not the agent's is one Radar wrote, and none of them reports a result of something not run.
    const radar = lines.filter((line, index) => !agent.includes(index) && line !== p.meta && line !== CLOSING && line !== AGENT_LABEL && !line.startsWith('- Article: ') && !/^ {2}- `[^`]*`$/.test(line));
    expect(radar.join('\n')).not.toMatch(/build|lint|tests?\b|preview|deploy|runtime|install|verified/i);
    // The agent's summary, the rules it says it followed, the per-check list and the "Not run" and "Files" lists are
    // saved on the draft for operators and are not printed.
    expect(body).not.toMatch(/^(?:Summary: |- Rule \d+: |- \*\*)/m);
    expect(body).not.toMatch(/Checks Radar ran|What the agent reported|Not run|bytes \(limit/);
    expect(draft!.extra.notRun).toEqual([...SANDBOX_NOT_RUN]);
    expect(typeof draft!.extra.summary).toBe('string');
    expect(body.length).toBeLessThan(8 * 440 + 10 * 310 + 1500);
    for (const secret of [token, process.env.DAYTONA_API_KEY!, process.env.RADAR_PUBLISH_CAPABILITY_SECRET!, 'rdrcap1.']) expect(body.includes(secret)).toBe(false);
    record.pr = { number: prNumber, state: pr.state, draft: pr.draft, base: pr.base.ref, commits: pr.commits, changedFiles: pr.changed_files, bodyChars: body.length, deviationsShown: shown };
  });

  it('a retry for the same entry runs no sandbox, writes no commit and opens no second pull request (SBX-7)', async () => {
    const head = (await gh(`/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`)).body.object.sha;
    // 1. The saved draft is used again (a retry after the pull request was opened but before the entry was marked published).
    const again = await nextjs.publish(c, p, draft!);
    expect(again.url).toBe(prUrl);
    // 2. The saved draft was lost (a crash after the ref update): the whole attempt runs again from createDraft.
    const startedAt = Date.now();
    const resumed = await nextjs.createDraft(c, p);
    record.retryCreateDraftMs = Date.now() - startedAt;
    expect(resumed.id).toBe(branch);
    expect(resumed.extra).toMatchObject({ layout: 'sandbox-agent', continuation: 'resumed', path: draft!.extra.path, slug: draft!.extra.slug, route: draft!.extra.route });
    expect(runLines).toHaveLength(1); // no second sandbox attempt was logged
    expect(await sandboxesFor()).toEqual([]);
    expect((await nextjs.publish(c, p, resumed)).url).toBe(prUrl);
    expect((await gh(`/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`)).body.object.sha).toBe(head);
    const compare = (await gh(`/compare/main...${encodeURIComponent(branch)}`)).body;
    expect([compare.ahead_by, compare.behind_by]).toEqual([1, 0]);
    const all = (await gh(`/pulls?head=${encodeURIComponent('kenny-io:' + branch)}&state=all`)).body;
    expect(all).toHaveLength(1);
    expect(((await gh('/pulls?state=open&per_page=100')).body as any[]).map(item => item.number)).toEqual([prNumber]);
    expect(((await gh('/branches?per_page=100')).body as any[]).map(item => item.name).sort()).toEqual(['main', branch].sort());
    record.retry = { sandboxRuns: runLines.length, headUnchanged: true, pullRequestsForBranch: all.length, continuation: resumed.extra.continuation };
  });
});
