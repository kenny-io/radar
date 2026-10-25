// Notion connector against a mocked fetch: requests must match API version 2026-03-11 (developers.notion.com/reference/…):
// data sources (not databases), `data_source_id` parents, `in_trash`, ≤ 100 children per request, ≤ 2000 chars per rich
// text item, and errors must map to readable, correctly retried PublishErrors. No database.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '@/lib/types';
import { PublishError } from '../http';
import type { ConnCtx, PublishPayload } from '../types';
import { notion, notionPageId, publicHttps, toNotionBlocks } from './notion';

const API = 'https://api.notion.com/v1';
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

const DS = 'a1b2c3d4-0000-4000-8000-000000000001';
const C: ConnCtx = { type: 'notion', fields: {}, creds: { access_token: 'ntn_tok' }, target: 'Blog', targetId: DS, bid: 'b1', domain: 'fieldnote.app', businessName: 'Fieldnote' };
const SCHEMA = { object: 'data_source', id: DS, properties: {
  Title: { id: 'title', type: 'title', title: {} },
  Slug: { id: 's', type: 'rich_text', rich_text: {} },
  Summary: { id: 'm', type: 'rich_text', rich_text: {} },
  'Publish date': { id: 'd', type: 'date', date: {} },
  Status: { id: 'st', type: 'status', status: { options: [{ name: 'Draft' }, { name: 'Published' }] } },
} };
const blocks = (n: number): Block[] => Array.from({ length: n }, (_, i) => ['p', `Paragraph ${i + 1}`] as Block);
const P = (o: Partial<PublishPayload> = {}): PublishPayload => ({
  entryId: 'e1', title: 'Billing tips', slug: 'billing-tips', html: '', markdown: '', blocks: blocks(3), meta: 'How to bill.', keyword: 'billing', date: '2026-10-25',
  image: { url: 'https://cdn.radar.example/hero.png', alt: 'A ledger', bytes: async () => ({ buf: Buffer.from(''), type: 'image/png', name: 'x.png' }) },
  canonical: null, mode: 'new', refreshUrl: null, sources: [], videos: [], author: 'Fieldnote', ...o,
});
async function err(p: Promise<unknown>): Promise<PublishError> { try { await p; } catch (e) { return e as PublishError; } throw new Error('expected a rejection'); }

describe('every request', () => {
  it('sends the Bearer token and Notion-Version 2026-03-11', async () => {
    mockFetch(() => reply(200, { results: [], has_more: false, next_cursor: null }));
    await notion.targets!(C);
    expect(hdr(calls[0], 'authorization')).toBe('Bearer ntn_tok');
    expect(hdr(calls[0], 'notion-version')).toBe('2026-03-11');
  });
});

describe('targets (POST /v1/search for data sources)', () => {
  it('filters on data_source, pages through results and names untitled ones', async () => {
    mockFetch((_u, init) => {
      const b = JSON.parse(String(init.body));
      return b.start_cursor
        ? reply(200, { results: [{ object: 'data_source', id: 'ds3', title: [], in_trash: false }], has_more: false, next_cursor: null })
        : reply(200, { results: [
          { object: 'data_source', id: 'ds1', title: [{ plain_text: 'Blog' }, { plain_text: ' posts' }], url: 'https://www.notion.so/x' },
          { object: 'data_source', id: 'ds2', title: [{ plain_text: 'Old' }], in_trash: true },
        ], has_more: true, next_cursor: 'cur-2' });
    });
    const t = await notion.targets!(C);
    expect(req(calls[0])).toEqual(['POST', `${API}/search`]);
    expect(json(calls[0])).toEqual({ filter: { property: 'object', value: 'data_source' }, page_size: 100 });
    expect(json(calls[1])).toEqual({ filter: { property: 'object', value: 'data_source' }, page_size: 100, start_cursor: 'cur-2' });
    expect(t).toEqual([{ id: 'ds1', name: 'Blog posts', url: 'https://www.notion.so/x' }, { id: 'ds3', name: 'Untitled', url: null }]);
  });
});

