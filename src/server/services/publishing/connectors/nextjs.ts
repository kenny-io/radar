// Next.js blog — GitHub (OAuth, scope "repo"). Each article: its own branch → commit {folder}/{slug}.mdx with frontmatter → pull request.
// "Published" = the pull request is opened (DIVERGENCES #10); publishedUrl is the PR.
// Contract (docs.github.com/en/rest, API version 2022-11-28):
//  - GET  /repos/{repo}: default_branch, permissions.push; a private repo the token can't see is a 404, not a 403
//  - GET  /repos/{repo}/git/ref/heads/<branch name> (the branch's slashes stay in the path); 404 = no such ref, 409 = empty repo
//  - POST /repos/{repo}/git/refs { ref: "refs/heads/…", sha }; DELETE /repos/{repo}/git/refs/heads/<branch name>
//  - GET  /repos/{repo}/contents/{path}?ref=… → { sha }, 404 when absent; PUT { message, content (base64), branch, sha (to update) }
//  - POST /repos/{repo}/pulls { title, head, base, body } (422 = validation, e.g. a PR for that head already exists);
//    GET /repos/{repo}/pulls?head=owner:branch&state=open
//  - 401 = bad credentials; rate limits are 403 or 429 ("API rate limit exceeded" / "secondary rate limit")
import type { Connector, ConnCtx, PublishPayload } from '../types';
import { jsonBody, PublishError, reqJson } from '../http';
import { yamlStr } from '../render';

const API = 'https://api.github.com';
const h = (c: ConnCtx) => ({ authorization: `Bearer ${c.creds.access_token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'Radar' });
export const parseRepo = (s: string) => { const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec((s || '').trim()); return m ? { owner: m[1], repo: m[2] } : null; };
const repoOf = (c: ConnCtx) => { const r = parseRepo(c.fields.repo); if (!r) throw new PublishError(404, 'Invalid repository', 'github.com', 'config'); return `${r.owner}/${r.repo}`; };
const folder = (c: ConnCtx) => (c.fields.path || 'content/posts').trim().replace(/^\/+|\/+$/g, '');
const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const slugOf = (url: string) => url.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || '';
const notFound = (e: unknown) => e instanceof PublishError && e.http === 404;

/** A revoked token is "Needs reconnecting"; a rate-limited 403 is retried like a 429 instead of flagging the connection. */
async function gh<T = any>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  try { return await reqJson<T>(url, init); } catch (e) {
    if (e instanceof PublishError && e.http === 401) throw new PublishError(401, e.detail, e.host, 'auth-expired');
    if (e instanceof PublishError && e.http === 403 && /rate limit/i.test(e.detail)) throw new PublishError(429, e.detail, e.host);
    throw e;
  }
}
/** Only a 404 means "no such file"; anything else (401, 403, 5xx) is rethrown. */
async function getFile(c: ConnCtx, repo: string, path: string, ref: string): Promise<{ sha: string } | null> {
  try { return await gh<{ sha: string }>(`${API}/repos/${repo}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`, { headers: h(c) }); }
  catch (e) { if (notFound(e)) return null; throw e; }
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

/** Where the post goes: the refreshed post's own file, else {slug}.mdx — or slug-2, -3… when another post already has it. */
async function target(c: ConnCtx, repo: string, ref: string, p: PublishPayload): Promise<{ path: string; slug: string; taken?: boolean }> {
  const dir = folder(c);
  if (p.mode === 'refresh' && p.refreshUrl) {
    const s = slugOf(p.refreshUrl);
    if (s) for (const ext of ['.mdx', '.md']) if (await getFile(c, repo, `${dir}/${s}${ext}`, ref)) return { path: `${dir}/${s}${ext}`, slug: s };
  }
  for (let i = 0; i < 20; i++) {
    const slug = i ? `${p.slug}-${i + 1}` : p.slug;
    if (!(await getFile(c, repo, `${dir}/${slug}.mdx`, ref)) && !(await getFile(c, repo, `${dir}/${slug}.md`, ref))) return { path: `${dir}/${slug}.mdx`, slug, ...(i ? { taken: true } : {}) };
  }
  throw new PublishError(422, `Every slug from “${p.slug}” to “${p.slug}-20” is taken in ${dir}. Change the article’s slug and try again.`, 'api.github.com', 'config');
}

export function mdxFile(p: PublishPayload): string {
  const fm = [
    '---', `title: ${yamlStr(p.title)}`, `description: ${yamlStr(p.meta)}`, `date: ${yamlStr(p.date)}`, `slug: ${yamlStr(p.slug)}`,
    ...(p.image ? [`image: ${yamlStr(p.image.url)}`, `imageAlt: ${yamlStr(p.image.alt)}`] : []),
    ...(p.canonical ? [`canonical: ${yamlStr(p.canonical)}`] : []),
    `author: ${yamlStr(p.author)}`, `keywords: [${yamlStr(p.keyword)}]`, '---', '',
  ];
  return fm.join('\n') + p.markdown;
}

export const nextjs: Connector = {
  async test(c) {
    const b = await base(c);
    const n = `radar/connection-test-${Date.now().toString(36)}`;
    await makeBranch(c, b.repo, n, b.sha);
    await gh(`${API}/repos/${b.repo}/git/refs/heads/${encPath(n)}`, { method: 'DELETE', headers: h(c) });
  },
  async createDraft(c, p) {
    const b = await base(c);
    const t = await target(c, b.repo, b.branch, p);
    const branch = branchOf(p);
    if (!(await getRef(c, b.repo, branch))) await makeBranch(c, b.repo, branch, b.sha);
    // The file's sha on this branch: the refreshed post, or this article's own commit from an interrupted attempt.
    const ex = await getFile(c, b.repo, t.path, branch);
    const file = mdxFile({ ...p, slug: t.slug });
    await gh(`${API}/repos/${b.repo}/contents/${encPath(t.path)}`, { method: 'PUT', ...jsonBody({ message: `${ex ? 'Update' : 'Add'} post: ${p.title}`, content: Buffer.from(file, 'utf8').toString('base64'), branch, ...(ex?.sha ? { sha: ex.sha } : {}) }, h(c)) });
    return { id: branch, extra: { base: b.branch, path: t.path, slug: t.slug, ...(t.taken ? { taken: true } : {}) } };
  },
  async publish(c, p, d) {
    const repo = repoOf(c);
    const path = d.extra?.path;
    const note = d.extra?.taken ? `\n\n\`${p.slug}\` is already used by another post, so this one is \`${d.extra.slug}\`.` : '';
    const body = `${p.meta}\n\nScheduled for ${p.date}. File: \`${path}\`.${note}\n\nOpened by Radar. Merge to publish.`;
    try {
      const pr = await gh<{ html_url: string }>(`${API}/repos/${repo}/pulls`, { method: 'POST', ...jsonBody({ title: p.title, head: d.id, base: d.extra?.base, body }, h(c)) });
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
