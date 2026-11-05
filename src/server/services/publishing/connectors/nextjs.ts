// GitHub (type "nextjs") — OAuth, scope "repo". Each article gets its own branch and PR.
// Every site layout uses source-based repository planning and review before an atomic complete integration commit.
// "Published" = the pull request is opened (DIVERGENCES #10); publishedUrl is the PR.
// Contract (docs.github.com/en/rest, API version 2022-11-28):
//  - GET  /repos/{repo}: default_branch, permissions.push; a private repo the token can't see is a 404, not a 403
//  - GET  /repos/{repo}/git/ref/heads/<branch name> (the branch's slashes stay in the path); 404 = no such ref, 409 = empty repo
//  - POST /repos/{repo}/git/refs { ref: "refs/heads/…", sha }; DELETE /repos/{repo}/git/refs/heads/<branch name>
//  - GET  /repos/{repo}/contents/{path}?ref=<commit SHA> → { sha, encoding, content }; immutable text source only
//  - GET/POST /repos/{repo}/git/trees and /git/commits; PATCH /git/refs/heads/<branch> { sha, force: false }
//  - POST /repos/{repo}/pulls { title, head, base, body, draft: true } (422 = validation, e.g. that head has a PR);
//    GET /repos/{repo}/pulls?head=owner:branch&state=open
//  - GET  /user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100&page=N → [{ full_name, html_url, permissions.push }]
//    (repos of an org that restricts OAuth apps are left out of the list, not an error)
//  - 401 = bad credentials; rate limits are 403 or 429 ("API rate limit exceeded" / "secondary rate limit");
//    an org that restricts OAuth apps answers 403 "…the `org` organization has enabled OAuth App access restrictions…",
//    and one with SAML single sign-on answers 403 "Resource protected by organization SAML enforcement…"
import type { Connector, ConnCtx, PublishPayload, RemoteDraft, Target } from '../types';
import { jsonBody, PublishError, reqJson } from '../http';
import { planRepositoryPost, safeRepositoryPath, type RepoEntry } from './nextjs-agent';

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
const folder = (c: ConnCtx) => { const f = normFolder(c.fields.path); if (unsafeFolder(f)) throw new PublishError(422, 'The content folder can’t contain “.” or “..”. Edit the connection and choose a folder inside the repository.', 'api.github.com', 'config'); return f; };
const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const notFound = (e: unknown) => e instanceof PublishError && e.http === 404;

/** The org named in GitHub's 403 message (`thallylabs`), else a generic "repository’s". */
const orgIn = (detail: string) => { const m = /`([A-Za-z0-9-]+)`/.exec(detail); return m ? m[1] : 'repository’s'; };
/** A revoked token is "Needs reconnecting"; a rate-limited 403 is retried like a 429 instead of flagging the connection;
 * an org that hasn't approved Radar (or needs SSO) is a setup problem explained in a sentence, not "check the credentials". */
async function gh<T = any>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  try { return await reqJson<T>(url, init); } catch (e) {
    if (e instanceof PublishError && e.http === 401) throw new PublishError(401, e.detail, e.host, 'auth-expired');
    if (e instanceof PublishError && e.http === 403 && /OAuth App access restrictions/i.test(e.detail)) throw new PublishError(403, `The ${orgIn(e.detail)} organization hasn’t approved Radar on GitHub. Ask an organization owner to approve it, or request access under GitHub Settings → Applications → Radar, then test again.`, e.host, 'config');
    if (e instanceof PublishError && e.http === 403 && /SAML enforcement/i.test(e.detail)) throw new PublishError(403, `The ${orgIn(e.detail)} organization uses single sign-on. Authorize Radar for it under GitHub Settings → Applications → Radar, then test again.`, e.host, 'config');
    if (e instanceof PublishError && e.http === 403 && /rate limit/i.test(e.detail)) throw new PublishError(429, e.detail, e.host);
    throw e;
  }
}
async function getRef(c: ConnCtx, repo: string, branch: string): Promise<{ object: { sha: string } } | null> {
  try { return await gh(`${API}/repos/${repo}/git/ref/heads/${encPath(branch)}`, { headers: h(c) }); }
  catch (e) {
    if (notFound(e)) return null;
    if (e instanceof PublishError && e.http === 409) throw new PublishError(422, 'The repository is empty. Push a first commit to it, then try again.', e.host, 'config');
    throw e;
  }
}