describe('test connection', () => {
  it('reads the data source schema, creates a page under data_source_id with the title property, then trashes it', async () => {
    mockFetch(url => (url.endsWith(`/data_sources/${DS}`) ? reply(200, SCHEMA) : reply(200, { object: 'page', id: 'pg1' })));
    await notion.test(C);
    expect(calls.map(req)).toEqual([['GET', `${API}/data_sources/${DS}`], ['POST', `${API}/pages`], ['PATCH', `${API}/pages/pg1`]]);
    expect(json(calls[1])).toEqual({ parent: { type: 'data_source_id', data_source_id: DS }, properties: { Title: { title: [{ type: 'text', text: { content: 'Radar connection test' } }] } } });
    expect(json(calls[2])).toEqual({ in_trash: true });
  });
  it('a target saved as a database ID resolves to its first data source', async () => {
    mockFetch(url => {
      if (url.endsWith('/data_sources/db-old')) return reply(404, { object: 'error', code: 'object_not_found', message: 'Could not find data_source' });
      if (url.endsWith('/databases/db-old')) return reply(200, { object: 'database', id: 'db-old', data_sources: [{ id: DS, name: 'Blog' }] });
      if (url.endsWith(`/data_sources/${DS}`)) return reply(200, SCHEMA);
      return reply(200, { id: 'pg1' });
    });
    await notion.test({ ...C, targetId: 'db-old' });
    expect(json(calls[3]).parent).toEqual({ type: 'data_source_id', data_source_id: DS });
  });
  it('a transient failure on the legacy database lookup is retried, not reported as 404', async () => {
    mockFetch(url => (url.includes('/data_sources/') ? reply(404, { code: 'object_not_found', message: 'x' }) : reply(502, { code: 'bad_gateway', message: 'x' })));
    const e = await err(notion.test({ ...C, targetId: 'db-old' }));
    expect(e.http).toBe(502);
    expect(e.retryable).toBe(true);
  });
  it('a database that is no longer shared (404 everywhere) fails with 404, not retried', async () => {
    mockFetch(() => reply(404, { object: 'error', code: 'object_not_found', message: 'Could not find' }));
    const e = await err(notion.test(C));
    expect(e.http).toBe(404);
    expect(e.retryable).toBe(false);
  });
});

describe('createDraft (new page)', () => {
  it('sets title, slug, summary and date; sends ≤ 100 children, appends the rest in batches; public https cover', async () => {
    mockFetch(url => (url.endsWith(`/data_sources/${DS}`) ? reply(200, SCHEMA) : url.endsWith('/pages') ? reply(200, { id: 'pg9', url: 'https://www.notion.so/Billing-tips-pg9', public_url: null }) : reply(200, { results: [] })));
    const d = await notion.createDraft(C, P({ blocks: blocks(230) }));
    const create = calls[1];
    expect(req(create)).toEqual(['POST', `${API}/pages`]);
    const body = json(create);
    expect(body.parent).toEqual({ type: 'data_source_id', data_source_id: DS });
    expect(body.properties).toEqual({
      Title: { title: [{ type: 'text', text: { content: 'Billing tips' } }] },
      Summary: { rich_text: [{ type: 'text', text: { content: 'How to bill.' } }] },
      Slug: { rich_text: [{ type: 'text', text: { content: 'billing-tips' } }] },
      'Publish date': { date: { start: '2026-10-25' } },
    });
    expect(body.properties).not.toHaveProperty('Status'); // stays a draft until publish
    expect(body.cover).toEqual({ type: 'external', external: { url: 'https://cdn.radar.example/hero.png' } });
    expect(body.children).toHaveLength(100);
    expect(calls.slice(2).map(req)).toEqual([['PATCH', `${API}/blocks/pg9/children`], ['PATCH', `${API}/blocks/pg9/children`]]);
    expect(json(calls[2]).children).toHaveLength(100);
    expect(json(calls[3]).children).toHaveLength(30);
    expect(json(calls[3]).children[29].paragraph.rich_text[0].text.content).toBe('Paragraph 230');
    expect(d).toEqual({ id: 'pg9', url: 'https://www.notion.so/Billing-tips-pg9', extra: { status: { key: 'Status', type: 'status', name: 'Published' } } });
  });
  it('no cover when the hero image is not on a public https host (Notion loads it from the reader’s browser)', async () => {
    mockFetch(url => (url.endsWith(`/data_sources/${DS}`) ? reply(200, SCHEMA) : reply(200, { id: 'pg9', url: 'u' })));
    await notion.createDraft(C, P({ image: { url: 'http://localhost:3202/api/files/hero.png', alt: '', bytes: async () => ({ buf: Buffer.from(''), type: 'image/png', name: 'x' }) } }));
    expect(json(calls[1])).not.toHaveProperty('cover');
  });
  it('a failed append trashes the half-built page before failing, so a retry cannot leave two pages', async () => {
    mockFetch((url, init) => {
      if (url.endsWith(`/data_sources/${DS}`)) return reply(200, SCHEMA);
      if (url.endsWith('/pages')) return reply(200, { id: 'pg9', url: 'u' });
      if (url.endsWith('/children')) return reply(429, { object: 'error', code: 'rate_limited', message: 'Rate limited' });
      return reply(200, { id: 'pg9', in_trash: init.method === 'PATCH' });
    });
    const e = await err(notion.createDraft(C, P({ blocks: blocks(150) })));
    expect(e.http).toBe(429);
    expect(e.retryable).toBe(true);
    const last = calls[calls.length - 1];
    expect(req(last)).toEqual(['PATCH', `${API}/pages/pg9`]);
    expect(json(last)).toEqual({ in_trash: true });
  });
});

