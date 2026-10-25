// Framer connector against a fake `framer-api` (vi.mock) that records every call. The calls must match the Server API
// contract in node_modules/framer-api/dist/index.d.ts (5.1.0) and framer.com/developers/server-api-quick-start,
// …/server-api-reference and …/reference/plugins-collection-add-items: connect(url, key), getCollection(id), getFields,
// getItems, addItems (id = update, omitted top-level fields unchanged), removeItems, publish() → { deployment, hostnames },
// deploy(id) → Hostname[], getNodesWithType('WebPageNode'). Errors are FramerAPIError { code, retryable } / FramerPluginError.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FramerAPIError, FramerPluginError } from 'framer-api';
import { PublishError } from '../http';
import type { ConnCtx, PublishPayload } from '../types';

type Item = { id: string; slug: string; draft: boolean; fieldData: Record<string, any> };
let calls: [string, ...any[]][] = [];
let items: Item[] = [];
let n = 0;
let fail: Partial<Record<string, unknown>> = {};
let deployed: any[] = [];
let pages: any[] = [];
const FIELDS = [{ id: 'fTitle', name: 'Title', type: 'string' }, { id: 'fBody', name: 'Content', type: 'formattedText' }, { id: 'fDesc', name: 'Summary', type: 'string' },
  { id: 'fImg', name: 'Cover image', type: 'image' }, { id: 'fDate', name: 'Date', type: 'date' }, { id: 'div', type: 'divider' }];
let fields: any[] = FIELDS;
const step = async (name: string, ...args: any[]) => { calls.push([name, ...args]); if (fail[name]) throw fail[name]; };
const col = {
  id: 'col1', name: 'Blog', managedBy: 'user',
  getFields: async () => { await step('getFields'); return fields; },
  getItems: async () => { await step('getItems'); return items.map(i => ({ ...i })); },
  addItems: async (input: any[]) => {
    await step('addItems', input);
    for (const x of input) {
      const ex = x.id && items.find(i => i.id === x.id);
      if (ex) Object.assign(ex, Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'fieldData')), x.fieldData ? { fieldData: { ...ex.fieldData, ...x.fieldData } } : {});
      else items.push({ id: 'it' + ++n, slug: x.slug, draft: !!x.draft, fieldData: x.fieldData || {} });
    }
    if (fail.afterAdd) { const e = fail.afterAdd; fail.afterAdd = undefined; throw e; }
  },
  removeItems: async (ids: string[]) => { await step('removeItems', ids); items = items.filter(i => !ids.includes(i.id)); },
};
const fake = {
  getCollections: async () => { await step('getCollections'); return [col, { id: 'col2', name: 'Synced', managedBy: 'anotherPlugin' }]; },
  getCollection: async (id: string) => { await step('getCollection', id); return id === 'col1' ? col : null; },
  publish: async () => { await step('publish'); return { deployment: { id: 'dep1', status: 'pending' }, hostnames: [
    { hostname: 'fieldnote-abc123.framer.website', type: 'version', isPrimary: false }, { hostname: 'fieldnote.framer.website', type: 'default', isPrimary: true }] }; },
  deploy: async (id: string) => { await step('deploy', id); return deployed; },
  getNodesWithType: async (t: string) => { await step('getNodesWithType', t); return pages; },
  disconnect: async () => { calls.push(['disconnect']); },
};
const connect = vi.fn(async (url: string, key: string) => { calls.push(['connect', url, key]); if (fail.connect) throw fail.connect; return fake; });
vi.mock('framer-api', async orig => ({ ...(await orig<typeof import('framer-api')>()), connect: (...a: [string, string]) => connect(...a) }));
const { framer, mapErr } = await import('./framer');

beforeEach(() => { calls = []; items = []; n = 0; fail = {}; deployed = []; pages = [{ collectionId: 'col1', path: '/blog/:slug' }]; fields = FIELDS; });
afterEach(() => { vi.clearAllMocks(); });

