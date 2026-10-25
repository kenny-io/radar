// WordPress.com connector against a mocked fetch: the requests must match the REST v1.1 contract
// (developer.wordpress.com/docs/api/1.1/…) and failures must map to readable, correctly retried PublishErrors. No database.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishError } from '../http';
import type { ConnCtx, PublishPayload } from '../types';
import { wpcom } from './wpcom';

const API = 'https://public-api.wordpress.com/rest/v1.1';
type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const reply = (status: number, body: any = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function mockFetch(fn: (url: string, init: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => { calls.push({ url: String(url), init }); return fn(String(url), init); }));
}
const json = (c: Call) => JSON.parse(String(c.init.body));
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];
beforeEach(() => { calls = []; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const C: ConnCtx = { type: 'wpcom', fields: {}, creds: { access_token: 'tok' }, target: 'fieldnote.blog', targetId: '12345', bid: 'b1', domain: 'fieldnote.app', businessName: 'Fieldnote' };
const P = (o: Partial<PublishPayload> = {}): PublishPayload => ({
  entryId: 'e1', title: 'Billing tips', slug: 'billing-tips', html: '<h2>Why</h2><p>Because.</p>', markdown: '', blocks: [], meta: 'How to bill.', keyword: 'billing', date: '2026-10-25',
  image: { url: 'https://cdn.example.com/hero.png', alt: 'A ledger on a desk', bytes: async () => ({ buf: Buffer.from('PNGDATA'), type: 'image/png', name: 'billing-tips.png' }) },
  canonical: null, mode: 'new', refreshUrl: null, sources: [], videos: [], author: 'Fieldnote', ...o,
});
async function err(p: Promise<unknown>): Promise<PublishError> { try { await p; } catch (e) { return e as PublishError; } throw new Error('expected a rejection'); }

describe('targets (GET /me/sites)', () => {
  it('lists the sites the token can publish to, with the Bearer token', async () => {
    mockFetch(() => reply(200, { sites: [
      { ID: 1, name: 'Notes', URL: 'https://notes.fieldnote.app', capabilities: { publish_posts: true } },
      { ID: 2, name: 'Read only', URL: 'https://ro.wordpress.com', capabilities: { publish_posts: false } },
      { ID: 3, name: 'Blog', URL: 'https://fieldnote.blog/' },
    ] }));
    const t = await wpcom.targets!(C);
    expect(calls[0].url).toBe(`${API}/me/sites?fields=ID,name,URL,capabilities`);
    expect(hdr(calls[0], 'authorization')).toBe('Bearer tok');
    expect(t).toEqual([{ id: '1', name: 'notes.fieldnote.app', url: 'https://notes.fieldnote.app' }, { id: '3', name: 'fieldnote.blog', url: 'https://fieldnote.blog/' }]);
  });
});

describe('test connection', () => {
  it('creates a draft, then deletes it twice (trash, then permanent)', async () => {
    mockFetch(url => (url.endsWith('/posts/new') ? reply(200, { ID: 901 }) : reply(200, { ID: 901, status: 'trash' })));
    await wpcom.test(C);
    expect(calls.map(c => [c.init.method, c.url])).toEqual([
      ['POST', `${API}/sites/12345/posts/new`], ['POST', `${API}/sites/12345/posts/901/delete`], ['POST', `${API}/sites/12345/posts/901/delete`],
    ]);
    expect(json(calls[0])).toMatchObject({ status: 'draft', title: 'Radar connection test' });
  });
  it('without a chosen site fails before any request', async () => {
    mockFetch(() => reply(200));
    expect((await err(wpcom.test({ ...C, targetId: null }))).http).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe('createDraft + publish (new post)', () => {
  it('uploads the hero as multipart media[] with its alt text, then sets featured_image to the attachment ID', async () => {
    mockFetch(url => (url.endsWith('/media/new') ? reply(200, { media: [{ ID: 77, URL: 'https://fieldnote.blog/wp-content/hero.png' }] }) : reply(200, { ID: 501, URL: 'https://fieldnote.blog/?p=501' })));
    const d = await wpcom.createDraft(C, P());
    expect(calls[0].url).toBe(`${API}/sites/12345/media/new`);
    const fd = calls[0].init.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    const file = fd.get('media[]') as File;
    expect(file.name).toBe('billing-tips.png');
    expect(file.type).toBe('image/png');
    expect(fd.get('attrs[0][alt]')).toBe('A ledger on a desk');
    expect(hdr(calls[0], 'content-type')).toBeUndefined(); // fetch sets the multipart boundary
    expect(calls[1].url).toBe(`${API}/sites/12345/posts/new`);
    expect(json(calls[1])).toEqual({ title: 'Billing tips', content: '<h2>Why</h2><p>Because.</p>', excerpt: 'How to bill.', featured_image: '77', slug: 'billing-tips', status: 'draft' });
    expect(d).toEqual({ id: '501', url: 'https://fieldnote.blog/?p=501' });
  });
  it('without an image there is no upload and no featured_image', async () => {
    mockFetch(() => reply(200, { ID: 502, URL: 'u' }));
    await wpcom.createDraft(C, P({ image: null }));
    expect(calls).toHaveLength(1);
    expect(json(calls[0])).not.toHaveProperty('featured_image');
  });
  it('a rejected upload (200 with errors) fails without creating a post, and is not retried', async () => {
    mockFetch(() => reply(200, { media: [], errors: [{ error: 'upload_error', message: 'Sorry, this file type is not permitted.' }] }));
    const e = await err(wpcom.createDraft(C, P()));
    expect(e.http).toBe(422);
    expect(e.retryable).toBe(false);
    expect(calls).toHaveLength(1);
  });
  it('publish sets status publish and returns the permalink WordPress chose (a taken slug gets "-2")', async () => {
    mockFetch(() => reply(200, { ID: 501, URL: 'https://fieldnote.blog/2026/10/25/billing-tips-2/', status: 'publish' }));
    const r = await wpcom.publish(C, P(), { id: '501' });
    expect(calls[0].url).toBe(`${API}/sites/12345/posts/501`);
    expect(calls[0].init.method).toBe('POST');
    expect(json(calls[0])).toEqual({ status: 'publish' });
    expect(r.url).toBe('https://fieldnote.blog/2026/10/25/billing-tips-2/');
  });
});

describe('refresh updates the existing post in place', () => {
  const R = P({ mode: 'refresh', refreshUrl: 'https://fieldnote.blog/2025/03/01/billing-tips/?utm=x' });
  it('finds the post by slug, creates nothing, and publish updates that post without touching slug or status', async () => {
    mockFetch(url => (url.includes('/posts/slug:') ? reply(200, { ID: 55 }) : url.endsWith('/media/new') ? reply(200, { media: [{ ID: 78 }] }) : reply(200, { ID: 55, URL: 'https://fieldnote.blog/2025/03/01/billing-tips/' })));
    const d = await wpcom.createDraft(C, R);
    expect(calls[0].url).toBe(`${API}/sites/12345/posts/slug:billing-tips?fields=ID`);
    expect(calls.some(c => c.url.endsWith('/posts/new'))).toBe(false);
    expect(d).toMatchObject({ id: '55', extra: { refresh: true } });
    const r = await wpcom.publish(C, R, d);
    const upd = calls[calls.length - 1];
    expect(upd.url).toBe(`${API}/sites/12345/posts/55`);
    expect(json(upd)).toEqual({ title: 'Billing tips', content: '<h2>Why</h2><p>Because.</p>', excerpt: 'How to bill.', featured_image: '78' });
    expect(r.url).toBe('https://fieldnote.blog/2025/03/01/billing-tips/');
  });
  it('a 404 on the slug lookup falls back to a new draft', async () => {
    mockFetch(url => (url.includes('/posts/slug:') ? reply(404, { error: 'unknown_post', message: 'Unknown post' }) : url.endsWith('/media/new') ? reply(200, { media: [{ ID: 1 }] }) : reply(200, { ID: 600, URL: 'u' })));
    expect((await wpcom.createDraft(C, R)).id).toBe('600');
  });
  it('a 5xx on the slug lookup is rethrown (retried), never turned into a duplicate post', async () => {
    mockFetch(() => reply(503, 'Service Unavailable'));
    const e = await err(wpcom.createDraft(C, R));
    expect(e.http).toBe(503);
    expect(e.retryable).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('error mapping', () => {
  it('400 invalid_token becomes an expired authorization (401) so the connection needs reconnecting', async () => {
    mockFetch(() => reply(400, { error: 'invalid_token', message: 'The OAuth2 token is invalid.' }));
    const e = await err(wpcom.targets!(C));
    expect(e).toMatchObject({ http: 401, kind: 'auth-expired' });
    expect(e.retryable).toBe(false);
  });
  it('other 400s keep their status; 401/403/404 are final; 429 and 5xx retry; no response is a network error', async () => {
    mockFetch(() => reply(400, { error: 'invalid_input', message: 'Invalid request input' }));
    expect((await err(wpcom.test(C))).http).toBe(400);
    for (const [status, retry] of [[401, false], [403, false], [404, false], [429, true], [500, true]] as const) {
      mockFetch(() => reply(status, { error: 'x', message: 'y' }));
      const e = await err(wpcom.test(C));
      expect(e.http).toBe(status);
      expect(e.retryable).toBe(retry);
    }
    mockFetch(() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); });
    const e = await err(wpcom.test(C));
    expect(e).toMatchObject({ http: 0, kind: 'network', host: 'public-api.wordpress.com' });
    expect(e.retryable).toBe(true);
  });
});