describe('publish', () => {
  it('sets the Status property to its Published option and returns the page’s public URL when shared to the web', async () => {
    mockFetch(() => reply(200, { id: 'pg9', url: 'https://www.notion.so/Billing-tips-pg9', public_url: 'https://fieldnote.notion.site/Billing-tips-pg9' }));
    const r = await notion.publish(C, P(), { id: 'pg9', url: 'https://www.notion.so/Billing-tips-pg9', extra: { status: { key: 'Status', type: 'status', name: 'Published' } } });
    expect(req(calls[0])).toEqual(['PATCH', `${API}/pages/pg9`]);
    expect(json(calls[0])).toEqual({ properties: { Status: { status: { name: 'Published' } } } });
    expect(r.url).toBe('https://fieldnote.notion.site/Billing-tips-pg9');
  });
  it('a select-type status uses select; with no status property it reads the page and returns its notion.so URL', async () => {
    mockFetch(() => reply(200, { id: 'pg9', url: 'https://www.notion.so/Billing-tips-pg9', public_url: null }));
    await notion.publish(C, P(), { id: 'pg9', extra: { status: { key: 'State', type: 'select', name: 'Live' } } });
    expect(json(calls[0])).toEqual({ properties: { State: { select: { name: 'Live' } } } });
    const r = await notion.publish(C, P(), { id: 'pg9', extra: { status: null } });
    expect(req(calls[1])).toEqual(['GET', `${API}/pages/pg9`]);
    expect(r.url).toBe('https://www.notion.so/Billing-tips-pg9');
  });
});

describe('refresh updates the existing page in place', () => {
  const handler = (url: string, init: RequestInit) => {
    if (url.endsWith(`/data_sources/${DS}`)) return reply(200, SCHEMA);
    if (url.endsWith(`/data_sources/${DS}/query`)) return reply(200, { results: [{ object: 'page', id: 'pg-old' }], has_more: false });
    if (url.includes('/blocks/pg-old/children') && (init.method || 'GET') === 'GET') return reply(200, { results: [{ id: 'b1', type: 'paragraph' }, { id: 'b2', type: 'child_page' }, { id: 'b3', type: 'heading_2' }], has_more: false, next_cursor: null });
    return reply(200, { id: 'pg-old', url: 'https://www.notion.so/Billing-pgold', public_url: null });
  };
  it('finds the page by its Slug, creates nothing, then replaces properties and content (child pages kept)', async () => {
    mockFetch(handler);
    const R = P({ mode: 'refresh', refreshUrl: 'https://fieldnote.app/blog/billing-tips/' });
    const d = await notion.createDraft(C, R);
    expect(req(calls[1])).toEqual(['POST', `${API}/data_sources/${DS}/query`]);
    expect(json(calls[1])).toEqual({ filter: { property: 'Slug', rich_text: { equals: 'billing-tips' } }, page_size: 1 });
    expect(calls.some(c => c.url === `${API}/pages` && c.init.method === 'POST')).toBe(false);
    expect(d).toMatchObject({ id: 'pg-old', extra: { refresh: true } });
    calls = [];
    const r = await notion.publish(C, R, d);
    expect(calls.map(req)).toEqual([
      ['PATCH', `${API}/pages/pg-old`],
      ['GET', `${API}/blocks/pg-old/children?page_size=100`],
      ['PATCH', `${API}/blocks/pg-old/children`], // new content goes in before the old is removed: the page is never empty
      ['DELETE', `${API}/blocks/b1`], ['DELETE', `${API}/blocks/b3`],
    ]);
    const upd = json(calls[0]);
    expect(Object.keys(upd.properties).sort()).toEqual(['Status', 'Summary', 'Title']); // slug and date are left as they were
    expect(upd.cover).toEqual({ type: 'external', external: { url: 'https://cdn.radar.example/hero.png' } });
    expect(json(calls[2]).children).toHaveLength(3);
    expect(r.url).toBe('https://fieldnote.app/blog/billing-tips/'); // same URL as before
  });
  it('a notion.so URL names the page directly', async () => {
    mockFetch(handler);
    const d = await notion.createDraft(C, P({ mode: 'refresh', refreshUrl: 'https://www.notion.so/acme/Billing-tips-0123456789abcdef0123456789abcdef' }));
    expect(req(calls[1])).toEqual(['GET', `${API}/pages/0123456789abcdef0123456789abcdef`]);
    expect(d.extra.refresh).toBe(true);
  });
  it('a transient failure while looking the page up is rethrown, never a duplicate page', async () => {
    mockFetch(url => (url.endsWith(`/data_sources/${DS}`) ? reply(200, SCHEMA) : reply(503, { object: 'error', code: 'service_unavailable', message: 'x' })));
    const e = await err(notion.createDraft(C, P({ mode: 'refresh', refreshUrl: 'https://fieldnote.app/blog/billing-tips/' })));
    expect(e.http).toBe(503);
    expect(calls.some(c => c.url === `${API}/pages`)).toBe(false);
  });
});