const C: ConnCtx = { type: 'framer', fields: { url: 'https://framer.com/projects/Site--aabbccdd1122 ' }, creds: { key: ' fr_key ' }, target: 'Blog', targetId: 'col1', bid: 'b1', domain: 'fieldnote.app', businessName: 'Fieldnote' };
const P = (o: Partial<PublishPayload> = {}): PublishPayload => ({
  entryId: 'e1', title: 'Billing tips', slug: 'billing-tips', html: '<h2>Why</h2><p>Because.</p>', markdown: '', blocks: [], meta: 'How to bill.', keyword: 'billing', date: '2026-10-25',
  image: { url: 'https://cdn.example.com/hero.png', alt: 'A ledger', bytes: async () => ({ buf: Buffer.from(''), type: 'image/png', name: 'x.png' }) },
  canonical: null, mode: 'new', refreshUrl: null, sources: [], videos: [], author: 'Fieldnote', ...o,
});
const live = (slug: string, title = 'Someone else'): Item => ({ id: 'old-' + slug, slug, draft: false, fieldData: { fTitle: { type: 'string', value: title } } });
async function err(p: Promise<unknown>): Promise<PublishError> { try { await p; } catch (e) { return e as PublishError; } throw new Error('expected a rejection'); }
const names = () => calls.map(c => c[0]);

describe('connect', () => {
  it('passes the trimmed project URL and key, and always disconnects', async () => {
    await framer.targets!(C);
    expect(calls[0]).toEqual(['connect', 'https://framer.com/projects/Site--aabbccdd1122', 'fr_key']);
    expect(names().at(-1)).toBe('disconnect');
  });
  it('a blank key or URL fails before connect (connect() would fall back to FRAMER_API_KEY / FRAMER_PROJECT_URL)', async () => {
    expect((await err(framer.test({ ...C, creds: { key: ' ' } }))).http).toBe(401);
    expect((await err(framer.test({ ...C, fields: { url: '' } }))).http).toBe(404);
    expect(connect).not.toHaveBeenCalled();
  });
  it('disconnects after a failed call too', async () => {
    fail.getCollection = new FramerPluginError('boom');
    await err(framer.test(C));
    expect(names().at(-1)).toBe('disconnect');
  });
});

describe('error mapping (FramerAPIError codes, FramerPluginError messages)', () => {
  const api = (code: string, retryable = false) => new FramerAPIError('x', code as any, { retryable });
  it.each([
    ['UNAUTHORIZED', 401, false], ['INVALID_REQUEST', 404, false], ['TIMEOUT', 503, true], ['PROJECT_CLOSED', 503, true],
    ['POOL_EXHAUSTED', 429, true], ['TOKEN_SESSION_LIMIT', 429, true], ['INTERNAL', 502, true],
  ])('connect failing with %s → %i (retried: %s)', async (code, http, retryable) => {
    fail.connect = api(code);
    const e = await err(framer.test(C));
    expect(e).toBeInstanceOf(PublishError);
    expect([e.http, e.retryable, e.host]).toEqual([http, retryable, 'framer.com']);
  });
  it('an invalid project URL reads "check the URL" (config 404); INVALID_REQUEST on a method call is a 400', () => {
    expect(mapErr(api('INVALID_REQUEST'), true)).toMatchObject({ http: 404, kind: 'config' });
    expect(mapErr(api('INVALID_REQUEST'))).toMatchObject({ http: 400, retryable: false });
  });
  it('a server-retryable INTERNAL is retried', () => { expect(mapErr(api('INTERNAL', true)).http).toBe(503); });
  it('method errors map by message; an unknown one is not retried (calls are not transactional)', () => {
    expect(mapErr(new FramerPluginError('Permission denied: not allowed')).http).toBe(403);
    expect(mapErr(new FramerPluginError('Item not found')).http).toBe(404);
    expect(mapErr(new FramerPluginError('Invalid field value')).retryable).toBe(false);
  });
  it('anything else (e.g. a socket error) is a retried 502', () => { expect(mapErr(new Error('ECONNRESET')).retryable).toBe(true); });
});

