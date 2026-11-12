// Live: the repository-aware GitHub connector against a real GitHub repository (REST API 2022-11-28). Skipped unless
// RADAR_IT_GITHUB_REPO (owner/repo) and RADAR_IT_GITHUB_TOKEN (a token with push access to it) are set. Only Radar's own
// branches and PRs are created; afterAll closes the PRs and deletes the branches. Nothing is written to the default branch.
// Optional: RADAR_IT_GITHUB_PATH is a discovery hint (default content/posts); RADAR_IT_GITHUB_REFRESH_URL enables refresh.
// Article planning additionally needs DATABASE_URL and a configured writing-model provider. It opens only DRAFT PRs.
// Connection/auth checks still run with repository/token alone. No framework or generated filename is assumed.
// The engine follows the rollout switch: with RADAR_PUBLISH_SANDBOX set to `all` (or naming this suite's business,
// 00000000-0000-0000-0000-000000000000) and the worker's sandbox variables set, drafts come from the sandbox publisher
// (a real Daytona sandbox and model run per article, each up to the per-run cap); otherwise from the planner.
import { afterAll, describe, expect, it } from 'vitest';
import { nextjs } from './nextjs';
import { PublishError } from '../http';
import { RUN, ctx, payload } from './live-fixtures';
import { sandboxPublisher } from '../sandbox/config';

const REPO = process.env.RADAR_IT_GITHUB_REPO || ''; const TOKEN = process.env.RADAR_IT_GITHUB_TOKEN || '';
const FOLDER = process.env.RADAR_IT_GITHUB_PATH || 'content/posts'; const REFRESH = process.env.RADAR_IT_GITHUB_REFRESH_URL || '';
const ON = !!(REPO && TOKEN);
const AI_READY = !!(process.env.DATABASE_URL && (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY || process.env.XAI_API_KEY));
const c = ctx('nextjs', { repo: REPO, path: FOLDER }, { access_token: TOKEN });
const gh = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'Radar-IT' } });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) as any };
};
const branches = new Set<string>(); const prs = new Set<number>();
const track = (branch: string, url?: string) => { branches.add(branch); if (url) prs.add(Number(url.split('/').pop())); };
const err = async (p: Promise<any>) => { try { await p; } catch (e) { return e as PublishError; } throw new Error('expected a PublishError'); };

describe.skipIf(!ON)('Repository-aware GitHub (live)', { timeout: 900_000 }, () => {
  afterAll(async () => {
    for (const n of prs) await gh(`/pulls/${n}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
    for (const b of branches) await gh(`/git/refs/heads/${b.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' });
  });

  it('Test connection creates a branch and deletes it: no radar/connection-test branch is left', async () => {
    await nextjs.test(c);
    expect((await gh('/git/matching-refs/heads/radar/connection-test-')).body).toEqual([]);
  });

  it.skipIf(!AI_READY)('createDraft commits the complete inspected integration; publish opens a draft PR to the default branch', async () => {
    const p = payload({ slug: `radar-it-${RUN}`, entryId: `e_it${RUN}` });
    const d = await nextjs.createDraft(c, p); track(d.id);
    const sandbox = d.extra.layout === 'sandbox-agent';
    expect(d.extra.layout).toBe(sandboxPublisher(c.bid).enabled ? 'sandbox-agent' : 'repository-aware');
    if (sandbox) { expect(d.extra.checks.length).toBeGreaterThan(0); expect(d.extra.review.runtimeVerified).toBe(false); }
    else expect(d.extra.discovery.length).toBeGreaterThan(0);
    const file = await gh(`/contents/${d.extra.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(d.id)}`);
    expect(file.status).toBe(200);
    const mdx = Buffer.from(file.body.content, 'base64').toString('utf8');
    expect(mdx).toContain('Work out your floor');
    const { url } = await nextjs.publish(c, p, d); track(d.id, url);
    const pr = (await gh(`/pulls/${url.split('/').pop()}`)).body;
    expect(pr.state).toBe('open');
    expect(pr.draft).toBe(true);
    expect(pr.body).toContain(sandbox ? '- Checked by Radar: ' : 'not been run by Radar');
    if (sandbox) expect(pr.body).toContain('Radar did not build or run the site.');
    const files = (await gh(`/pulls/${url.split('/').pop()}/files?per_page=100`)).body;
    expect(files.map((file: any) => file.filename)).toEqual(expect.arrayContaining(d.extra.files));
    expect(pr.head.ref).toBe(d.id);
    expect(pr.base.ref).toBe(d.extra.base);
    expect(pr.html_url).toBe(url);
  });

  it.skipIf(!AI_READY)('a retry reuses the branch, article identity and open draft PR: one branch, one PR', async () => {
    const p = payload({ slug: `radar-it-retry-${RUN}`, entryId: `e_itr${RUN}` });
    const d1 = await nextjs.createDraft(c, p); track(d1.id);
    const d2 = await nextjs.createDraft(c, p);
    expect(d2.id).toBe(d1.id);
    expect(d2.extra.path).toBe(d1.extra.path);
    expect(d2.extra.slug).toBe(d1.extra.slug);
    const u1 = (await nextjs.publish(c, p, d1)).url; track(d1.id, u1);
    const u2 = (await nextjs.publish(c, p, d2)).url;
    expect(u2).toBe(u1);
    const owner = REPO.split('/')[0];
    expect((await gh(`/pulls?head=${encodeURIComponent(owner + ':' + d1.id)}&state=all`)).body).toHaveLength(1);
  });

  it.skipIf(!REFRESH || !AI_READY)('a refresh preserves the existing route and updates its article plus necessary integration files', async () => {
    const p = payload({ slug: `radar-it-refresh-${RUN}`, entryId: `e_itf${RUN}`, mode: 'refresh', refreshUrl: REFRESH, canonical: REFRESH });
    const d = await nextjs.createDraft(c, p); track(d.id);
    expect(d.extra.route.replace(/\/+$/, '')).toBe(new URL(REFRESH).pathname.replace(/\/+$/, ''));
    const { url } = await nextjs.publish(c, p, d); track(d.id, url);
    const files = (await gh(`/pulls/${url.split('/').pop()}/files`)).body;
    expect(files).toEqual(expect.arrayContaining([expect.objectContaining({ filename: d.extra.path, status: 'modified' })]));
  });

  it.skipIf(!REFRESH || !AI_READY)('a new article avoids an occupied existing route without replacing its article', async () => {
    const slug = REFRESH.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop()!;
    const p = payload({ slug, entryId: `e_itt${RUN}` });
    const d = await nextjs.createDraft(c, p); track(d.id);
    expect(d.extra.route.replace(/\/+$/, '')).not.toBe(new URL(REFRESH).pathname.replace(/\/+$/, ''));
    const before = await gh(`/contents/${d.extra.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(d.extra.base)}`);
    expect(before.status).toBe(404);
    const { url } = await nextjs.publish(c, p, d); track(d.id, url);
    const files = (await gh(`/pulls/${url.split('/').pop()}/files`)).body;
    expect(files).toEqual(expect.arrayContaining([expect.objectContaining({ filename: d.extra.path, status: 'added' })]));
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
