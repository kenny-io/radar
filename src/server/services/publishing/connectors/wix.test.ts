// Wix connector against a mocked fetch: requests must match dev.wix.com/docs (api-reference/app-management/oauth-2/create-access-token,
// build-apps/develop-your-app/access/authentication/authenticate-using-oauth, app-management/app-instance/get-app-instance,
// business-solutions/blog/draft-posts/{create,update,publish,delete,query}-draft-post(s), blog/posts-stats/get-post-by-slug,
// blog/skills/how-to-create-blog-posts, assets/rich-content/ricos-documents/convert-to-ricos-document,
// assets/media/media-manager/files/import-file, crm/members-contacts/members/member-management/members/query-members). No database.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '@/server/env';
import { PublishError } from '../http';
import type { ConnCtx, PublishPayload } from '../types';
import { htmlChunks, resetWixTokens, wix } from './wix';

const API = 'https://www.wixapis.com';
type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const reply = (status: number, body: any = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function mockFetch(fn: (url: string, init: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => { calls.push({ url: String(url), init }); return fn(String(url), init); }));
}
const json = (c: Call) => JSON.parse(String(c.init.body));
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];
const req = (c: Call) => [c.init.method || 'GET', c.url.replace(API, '')];
const apiCalls = () => calls.filter(c => !c.url.endsWith('/oauth2/token'));
const ENV = { wixClientId: env.wixClientId, wixClientSecret: env.wixClientSecret };
beforeAll(() => { Object.assign(env, { wixClientId: 'wix-app', wixClientSecret: 'wix-secret' }); });
afterAll(() => { Object.assign(env, ENV); });
beforeEach(() => { calls = []; resetWixTokens(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const C: ConnCtx = { type: 'wix', fields: {}, creds: { instanceId: 'inst-1' }, target: 'fieldnote.app', targetId: 'site-1', bid: 'b1', domain: 'fieldnote.app', businessName: 'Fieldnote' };
const P = (o: Partial<PublishPayload> = {}): PublishPayload => ({
  entryId: 'e1', title: 'Billing tips', slug: 'billing-tips', seoTitle: 'Billing tips for freelancers', html: '<h2>Why</h2>\n<p>Because.</p>', markdown: '', blocks: [], meta: 'How to bill.', keyword: 'billing', date: '2026-10-25',
  image: { url: 'https://cdn.example.com/hero.png', alt: 'A ledger on a desk', bytes: async () => ({ buf: Buffer.from(''), type: 'image/png', name: 'x.png' }) },
  canonical: null, mode: 'new', refreshUrl: null, sources: [], videos: [], author: 'Fieldnote', ...o,
});
type Routes = Partial<Record<string, (url: URL, body: any) => Response>>;
/** Route by "METHOD /path" (no query string). Unrouted calls answer 404. */
function wx(routes: Routes = {}) {
  const base: Routes = {
    'POST /oauth2/token': () => reply(200, { access_token: 'OAUTH2.tok', token_type: 'Bearer', expires_in: 14400 }),
    'GET /apps/v1/instance': () => reply(200, { instance: { instanceId: 'inst-1' }, site: { siteId: 'site-1', url: 'https://www.fieldnote.app', siteDisplayName: 'Fieldnote', ownerInfo: { email: 'owner@fieldnote.app' } } }),
    'POST /members/v1/members/query': () => reply(200, { members: [{ id: 'mem-owner' }] }),
    'POST /ricos/v1/ricos-document/convert/to-ricos': (_u, b) => reply(200, { document: { nodes: [{ type: 'PARAGRAPH', id: String(b.html).slice(0, 12) }], metadata: { version: 1 } } }),
    'POST /site-media/v1/files/import': () => reply(200, { file: { id: 'media-1', operationStatus: 'PENDING' } }),
    'POST /blog/v3/draft-posts/query': () => reply(200, { draftPosts: [] }),
    'POST /blog/v3/draft-posts': () => reply(200, { draftPost: { id: 'draft-1' } }),
    'PATCH /blog/v3/draft-posts/draft-1': () => reply(200, { draftPost: { id: 'draft-1' } }),
    'POST /blog/v3/draft-posts/draft-1/publish': () => reply(200, { postId: 'draft-1' }),
    'GET /blog/v3/posts/draft-1': () => reply(200, { post: { id: 'draft-1', url: { base: 'https://www.fieldnote.app/', path: '/post/billing-tips' } } }),
    'DELETE /blog/v3/draft-posts/draft-1': () => reply(200, {}),
  };
  const all = { ...base, ...routes };
  mockFetch((url, init) => {
    const u = new URL(url); const key = `${init.method || 'GET'} ${u.pathname}`;
    const fn = all[key];
    return fn ? fn(u, init.body ? JSON.parse(String(init.body)) : null) : reply(404, { message: 'Entity not found', details: { applicationError: { code: 'NOT_FOUND' } } });
  });
}
async function err(p: Promise<unknown>): Promise<PublishError> { try { await p; } catch (e) { return e as PublishError; } throw new Error('expected a rejection'); }

describe('access tokens', () => {
  it('mints one client-credentials token per instance and sends it bare in Authorization, across createDraft and publish', async () => {
    wx();
    const d = await wix.createDraft(C, P());
    await wix.publish(C, P(), d);
    const mints = calls.filter(c => c.url === `${API}/oauth2/token`);
    expect(mints).toHaveLength(1);
    expect(json(mints[0])).toEqual({ grant_type: 'client_credentials', client_id: 'wix-app', client_secret: 'wix-secret', instance_id: 'inst-1' });
    expect(apiCalls().length).toBeGreaterThan(5);
    expect(apiCalls().every(c => hdr(c, 'authorization') === 'OAUTH2.tok')).toBe(true);
  });
  it('a site that uninstalled the app (token request refused) needs reconnecting', async () => {
    for (const status of [400, 401, 403, 404]) {
      resetWixTokens();
      wx({ 'POST /oauth2/token': () => reply(status, { error: 'invalid_grant', error_description: 'App is not installed' }) });
      const e = await err(wix.targets!(C));
      expect(e).toMatchObject({ http: 401, kind: 'auth-expired' });
    }
  });
  it('a rate-limited or failing token endpoint is retried later', async () => {
    for (const status of [429, 503]) {
      wx({ 'POST /oauth2/token': () => reply(status, 'busy') });
      const e = await err(wix.targets!(C));
      expect([e.http, e.retryable]).toEqual([status, true]);
    }
  });
  it('a 401 from an API call mints a fresh token once and retries; a second 401 needs reconnecting', async () => {
    let n = 0;
    wx({ 'GET /apps/v1/instance': () => (++n === 1 ? reply(401, { message: 'expired' }) : reply(200, { site: { siteId: 'site-1', url: 'https://www.fieldnote.app' } })) });
    expect(await wix.targets!(C)).toEqual([{ id: 'site-1', name: 'www.fieldnote.app', url: 'https://www.fieldnote.app' }]);
    expect(calls.filter(c => c.url.endsWith('/oauth2/token'))).toHaveLength(2);
    wx({ 'GET /apps/v1/instance': () => reply(401, { message: 'no' }) });
    expect(await err(wix.targets!(C))).toMatchObject({ http: 401, kind: 'auth-expired' });
  });
  it('no instance on the connection needs reconnecting, without a request', async () => {
    wx();
    expect(await err(wix.targets!({ ...C, creds: {} }))).toMatchObject({ http: 401, kind: 'auth-expired' });
    expect(calls).toHaveLength(0);
  });
});

describe('targets', () => {
  it('an unpublished site (no site.url) is named by its display name', async () => {
    wx({ 'GET /apps/v1/instance': () => reply(200, { site: { siteId: 'site-1', siteDisplayName: 'Fieldnote' } }) });
    expect(await wix.targets!(C)).toEqual([{ id: 'site-1', name: 'Fieldnote', url: null }]);
  });
});

describe('test connection', () => {
  it('creates a draft owned by the site owner’s member profile and deletes it permanently', async () => {
    wx();
    await wix.test(C);
    expect(apiCalls().map(req)).toEqual([
      ['GET', '/apps/v1/instance'], ['POST', '/members/v1/members/query'], ['POST', '/ricos/v1/ricos-document/convert/to-ricos'],
      ['POST', '/blog/v3/draft-posts'], ['DELETE', '/blog/v3/draft-posts/draft-1?permanent=true'],
    ]);
    expect(json(apiCalls()[1])).toEqual({ query: { filter: { loginEmail: { $eq: 'owner@fieldnote.app' } }, paging: { limit: 1 } } });
    expect(json(apiCalls()[3]).draftPost).toMatchObject({ title: 'Radar connection test', memberId: 'mem-owner' });
  });
  it('Wix Blog not installed (the draft-posts endpoint 404s) reads as a setup step', async () => {
    wx({ 'POST /blog/v3/draft-posts': () => reply(404, { message: 'Not Found' }) });
    const e = await err(wix.test(C));
    expect(e).toMatchObject({ http: 422, kind: 'config', detail: 'Wix Blog isn’t installed on this site. Add the Blog app to your Wix site, then try again.' });
    expect(e.retryable).toBe(false);
  });
  it('the owner has no member profile: a readable setup error, and no member is created on the customer’s site', async () => {
    wx({ 'POST /members/v1/members/query': () => reply(200, { members: [] }) });
    const e = await err(wix.test(C));
    expect(e).toMatchObject({ http: 422, kind: 'config' });
    expect(e.detail).toContain('the owner has no member profile');
    expect(calls.some(c => c.url.endsWith('/members/v1/members') && c.init.method === 'POST')).toBe(false);
    expect(calls.some(c => c.url.endsWith('/blog/v3/draft-posts'))).toBe(false);
  });
  it('a member lookup failure is not swallowed (it used to fall back to no memberId)', async () => {
    wx({ 'POST /members/v1/members/query': () => reply(503, 'busy') });
    expect((await err(wix.test(C))).http).toBe(503);
  });
  it('a memberId stored on the connection is used as is', async () => {
    wx();
    await wix.test({ ...C, creds: { instanceId: 'inst-1', memberId: 'mem-x' } });
    expect(apiCalls().some(c => c.url.includes('/members/'))).toBe(false);
    expect(json(apiCalls().find(c => c.url.endsWith('/blog/v3/draft-posts'))!).draftPost.memberId).toBe('mem-x');
  });
});

describe('createDraft + publish (new post)', () => {
  it('converts the HTML with explicit plugins, imports the hero, and creates the draft with slug, excerpt, SEO tags and cover alt text', async () => {
    wx();
    const d = await wix.createDraft(C, P());
    const conv = apiCalls().find(c => c.url.endsWith('/convert/to-ricos'))!;
    expect(json(conv)).toEqual({ html: '<h2>Why</h2>\n<p>Because.</p>', options: { plugins: ['HEADING', 'LINK', 'IMAGE', 'VIDEO', 'HTML', 'DIVIDER'] } });
    expect(json(apiCalls().find(c => c.url.endsWith('/files/import'))!)).toEqual({ url: 'https://cdn.example.com/hero.png', mediaType: 'IMAGE', displayName: 'billing-tips.png' });
    expect(json(apiCalls().find(c => c.url.endsWith('/draft-posts/query'))!)).toEqual({ query: { filter: { title: { $eq: 'Billing tips' }, status: { $eq: 'UNPUBLISHED' } }, cursorPaging: { limit: 20 } } });
    const create = json(apiCalls().find(c => c.url.endsWith('/blog/v3/draft-posts'))!).draftPost;
    expect(create).toEqual({
      title: 'Billing tips', memberId: 'mem-owner', excerpt: 'How to bill.', seoSlug: 'billing-tips',
      richContent: { nodes: [{ type: 'PARAGRAPH', id: '<h2>Why</h2>' }], metadata: { version: 1 } },
      seoData: { tags: [{ type: 'title', children: 'Billing tips for freelancers' }, { type: 'meta', props: { name: 'description', content: 'How to bill.' } }] },
      media: { wixMedia: { image: { id: 'media-1' } }, displayed: true, custom: true, altText: 'A ledger on a desk' },
    });
    expect(d).toEqual({ id: 'draft-1' });
    const r = await wix.publish(C, P(), d);
    expect(apiCalls().slice(-2).map(req)).toEqual([['POST', '/blog/v3/draft-posts/draft-1/publish'], ['GET', '/blog/v3/posts/draft-1?fieldsets=URL']]);
    expect(r.url).toBe('https://www.fieldnote.app/post/billing-tips');
  });
  it('HTML over the 30,000-character conversion limit is converted in chunks and the nodes joined in order', async () => {
    wx();
    const para = '<p>' + 'x'.repeat(9990) + '</p>';
    const html = [para, para, para, para].join('\n');
    await wix.createDraft(C, P({ html }));
    const convs = apiCalls().filter(c => c.url.endsWith('/convert/to-ricos'));
    expect(convs).toHaveLength(2);
    expect(convs.every(c => json(c).html.length <= 30000)).toBe(true);
    expect(convs.map(c => json(c).html).join('\n')).toBe(html);
    expect(json(apiCalls().find(c => c.url.endsWith('/blog/v3/draft-posts'))!).draftPost.richContent.nodes).toHaveLength(2);
    expect(htmlChunks('<p>' + 'y'.repeat(40000) + '</p>').every(s => s.length <= 30000)).toBe(true);
  });
  it('a slug another post has is never reused: the next free slug is asked for', async () => {
    wx({ 'GET /blog/v3/posts/slugs/billing-tips': () => reply(200, { post: { id: 'other' } }) });
    await wix.createDraft(C, P());
    expect(json(apiCalls().find(c => c.url.endsWith('/blog/v3/draft-posts'))!).draftPost.seoSlug).toBe('billing-tips-2');
    expect(calls.some(c => c.url.includes('/draft-posts/other'))).toBe(false);
  });
  it('a retry after a lost create response updates our own unpublished draft instead of creating a second one', async () => {
    wx({ 'POST /blog/v3/draft-posts/query': () => reply(200, { draftPosts: [{ id: 'owner-draft', seoSlug: 'something-else' }, { id: 'draft-1', seoSlug: 'billing-tips' }] }) });
    const d = await wix.createDraft(C, P());
    expect(d).toEqual({ id: 'draft-1' });
    expect(calls.some(c => c.url.endsWith('/blog/v3/draft-posts') && c.init.method === 'POST')).toBe(false);
    const patch = calls.find(c => c.init.method === 'PATCH')!;
    expect(req(patch)).toEqual(['PATCH', '/blog/v3/draft-posts/draft-1']);
    expect(json(patch)).toMatchObject({ action: 'UPDATE', draftPost: { id: 'draft-1', title: 'Billing tips', seoSlug: 'billing-tips' } });
  });
  it('an image Wix refuses to import is left off; the post is still created', async () => {
    wx({ 'POST /site-media/v1/files/import': () => reply(400, { message: 'Invalid url' }) });
    await wix.createDraft(C, P());
    expect(json(apiCalls().find(c => c.url.endsWith('/blog/v3/draft-posts'))!).draftPost).not.toHaveProperty('media');
  });
  it('a transient import failure is rethrown (retried), not silently dropped', async () => {
    wx({ 'POST /site-media/v1/files/import': () => reply(503, 'busy') });
    const e = await err(wix.createDraft(C, P()));
    expect([e.http, e.retryable]).toEqual([503, true]);
    expect(calls.some(c => c.url.endsWith('/blog/v3/draft-posts') && c.init.method === 'POST')).toBe(false);
  });
});

describe('refresh updates the existing post in place', () => {
  const R = P({ mode: 'refresh', refreshUrl: 'https://www.fieldnote.app/post/old-billing-tips?utm=x', slug: 'new-slug' });
  it('finds the post by the URL slug, updates its draft with UPDATE_PUBLICATION (post stays live), then publishes it', async () => {
    wx({
      'GET /blog/v3/posts/slugs/old-billing-tips': () => reply(200, { post: { id: 'live-1', slug: 'old-billing-tips' } }),
      'PATCH /blog/v3/draft-posts/live-1': () => reply(200, { draftPost: { id: 'live-1' } }),
      'POST /blog/v3/draft-posts/live-1/publish': () => reply(200, { postId: 'live-1' }),
      'GET /blog/v3/posts/live-1': () => reply(200, { post: { url: { base: 'https://www.fieldnote.app', path: '/post/old-billing-tips' } } }),
    });
    const d = await wix.createDraft(C, R);
    expect(d).toEqual({ id: 'live-1', extra: { refresh: true } });
    expect(calls.some(c => c.url.endsWith('/blog/v3/draft-posts') && c.init.method === 'POST')).toBe(false);
    const patch = json(calls.find(c => c.init.method === 'PATCH')!);
    expect(patch.action).toBe('UPDATE_PUBLICATION');
    expect(patch.draftPost).toMatchObject({ id: 'live-1', title: 'Billing tips' });
    expect(patch.draftPost).not.toHaveProperty('seoSlug');
    expect(patch.draftPost).not.toHaveProperty('memberId');
    expect((await wix.publish(C, R, d)).url).toBe('https://www.fieldnote.app/post/old-billing-tips');
  });
  it('a 404 on the slug lookup falls back to a new post', async () => {
    wx();
    expect((await wix.createDraft(C, R)).id).toBe('draft-1');
    expect(json(apiCalls().find(c => c.url.endsWith('/blog/v3/draft-posts'))!).draftPost.seoSlug).toBe('new-slug');
  });
  it('a failed lookup is rethrown (retried), never turned into a duplicate', async () => {
    wx({ 'GET /blog/v3/posts/slugs/old-billing-tips': () => reply(500, 'oops') });
    const e = await err(wix.createDraft(C, R));
    expect([e.http, e.retryable]).toEqual([500, true]);
    expect(calls.some(c => c.init.method === 'PATCH' || (c.url.endsWith('/blog/v3/draft-posts') && c.init.method === 'POST'))).toBe(false);
  });
});

describe('error mapping', () => {
  it('403 is final; 429 and 5xx retry; no response is a network error', async () => {
    for (const [status, retry] of [[403, false], [429, true], [500, true]] as const) {
      wx({ 'GET /apps/v1/instance': () => reply(status, { message: 'x' }) });
      const e = await err(wix.targets!(C));
      expect([e.http, e.retryable]).toEqual([status, retry]);
    }
    resetWixTokens();
    mockFetch(() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ETIMEDOUT' } }); });
    expect(await err(wix.targets!(C))).toMatchObject({ http: 0, kind: 'network', host: 'www.wixapis.com' });
  });
});