describe('block conversion', () => {
  it('maps headings, paragraphs and bullets; the video follows the first section; sources link out', () => {
    const out = toNotionBlocks([['p', 'Intro'], ['ul', ['One', 'Two']], ['h2', 'Why'], ['h3', 'Detail'], ['p', 'Body']], {
      videos: [{ id: 'abc', title: 'Demo', channel: 'Fieldnote', url: 'https://www.youtube.com/watch?v=abc' }],
      sources: [{ title: 'Study', url: 'https://example.org/study' }],
    });
    expect(out.map(b => b.type)).toEqual(['paragraph', 'bulleted_list_item', 'bulleted_list_item', 'video', 'heading_2', 'heading_3', 'paragraph', 'heading_2', 'numbered_list_item']);
    expect(out[3].video).toEqual({ type: 'external', external: { url: 'https://www.youtube.com/watch?v=abc' }, caption: [{ type: 'text', text: { content: 'Demo · YouTube · Fieldnote' } }] });
    expect(out[7].heading_2.rich_text[0].text.content).toBe('Sources');
    expect(out[8].numbered_list_item.rich_text[0].text).toEqual({ content: 'Study', link: { url: 'https://example.org/study' } });
  });
  it('splits text into ≤ 2000-unit rich text items without breaking surrogate pairs', () => {
    const s = 'a' + '😀'.repeat(2500);
    const [b] = toNotionBlocks([['p', s]], { videos: [], sources: [] });
    const items: string[] = b.paragraph.rich_text.map((r: any) => r.text.content);
    expect(items.every(x => x.length <= 2000)).toBe(true);
    expect(items.every(x => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(x))).toBe(true);
    expect(items.join('')).toBe(s);
    expect(items).toHaveLength(3);
  });
  it('a paragraph needing more than 100 rich text items becomes several paragraph blocks', () => {
    const out = toNotionBlocks([['p', 'x'.repeat(2000 * 101 + 5)]], { videos: [], sources: [] });
    expect(out.map(b => b.paragraph.rich_text.length)).toEqual([100, 2]);
  });
  it('drops a source link that is not http(s) or exceeds 2000 characters, keeping the text', () => {
    const out = toNotionBlocks([], { videos: [], sources: [{ title: 'Long', url: 'https://e.org/' + 'a'.repeat(2100) }, { title: 'Bad', url: 'javascript:alert(1)' }] });
    expect(out.slice(1).map(b => b.numbered_list_item.rich_text[0].text)).toEqual([{ content: 'Long' }, { content: 'Bad' }]);
  });
  it('helpers: public https hosts and notion page ids', () => {
    expect(publicHttps('https://cdn.radar.example/a.png')).toBe(true);
    expect(publicHttps('http://cdn.radar.example/a.png')).toBe(false);
    expect(publicHttps('https://localhost:3202/a.png')).toBe(false);
    expect(publicHttps('https://192.168.1.4/a.png')).toBe(false);
    expect(notionPageId('https://www.notion.so/Title-0123456789abcdef0123456789abcdef')).toBe('0123456789abcdef0123456789abcdef');
    expect(notionPageId('https://acme.notion.site/01234567-89ab-cdef-0123-456789abcdef')).toBe('0123456789abcdef0123456789abcdef');
    expect(notionPageId('https://fieldnote.app/blog/0123456789abcdef0123456789abcdef')).toBeNull();
  });
});

describe('error mapping', () => {
  it('401 unauthorized and 403 restricted_resource are final; 400 validation_error is final; 409, 429, 5xx and 529 retry', async () => {
    for (const [status, code, retry] of [[401, 'unauthorized', false], [403, 'restricted_resource', false], [400, 'validation_error', false], [409, 'conflict_error', true], [429, 'rate_limited', true], [502, 'bad_gateway', true], [529, 'service_overload', true]] as const) {
      mockFetch(() => reply(status, { object: 'error', status, code, message: 'm' }));
      const e = await err(notion.targets!(C));
      expect(e.http).toBe(status);
      expect(e.retryable).toBe(retry);
      expect(e.detail).toContain(code);
    }
  });
});