describe('targets', () => {
  it('lists only user-managed collections (plugin-managed ones are read-only)', async () => {
    expect(await framer.targets!(C)).toEqual([{ id: 'col1', name: 'Blog' }]);
  });
});

describe('test connection', () => {
  it('adds a draft test item, finds it and removes it: nothing is left', async () => {
    await framer.test(C);
    const add = calls.find(c => c[0] === 'addItems')!;
    expect(add[1]).toEqual([{ slug: expect.stringMatching(/^radar-test-/), draft: true, fieldData: { fTitle: { type: 'string', value: 'Radar connection test' } } }]);
    expect(calls.find(c => c[0] === 'removeItems')![1]).toEqual(['it1']);
    expect(items).toEqual([]);
  });
  it('an unknown collection is a 404; a collection without a formatted text field fails readably before writing', async () => {
    expect((await err(framer.test({ ...C, targetId: 'nope' }))).http).toBe(404);
    fields = FIELDS.filter(f => f.type !== 'formattedText');
    const e = await err(framer.test(C));
    expect([e.http, e.kind, e.retryable]).toEqual([422, 'config', false]);
    expect(names()).not.toContain('addItems');
  });
});

describe('createDraft + publish (new post)', () => {
  it('creates a draft item with the field data keyed by field id, then publishes, deploys and returns the live URL', async () => {
    const d = await framer.createDraft(C, P());
    expect(calls.find(c => c[0] === 'addItems')![1]).toEqual([{ slug: 'billing-tips', draft: true, fieldData: {
      fTitle: { type: 'string', value: 'Billing tips' }, fBody: { type: 'formattedText', value: '<h2>Why</h2><p>Because.</p>', contentType: 'html' },
      fDesc: { type: 'string', value: 'How to bill.' }, fImg: { type: 'image', value: 'https://cdn.example.com/hero.png', alt: 'A ledger' },
      fDate: { type: 'date', value: '2026-10-25T12:00:00.000Z' },
    } }]);
    expect(d).toEqual({ id: 'it1', extra: { slug: 'billing-tips' } });
    calls = [];
    deployed = [{ hostname: 'fieldnote.app', type: 'custom', isPrimary: true }];
    const r = await framer.publish(C, P(), d);
    expect(calls.find(c => c[0] === 'addItems')![1]).toEqual([{ id: 'it1', draft: false }]);
    expect(calls.filter(c => ['publish', 'deploy'].includes(c[0]))).toEqual([['publish'], ['deploy', 'dep1']]);
    expect(r.url).toBe('https://fieldnote.app/blog/billing-tips');
    expect(items[0]).toMatchObject({ draft: false, slug: 'billing-tips', fieldData: { fTitle: { value: 'Billing tips' } } });
  });
  it('a non-https image (local dev) is left out rather than sent as a broken URL', async () => {
    await framer.createDraft(C, P({ image: { ...P().image!, url: 'http://localhost:3000/api/files/x.png' } }));
    expect(calls.find(c => c[0] === 'addItems')![1][0].fieldData).not.toHaveProperty('fImg');
  });
  it('with no custom domain (deploy → []) the URL is the default framer hostname, never the versioned preview', async () => {
    const r = await framer.publish(C, P(), { id: 'it1', extra: { slug: 'billing-tips' } });
    expect(r.url).toBe('https://fieldnote.framer.website/blog/billing-tips');
  });
  it('without a CMS detail page the path falls back to /{slug}', async () => {
    pages = [];
    expect((await framer.publish(C, P(), { id: 'it1', extra: { slug: 'x' } })).url).toBe('https://fieldnote.framer.website/x');
  });
  it('a failed deploy is not swallowed (the post would be missing from the custom domain)', async () => {
    fail.deploy = new FramerAPIError('No connection to the server', 'INTERNAL' as any, { retryable: true });
    expect((await err(framer.publish(C, P(), { id: 'it1' }))).retryable).toBe(true);
  });
});