async function base(c: ConnCtx) {
  const repo = repoOf(c);
  const r = await gh<{ default_branch: string; permissions?: { push?: boolean } }>(`${API}/repos/${repo}`, { headers: h(c) });
  if (r.permissions && r.permissions.push === false) throw new PublishError(403, 'Your GitHub account can’t push to that repository. Reconnect with an account that can.', 'api.github.com', 'config');
  const ref = await getRef(c, repo, r.default_branch);
  if (!ref) throw new PublishError(404, `Default branch ${r.default_branch} not found`, 'api.github.com');
  return { repo, branch: r.default_branch, sha: ref.object.sha };
}
const makeBranch = (c: ConnCtx, repo: string, name: string, sha: string) => gh(`${API}/repos/${repo}/git/refs`, { method: 'POST', ...jsonBody({ ref: `refs/heads/${name}`, sha }, h(c)) });

/** One branch per article (slug + entry id): a retry finds and reuses it, and two articles with the same slug never share one. */
export const branchOf = (p: PublishPayload) => `radar/${p.slug.slice(0, 120).replace(/-+$/, '')}-${p.entryId.replace(/^e_/, '').slice(0, 60)}`.replace(/[^A-Za-z0-9._/-]/g, '-').replace(/\.{2,}/g, '.').replace(/[./]+$/, '');

/** Repositories the account can push to, most recently pushed first. Page 1 alone answers most accounts; a full page fetches
 * pages 2–5 together (one listing of ~500 repos page by page took ~16 s). The likely site repo leads and is preselected. */
async function repos(c: ConnCtx): Promise<Target[]> {
  type Row = { full_name: string; name: string; html_url: string; permissions?: { push?: boolean } };
  const page = async (n: number): Promise<Row[]> => { const b = await gh(`${API}/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member&page=${n}`, { headers: h(c) }); return Array.isArray(b) ? b : []; };
  const all = await page(1);
  if (all.length === 100) for (const b of await Promise.all([2, 3, 4, 5].map(page))) { all.push(...b); if (b.length < 100) break; }
  const host = (c.domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''); const label = host.split('.')[0];
  // 0: named for the site ("thally-website", "thally.io"), 1: exactly the label ("thally"), 2: contains it ("thallydocs"), 3: the rest.
  const rank = (n: string) => !label || label.length < 2 ? 3 : n === host || /^(.+)[-_.](website|site|web|www|blog|homepage|landing|marketing)$/.exec(n)?.[1] === label ? 0 : n === label ? 1 : n.includes(label) ? 2 : 3;
  const list = all.filter(r => r.permissions?.push && r.full_name).map(r => ({ t: { id: r.full_name, name: r.full_name, url: r.html_url || null }, r: rank((r.name || r.full_name.split('/')[1] || '').toLowerCase()) }));
  return [0, 1, 2, 3].flatMap(k => list.filter(x => x.r === k).map(x => (k < 3 ? { ...x.t, suggested: true } : x.t)));
}

