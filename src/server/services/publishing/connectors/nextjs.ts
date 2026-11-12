// GitHub (type "nextjs") — OAuth, scope "repo". Each article gets its own branch and PR.
// Every site layout uses source-based repository planning and review before an atomic complete integration commit.
// One of two engines prepares that commit, chosen once per attempt by sandboxPublisher(businessId) (sandbox/config.ts):
// the planner (nextjs-agent.ts, the default) or the sandbox publisher (sandbox/run.ts). The GitHub token never leaves
// this file: the sandbox engine receives closures that fetch the pinned archive and blobs, not the credentials.
// "Published" = the pull request is opened (DIVERGENCES #10); publishedUrl is the PR.
// Contract (docs.github.com/en/rest, API version 2022-11-28):
//  - GET  /repos/{repo}: default_branch, permissions.push; a private repo the token can't see is a 404, not a 403
//  - GET  /repos/{repo}/git/ref/heads/<branch name> (the branch's slashes stay in the path); 404 = no such ref, 409 = empty repo
//  - POST /repos/{repo}/git/refs { ref: "refs/heads/…", sha }; DELETE /repos/{repo}/git/refs/heads/<branch name>
//  - GET  /repos/{repo}/contents/{path}?ref=<commit SHA> → { sha, encoding, content }; immutable text source only
//  - GET  /repos/{repo}/tarball/<commit SHA> → 302 to codeload.github.com (the token is not sent across that redirect);
//    GET  /repos/{repo}/git/blobs/<blob SHA> → { encoding: "base64", content }; GET /repos/{repo}/commits/<SHA> → { files: [{ filename, status }] }
//  - GET/POST /repos/{repo}/git/trees and /git/commits; PATCH /git/refs/heads/<branch> { sha, force: false }
//  - GET  /repos/{repo}/compare/<base SHA>...<head SHA> → { merge_base_commit: { sha, commit: { tree: { sha } } } };
//    404 when the two commits share no history
//  - POST /repos/{repo}/pulls { title, head, base, body, draft: true } (422 = validation, e.g. that head has a PR);
//    GET /repos/{repo}/pulls?head=owner:branch&state=open
//  - GET  /user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100&page=N → [{ full_name, html_url, permissions.push }]
//    (repos of an org that restricts OAuth apps are left out of the list, not an error)
//  - 401 = bad credentials; rate limits are 403 or 429 ("API rate limit exceeded" / "secondary rate limit");
//    an org that restricts OAuth apps answers 403 "…the `org` organization has enabled OAuth App access restrictions…",
//    and one with SAML single sign-on answers 403 "Resource protected by organization SAML enforcement…"
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/server/env';
import { reportFailure } from '@/server/observability/failures';
import type { Connector, ConnCtx, PublishPayload, RemoteDraft, Target } from '../types';
import { jsonBody, PublishError, req, reqJson, publishingTimeRemaining, repositoryPublishingError } from '../http';
import { planRepositoryPost, safeRepositoryPath, RepositorySourceTooLargeError, SOURCE_FILE_BYTES, type RepoEntry, type RepositoryPostPlan } from './nextjs-agent';
import { sandboxPublisher } from '../sandbox/config';
import { integrateWithSandbox } from '../sandbox/run';
import { articleReferences } from '../sandbox/fidelity';
import { AGENT_TEXT, COMMIT_MARKER_KEY_PURPOSE, GATE_LIMITS, PUBLISH_CHECK_IDS, SANDBOX_BUDGET, SANDBOX_DRAFT_LAYOUT, SANDBOX_NOT_RUN, SANDBOX_OPERATIONS, shortenAgentText, type PublishCheck, type SandboxCommitMarker, type SandboxContinuation, type SandboxDraftExtra, type SandboxIntegration } from '../sandbox/types';

