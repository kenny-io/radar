// Webflow connector against a mocked fetch: requests must match the Data API v2 contract (developers.webflow.com/data/reference/
// cms/collections/get, cms/collection-items/staged-items/{list-items,create-item,update-item,publish-item}, sites/get,
// field-types-item-values) and failures must map to readable, correctly retried PublishErrors. No database.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishError } from '../http';
import type { ConnCtx, PublishPayload } from '../types';
import { webflow } from './webflow';

const API = 'https://api.webflow.com/v2';
type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const reply = (status: number, body: any = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function mockFetch(fn: (url: string, init: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => { calls.push({ url: String(url), init }); return fn(String(url), init); }));
}
const json = (c: Call) => JSON.parse(String(c.init.body));
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];
const req = (c: Call) => [c.init.method || 'GET', c.url];
beforeEach(() => { calls = []; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const C: ConnCtx = { type: 'webflow', fields: {}, creds: { access_token: 'wf_tok' }, target: 'Blog Posts', targetId: 'site1:coll1', bid: 'b1', domain: 'fieldnote.app', businessName: 'Fieldnote' };
const P = (o: Partial<PublishPayload> = {}): PublishPayload => ({
  entryId: 'e1', title: 'Billing tips', slug: 'billing-tips', html: '<h2>Why</h2><p>Because.</p>', markdown: '', blocks: [], meta: 'How to bill.', keyword: 'billing', date: '2026-10-25',
  image: { url: 'https://cdn.example.com/hero.png', alt: 'A ledger on a desk', bytes: async () => ({ buf: Buffer.from(''), type: 'image/png', name: 'x.png' }) },
  canonical: null, mode: 'new', refreshUrl: null, sources: [], videos: [], author: 'Fieldnote', ...o,
});
const FIELDS = [
  { slug: 'name', displayName: 'Name', type: 'PlainText', isRequired: true }, { slug: 'slug', displayName: 'Slug', type: 'PlainText', isRequired: true },
  { slug: 'post-body', displayName: 'Post Body', type: 'RichText', isRequired: false }, { slug: 'post-summary', displayName: 'Post Summary', type: 'PlainText', isRequired: false },
  { slug: 'main-image', displayName: 'Main Image', type: 'Image', isRequired: false },
];
const COLL = (extra: any[] = []) => reply(200, { id: 'coll1', displayName: 'Blog Posts', slug: 'post', fields: [...FIELDS, ...extra] });
const item = (o: any = {}) => ({ id: 'it1', isDraft: true, lastPublished: null, fieldData: { name: 'Billing tips', slug: 'billing-tips' }, ...o });
const SITE = reply(200, { id: 'site1', shortName: 'fieldnote', customDomains: [{ id: 'd1', url: 'www.fieldnote.app' }] });
/** Route by method + path; `items` answers the ?slug= lookups. */
function wf(o: { coll?: () => Response; items?: (slug: string) => any[]; create?: (b: any) => Response; patch?: () => Response; publish?: () => Response; site?: () => Response } = {}) {
  mockFetch((url, init) => {
    const m = init.method || 'GET'; const u = new URL(url);
    if (m === 'GET' && u.pathname === '/v2/collections/coll1') return (o.coll || COLL)();
    if (m === 'GET' && u.pathname === '/v2/collections/coll1/items') return reply(200, { items: (o.items || (() => []))(u.searchParams.get('slug') || ''), pagination: { limit: 100, offset: 0, total: 0 } });
    if (m === 'POST' && u.pathname === '/v2/collections/coll1/items') return o.create ? o.create(JSON.parse(String(init.body))) : reply(202, item({ id: 'new1', fieldData: JSON.parse(String(init.body)).fieldData }));
    if (m === 'PATCH') return (o.patch || (() => reply(200, item())))();
    if (m === 'POST' && u.pathname.endsWith('/items/publish')) return (o.publish || (() => reply(202, { publishedItemIds: [JSON.parse(String(init.body)).itemIds[0]], errors: [] })))();
    if (m === 'GET' && u.pathname === '/v2/sites/site1') return (o.site || (() => SITE.clone()))();
    if (m === 'DELETE') return new Response(null, { status: 204 });
    return reply(404, { code: 'route_not_found' });
  });
}
async function err(p: Promise<unknown>): Promise<PublishError> { try { await p; } catch (e) { return e as PublishError; } throw new Error('expected a rejection'); }

describe('targets', () => {
  it('lists every collection of every site with the Bearer token; custom domain hostnames become https URLs', async () => {
    mockFetch(url => (url.endsWith('/sites') ? reply(200, { sites: [{ id: 's1', displayName: 'Fieldnote', shortName: 'fieldnote', customDomains: [{ url: 'www.fieldnote.app' }] }, { id: 's2', displayName: 'Lab', shortName: 'lab' }] })
      : reply(200, { collections: [{ id: url.includes('/s1/') ? 'c1' : 'c2', displayName: 'Posts' }] })));
    const t = await webflow.targets!(C);
    expect(hdr(calls[0], 'authorization')).toBe('Bearer wf_tok');
    expect(t).toEqual([{ id: 's1:c1', name: 'Fieldnote · Posts', url: 'https://www.fieldnote.app' }, { id: 's2:c2', name: 'Lab · Posts', url: 'https://lab.webflow.io' }]);
  });
});

describe('test connection', () => {
  it('creates a draft item with a unique slug and deletes it', async () => {
    wf();
    await webflow.test(C);
    expect(calls.map(req)).toEqual([['GET', `${API}/collections/coll1`], ['POST', `${API}/collections/coll1/items`], ['DELETE', `${API}/collections/coll1/items/new1`]]);
    const b = json(calls[1]);
    expect(b).toMatchObject({ isArchived: false, isDraft: true, fieldData: { name: 'Radar connection test', 'post-body': expect.stringContaining('Radar created this draft') } });
    expect(b.fieldData.slug).toMatch(/^radar-test-/);
  });
  it('a collection with required fields Radar can’t fill fails readably, naming them, before creating anything', async () => {
    wf({ coll: () => COLL([{ slug: 'author', displayName: 'Author', type: 'Reference', isRequired: true }, { slug: 'category', displayName: 'Category', type: 'Option', isRequired: true }]) });
    const e = await err(webflow.test(C));
    expect(e).toMatchObject({ http: 422, kind: 'config' });
    expect(e.detail).toBe('The Webflow collection “Blog Posts” has required fields Radar can’t fill: “Author”, “Category”. Make them optional in Webflow, then try again.');
    expect(e.retryable).toBe(false);
    expect(calls.map(req)).toEqual([['GET', `${API}/collections/coll1`]]);
  });
  it('without a chosen collection fails before any request', async () => {
    wf();
    expect((await err(webflow.test({ ...C, targetId: null }))).http).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe('createDraft + publish (new item)', () => {
  it('creates the item as a draft (not queued for the next site publish) with body, summary and image {url, alt}, then publishes it', async () => {
    wf();
    const d = await webflow.createDraft(C, P());
    expect(calls.map(req)).toEqual([['GET', `${API}/collections/coll1`], ['GET', `${API}/collections/coll1/items?slug=billing-tips`], ['POST', `${API}/collections/coll1/items`]]);
    expect(json(calls[2])).toEqual({ isArchived: false, isDraft: true, fieldData: { name: 'Billing tips', slug: 'billing-tips', 'post-body': '<h2>Why</h2><p>Because.</p>', 'post-summary': 'How to bill.', 'main-image': { url: 'https://cdn.example.com/hero.png', alt: 'A ledger on a desk' } } });
    expect(d).toEqual({ id: 'new1', extra: { colSlug: 'post', slug: 'billing-tips' } });
    const r = await webflow.publish(C, P(), d);
    expect(req(calls[3])).toEqual(['POST', `${API}/collections/coll1/items/publish`]);
    expect(json(calls[3])).toEqual({ itemIds: ['new1'] });
    expect(r.url).toBe('https://www.fieldnote.app/post/billing-tips');
  });
  it('a taken slug never touches the other item: the next free slug is used', async () => {
    wf({ items: s => (s === 'billing-tips' ? [item({ id: 'other', lastPublished: '2026-01-01T00:00:00Z', isDraft: false, fieldData: { name: 'Someone else', slug: s } })] : []) });
    const d = await webflow.createDraft(C, P());
    expect(json(calls.find(c => c.init.method === 'POST')!).fieldData.slug).toBe('billing-tips-2');
    expect(calls.some(c => c.init.method === 'PATCH')).toBe(false);
    expect(d.extra.slug).toBe('billing-tips-2');
  });
  it('a slug conflict raced in after the lookup (400 validation on slug) moves on to the next slug', async () => {
    let n = 0;
    wf({ create: b => (++n === 1 ? reply(400, { code: 'validation_error', message: 'Validation Error', details: [{ param: 'slug', description: 'Unique value is already in database: billing-tips' }] }) : reply(202, item({ id: 'new2', fieldData: b.fieldData }))) });
    expect((await webflow.createDraft(C, P())).extra.slug).toBe('billing-tips-2');
  });
  it('a retry after a lost create response reuses our own never-published draft instead of making a second item', async () => {
    wf({ items: s => (s === 'billing-tips' ? [item({ id: 'mine' })] : []) });
    const d = await webflow.createDraft(C, P());
    expect(calls.some(c => c.init.method === 'POST')).toBe(false);
    expect(req(calls[2])).toEqual(['PATCH', `${API}/collections/coll1/items/mine`]);
    expect(d.id).toBe('mine');
  });
  it('required fields Radar can’t fill fail readably before anything is created', async () => {
    wf({ coll: () => COLL([{ slug: 'author', displayName: 'Author', type: 'Reference', isRequired: true }]) });
    const e = await err(webflow.createDraft(C, P()));
    expect(e.detail).toContain('required field Radar can’t fill: “Author”. Make it optional');
    expect(calls.every(c => (c.init.method || 'GET') === 'GET')).toBe(true);
  });
  it('an image that is not public https is left out (Webflow fetches it from the URL)', async () => {
    wf();
    await webflow.createDraft(C, P({ image: { url: 'http://localhost:3000/x.png', alt: 'x', bytes: async () => ({ buf: Buffer.from(''), type: 'image/png', name: 'x' }) } }));
    expect(json(calls[2]).fieldData).not.toHaveProperty('main-image');
  });
  it('without a custom domain the URL is on {shortName}.webflow.io', async () => {
    wf({ site: () => reply(200, { id: 'site1', shortName: 'fieldnote', customDomains: [] }) });
    expect((await webflow.publish(C, P(), { id: 'new1', extra: { colSlug: 'post', slug: 'billing-tips' } })).url).toBe('https://fieldnote.webflow.io/post/billing-tips');
  });
});

describe('publish failures', () => {
  it('409 (domains published at different times) is a readable, non-retried setup error', async () => {
    wf({ publish: () => reply(409, { code: 'conflict', message: 'Conflict: Site is published to multiple domains at different times' }) });
    const e = await err(webflow.publish(C, P(), { id: 'new1' }));
    expect(e).toMatchObject({ http: 422, kind: 'config' });
    expect(e.detail).toContain('Publish the whole site once in Webflow');
    expect(e.retryable).toBe(false);
  });
  it('a site that has never been published gets readable copy (error wording unverified, matched loosely)', async () => {
    wf({ publish: () => reply(400, { code: 'bad_request', message: 'Site has not been published yet' }) });
    const e = await err(webflow.publish(C, P(), { id: 'new1' }));
    expect(e).toMatchObject({ http: 422, kind: 'config' });
    expect(e.detail).toContain('Publish your Webflow site once in the Designer');
  });
  it('a 202 that doesn’t list our item as published is a failure, not a success', async () => {
    wf({ publish: () => reply(202, { publishedItemIds: [], errors: ['Staging item ID new1 not found.'] }) });
    const e = await err(webflow.publish(C, P(), { id: 'new1' }));
    expect(e).toMatchObject({ http: 422 });
    expect(e.hint).toBe('Webflow didn’t publish the item: Staging item ID new1 not found. Try again, or publish it in Webflow.');
    wf({ publish: () => reply(202, { publishedItemIds: [], errors: [] }) });
    expect((await err(webflow.publish(C, P(), { id: 'new1' }))).hint).toBe('Webflow didn’t publish the item. Try again, or publish it in Webflow.');
  });
});

describe('refresh updates the existing item in place', () => {
  const R = P({ mode: 'refresh', refreshUrl: 'https://www.fieldnote.app/post/old-billing-tips/?utm=x', slug: 'new-slug' });
  it('finds the item by the URL slug, PATCHes its staged copy (slug kept), then publishes; nothing new is created', async () => {
    wf({ items: s => (s === 'old-billing-tips' ? [item({ id: 'live1', isDraft: false, lastPublished: '2026-01-01T00:00:00Z', fieldData: { name: 'Old', slug: s } })] : []) });
    const d = await webflow.createDraft(C, R);
    expect(calls.map(req)).toEqual([['GET', `${API}/collections/coll1`], ['GET', `${API}/collections/coll1/items?slug=old-billing-tips`], ['PATCH', `${API}/collections/coll1/items/live1`]]);
    expect(json(calls[2]).fieldData).toEqual({ name: 'Billing tips', 'post-body': '<h2>Why</h2><p>Because.</p>', 'post-summary': 'How to bill.', 'main-image': { url: 'https://cdn.example.com/hero.png', alt: 'A ledger on a desk' } });
    expect(json(calls[2])).not.toHaveProperty('isDraft');
    const r = await webflow.publish(C, R, d);
    expect(json(calls[3])).toEqual({ itemIds: ['live1'] });
    expect(r.url).toBe('https://www.fieldnote.app/post/old-billing-tips');
  });
  it('no item with that slug falls back to a new one', async () => {
    wf();
    const d = await webflow.createDraft(C, R);
    expect(d.id).toBe('new1');
    expect(json(calls.find(c => c.init.method === 'POST')!).fieldData.slug).toBe('new-slug');
  });
  it('a failed lookup is rethrown (retried), never turned into a duplicate', async () => {
    mockFetch(url => (url.includes('/items?slug=') ? reply(503, 'unavailable') : COLL()));
    const e = await err(webflow.createDraft(C, R));
    expect([e.http, e.retryable]).toEqual([503, true]);
    expect(calls.some(c => c.init.method === 'POST' || c.init.method === 'PATCH')).toBe(false);
  });
});

describe('error mapping', () => {
  it('401/403/404 are final; 429 and 5xx retry; no response is a network error', async () => {
    for (const [status, retry] of [[401, false], [403, false], [404, false], [429, true], [500, true]] as const) {
      mockFetch(() => reply(status, { code: 'x', message: 'y' }));
      const e = await err(webflow.test(C));
      expect([e.http, e.retryable]).toEqual([status, retry]);
    }
    mockFetch(() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); });
    expect(await err(webflow.test(C))).toMatchObject({ http: 0, kind: 'network', host: 'api.webflow.com' });
  });
});