describe('taken slug never overwrites another post', () => {
  it('a live item with the slug is left alone: the new post gets slug-2, and the URL uses it', async () => {
    items = [live('billing-tips'), live('billing-tips-2')];
    const d = await framer.createDraft(C, P());
    expect(d.extra.slug).toBe('billing-tips-3');
    expect(calls.find(c => c[0] === 'addItems')![1][0]).toMatchObject({ slug: 'billing-tips-3', draft: true });
    expect(calls.find(c => c[0] === 'addItems')![1][0]).not.toHaveProperty('id');
    expect(items.slice(0, 2)).toEqual([live('billing-tips'), live('billing-tips-2')]);
    expect((await framer.publish(C, P(), d)).url).toBe('https://fieldnote.framer.website/blog/billing-tips-3');
  });
  it('another draft with the slug but a different title is someone else\'s draft: skipped too', async () => {
    items = [{ ...live('billing-tips', 'Other draft'), draft: true }];
    expect((await framer.createDraft(C, P())).extra.slug).toBe('billing-tips-2');
  });
  it('fails readably (not retried) when the slug and 19 variants are all taken', async () => {
    items = Array.from({ length: 20 }, (_, i) => live(i ? `billing-tips-${i + 1}` : 'billing-tips'));
    const e = await err(framer.createDraft(C, P()));
    expect([e.http, e.retryable]).toEqual([422, false]);
    expect(names()).not.toContain('addItems');
  });
});

describe('retry never makes a second item', () => {
  it('createDraft that failed after the write reuses its own draft item on the retry', async () => {
    fail.afterAdd = new FramerAPIError('Connection to the server was closed (code: 1006)', 'PROJECT_CLOSED' as any, { retryable: true });
    expect((await err(framer.createDraft(C, P()))).retryable).toBe(true);
    expect(items).toHaveLength(1);
    const d = await framer.createDraft(C, P());
    expect(items).toHaveLength(1);
    expect(d).toEqual({ id: 'it1', extra: { slug: 'billing-tips' } });
    expect(calls.filter(c => c[0] === 'addItems').at(-1)![1][0]).toMatchObject({ id: 'it1', draft: true });
  });
  it('publishing the saved draft twice updates the same item', async () => {
    const d = await framer.createDraft(C, P());
    await framer.publish(C, P(), d);
    await framer.publish(C, P(), d);
    expect(items).toHaveLength(1);
  });
});

describe('refresh updates the existing item in place', () => {
  const R = P({ mode: 'refresh', slug: 'billing-tips-2026', title: 'Billing tips (2026)', refreshUrl: 'https://fieldnote.app/blog/billing-tips/?utm=x' });
  it('finds the item by the refreshUrl slug, leaves it live while drafting, and publish writes the new content to it', async () => {
    items = [live('billing-tips', 'Billing tips')];
    const d = await framer.createDraft(C, R);
    expect(d).toEqual({ id: 'old-billing-tips', extra: { slug: 'billing-tips', refresh: true } });
    expect(names()).not.toContain('addItems');
    expect(items[0].draft).toBe(false);
    const r = await framer.publish(C, R, d);
    const add = calls.find(c => c[0] === 'addItems')![1][0];
    expect(add).toMatchObject({ id: 'old-billing-tips', draft: false, fieldData: { fTitle: { type: 'string', value: 'Billing tips (2026)' } } });
    expect(add).not.toHaveProperty('slug');
    expect(items).toHaveLength(1);
    expect(items[0].slug).toBe('billing-tips');
    expect(r.url).toBe('https://fieldnote.framer.website/blog/billing-tips');
  });
  it('no item with that slug → a new item (the payload slug)', async () => {
    const d = await framer.createDraft(C, R);
    expect(d.extra).toEqual({ slug: 'billing-tips-2026' });
  });
  it('a failed lookup is rethrown, never turned into a new item', async () => {
    fail.getItems = new FramerAPIError('Connection timeout after 30000ms', 'TIMEOUT' as any, { retryable: true });
    const e = await err(framer.createDraft(C, R));
    expect([e.http, e.retryable]).toEqual([503, true]);
    expect(names()).not.toContain('addItems');
  });
});
