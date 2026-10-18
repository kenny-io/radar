// Next.js blog — GitHub (OAuth, scope "repo"). Each article: new branch → commit {folder}/{slug}.mdx with frontmatter → pull request.
// "Published" = the pull request is opened (DIVERGENCES #10); publishedUrl is the PR.
import type { Connector, ConnCtx, PublishPayload } from '../types';
import { jsonBody, PublishError, req, reqJson } from '../http';
import { yamlStr } from '../render';

const API = 'https://api.github.com';
const h = (c: ConnCtx) => ({ authorization: `Bearer ${c.creds.access_token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'Radar' });
export const parseRepo = (s: string) => { const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec((s || '').trim()); return m ? { owner: m[1], repo: m[2] } : null; };
const repoOf = (c: ConnCtx) => { const r = parseRepo(c.fields.repo); if (!r) throw new PublishError(404, 'Invalid repository', 'github.com', 'config'); return `${r.owner}/${r.repo}`; };
const folder = (c: ConnCtx) => (c.fields.path || 'content/posts').trim().replace(/^\/+|\/+$/g, '');
const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

async function base(c: ConnCtx) {
  const repo = repoOf(c);
  const r = await reqJson<{ default_branch: string; permissions?: { push?: boolean } }>(`${API}/repos/${repo}`, { headers: h(c) });
  if (r.permissions && r.permissions.push === false) throw new PublishError(403, 'No push access', 'github.com');
  const ref = await reqJson<{ object: { sha: string } }>(`${API}/repos/${repo}/git/ref/heads/${encodeURIComponent(r.default_branch)}`, { headers: h(c) });
  return { repo, branch: r.default_branch, sha: ref.object.sha };
}
async function makeBranch(c: ConnCtx, repo: string, name: string, sha: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const n = i ? `${name}-${i + 1}` : name;
    try { await reqJson(`${API}/repos/${repo}/git/refs`, { method: 'POST', ...jsonBody({ ref: `refs/heads/${n}`, sha }, h(c)) }); return n; }
    catch (e: any) { if (!(e instanceof PublishError && e.http === 422)) throw e; }
  }
  throw new PublishError(422, 'Branch already exists', 'github.com');
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
    const n = await makeBranch(c, b.repo, `radar/connection-test-${Date.now().toString(36)}`, b.sha);
    await req(`${API}/repos/${b.repo}/git/refs/heads/${encPath(n)}`, { method: 'DELETE', headers: h(c) });
  },
  async createDraft(c, p) {
    const b = await base(c);
    const branch = await makeBranch(c, b.repo, `radar/${p.slug}`.slice(0, 200), b.sha);
    const path = `${folder(c)}/${p.slug}.mdx`;
    const ex = await reqJson<{ sha: string }>(`${API}/repos/${b.repo}/contents/${encPath(path)}?ref=${encodeURIComponent(branch)}`, { headers: h(c) }).catch(() => null);
    await reqJson(`${API}/repos/${b.repo}/contents/${encPath(path)}`, { method: 'PUT', ...jsonBody({ message: `${ex ? 'Update' : 'Add'} post: ${p.title}`, content: Buffer.from(mdxFile(p), 'utf8').toString('base64'), branch, ...(ex?.sha ? { sha: ex.sha } : {}) }, h(c)) });
    return { id: branch, extra: { base: b.branch, path } };
  },
  async publish(c, p, d) {
    const repo = repoOf(c);
    const body = `${p.meta}\n\nScheduled for ${p.date}. File: \`${d.extra?.path}\`.\n\nOpened by Radar. Merge to publish.`;
    try {
      const pr = await reqJson<{ html_url: string }>(`${API}/repos/${repo}/pulls`, { method: 'POST', ...jsonBody({ title: p.title, head: d.id, base: d.extra?.base, body }, h(c)) });
      return { url: pr.html_url };
    } catch (e: any) {
      // A PR for this branch already exists (a retry after a timeout): reuse it.
      if (e instanceof PublishError && e.http === 422) {
        const owner = repo.split('/')[0];
        const open = await reqJson<{ html_url: string }[]>(`${API}/repos/${repo}/pulls?head=${encodeURIComponent(owner + ':' + d.id)}&state=open`, { headers: h(c) });
        if (open[0]) return { url: open[0].html_url };
      }
      throw e;
    }
  },
};