const API = 'https://api.github.com';
const h = (c: ConnCtx) => ({ authorization: `Bearer ${c.creds.access_token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'Radar' });
/** owner/repo (or a github.com URL to it). "." and ".." are never names: they would turn the API path into another endpoint. */
export const parseRepo = (s: string) => { const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec((s || '').trim()); return m && !/^\.+$/.test(m[1]) && !/^\.+$/.test(m[2]) ? { owner: m[1], repo: m[2] } : null; };
const repoOf = (c: ConnCtx) => { const r = parseRepo(c.fields.repo); if (!r) throw new PublishError(404, 'Invalid repository', 'github.com', 'config'); return `${r.owner}/${r.repo}`; };
/** The repo-relative content folder from what was typed or pasted: a github.com URL, "tree/main/…" or "/content/posts/".
 * Without a github.com URL, "tree/<branch>/" is only stripped when a folder follows it, so a real "tree/posts" folder stays. */
export const normFolder = (s: string) => {
  let v = (s || '').trim(); const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/[^/]+\/[^/]+(?:\/|$)/i;
  if (url.test(v)) v = v.replace(url, '').replace(/^\/+/, '').replace(/^(?:tree|blob)\/[^/]+(?:\/|$)/, '');
  else v = v.replace(/^\/+/, '').replace(/^(?:tree|blob)\/[^/]+\/(?=[^/])/, '');
  return v.replace(/^\/+|\/+$/g, '') || 'content/posts';
};
/** "." and ".." segments would let the folder climb out of the repository's contents API into other endpoints or repos. */
export const unsafeFolder = (s: string) => s.split('/').some(x => x === '.' || x === '..');
const folder = (c: ConnCtx) => { const f = normFolder(c.fields.path); if (unsafeFolder(f)) throw repositoryPublishingError('The content folder can’t contain “.” or “..”. Edit the connection and choose a folder inside the repository.'); return f; };
const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const notFound = (e: unknown) => e instanceof PublishError && e.http === 404;

/** The org named in GitHub's 403 message (`thallylabs`), else a generic "repository’s". */
const orgIn = (detail: string) => { const m = /`([A-Za-z0-9-]+)`/.exec(detail); return m ? m[1] : 'repository’s'; };
/** A revoked token is "Needs reconnecting"; a rate-limited 403 is retried like a 429 instead of flagging the connection;
 * an org that hasn't approved Radar (or needs SSO) is a setup problem explained in a sentence, not "check the credentials". */
function githubFailure(e: unknown): unknown {
  if (e instanceof PublishError && e.http === 401) return new PublishError(401, e.detail, e.host, 'auth-expired');
  if (e instanceof PublishError && e.http === 403 && /OAuth App access restrictions/i.test(e.detail)) return new PublishError(403, `The ${orgIn(e.detail)} organization hasn’t approved Radar on GitHub. Ask an organization owner to approve it, or request access under GitHub Settings → Applications → Radar, then test again.`, e.host, 'config');
  if (e instanceof PublishError && e.http === 403 && /SAML enforcement/i.test(e.detail)) return new PublishError(403, `The ${orgIn(e.detail)} organization uses single sign-on. Authorize Radar for it under GitHub Settings → Applications → Radar, then test again.`, e.host, 'config');
  if (e instanceof PublishError && e.http === 403 && /rate limit/i.test(e.detail)) return new PublishError(429, e.detail, e.host);
  return e;
}
async function gh<T = any>(c: ConnCtx, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const timeoutMs = Math.min(init.timeoutMs ?? 30_000, publishingTimeRemaining(c.publishDeadlineAt, 'plan'));
  try { return await reqJson<T>(url, { ...init, timeoutMs }); } catch (e) {
    publishingTimeRemaining(c.publishDeadlineAt, 'plan');
    throw githubFailure(e);
  }
}
async function getRef(c: ConnCtx, repo: string, branch: string): Promise<{ object: { sha: string } } | null> {
  try { return await gh(c, `${API}/repos/${repo}/git/ref/heads/${encPath(branch)}`, { headers: h(c) }); }
  catch (e) {
    if (notFound(e)) return null;
    if (e instanceof PublishError && e.http === 409) throw new PublishError(422, 'The repository is empty. Push a first commit to it, then try again.', e.host, 'config');
    throw e;
  }
}

async function base(c: ConnCtx) {
  const repo = repoOf(c);
  const r = await gh<{ default_branch: string; permissions?: { push?: boolean } }>(c, `${API}/repos/${repo}`, { headers: h(c) });
  if (r.permissions && r.permissions.push === false) throw new PublishError(403, 'Your GitHub account can’t push to that repository. Reconnect with an account that can.', 'api.github.com', 'config');
  const ref = await getRef(c, repo, r.default_branch);
  if (!ref) throw new PublishError(404, `Default branch ${r.default_branch} not found`, 'api.github.com');
  return { repo, branch: r.default_branch, sha: ref.object.sha };
}
const makeBranch = (c: ConnCtx, repo: string, name: string, sha: string) => gh(c, `${API}/repos/${repo}/git/refs`, { method: 'POST', ...jsonBody({ ref: `refs/heads/${name}`, sha }, h(c)) });

/** One branch per article (slug + entry id): a retry finds and reuses it, and two articles with the same slug never share one. */
export const branchOf = (p: PublishPayload) => `radar/${p.slug.slice(0, 120).replace(/-+$/, '')}-${p.entryId.replace(/^e_/, '').slice(0, 60)}`.replace(/[^A-Za-z0-9._/-]/g, '-').replace(/\.{2,}/g, '.').replace(/[./]+$/, '');

/** Repositories the account can push to, most recently pushed first. Page 1 alone answers most accounts; a full page fetches
 * pages 2–5 together (one listing of ~500 repos page by page took ~16 s). The likely site repo leads and is preselected. */
async function repos(c: ConnCtx): Promise<Target[]> {
  type Row = { full_name: string; name: string; html_url: string; permissions?: { push?: boolean } };
  const page = async (n: number): Promise<Row[]> => { const b = await gh(c, `${API}/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member&page=${n}`, { headers: h(c) }); return Array.isArray(b) ? b : []; };
  const all = await page(1);
  if (all.length === 100) for (const b of await Promise.all([2, 3, 4, 5].map(page))) { all.push(...b); if (b.length < 100) break; }
  const host = (c.domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''); const label = host.split('.')[0];
  // 0: named for the site ("thally-website", "thally.io"), 1: exactly the label ("thally"), 2: contains it ("thallydocs"), 3: the rest.
  const rank = (n: string) => !label || label.length < 2 ? 3 : n === host || /^(.+)[-_.](website|site|web|www|blog|homepage|landing|marketing)$/.exec(n)?.[1] === label ? 0 : n === label ? 1 : n.includes(label) ? 2 : 3;
  const list = all.filter(r => r.permissions?.push && r.full_name).map(r => ({ t: { id: r.full_name, name: r.full_name, url: r.html_url || null }, r: rank((r.name || r.full_name.split('/')[1] || '').toLowerCase()) }));
  return [0, 1, 2, 3].flatMap(k => list.filter(x => x.r === k).map(x => (k < 3 ? { ...x.t, suggested: true } : x.t)));
}

/** One absolute deadline per publishing attempt: the sandbox engine's budget when it is selected for the business,
 * otherwise the planner's 270 seconds. The publisher and this connector both take it from here. */
export const publishAttemptMs = (businessId: string) => (sandboxPublisher(businessId).enabled ? SANDBOX_BUDGET.attemptMs : 270_000);

/** Marker version 3: identifies the article a sandbox commit was gated for. A retry with the same article reuses that commit. */
const articleBodyHash = (p: PublishPayload) => createHash('sha256').update(JSON.stringify([p.title, p.slug, p.markdown, p.html, p.meta, p.date, p.mode, p.refreshUrl])).digest('hex').slice(0, 16);

// A commit trailer is text anyone with push access to the repository can copy onto a later commit, so the marker of a
// sandbox commit is bound to what Radar committed: it names the tree it was written for and carries an HMAC over its
// identity fields. The key is derived from the application secret for this purpose alone and never leaves the control
// plane (it is not given to the sandbox, the model proxy or GitHub). Without the application secret in production
// nothing is signed, so nothing is ever resumed; development and tests use the same fallback as the rest of the app.
type MarkerIdentity = Pick<SandboxCommitMarker, 'entryId' | 'hint' | 'slug' | 'articlePath' | 'route' | 'body'> & { tree: string };
function markerKey(): Buffer | null {
  const secret = env.secretKey || (env.isProd ? '' : 'radar-dev-only-key');
  return secret ? createHmac('sha256', secret).update(COMMIT_MARKER_KEY_PURPOSE).digest() : null;
}
/** HMAC-SHA256, base64url, over the marker's identity fields in a fixed order. null when there is no key to sign with. */
export function markerSignature(marker: MarkerIdentity): string | null {
  const key = markerKey();
  return key ? createHmac('sha256', key).update(JSON.stringify(['Radar-Post', 3, 'sandbox', marker.entryId, marker.hint, marker.slug, marker.articlePath, marker.route, marker.body, marker.tree])).digest('base64url') : null;
}
/** True only for a marker Radar signed whose tree is the tree of the commit it sits on. A marker with no signature
 *  (written before signing existed, or without a key), a changed field, a forged signature or another tree is false. */
export function markerBindsCommit(saved: any, commitTree: string): boolean {
  const fields = [saved?.entryId, saved?.hint, saved?.slug, saved?.articlePath, saved?.route, saved?.body, saved?.tree, saved?.sig];
  if (!fields.every(value => typeof value === 'string' && value.length > 0 && value.length <= 2000)) return false;
  const expected = markerSignature(saved);
  if (!expected) return false;
  const given = Buffer.from(saved.sig, 'base64url'); const wanted = Buffer.from(expected, 'base64url');
  return given.length === wanted.length && timingSafeEqual(given, wanted) && saved.tree === commitTree;
}
const gitBlobSha = (data: Buffer, algorithm: 'sha1' | 'sha256') => createHash(algorithm).update(`blob ${data.length}\0`).update(data).digest('hex');

/** RemoteDraft.extra for a gated sandbox integration. Also used by the replay harness to render the pull request body. */
export function sandboxDraftExtra(base: string, p: PublishPayload, plan: Pick<SandboxIntegration, 'slug' | 'path' | 'summary' | 'route' | 'checks' | 'agentNotes' | 'mediaOmitted' | 'review'> & { files: string[] }, continuation?: SandboxContinuation): SandboxDraftExtra {
  return {
    base, path: plan.path, slug: plan.slug, layout: SANDBOX_DRAFT_LAYOUT,
    // A retry may leave the article file as it already is on the branch; it is still the file the checks were about.
    files: plan.files.includes(plan.path) ? plan.files : [plan.path, ...plan.files],
    summary: plan.summary, route: plan.route, checks: plan.checks, agentNotes: plan.agentNotes, notRun: [...SANDBOX_NOT_RUN], mediaOmitted: plan.mediaOmitted,
    review: { summary: plan.review.summary, runtimeVerified: false }, draft: true,
    ...(p.mode === 'new' && plan.slug !== p.slug ? { taken: true as const } : {}),
    ...(continuation ? { continuation } : {}),
  };
}

/** One immutable snapshot and one complete commit: content never lands without its integration changes. */
async function createRepositoryDraft(c: ConnCtx, p: PublishPayload, b: Awaited<ReturnType<typeof base>>, hint: string, storedLegacy?: RemoteDraft) {
  const branch = branchOf(p);
  const validSlug = (value: unknown): value is string => typeof value === 'string' && !!value && !['.', '..'].includes(value) && value.length <= 200 && !/[\x00-\x20/\\?#]/.test(value);
  if (storedLegacy && (storedLegacy.id !== branch || storedLegacy.extra?.base !== b.branch || !validSlug(storedLegacy.extra?.slug) || typeof storedLegacy.extra?.path !== 'string' || !safeRepositoryPath(storedLegacy.extra.path, true))) {
    throw repositoryPublishingError('The older publishing draft does not match this article and repository branch. Review or reset the saved draft before retrying.');
  }
  const previous = await getRef(c, b.repo, branch);
  if (storedLegacy && !previous) throw repositoryPublishingError('The older publishing branch no longer exists. Reset the saved publishing draft and try again.');
  const parent = previous?.object.sha || b.sha;
  const commit = await gh<{ tree: { sha: string }; message: string }>(c, `${API}/repos/${b.repo}/git/commits/${parent}`, { headers: h(c) });
  let retry: { slug: string; articlePath: string } | undefined;
  let legacy: { slug: string; articlePath: string } | undefined;
  let gatedRoute: string | undefined;
  if (previous) {
    // Only Radar's final generated marker is authoritative; article titles can contain arbitrary newlines.
    const trailer = commit.message.trimEnd().split('\n').at(-1);
    const marker = trailer?.startsWith('Radar-Post: ') ? trailer.slice('Radar-Post: '.length) : null;
    let saved: any;
    try { saved = marker && JSON.parse(marker); } catch { /* Refuse unrelated branches. */ }
    // Version 2 is written by the planner and version 3 by the sandbox engine; both bind the same article identity.
    const versioned = saved?.version === 2 || saved?.version === 3;
    const matches = versioned && saved.entryId === p.entryId && saved.hint === hint && validSlug(saved.slug) && typeof saved.articlePath === 'string' && safeRepositoryPath(saved.articlePath, true);
    if (matches) {
      retry = { slug: saved.slug, articlePath: saved.articlePath };
      // Resumed only when the marker is Radar's own for exactly this commit. Any other version 3 marker (unsigned,
      // altered, or copied onto a commit with another tree) is an ordinary retry: the engine runs on the branch head.
      if (saved.version === 3 && saved.engine === 'sandbox' && saved.body === articleBodyHash(p) && typeof saved.route === 'string' && saved.route.startsWith('/') && !/[\x00-\x20\x7f]/.test(saved.route) && markerBindsCommit(saved, commit.tree.sha)) gatedRoute = saved.route;
    }
    else if (storedLegacy && !versioned && (!saved?.entryId || saved.entryId === p.entryId)) legacy = { slug: storedLegacy.extra.slug, articlePath: storedLegacy.extra.path };
    else {
      throw repositoryPublishingError('The article branch contains changes Radar cannot safely resume. Review that branch before retrying, or use a new article branch.');
    }
  }
  if (retry && gatedRoute) {
    // The branch head is the commit Radar itself wrote for exactly this article (its signed marker names this tree),
    // and such a commit is written only after the publication gate passed. An attempt that was interrupted after the
    // ref update resumes here: no sandbox run and no second commit. The gate's details and the agent's notes were
    // never persisted, so the draft says so.
    const head = await gh<{ files?: { filename?: unknown; status?: unknown }[] }>(c, `${API}/repos/${b.repo}/commits/${parent}`, { headers: h(c) });
    const files = (Array.isArray(head.files) ? head.files : []).filter(file => file?.status !== 'removed' && typeof file?.filename === 'string' && safeRepositoryPath(file.filename, true)).map(file => String(file.filename)).slice(0, GATE_LIMITS.candidates);
    return { id: branch, extra: sandboxDraftExtra(b.branch, p, {
      slug: retry.slug, path: retry.articlePath, files, route: gatedRoute, mediaOmitted: [], agentNotes: { conventions: [], deviations: [] },
      summary: 'Radar reused the commit an earlier attempt had already checked and written to this branch.',
      checks: PUBLISH_CHECK_IDS.map(id => ({ id, outcome: 'passed' as const, detail: 'passed in the earlier attempt, before this commit was written; its details were not kept' })),
      review: { summary: 'An earlier attempt passed every Radar check before it wrote this commit. Nothing from the repository was installed, built or executed.', runtimeVerified: false },
    }, 'resumed') };
  }
  const tree = await gh<{ sha: string; truncated?: boolean; tree: RepoEntry[] }>(c, `${API}/repos/${b.repo}/git/trees/${commit.tree.sha}?recursive=1`, { headers: h(c) });
  if (tree.truncated || !Array.isArray(tree.tree) || tree.tree.length > 30_000) throw repositoryPublishingError('The repository tree is too large to inspect safely. Connect the website in a smaller repository and try again.', 'tree-unavailable');
  const entries = new Map(tree.tree.map(entry => [entry.path, entry]));
  if (legacy) {
    const exported = entries.get(legacy.articlePath);
    if (!exported || exported.type !== 'blob' || !['100644', '100755'].includes(exported.mode || '100644')) throw repositoryPublishingError('The saved older draft article is missing or is not a regular repository file. Reset the publishing draft before retrying.');
  }
  const cache = new Map<string, Promise<string>>();
  const read = (path: string): Promise<string> => {
    const entry = entries.get(path);
    if (!entry || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode || '100644') || !safeRepositoryPath(path)) throw repositoryPublishingError('Repository inspection requested an unavailable or protected text file.');
    if (entry.size !== undefined && entry.size > SOURCE_FILE_BYTES) throw new RepositorySourceTooLargeError(path, entry.sha, entry.size);
    if (!cache.has(path)) cache.set(path, (async () => {
      const file = await gh<{ sha?: string; content?: string; encoding?: string; size?: number }>(c, `${API}/repos/${b.repo}/contents/${encPath(path)}?ref=${encodeURIComponent(parent)}`, { headers: h(c) });
      if (file.sha !== entry.sha) throw repositoryPublishingError('Repository file contents do not match the inspected revision. Retry after checking the repository branch.', 'snapshot-mismatch');
      if ((file.size || 0) > SOURCE_FILE_BYTES) throw new RepositorySourceTooLargeError(path, entry.sha, file.size!);
      if (file.encoding !== 'base64' || typeof file.content !== 'string') throw repositoryPublishingError(`Radar cannot safely inspect ${path}. Source files used for publishing must be below 100 KB.`);
      if (file.content.replace(/\s/g, '').length > Math.ceil(SOURCE_FILE_BYTES / 3) * 4) throw new RepositorySourceTooLargeError(path, entry.sha, Math.floor(file.content.replace(/\s/g, '').length * 3 / 4) - (file.content.endsWith('==') ? 2 : file.content.endsWith('=') ? 1 : 0));
      const decoded = Buffer.from(file.content, 'base64');
      if (decoded.length > SOURCE_FILE_BYTES) throw new RepositorySourceTooLargeError(path, entry.sha, decoded.length);
      try { return new TextDecoder('utf-8', { fatal: true }).decode(decoded); }
      catch { throw repositoryPublishingError('Repository inspection encountered a file that is not UTF-8 text.'); }
    })());
    return cache.get(path)!;
  };
  // The sandbox engine's two views of the repository. The token stays in these closures: sandbox/run.ts gets archive
  // bytes and blob bytes, never the credentials, and nothing here is handed to the sandbox provider.
  const fetchArchive = async (signal: AbortSignal): Promise<{ stream: ReadableStream<Uint8Array> }> => {
    // req() builds its own timeout signal, so the request is bounded by the archive budget and the caller's signal is raced.
    const timeoutMs = Math.min(SANDBOX_BUDGET.archiveSec * 1000, publishingTimeRemaining(c.publishDeadlineAt, 'plan'));
    let abort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => { abort = () => reject(new PublishError(0, 'timed out', 'api.github.com', 'network')); });
    aborted.catch(() => {});
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    const opening = req(`${API}/repos/${b.repo}/tarball/${parent}`, { headers: h(c), timeoutMs });
    try {
      const response = await Promise.race([opening, aborted]);
      if (!response.body) throw new PublishError(502, 'The repository archive was empty', 'api.github.com');
      return { stream: response.body };
    } catch (e) {
      // A response that arrives after the caller gave up is closed, not left open.
      opening.then(late => late.body?.cancel(), () => {}).catch(() => {});
      throw githubFailure(e);
    } finally { signal.removeEventListener('abort', abort); }
  };
  const pinnedBlobs = new Map(tree.tree.filter(entry => entry.type === 'blob').map(entry => [entry.sha, entry.size]));
  const blobCache = new Map<string, Promise<Buffer>>();
  const readBlob = (sha: string): Promise<Buffer> => {
    if (!blobCache.has(sha)) blobCache.set(sha, (async () => {
      if (!pinnedBlobs.has(sha)) throw repositoryPublishingError('The publication checks requested a file that is not in the inspected revision.', 'snapshot-mismatch');
      // An original far above what a change may touch is refused rather than held in memory.
      if ((pinnedBlobs.get(sha) ?? 0) > 2 * GATE_LIMITS.totalBytes) throw repositoryPublishingError('A file in the change is too large for Radar to compare with its original.', 'final-output-size');
      const blob = await gh<{ content?: string; encoding?: string }>(c, `${API}/repos/${b.repo}/git/blobs/${sha}`, { headers: h(c) });
      const data = blob.encoding === 'base64' && typeof blob.content === 'string' ? Buffer.from(blob.content, 'base64') : null;
      if (!data || gitBlobSha(data, sha.length === 64 ? 'sha256' : 'sha1') !== sha) throw repositoryPublishingError('Repository file contents do not match the inspected revision. Retry after checking the repository branch.', 'snapshot-mismatch');
      return data;
    })());
    return blobCache.get(sha)!;
  };
  // One engine per attempt. Off, not listed and unconfigured all use the planner exactly as before; a switch that is
  // on but unconfigured is also reported, by variable name only.
  const engine = sandboxPublisher(c.bid);
  if (!engine.enabled && engine.reason === 'unconfigured') {
    await reportFailure(new Error(`The sandbox publisher is switched on but not configured, so the planner was used. Missing or invalid: ${(engine.missing || []).join(', ') || 'unknown'}.`),
      { source: 'publishing', operation: SANDBOX_OPERATIONS.config, incidentKey: SANDBOX_OPERATIONS.config, businessId: c.bid, ref: p.entryId, provider: 'nextjs', degraded: true });
  }
  const options = { businessId: c.bid, deadlineAt: c.publishDeadlineAt, ...(retry ? { retry } : {}), ...(legacy ? { legacy } : {}) };
  // A retry or a migration continues a branch that already holds an earlier attempt's work, so "existing content" is
  // not the branch head. The sandbox engine's gate is given the tree of the default-branch commit the article branch
  // started from, and protects what that commit holds exactly as it does on a first attempt.
  let baseEntries: RepoEntry[] | undefined;
  if (engine.enabled && previous) {
    let compared: { merge_base_commit?: { commit?: { tree?: { sha?: unknown } } } };
    try { compared = await gh(c, `${API}/repos/${b.repo}/compare/${b.sha}...${parent}?per_page=1`, { headers: h(c) }); } catch (e) {
      if (notFound(e)) throw repositoryPublishingError('The article branch shares no history with the default branch, so Radar cannot tell existing content from its own earlier changes. Review that branch before retrying, or use a new article branch.');
      throw e;
    }
    const baseTreeSha = compared.merge_base_commit?.commit?.tree?.sha;
    // An object name only: it goes into a request path.
    if (typeof baseTreeSha !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(baseTreeSha)) throw repositoryPublishingError('GitHub did not say where the article branch left the default branch. Retry after checking the repository branch.', 'snapshot-mismatch');
    if (baseTreeSha === commit.tree.sha) baseEntries = tree.tree;
    else {
      const baseTree = await gh<{ truncated?: boolean; tree: RepoEntry[] }>(c, `${API}/repos/${b.repo}/git/trees/${baseTreeSha}?recursive=1`, { headers: h(c) });
      if (baseTree.truncated || !Array.isArray(baseTree.tree) || baseTree.tree.length > 30_000) throw repositoryPublishingError('The repository tree is too large to inspect safely. Connect the website in a smaller repository and try again.', 'tree-unavailable');
      baseEntries = baseTree.tree;
      // The gate reads the default branch's version of a changed file through the same verified blob reader.
      for (const entry of baseTree.tree) if (entry.type === 'blob' && !pinnedBlobs.has(entry.sha)) pinnedBlobs.set(entry.sha, entry.size);
    }
  }
  // The hint never selects a framework or limits where a grounded integration may add files.
  const sandbox: SandboxIntegration | null = engine.enabled
    ? await integrateWithSandbox({ config: engine, hint, payload: p, repo: b.repo, commitSha: parent, entries: tree.tree, ...(baseEntries ? { baseEntries } : {}), fetchArchive, readBlob, options: { ...options, deadlineAt: c.publishDeadlineAt ?? Date.now() + engine.attemptMs } })
    : null;
  const plan: RepositoryPostPlan = sandbox ?? await planRepositoryPost(hint, p, { entries: tree.tree, read }, options);
  if (sandbox?.unchanged) {
    // The gate verified the article already on the branch and found nothing to add: no tree, commit or ref write.
    if (!previous) throw repositoryPublishingError('The integration produced no change to publish.', 'plan-empty');
    return { id: branch, extra: sandboxDraftExtra(b.branch, p, { ...sandbox, files: [] }, 'unchanged') };
  }
  const changes = plan.files.map(file => {
    const existing = entries.get(file.path);
    if (!safeRepositoryPath(file.path, true) || (existing && (existing.type !== 'blob' || !['100644', '100755'].includes(existing.mode || '100644')))) throw repositoryPublishingError('The integration includes an unsafe repository change.');
    return { path: file.path, mode: existing?.mode || '100644', type: 'blob', content: file.content };
  });
  const createdTree = await gh<{ sha: string }>(c, `${API}/repos/${b.repo}/git/trees`, { method: 'POST', ...jsonBody({ base_tree: commit.tree.sha, tree: changes }, h(c)) });
  const signed: MarkerIdentity = { entryId: p.entryId, hint, slug: plan.slug, articlePath: plan.path, route: plan.route, body: articleBodyHash(p), tree: createdTree.sha };
  const sig = sandbox ? markerSignature(signed) : null;
  const identity: SandboxCommitMarker | Record<string, unknown> = sandbox
    ? { version: 3, entryId: signed.entryId, hint, slug: signed.slug, articlePath: signed.articlePath, route: signed.route, engine: 'sandbox', body: signed.body, tree: signed.tree, ...(sig ? { sig } : {}) }
    : { version: 2, entryId: p.entryId, hint, slug: plan.slug, articlePath: plan.path };
  const createdCommit = await gh<{ sha: string }>(c, `${API}/repos/${b.repo}/git/commits`, { method: 'POST', ...jsonBody({ message: `${previous || p.mode === 'refresh' ? 'Update' : 'Add'} post: ${p.title}\n\nRadar-Post: ${JSON.stringify(identity)}`, tree: createdTree.sha, parents: [parent] }, h(c)) });
  if (previous) await gh(c, `${API}/repos/${b.repo}/git/refs/heads/${encPath(branch)}`, { method: 'PATCH', ...jsonBody({ sha: createdCommit.sha, force: false }, h(c)) });
  else await makeBranch(c, b.repo, branch, createdCommit.sha);
  if (sandbox) return { id: branch, extra: sandboxDraftExtra(b.branch, p, { ...sandbox, files: sandbox.files.map(file => file.path) }, previous ? 'added' : undefined) };
  return { id: branch, extra: { base: b.branch, path: plan.path, slug: plan.slug, layout: 'repository-aware', files: plan.files.map(file => file.path), summary: plan.summary, route: plan.route, discovery: plan.discovery, review: plan.review, draft: true, ...(p.mode === 'new' && plan.slug !== p.slug ? { taken: true } : {}) } };
}

/** Source review is useful evidence, but it is never a substitute for a destination build/preview. */
function pullRequestBody(p: PublishPayload, extra: any): string {
  const lines = [p.meta, '', '**Draft for build and deployment-preview review.** The article is not live. Destination build, runtime route responses and deployment preview have not been run by Radar.', '', `Scheduled for ${p.date}. Article file: \`${String(extra?.path || 'unverified')}\`.`, ''];
  if (extra?.layout === 'repository-aware') {
    lines.push(String(extra.summary || '').slice(0, 8000), '', `Inferred article route: \`${String(extra.route || '')}\`.`, '', 'Integration files:');
    for (const file of (Array.isArray(extra.files) ? extra.files : []).slice(0, 12)) lines.push(`- \`${String(file)}\``);
    lines.push('', 'Observed integration evidence (source inspection, not runtime verification):');
    for (const evidence of (Array.isArray(extra.discovery) ? extra.discovery : []).slice(0, 24)) lines.push(`- ${String(evidence.role)}: \`${String(evidence.path)}\` at \`${String(evidence.sha)}\`: ${JSON.stringify(String(evidence.snippet || '').slice(0, 1000))}`);
    lines.push('', 'Static checks: exact snapshot/source edits, allowed change paths, original article-body insertion, and a separate source-based route/listing review.', `Source review: ${String(extra.review?.summary || 'See the complete diff.').slice(0, 4000)}`);
    if (extra.taken) lines.push('', `The proposed slug \`${p.slug}\` was unavailable; the inspected plan uses \`${String(extra.slug)}\`.`);
  }
  lines.push('', 'Before marking this PR ready: run the repository’s build/CI checks and use its deployment preview to verify the article route, blog listing and navigation.', '', 'Opened by Radar.');
  return lines.join('\n');
}

