// Shopify connector against a mocked fetch: requests must match the Admin GraphQL API 2026-10 contract
// (shopify.dev/docs/api/admin-graphql/2026-10/mutations/articleCreate, …/articleUpdate, …/articleDelete, …/queries/articles,
// …/input-objects/ArticleCreateInput, …/enums/ArticleCreateUserErrorCode, shopify.dev/docs/api/admin-graphql#status-and-error-codes)
// and the expiring offline token refresh (shopify.dev/docs/apps/build/authentication-authorization/access-token-types/offline-access-tokens,
// shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant). No database.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '@/server/env';
import { PublishError } from '../http';
import type { ConnCtx, PublishPayload } from '../types';
import { shopify, SHOPIFY_API_VERSION } from './shopify';

const GQL = `https://fieldnote.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
const TOKEN = 'https://fieldnote.myshopify.com/admin/oauth/access_token';
const BLOG = 'gid://shopify/Blog/241253187';
type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const reply = (status: number, body: any = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function mockFetch(fn: (url: string, init: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => { calls.push({ url: String(url), init }); return fn(String(url), init); }));
}
const json = (c: Call) => JSON.parse(String(c.init.body));
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];
const op = (c: Call) => { if (c.url === TOKEN) return 'token'; const q: string = json(c).query; return /articleCreate/.test(q) ? 'create' : /articleUpdate/.test(q) ? 'update' : /articleDelete/.test(q) ? 'delete' : /articles\(/.test(q) ? 'find' : /primaryDomain/.test(q) ? 'domain' : /blogs/.test(q) ? 'blogs' : '?'; };
const gqlCalls = () => calls.filter(c => c.url === GQL);
beforeEach(() => { calls = []; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const ENV = { shopifyClientId: env.shopifyClientId, shopifyClientSecret: env.shopifyClientSecret };
beforeAll(() => { Object.assign(env, { shopifyClientId: 'shp-client', shopifyClientSecret: 'shp-secret' }); });
afterAll(() => { Object.assign(env, ENV); });

const C = (creds: Record<string, any> = {}): ConnCtx => ({ type: 'shopify', fields: { store: 'fieldnote.myshopify.com' }, creds: { access_token: 'shpat_x', shop: 'fieldnote.myshopify.com', ...creds }, target: 'News', targetId: BLOG, bid: 'b1', domain: 'fieldnote.app', businessName: 'Fieldnote' });
const P = (o: Partial<PublishPayload> = {}): PublishPayload => ({
  entryId: 'e1', title: 'Billing tips', slug: 'billing-tips', html: '<h2>Why</h2><p>Because.</p>', markdown: '', blocks: [], meta: 'How to bill <fast> & right.', keyword: 'billing', date: '2026-10-25',
  image: { url: 'https://cdn.example.com/hero.png', alt: 'A ledger on a desk', bytes: async () => ({ buf: Buffer.from(''), type: 'image/png', name: 'x.png' }) },
  canonical: null, mode: 'new', refreshUrl: null, sources: [], videos: [], author: 'Fieldnote', ...o,
});
const art = (o: any = {}) => ({ id: 'gid://shopify/Article/1', handle: 'billing-tips', title: 'Billing tips', isPublished: false, blog: { id: BLOG, handle: 'news' }, ...o });
const ok = (data: any) => reply(200, { data });
const none = () => ok({ articles: { nodes: [] } });
async function err(p: Promise<unknown>): Promise<PublishError> { try { await p; } catch (e) { return e as PublishError; } throw new Error('expected a rejection'); }

describe('every request', () => {
  it('POSTs GraphQL to the pinned Admin API version with X-Shopify-Access-Token', async () => {
    expect(SHOPIFY_API_VERSION).toBe('2026-10');
    mockFetch(() => ok({ blogs: { nodes: [{ id: BLOG, title: 'News' }] } }));
    expect(await shopify.targets!(C())).toEqual([{ id: BLOG, name: 'News' }]);
    expect(calls[0].url).toBe(GQL);
    expect(calls[0].init.method).toBe('POST');
    expect(hdr(calls[0], 'x-shopify-access-token')).toBe('shpat_x');
    expect(hdr(calls[0], 'content-type')).toBe('application/json');
  });
});

describe('test connection', () => {
  it('creates an unpublished article with a unique handle, then deletes it (permanent)', async () => {
    mockFetch((_u, init) => (/articleCreate/.test(JSON.parse(String(init.body)).query) ? ok({ articleCreate: { article: art({ id: 'gid://shopify/Article/9' }), userErrors: [] } }) : ok({ articleDelete: { deletedArticleId: 'gid://shopify/Article/9', userErrors: [] } })));
    await shopify.test(C());
    expect(calls.map(op)).toEqual(['create', 'delete']);
    const a = json(calls[0]).variables.article;
    expect(a).toMatchObject({ blogId: BLOG, title: 'Radar connection test', isPublished: false, author: { name: 'Fieldnote' } });
    expect(a.handle).toMatch(/^radar-connection-test-/);
    expect(json(calls[1]).variables).toEqual({ id: 'gid://shopify/Article/9' });
  });
  it('without a chosen blog fails before any request', async () => {
    mockFetch(() => ok({}));
    expect((await err(shopify.test({ ...C(), targetId: null }))).http).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe('createDraft + publish (new article)', () => {
  it('looks the handle up, creates an unpublished article with handle, summary, author and image alt text, then publishes it', async () => {
    mockFetch((_u, init) => {
      const q = JSON.parse(String(init.body)).query;
      if (/articles\(/.test(q)) return none();
      if (/articleCreate/.test(q)) return ok({ articleCreate: { article: art({ id: 'gid://shopify/Article/5' }), userErrors: [] } });
      if (/articleUpdate/.test(q)) return ok({ articleUpdate: { article: art({ id: 'gid://shopify/Article/5', isPublished: true }), userErrors: [] } });
      return ok({ shop: { primaryDomain: { url: 'https://fieldnote.app/' } } });
    });
    const d = await shopify.createDraft(C(), P());
    expect(json(calls[0]).variables).toEqual({ q: 'handle:"billing-tips" blog_id:241253187' });
    expect(json(calls[1]).variables.article).toEqual({
      blogId: BLOG, handle: 'billing-tips', title: 'Billing tips', body: '<h2>Why</h2><p>Because.</p>', summary: '<p>How to bill &lt;fast&gt; &amp; right.</p>',
      author: { name: 'Fieldnote' }, image: { url: 'https://cdn.example.com/hero.png', altText: 'A ledger on a desk' }, isPublished: false,
    });
    expect(json(calls[1]).query).toContain('userErrors { code field message }');
    expect(d).toEqual({ id: 'gid://shopify/Article/5', extra: { handle: 'billing-tips', blog: 'news' } });
    const r = await shopify.publish(C(), P(), d);
    expect(json(calls[2]).variables).toEqual({ id: 'gid://shopify/Article/5', article: { isPublished: true } });
    expect(r.url).toBe('https://fieldnote.app/blogs/news/billing-tips');
  });
  it('an image that is not public https is left out (Shopify downloads it from the URL)', async () => {
    mockFetch((_u, init) => (/articles\(/.test(JSON.parse(String(init.body)).query) ? none() : ok({ articleCreate: { article: art(), userErrors: [] } })));
    await shopify.createDraft(C(), P({ image: { url: 'http://localhost:3000/x.png', alt: 'x', bytes: async () => ({ buf: Buffer.from(''), type: 'image/png', name: 'x' }) } }));
    expect(json(calls[1]).variables.article).not.toHaveProperty('image');
  });
  it('a taken handle is never overwritten: the next free handle is used', async () => {
    mockFetch((_u, init) => {
      const b = JSON.parse(String(init.body));
      if (/articles\(/.test(b.query)) return b.variables.q.includes('"billing-tips"') ? ok({ articles: { nodes: [art({ id: 'gid://shopify/Article/OTHER', title: 'Someone else', isPublished: true })] } }) : none();
      return ok({ articleCreate: { article: art({ id: 'gid://shopify/Article/6', handle: 'billing-tips-2' }), userErrors: [] } });
    });
    const d = await shopify.createDraft(C(), P());
    expect(calls.map(op)).toEqual(['find', 'find', 'create']);
    expect(json(calls[2]).variables.article.handle).toBe('billing-tips-2');
    expect(calls.some(c => op(c) === 'update')).toBe(false);
    expect(d.extra.handle).toBe('billing-tips-2');
  });
  it('a TAKEN userError (handle raced in after the lookup) moves on to the next handle', async () => {
    let n = 0;
    mockFetch((_u, init) => (/articles\(/.test(JSON.parse(String(init.body)).query) ? none()
      : ++n === 1 ? ok({ articleCreate: { article: null, userErrors: [{ code: 'TAKEN', field: ['article', 'handle'], message: 'Handle has already been taken' }] } })
        : ok({ articleCreate: { article: art({ handle: 'billing-tips-2' }), userErrors: [] } })));
    const d = await shopify.createDraft(C(), P());
    expect(d.extra.handle).toBe('billing-tips-2');
  });
  it('other userErrors fail readably and are not retried', async () => {
    mockFetch((_u, init) => (/articles\(/.test(JSON.parse(String(init.body)).query) ? none() : ok({ articleCreate: { article: null, userErrors: [{ code: 'TOO_LONG', field: ['article', 'title'], message: 'Title is too long' }] } })));
    const e = await err(shopify.createDraft(C(), P()));
    expect(e).toMatchObject({ http: 422 });
    expect(e.message).toContain('Title is too long');
    expect(e.retryable).toBe(false);
    expect(e.hint).toBe('Shopify refused the article: Title is too long.');
  });
  it('every handle taken: a readable config error, nothing written', async () => {
    mockFetch((_u, init) => { const q = JSON.parse(String(init.body)).variables.q.match(/"(.+)"/)[1]; return ok({ articles: { nodes: [art({ handle: q, isPublished: true, title: 'Other' })] } }); });
    const e = await err(shopify.createDraft(C(), P()));
    expect(e).toMatchObject({ http: 422, kind: 'config' });
    expect(e.detail).toContain('billing-tips-10');
    expect(calls.every(c => op(c) === 'find')).toBe(true);
  });
  it('a retry after a lost create response reuses our own unpublished article instead of making a second one', async () => {
    mockFetch((_u, init) => (/articles\(/.test(JSON.parse(String(init.body)).query) ? ok({ articles: { nodes: [art({ id: 'gid://shopify/Article/5' })] } }) : ok({ articleUpdate: { article: art({ id: 'gid://shopify/Article/5', isPublished: true }), userErrors: [] } })));
    const d = await shopify.createDraft(C(), P());
    expect(calls.map(op)).toEqual(['find']);
    expect(d.id).toBe('gid://shopify/Article/5');
    await shopify.publish(C(), P(), d);
    expect(json(calls[1]).variables.article).toMatchObject({ title: 'Billing tips', body: '<h2>Why</h2><p>Because.</p>', isPublished: true });
  });
});

describe('refresh updates the existing article in place', () => {
  const R = P({ mode: 'refresh', refreshUrl: 'https://fieldnote.app/blogs/news/old-billing-tips?utm=x', slug: 'new-slug' });
  it('finds the article by the URL handle, writes nothing until publish, then updates content without touching handle, visibility or byline', async () => {
    mockFetch((_u, init) => {
      const q = JSON.parse(String(init.body)).query;
      if (/articles\(/.test(q)) return ok({ articles: { nodes: [art({ id: 'gid://shopify/Article/2', handle: 'old-billing-tips-2', isPublished: true }), art({ id: 'gid://shopify/Article/3', handle: 'old-billing-tips', isPublished: true })] } });
      if (/articleUpdate/.test(q)) return ok({ articleUpdate: { article: art({ id: 'gid://shopify/Article/3', handle: 'old-billing-tips', isPublished: true }), userErrors: [] } });
      return ok({ shop: { primaryDomain: { url: 'https://fieldnote.app' } } });
    });
    const d = await shopify.createDraft(C(), R);
    expect(json(calls[0]).variables).toEqual({ q: 'handle:"old-billing-tips" blog_id:241253187' });
    expect(calls.map(op)).toEqual(['find']);
    expect(d).toMatchObject({ id: 'gid://shopify/Article/3', extra: { refresh: true } });
    const r = await shopify.publish(C(), R, d);
    const upd = json(calls[1]).variables;
    expect(upd.id).toBe('gid://shopify/Article/3');
    expect(upd.article).not.toHaveProperty('handle');
    expect(upd.article).not.toHaveProperty('isPublished');
    expect(upd.article).not.toHaveProperty('author');
    expect(upd.article).toMatchObject({ title: 'Billing tips', body: '<h2>Why</h2><p>Because.</p>' });
    expect(r.url).toBe('https://fieldnote.app/blogs/news/old-billing-tips');
  });
  it('an empty lookup falls back to a new article', async () => {
    mockFetch((_u, init) => (/articles\(/.test(JSON.parse(String(init.body)).query) ? none() : ok({ articleCreate: { article: art({ id: 'gid://shopify/Article/7', handle: 'new-slug' }), userErrors: [] } })));
    expect((await shopify.createDraft(C(), R)).id).toBe('gid://shopify/Article/7');
  });
  it('a failed lookup (THROTTLED, 5xx) is rethrown and retried, never turned into a duplicate', async () => {
    mockFetch(() => reply(200, { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }));
    const e = await err(shopify.createDraft(C(), R));
    expect(e).toMatchObject({ http: 429 });
    expect(e.retryable).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('error mapping', () => {
  it('GraphQL codes: THROTTLED 429 and INTERNAL_SERVER_ERROR 500 retry; ACCESS_DENIED 403, SHOP_INACTIVE 423 and others 400 do not', async () => {
    for (const [code, http, retry] of [['THROTTLED', 429, true], ['INTERNAL_SERVER_ERROR', 500, true], ['ACCESS_DENIED', 403, false], ['SHOP_INACTIVE', 423, false], ['MAX_COST_EXCEEDED', 400, false]] as const) {
      mockFetch(() => reply(200, { errors: [{ message: 'x', extensions: { code } }] }));
      const e = await err(shopify.targets!(C()));
      expect([code, e.http, e.retryable]).toEqual([code, http, retry]);
    }
  });
  it('HTTP 401 (bad or revoked token, no refresh token) is an expired authorization', async () => {
    mockFetch(() => reply(401, { errors: '[API] Invalid API key or access token (unrecognized login or wrong password)' }));
    const e = await err(shopify.targets!(C()));
    expect(e).toMatchObject({ http: 401, kind: 'auth-expired' });
  });
  it('HTTP 402/404 are final; 429/5xx retry; no response is a network error', async () => {
    for (const [status, retry] of [[402, false], [404, false], [429, true], [503, true]] as const) {
      mockFetch(() => reply(status, { errors: 'x' }));
      const e = await err(shopify.targets!(C()));
      expect([e.http, e.retryable]).toEqual([status, retry]);
    }
    mockFetch(() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); });
    expect(await err(shopify.targets!(C()))).toMatchObject({ http: 0, kind: 'network', host: 'fieldnote.myshopify.com' });
  });
});

describe('expiring offline tokens', () => {
  const fresh = { access_token: 'shpat_new', expires_in: 3600, refresh_token: 'shprt_new', refresh_token_expires_in: 7776000, scope: 'read_content,write_content' };
  it('an access token about to expire is refreshed first (form POST, grant_type=refresh_token); the rotated pair is saved', async () => {
    const saveCreds = vi.fn(async () => {});
    mockFetch(url => (url === TOKEN ? reply(200, fresh) : ok({ blogs: { nodes: [] } })));
    const c = { ...C({ access_token: 'shpat_old', refresh_token: 'shprt_old', expires_at: Date.now() + 30e3 }), saveCreds };
    await shopify.targets!(c);
    expect(calls.map(op)).toEqual(['token', 'blogs']);
    expect(calls[0].init.method).toBe('POST');
    expect(hdr(calls[0], 'content-type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(String(calls[0].init.body)))).toEqual({ client_id: 'shp-client', client_secret: 'shp-secret', grant_type: 'refresh_token', refresh_token: 'shprt_old' });
    expect(hdr(calls[1], 'x-shopify-access-token')).toBe('shpat_new');
    expect(saveCreds).toHaveBeenCalledTimes(1);
    const saved = (saveCreds.mock.calls[0] as any[])[0];
    expect(saved).toMatchObject({ access_token: 'shpat_new', refresh_token: 'shprt_new', shop: 'fieldnote.myshopify.com', scope: 'read_content,write_content' });
    expect(saved.expires_at).toBeGreaterThan(Date.now() + 3500e3);
    expect(saved.refresh_expires_at).toBeGreaterThan(Date.now() + 89 * 86400e3);
  });
  it('a valid token is used as is (no refresh call)', async () => {
    mockFetch(() => ok({ blogs: { nodes: [] } }));
    await shopify.targets!(C({ refresh_token: 'shprt_old', expires_at: Date.now() + 3000e3 }));
    expect(calls.map(op)).toEqual(['blogs']);
  });
  it('a 401 with a refresh token refreshes once and retries the call once', async () => {
    let n = 0;
    mockFetch(url => (url === TOKEN ? reply(200, fresh) : ++n === 1 ? reply(401, { errors: 'Invalid' }) : ok({ blogs: { nodes: [] } })));
    await shopify.targets!(C({ refresh_token: 'shprt_old', expires_at: Date.now() + 3000e3 }));
    expect(calls.map(op)).toEqual(['blogs', 'token', 'blogs']);
  });
  it('a refused refresh (401 invalid_request) means "Needs reconnecting"', async () => {
    mockFetch(url => (url === TOKEN ? reply(401, { error: 'invalid_request', error_description: 'This request requires an active refresh_token' }) : ok({})));
    const e = await err(shopify.targets!(C({ refresh_token: 'shprt_old', expires_at: Date.now() - 1 })));
    expect(e).toMatchObject({ http: 401, kind: 'auth-expired' });
    expect(calls.map(op)).toEqual(['token']);
  });
  it('a refresh that hits a 5xx is retried later (refresh token kept); a 400/403 is final', async () => {
    const saveCreds = vi.fn(async () => {});
    mockFetch(() => reply(503, 'unavailable'));
    const c = { ...C({ refresh_token: 'shprt_old', expires_at: Date.now() - 1 }), saveCreds };
    const e = await err(shopify.targets!(c));
    expect([e.http, e.retryable]).toEqual([503, true]);
    expect(c.creds.refresh_token).toBe('shprt_old');
    expect(saveCreds).not.toHaveBeenCalled();
    mockFetch(() => reply(403, { error: 'invalid_client' }));
    const f = await err(shopify.targets!(C({ refresh_token: 'shprt_old', expires_at: Date.now() - 1 })));
    expect([f.http, f.retryable]).toEqual([403, false]);
  });
  it('concurrent calls share one refresh', async () => {
    mockFetch(url => (url === TOKEN ? reply(200, fresh) : ok({ blogs: { nodes: [] } })));
    const a = C({ refresh_token: 'shprt_same', expires_at: Date.now() - 1 }); const b = C({ refresh_token: 'shprt_same', expires_at: Date.now() - 1 });
    await Promise.all([shopify.targets!(a), shopify.targets!(b)]);
    expect(calls.filter(c => c.url === TOKEN)).toHaveLength(1);
    expect([a.creds.access_token, b.creds.access_token]).toEqual(['shpat_new', 'shpat_new']);
    expect(gqlCalls().every(c => hdr(c, 'x-shopify-access-token') === 'shpat_new')).toBe(true);
  });
});
