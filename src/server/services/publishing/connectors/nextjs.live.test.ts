// Live: the real Next.js connector against a real GitHub repository (REST API 2022-11-28). Skipped unless
// RADAR_IT_GITHUB_REPO (owner/repo) and RADAR_IT_GITHUB_TOKEN (a token with push access to it) are set. Only Radar's own
// branches and PRs are created; afterAll closes the PRs and deletes the branches. Nothing is written to the default branch.
// Optional: RADAR_IT_GITHUB_PATH (content folder, default content/posts); RADAR_IT_GITHUB_REFRESH_URL (a post URL whose
// slug has a {folder}/{slug}.mdx or .md on the default branch) enables the refresh case.
import { afterAll, describe, expect, it } from 'vitest';
import { nextjs } from './nextjs';
import { PublishError } from '../http';
import { RUN, ctx, payload } from './live-fixtures';

const REPO = process.env.RADAR_IT_GITHUB_REPO || ''; const TOKEN = process.env.RADAR_IT_GITHUB_TOKEN || '';
const FOLDER = process.env.RADAR_IT_GITHUB_PATH || 'content/posts'; const REFRESH = process.env.RADAR_IT_GITHUB_REFRESH_URL || '';
const ON = !!(REPO && TOKEN);
const c = ctx('nextjs', { repo: REPO, path: FOLDER }, { access_token: TOKEN });
const gh = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'Radar-IT' } });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) as any };
};
const branches = new Set<string>(); const prs = new Set<number>();
const track = (branch: string, url?: string) => { branches.add(branch); if (url) prs.add(Number(url.split('/').pop())); };
const err = async (p: Promise<any>) => { try { await p; } catch (e) { return e as PublishError; } throw new Error('expected a PublishError'); };

describe.skipIf(!ON)('Next.js via GitHub (live)', { timeout: 60_000 }, () => {
  afterAll(async () => {
    for (const n of prs) await gh(`/pulls/${n}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
    for (const b of branches) await gh(`/git/refs/heads/${b.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' });
  });

  it('Test connection creates a branch and deletes it: no radar/connection-test branch is left', async () => {
    await nextjs.test(c);
    expect((await gh('/git/matching-refs/heads/radar/connection-test-')).body).toEqual([]);
  });

  it('createDraft commits the MDX on its own branch; publish opens a PR to the default branch and returns its URL', async () => {
    const p = payload({ slug: `radar-it-${RUN}`, entryId: `e_it${RUN}` });
    const d = await nextjs.createDraft(c, p); track(d.id);
    const file = await gh(`/contents/${FOLDER}/radar-it-${RUN}.mdx?ref=${encodeURIComponent(d.id)}`);
    expect(file.status).toBe(200);
    const mdx = Buffer.from(file.body.content, 'base64').toString('utf8');
    expect(mdx).toContain(`slug: "radar-it-${RUN}"`);
    expect(mdx).toContain('## Work out your floor');
    const { url } = await nextjs.publish(c, p, d); track(d.id, url);
    const pr = (await gh(`/pulls/${url.split('/').pop()}`)).body;
    expect(pr.state).toBe('open');
    expect(pr.head.ref).toBe(d.id);
    expect(pr.base.ref).toBe(d.extra.base);
    expect(pr.html_url).toBe(url);
  });

  it('a retry reuses the branch, its commit and the open PR: one branch, one PR', async () => {
    const p = payload({ slug: `radar-it-retry-${RUN}`, entryId: `e_itr${RUN}` });
    const d1 = await nextjs.createDraft(c, p); track(d1.id);
    const d2 = await nextjs.createDraft(c, p);
    expect(d2.id).toBe(d1.id);
    const u1 = (await nextjs.publish(c, p, d1)).url; track(d1.id, u1);
    const u2 = (await nextjs.publish(c, p, d2)).url;
    expect(u2).toBe(u1);
    const owner = REPO.split('/')[0];
    expect((await gh(`/pulls?head=${encodeURIComponent(owner + ':' + d1.id)}&state=all`)).body).toHaveLength(1);
  });

  it.skipIf(!REFRESH)('a refresh updates the existing post file (found from refreshUrl) on a PR branch', async () => {
    const p = payload({ slug: `radar-it-refresh-${RUN}`, entryId: `e_itf${RUN}`, mode: 'refresh', refreshUrl: REFRESH, canonical: REFRESH });
    const d = await nextjs.createDraft(c, p); track(d.id);
    const slug = REFRESH.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
    expect(d.extra.path).toMatch(new RegExp(`/${slug}\\.mdx?$`));
    const { url } = await nextjs.publish(c, p, d); track(d.id, url);
    const files = (await gh(`/pulls/${url.split('/').pop()}/files`)).body;
    expect(files.map((f: any) => [f.filename, f.status])).toEqual([[d.extra.path, 'modified']]);
  });

  it.skipIf(!REFRESH)('a new article whose slug is taken on the default branch gets -2 and never touches the existing file', async () => {
    const slug = REFRESH.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop()!;
    const p = payload({ slug, entryId: `e_itt${RUN}` });
    const d = await nextjs.createDraft(c, p); track(d.id);
    expect(d.extra).toMatchObject({ slug: `${slug}-2`, path: `${FOLDER}/${slug}-2.mdx`, taken: true });
    const { url } = await nextjs.publish(c, p, d); track(d.id, url);
    const files = (await gh(`/pulls/${url.split('/').pop()}/files`)).body;
    expect(files.map((f: any) => [f.filename, f.status])).toEqual([[`${FOLDER}/${slug}-2.mdx`, 'added']]);
  });

  it('a bad token is a 401 auth-expired ("Needs reconnecting"), not retried', async () => {
    const e = await err(nextjs.test(ctx('nextjs', { repo: REPO, path: FOLDER }, { access_token: 'gho_invalid' })));
    expect([e.http, e.kind, e.retryable]).toEqual([401, 'auth-expired', false]);
  });

  it('a repository the token can\'t see is a 404', async () => {
    const e = await err(nextjs.test(ctx('nextjs', { repo: `${REPO.split('/')[0]}/radar-no-such-repo-${RUN}`, path: FOLDER }, { access_token: TOKEN })));
    expect(e.http).toBe(404);
  });
});