const CHECK_LABELS: Record<PublishCheck['id'], string> = {
  identity: 'Article identity', paths: 'Protected paths', 'file-modes': 'Regular files only', ceilings: 'Size and count limits',
  credentials: 'Credential scan', syntax: 'Syntax', 'peer-content': 'Existing content preserved', 'article-fidelity': 'Article fidelity',
};
const validCheck = (check: any): check is PublishCheck => (PUBLISH_CHECK_IDS as readonly string[]).includes(check?.id) && check.outcome === 'passed' && typeof check.detail === 'string';
/** Persisted and model-written text is printed as one plain line: no markup of its own, and an @name is shown as code
 * so GitHub notifies nobody. */
const plainLine = (value: unknown, limit: number) => String(value ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/`/g, "'").replace(/</g, '&lt;').replace(/@[A-Za-z0-9][\w/-]*/g, name => '`' + name + '`').replace(/\s+/g, ' ').trim().slice(0, limit);
const codeSpan = (value: unknown) => '`' + String(value ?? '').replace(/[`\x00-\x1f\x7f]/g, '').slice(0, 300) + '`';

// Agent-written text (the summary, conventions and deviations) is also kept from rendering any link or image.
const LINK_DESTINATION = String.raw`\(\s*(?:<[^<>]*>|[^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)`;
const INLINE_IMAGE = new RegExp(String.raw`!\[([^\[\]]*)\]` + LINK_DESTINATION, 'g');
const INLINE_LINK = new RegExp(String.raw`\[([^\[\]]*)\]` + LINK_DESTINATION, 'g');
/** One plain line of agent-written text in which GitHub renders no link and no image, whatever the agent wrote:
 *  - a Markdown link or image keeps its text and loses its destination, whatever the destination is;
 *  - an address is removed wherever it stands: any scheme://, a protocol-relative //host, a bare www. name;
 *  - every square bracket and backslash is escaped, so no link, image, reference-style link, link definition or task
 *    box can form from what is left, and a repository path such as app/[slug]/page.tsx still reads as written;
 *  - "&" and "<" are written as character references, so no tag or autolink in angle brackets can form;
 *  - an @name, an issue or pull request reference (#12, owner/repo#12, GH-12) and a commit hash are shown as code,
 *    which GitHub does not link.
 *  The result is bounded at `limit`, cut at a word boundary with the visible shortened marker. */
function agentLine(value: unknown, limit: number): string {
  // White space is collapsed before the working copy is bounded, so padding cannot hide that a text was longer.
  let text = String(value ?? '').replace(/[\x00-\x1f\x7f\s]+/g, ' ').trim().slice(0, 4 * limit).replace(/`/g, "'");
  // Twice, for an image used as the text of a link.
  for (let pass = 0; pass < 2; pass++) text = text.replace(INLINE_IMAGE, '$1 (image removed)').replace(INLINE_LINK, '$1 (link removed)');
  text = text
    .replace(/[A-Za-z][A-Za-z0-9+.-]{0,30}:\/\/[^\s<>"')]*/g, '(address removed)')
    .replace(/(^|[^\w:/.@-])\/\/[^\s/<>"')]*\.[^\s<>"')]*/g, '$1(address removed)')
    .replace(/(^|[^A-Za-z0-9/.@-])www\.[^\s<>"')]*/gi, '$1(address removed)')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/[\\[\]]/g, '\\$&')
    .replace(/(?:[\w.-]+\/[\w.-]+)?#\d+\b|\bGH-\d+\b|@[A-Za-z0-9][\w/-]*|\b(?=[a-f]*\d)(?=\d*[a-f])[0-9a-f]{7,40}\b/gi, reference => '`' + reference + '`')
    .replace(/\s+/g, ' ').trim();
  return shortenAgentText(text, limit);
}
/** How every piece of agent-written text enters the pull request body: as one line (`agentLine`), after words Radar
 *  wrote, on Radar's line. Markdown recognises a block (a heading, a quote, a list or task-list item, a table, a code
 *  fence or indented code, a thematic break, an HTML block, a link definition) only where a line, or the content of a
 *  list item, begins; a table and an underlined heading also need a second line. Agent text never stands at either
 *  place and never spans a line, so whatever it begins with, it is inline text inside Radar's own paragraph or list
 *  item. That removes the class; it does not depend on which markers exist. */
const agentStatement = (label: string, value: unknown, limit: number, empty = 'none given') => `${label}: ${agentLine(value, limit) || empty}`;

/** The sandbox engine's pull request. Three kinds of statement are kept apart: what Radar checked itself, what the
 * agent says (unverified), and what nobody ran. No v1 run installs, builds or executes anything from the repository,
 * so this body never reports a build or runtime result, whatever the agent wrote. */
export function sandboxPullRequestBody(p: PublishPayload, extra: any): string {
  const checks: PublishCheck[] = (Array.isArray(extra?.checks) ? extra.checks : []).filter(validCheck);
  const list = (values: unknown, limit: number): string[] => (Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value.trim()).slice(0, limit);
  const conventions = list(extra?.agentNotes?.conventions, 20); const deviations = list(extra?.agentNotes?.deviations, 20);
  const omitted = list(extra?.mediaOmitted, 50); const files = list(extra?.files, 16);
  const resumed = extra?.continuation === 'resumed';
  const lines = [
    plainLine(p.meta, 1000), '',
    '**Draft for review.** The article is not live. Radar did not install dependencies, build, lint, test or preview this repository, so nothing below is a build or runtime result.', '',
    `Scheduled for ${p.date}. Article file: ${codeSpan(extra?.path)}. Public route reported by the agent: ${codeSpan(extra?.route)} (not checked against a running site).`,
  ];
  if (extra?.taken) lines.push('', `The proposed slug ${codeSpan(p.slug)} was unavailable; this change uses ${codeSpan(extra.slug)}.`);
  if (extra?.continuation === 'added') lines.push('', 'This attempt added a commit to an existing article branch. The checks below cover the files changed in this attempt and the article file; earlier commits on the branch came from an earlier attempt.');
  if (extra?.continuation === 'unchanged') lines.push('', 'This attempt found the article already complete on its branch and wrote no new commit. The checks below ran on the article file already on the branch.');
  if (resumed) lines.push('', 'This pull request continues an earlier attempt that was interrupted after its commit was written. No agent ran this time. That attempt passed every check below before it wrote the commit, but its check details, the agent’s notes and its list of omitted media were not kept.');

  lines.push('', '### Checks Radar ran', '', 'Radar ran these itself, on the exact file contents it committed. All of them passed; a failed check stops publishing before any commit is written.', '');
  for (const check of checks) lines.push(`- **${CHECK_LABELS[check.id]}**: ${plainLine(check.detail, 500)}`);

  lines.push('', '### What the agent reported (not verified by Radar)', '');
  if (resumed) lines.push('Not available: the agent’s statements from the earlier attempt were not kept.');
  else {
    lines.push('An AI agent made this change in an isolated sandbox with file tools only. It could not run anything. The statements below are its own; Radar did not verify them and none of them is a check that ran.', '', agentStatement('Summary', extra?.summary, AGENT_TEXT.summaryChars));
    // Each note follows a label and number of Radar's, so no note begins its list item.
    if (conventions.length) { lines.push('', 'Repository rules it says it followed:'); conventions.forEach((note, index) => lines.push(`- ${agentStatement(`Rule ${index + 1}`, note, AGENT_TEXT.noteChars, 'nothing readable')}`)); }
    if (deviations.length) { lines.push('', 'Deviations it reported:'); deviations.forEach((note, index) => lines.push(`- ${agentStatement(`Deviation ${index + 1}`, note, AGENT_TEXT.noteChars, 'nothing readable')}`)); }
  }

  lines.push('', '### Media and links not carried over', '');
  if (resumed) lines.push('Not available for this pull request. Compare the article’s images, videos and links with the diff.');
  else if (omitted.length) {
    lines.push(`Radar did not find ${omitted.length === 1 ? 'this reference' : `these ${omitted.length} references`} from the article (image addresses, video ids, source and link addresses) in the changed files. The site’s content format may not be able to carry them:`, '');
    for (const reference of omitted) lines.push(`- ${codeSpan(reference)}`);
  } else if (!articleReferences(p).length) lines.push('The article has no images, videos, sources or links, so there was nothing to carry over.');
  else lines.push('Radar found every image address, video id, source and link address of the article in the changed files.');

  lines.push('', '### Not run', '', 'Neither Radar nor the agent ran any of these:', '');
  for (const item of SANDBOX_NOT_RUN) lines.push(`- ${item}`);

  lines.push('', '### Files', '');
  for (const file of files) lines.push(`- ${codeSpan(file)}`);
  lines.push('', 'Before marking this pull request ready: run the repository’s build and CI checks and use its deployment preview to verify the article route, blog listing and navigation.', '', 'Opened by Radar.');
  return lines.join('\n');
}

export const nextjs: Connector = {
  targets: repos,
  async test(c) {
    const b = await base(c);
    const n = `radar/connection-test-${Date.now().toString(36)}`;
    await makeBranch(c, b.repo, n, b.sha);
    await gh(c, `${API}/repos/${b.repo}/git/refs/heads/${encPath(n)}`, { method: 'DELETE', headers: h(c) });
  },
  async createDraft(c, p) {
    c = { ...c, publishDeadlineAt: c.publishDeadlineAt ?? Date.now() + publishAttemptMs(c.bid) };
    const hint = folder(c);
    const b = await base(c);
    return createRepositoryDraft(c, p, b, hint);
  },
  async publish(c, p, d) {
    c = { ...c, publishDeadlineAt: c.publishDeadlineAt ?? Date.now() + publishAttemptMs(c.bid) };
    const repo = repoOf(c);
    if (d.extra?.layout !== 'repository-aware' && d.extra?.layout !== SANDBOX_DRAFT_LAYOUT) {
      // The publisher persists RemoteDraft before opening a PR. Upgrade old saved exports rather than
      // letting retries bypass discovery and open another content-only PR.
      d = await createRepositoryDraft(c, p, await base(c), folder(c), d);
    }
    // A draft is persisted on the entry between createDraft and publish, so each engine's draft is validated again
    // here. Both layouts stay valid whichever engine the switch selects now: a planner draft saved before the switch
    // was turned on, and a sandbox draft saved before it was turned off, still open their pull request.
    const sandboxDraft = d.extra?.layout === SANDBOX_DRAFT_LAYOUT;
    const common = d.id === branchOf(p) && typeof d.extra?.base === 'string' && !!d.extra.base && safeRepositoryPath(d.extra?.path || '', true) && Array.isArray(d.extra?.files) && d.extra.files.includes(d.extra.path) && typeof d.extra?.route === 'string' && d.extra.route.startsWith('/') && d.extra?.review?.runtimeVerified === false;
    const reviewed = sandboxDraft
      ? Array.isArray(d.extra?.checks) && d.extra.checks.length > 0 && d.extra.checks.every(validCheck)
      : !!d.extra?.review?.summary && Array.isArray(d.extra?.discovery) && ['route', 'listing'].every(role => d.extra.discovery.some((proof: any) => proof?.role === role));
    if (!common || !reviewed) {
      throw repositoryPublishingError('The saved publishing draft lacks a reviewed repository integration. Reset the publishing draft and try again.');
    }
    const body = sandboxDraft ? sandboxPullRequestBody(p, d.extra) : pullRequestBody(p, d.extra);
    try {
      const pr = await gh<{ html_url: string }>(c, `${API}/repos/${repo}/pulls`, { method: 'POST', ...jsonBody({ title: p.title, head: d.id, base: d.extra?.base, body, draft: true }, h(c)) });
      return { url: pr.html_url };
    } catch (e: any) {
      // A PR for this branch already exists (a retry after a timeout): reuse it. Any other 422 stands (not retried).
      if (e instanceof PublishError && e.http === 422) {
        const owner = repo.split('/')[0];
        const open = await gh<{ html_url: string }[]>(c, `${API}/repos/${repo}/pulls?head=${encodeURIComponent(owner + ':' + d.id)}&state=open`, { headers: h(c) });
        if (open[0]) return { url: open[0].html_url };
      }
      throw e;
    }
  },
};