/** One immutable snapshot and one complete commit: content never lands without its integration changes. */
async function createRepositoryDraft(c: ConnCtx, p: PublishPayload, b: Awaited<ReturnType<typeof base>>, hint: string, storedLegacy?: RemoteDraft) {
  const branch = branchOf(p);
  const validSlug = (value: unknown): value is string => typeof value === 'string' && !!value && !['.', '..'].includes(value) && value.length <= 200 && !/[\x00-\x20/\\?#]/.test(value);
  if (storedLegacy && (storedLegacy.id !== branch || storedLegacy.extra?.base !== b.branch || !validSlug(storedLegacy.extra?.slug) || typeof storedLegacy.extra?.path !== 'string' || !safeRepositoryPath(storedLegacy.extra.path, true))) {
    throw new PublishError(422, 'The older publishing draft does not match this article and repository branch. Review or reset the saved draft before retrying.', 'api.github.com', 'config');
  }
  const previous = await getRef(c, b.repo, branch);
  if (storedLegacy && !previous) throw new PublishError(422, 'The older publishing branch no longer exists. Reset the saved publishing draft and try again.', 'api.github.com', 'config');
  const parent = previous?.object.sha || b.sha;
  const commit = await gh<{ tree: { sha: string }; message: string }>(`${API}/repos/${b.repo}/git/commits/${parent}`, { headers: h(c) });
  let retry: { slug: string; articlePath: string } | undefined;
  let legacy: { slug: string; articlePath: string } | undefined;
  if (previous) {
    // Only Radar's final generated marker is authoritative; article titles can contain arbitrary newlines.
    const trailer = commit.message.trimEnd().split('\n').at(-1);
    const marker = trailer?.startsWith('Radar-Post: ') ? trailer.slice('Radar-Post: '.length) : null;
    let saved: any;
    try { saved = marker && JSON.parse(marker); } catch { /* Refuse unrelated branches. */ }
    const matches = saved?.version === 2 && saved.entryId === p.entryId && saved.hint === hint && validSlug(saved.slug) && typeof saved.articlePath === 'string' && safeRepositoryPath(saved.articlePath, true);
    if (matches) retry = { slug: saved.slug, articlePath: saved.articlePath };
    else if (storedLegacy && saved?.version !== 2 && (!saved?.entryId || saved.entryId === p.entryId)) legacy = { slug: storedLegacy.extra.slug, articlePath: storedLegacy.extra.path };
    else {
      throw new PublishError(422, 'The article branch contains changes Radar cannot safely resume. Review that branch before retrying, or use a new article branch.', 'api.github.com', 'config');
    }
  }
  const tree = await gh<{ sha: string; truncated?: boolean; tree: RepoEntry[] }>(`${API}/repos/${b.repo}/git/trees/${commit.tree.sha}?recursive=1`, { headers: h(c) });
  if (tree.truncated || !Array.isArray(tree.tree) || tree.tree.length > 30_000) throw new PublishError(422, 'The repository tree is too large to inspect safely. Connect the website in a smaller repository and try again.', 'api.github.com', 'config');
  const entries = new Map(tree.tree.map(entry => [entry.path, entry]));
  if (legacy) {
    const exported = entries.get(legacy.articlePath);
    if (!exported || exported.type !== 'blob' || !['100644', '100755'].includes(exported.mode || '100644')) throw new PublishError(422, 'The saved older draft article is missing or is not a regular repository file. Reset the publishing draft before retrying.', 'api.github.com', 'config');
  }
  const cache = new Map<string, Promise<string>>();
  const read = (path: string): Promise<string> => {
    const entry = entries.get(path);
    if (!entry || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode || '100644') || !safeRepositoryPath(path)) throw new PublishError(422, 'Repository inspection requested an unavailable or protected text file.', 'api.github.com', 'config');
    if (!cache.has(path)) cache.set(path, (async () => {
      const file = await gh<{ sha?: string; content?: string; encoding?: string; size?: number }>(`${API}/repos/${b.repo}/contents/${encPath(path)}?ref=${encodeURIComponent(parent)}`, { headers: h(c) });
      if (file.sha !== entry.sha) throw new PublishError(422, 'Repository file contents do not match the inspected revision. Retry after checking the repository branch.', 'api.github.com', 'config');
      if (file.encoding !== 'base64' || typeof file.content !== 'string' || (file.size || 0) > 100_000) throw new PublishError(422, `Radar cannot safely inspect ${path}. Source files used for publishing must be below 100 KB.`, 'api.github.com', 'config');
      const decoded = Buffer.from(file.content, 'base64');
      if (decoded.length > 100_000) throw new PublishError(422, 'A repository source file exceeds the inspection budget.', 'api.github.com', 'config');
      try { return new TextDecoder('utf-8', { fatal: true }).decode(decoded); }
      catch { throw new PublishError(422, 'Repository inspection encountered a file that is not UTF-8 text.', 'api.github.com', 'config'); }
    })());
    return cache.get(path)!;
  };
  // The hint never selects a framework or limits where a grounded integration may add files.
  const plan = await planRepositoryPost(hint, p, { entries: tree.tree, read }, { businessId: c.bid, ...(retry ? { retry } : {}), ...(legacy ? { legacy } : {}) });
  const changes = plan.files.map(file => {
    const existing = entries.get(file.path);
    if (!safeRepositoryPath(file.path, true) || (existing && (existing.type !== 'blob' || !['100644', '100755'].includes(existing.mode || '100644')))) throw new PublishError(422, 'The integration includes an unsafe repository change.', 'api.github.com', 'config');
    return { path: file.path, mode: existing?.mode || '100644', type: 'blob', content: file.content };
  });
  const createdTree = await gh<{ sha: string }>(`${API}/repos/${b.repo}/git/trees`, { method: 'POST', ...jsonBody({ base_tree: commit.tree.sha, tree: changes }, h(c)) });
  const identity = { version: 2, entryId: p.entryId, hint, slug: plan.slug, articlePath: plan.path };
  const createdCommit = await gh<{ sha: string }>(`${API}/repos/${b.repo}/git/commits`, { method: 'POST', ...jsonBody({ message: `${previous || p.mode === 'refresh' ? 'Update' : 'Add'} post: ${p.title}\n\nRadar-Post: ${JSON.stringify(identity)}`, tree: createdTree.sha, parents: [parent] }, h(c)) });
  if (previous) await gh(`${API}/repos/${b.repo}/git/refs/heads/${encPath(branch)}`, { method: 'PATCH', ...jsonBody({ sha: createdCommit.sha, force: false }, h(c)) });
  else await makeBranch(c, b.repo, branch, createdCommit.sha);
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

export const nextjs: Connector = {
  targets: repos,
  async test(c) {
    const b = await base(c);
    const n = `radar/connection-test-${Date.now().toString(36)}`;
    await makeBranch(c, b.repo, n, b.sha);
    await gh(`${API}/repos/${b.repo}/git/refs/heads/${encPath(n)}`, { method: 'DELETE', headers: h(c) });
  },
  async createDraft(c, p) {
    const hint = folder(c);
    const b = await base(c);
    return createRepositoryDraft(c, p, b, hint);
  },
  async publish(c, p, d) {
    const repo = repoOf(c);
    if (d.extra?.layout !== 'repository-aware') {
      // The publisher persists RemoteDraft before opening a PR. Upgrade old saved exports rather than
      // letting retries bypass discovery and open another content-only PR.
      d = await createRepositoryDraft(c, p, await base(c), folder(c), d);
    }
    if (d.id !== branchOf(p) || typeof d.extra?.base !== 'string' || !d.extra.base || !safeRepositoryPath(d.extra?.path || '', true) || !Array.isArray(d.extra?.files) || !d.extra.files.includes(d.extra.path) || !d.extra.files.length || typeof d.extra?.route !== 'string' || !d.extra.route.startsWith('/') || !d.extra?.review?.summary || d.extra.review.runtimeVerified !== false || !Array.isArray(d.extra?.discovery) || !['route', 'listing'].every(role => d.extra.discovery.some((proof: any) => proof?.role === role))) {
      throw new PublishError(422, 'The saved publishing draft lacks a reviewed repository integration. Reset the publishing draft and try again.', 'api.github.com', 'config');
    }
    const body = pullRequestBody(p, d.extra);
    try {
      const pr = await gh<{ html_url: string }>(`${API}/repos/${repo}/pulls`, { method: 'POST', ...jsonBody({ title: p.title, head: d.id, base: d.extra?.base, body, draft: true }, h(c)) });
      return { url: pr.html_url };
    } catch (e: any) {
      // A PR for this branch already exists (a retry after a timeout): reuse it. Any other 422 stands (not retried).
      if (e instanceof PublishError && e.http === 422) {
        const owner = repo.split('/')[0];
        const open = await gh<{ html_url: string }[]>(`${API}/repos/${repo}/pulls?head=${encodeURIComponent(owner + ':' + d.id)}&state=open`, { headers: h(c) });
        if (open[0]) return { url: open[0].html_url };
      }
      throw e;
    }
  },
};
