// blog.test / resolveConn for Next.js: the picked repository (targetId, owner/repo) becomes fields.repo, which publishing
// reads; a connection saved before the picker keeps its fields.repo; the content folder is stored repo-relative.
// The store and the connector are mocked, so no database or network is needed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnCtx } from '../services/publishing/types';

const M = vi.hoisted(() => ({ row: null as any, seen: [] as ConnCtx[] }));
vi.mock('../services/publishing/store', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/publishing/store')>()),
  connRow: vi.fn(async (_bid: string, id: string) => (M.row && M.row.id === id ? M.row : null)),
  connCreds: vi.fn((r: any) => (r ? { access_token: 'gho_saved' } : {})),
  readPending: vi.fn(async (_bid: string, ref: string) => (ref === 'pend_ok' ? { access_token: 'gho_new' } : null)),
}));
vi.mock('../services/publishing/connectors', () => ({ connectorFor: () => ({ test: async (c: ConnCtx) => { M.seen.push(c); } }) }));

import { actions } from './publishing';

const OLD = '11111111-2222-4333-8444-555555555555';
const ctx = { bid: 'b1', biz: { id: 'b1', domain: 'fieldnote.app', profile: {} } } as any;
const test = (input: any) => actions['blog.test'].run(ctx, { type: 'nextjs', fields: {}, ...input });
const fail = async (p: Promise<unknown>) => { try { await p; } catch (e: any) { return e; } throw new Error('expected a rejection'); };
beforeEach(() => { M.row = null; M.seen = []; });

describe('Next.js connection (resolveConn)', () => {
  it('a new connection stores the picked repository as fields.repo, target and targetId', async () => {
    expect(await test({ fields: { path: 'content/posts' }, target: 'thallylabs/thally-website', targetId: 'thallylabs/thally-website', oauthRef: 'pend_ok' })).toEqual({ ok: true });
    expect(M.seen[0]).toMatchObject({ fields: { repo: 'thallylabs/thally-website', path: 'content/posts' }, target: 'thallylabs/thally-website', targetId: 'thallylabs/thally-website', creds: { access_token: 'gho_new' } });
  });
  it('a repo typed in the old field is ignored: the pick wins', async () => {
    await test({ fields: { repo: 'someone/else', path: 'content/posts' }, targetId: 'acme/site', oauthRef: 'pend_ok' });
    expect(M.seen[0].fields.repo).toBe('acme/site');
  });
  it('normalizes a manually entered GitHub URL through the same test path as a selected repository', async () => {
    await test({ fields: { path: 'content/posts' }, targetId: ' https://github.com/acme/private-blog.git/ ', target: 'untrusted label', oauthRef: 'pend_ok' });
    expect(M.seen[0]).toMatchObject({ fields: { repo: 'acme/private-blog' }, target: 'acme/private-blog', targetId: 'acme/private-blog' });
  });
  it('rejects manual values that could escape the GitHub repository endpoint or send credentials elsewhere', async () => {
    for (const targetId of ['https://evil.test/acme/site', 'https://github.com@evil.test/acme/site', 'https://github.com/acme/site/tree/main', 'acme/%2e%2e', 'acme/site?token=x', 'acme/site#readme', './site', 'acme/../site']) {
      expect((await fail(test({ fields: { path: 'content/posts' }, targetId, oauthRef: 'pend_ok' }))).status).toBe(400);
    }
    expect(M.seen).toHaveLength(0);
  });
  it('the content folder is stored repo-relative ("tree/main/…", a GitHub URL, slashes)', async () => {
    await test({ fields: { path: 'tree/main/public/blog' }, targetId: 'acme/site', oauthRef: 'pend_ok' });
    await test({ fields: { path: 'https://github.com/acme/site/tree/main/content/posts/' }, targetId: 'acme/site', oauthRef: 'pend_ok' });
    expect(M.seen.map(c => c.fields.path)).toEqual(['public/blog', 'content/posts']);
  });
  it('an old connection (fields.repo, no targetId) keeps its repository, canonicalized', async () => {
    M.row = { id: OLD, type: 'nextjs', fields: { repo: 'https://github.com/kenny/blog.git', path: 'content/posts' }, targetId: null, target: null, status: 'ok' };
    await test({ id: OLD, fields: { path: 'content/posts' } });
    expect(M.seen[0]).toMatchObject({ fields: { repo: 'kenny/blog' }, targetId: 'kenny/blog', creds: { access_token: 'gho_saved' } });
  });
  it('an old connection can move to another picked repository', async () => {
    M.row = { id: OLD, type: 'nextjs', fields: { repo: 'kenny/blog', path: 'content/posts' }, targetId: null, target: null, status: 'ok' };
    await test({ id: OLD, fields: { path: 'posts/en' }, targetId: 'kenny/site' });
    expect(M.seen[0].fields).toEqual({ repo: 'kenny/site', path: 'posts/en' });
  });
  it('rejects a picked value that isn’t owner/repo, and a new connection without a pick', async () => {
    for (const targetId of ['not a repo', 'a/b/c', '../x', 'acme/..']) expect((await fail(test({ fields: { path: 'content/posts' }, targetId, oauthRef: 'pend_ok' }))).status).toBe(400);
    expect((await fail(test({ fields: { path: 'content/posts' }, oauthRef: 'pend_ok' }))).status).toBe(400);
    expect(M.seen).toHaveLength(0);
  });
  it('rejects a content folder with "." or ".." segments (it would climb out of the repository)', async () => {
    for (const path of ['content/../../../other/repo/contents/x', '../posts', 'content/./posts', 'tree/main/../x']) expect((await fail(test({ fields: { path }, targetId: 'acme/site', oauthRef: 'pend_ok' }))).status).toBe(400);
    expect(M.seen).toHaveLength(0);
  });
  it('still requires a content folder', async () => {
    expect((await fail(test({ fields: { path: '' }, targetId: 'acme/site', oauthRef: 'pend_ok' }))).status).toBe(400);
  });
});
