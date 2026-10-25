// Notion — public integration (OAuth), API version 2026-03-11. Target = a data source (a database's table; since
// 2025-09-03 pages are created under a data source, not a database). Publishing creates a page with the title + converted
// blocks; "published" = the page exists (and a Status/select property is set to Published when the data source has one).
// Contract (developers.notion.com/reference/…):
//  - POST /v1/search { filter: { property: 'object', value: 'data_source' } } lists data sources shared with the integration
//  - GET  /v1/data_sources/:id → { properties } (the schema; exactly one property has type "title")
//  - POST /v1/pages { parent: { type: 'data_source_id', data_source_id }, properties, children ≤ 100, cover }
//  - PATCH /v1/blocks/:id/children { children ≤ 100 } appends the rest; rich text content ≤ 2000 chars, ≤ 100 items per array
//  - PATCH /v1/pages/:id { in_trash: true } trashes (2026-03-11 replaced `archived`)
//  - Page `url` (notion.so) opens for workspace members only; `public_url` is set when the page is shared to the web.
import type { Block } from '@/lib/types';
import type { Connector, ConnCtx, PublishPayload } from '../types';
import { TEST_TITLE } from '../types';
import { jsonBody, PublishError, reqJson } from '../http';

export const NOTION_VERSION = '2026-03-11';
const API = 'https://api.notion.com/v1';
const h = (c: ConnCtx) => ({ authorization: `Bearer ${c.creds.access_token}`, 'notion-version': NOTION_VERSION });
const BATCH = 100;      // children per request
const TEXT_MAX = 2000;  // characters per rich text item
const RT_MAX = 100;     // rich text items per block

/** Rich text items of at most TEXT_MAX UTF-16 units each (safe however Notion counts), never splitting a surrogate pair.
 *  A link is only kept when it's an http(s) URL ≤ 2000 chars. */
export function rt(s: string, link?: string): any[] {
  const url = link && /^https?:\/\//i.test(link) && link.length <= TEXT_MAX ? link : null;
  const parts: string[] = []; let cur = '';
  for (const cp of String(s ?? '')) { if (cur.length + cp.length > TEXT_MAX) { parts.push(cur); cur = ''; } cur += cp; }
  parts.push(cur);
  return parts.map(content => ({ type: 'text', text: { content, ...(url ? { link: { url } } : {}) } }));
}
/** One or more text blocks of a type (a very long paragraph becomes several blocks so no rich_text array exceeds RT_MAX). */
function textBlocks(type: string, s: string, link?: string): any[] {
  const all = rt(s, link); const out: any[] = [];
  for (let i = 0; i < all.length; i += RT_MAX) out.push({ object: 'block', type, [type]: { rich_text: all.slice(i, i + RT_MAX) } });
  return out;
}

export function toNotionBlocks(blocks: Block[], p: Pick<PublishPayload, 'videos' | 'sources'>): any[] {
  const out: any[] = [];
  const at = blocks.findIndex((x, j) => j > 0 && x[0] === 'h2'); const anchor = at > 0 ? at - 1 : blocks.length - 1;
  const videos = () => p.videos.forEach(v => out.push({ object: 'block', type: 'video', video: { type: 'external', external: { url: v.url }, caption: rt([v.title, 'YouTube', v.channel].filter(Boolean).join(' · ')) } }));
  blocks.forEach((b, i) => {
    if (b[0] === 'ul') (b[1] as string[]).forEach(li => out.push(...textBlocks('bulleted_list_item', li)));
    else if (b[0] === 'h2') out.push(...textBlocks('heading_2', b[1] as string));
    else if (b[0] === 'h3') out.push(...textBlocks('heading_3', b[1] as string));
    else out.push(...textBlocks('paragraph', b[1] as string));
    if (i === anchor) videos();
  });
  if (!blocks.length) videos();
  if (p.sources.length) {
    out.push(...textBlocks('heading_2', 'Sources'));
    p.sources.forEach(s => out.push(...textBlocks('numbered_list_item', s.title || s.url, s.url)));
  }
  return out;
}

/** Notion fetches an external cover from the reader's browser, so it must be a public https URL (not localhost/private). */
export function publicHttps(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i.test(x.hostname) && !x.hostname.endsWith('.localhost');
  } catch { return false; }
}

type Prop = { type: string; status?: { options: { name: string }[] }; select?: { options: { name: string }[] } };
/** The data source schema. A target saved as a database ID (API before 2025-09-03) resolves to the database's first data source. */
async function schemaOf(c: ConnCtx) {
  if (!c.targetId) throw new PublishError(404, 'No database chosen', '', 'config');
  let ds: { id: string; properties: Record<string, Prop> };
  try {
    ds = await reqJson(`${API}/data_sources/${c.targetId}`, { headers: h(c) });
  } catch (e) {
    if (!(e instanceof PublishError) || e.http !== 404) throw e;
    const db = await reqJson<{ data_sources?: { id: string }[] }>(`${API}/databases/${c.targetId}`, { headers: h(c) })
      .catch(e2 => { if (e2 instanceof PublishError && e2.http === 404) return null; throw e2; });
    const id = db?.data_sources?.[0]?.id;
    if (!id) throw e;
    ds = await reqJson(`${API}/data_sources/${id}`, { headers: h(c) });
  }
  const entries = Object.entries(ds.properties || {});
  const title = entries.find(([, v]) => v.type === 'title')?.[0] || 'Name';
  const statusE = entries.find(([, v]) => v.type === 'status') || entries.find(([k, v]) => v.type === 'select' && /status/i.test(k));
  let status: { key: string; type: string; name: string } | null = null;
  if (statusE) {
    const [k, v] = statusE; const opts = (v.status || v.select)?.options || [];
    const pick = opts.find(o => /^published$/i.test(o.name)) || opts.find(o => /publish|live|done/i.test(o.name));
    if (pick) status = { key: k, type: v.type, name: pick.name };
  }
  const find = (re: RegExp, type: string) => entries.find(([k, v]) => v.type === type && re.test(k))?.[0];
  return { dsId: ds.id || c.targetId, title, status, slug: find(/slug/i, 'rich_text'), desc: find(/description|summary|excerpt|meta/i, 'rich_text'), date: find(/date|publish/i, 'date') };
}
type Schema = Awaited<ReturnType<typeof schemaOf>>;

const trash = (c: ConnCtx, id: string) => reqJson(`${API}/pages/${id}`, { method: 'PATCH', ...jsonBody({ in_trash: true }, h(c)) });
const append = async (c: ConnCtx, id: string, children: any[]) => {
  for (let i = 0; i < children.length; i += BATCH) await reqJson(`${API}/blocks/${id}/children`, { method: 'PATCH', ...jsonBody({ children: children.slice(i, i + BATCH) }, h(c)) });
};
const statusProp = (st: Schema['status']) => (st ? { [st.key]: st.type === 'status' ? { status: { name: st.name } } : { select: { name: st.name } } } : {});

/** The Notion page ID in a notion.so URL ("…/Title-<32 hex>" or a dashed UUID). */
export function notionPageId(u: string): string | null {
  let x: URL; try { x = new URL(u); } catch { return null; }
  if (!/(^|\.)notion\.(so|site)$/i.test(x.hostname)) return null;
  const m = x.pathname.match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
  return m ? m[1].replace(/-/g, '') : null;
}

/** Refresh entries update the existing page: a notion.so URL names it, otherwise match the Slug property against the URL's
 *  last path segment. Only "not found" falls through to a new page; other failures are rethrown (no duplicate on a blip). */
async function existingPage(c: ConnCtx, pr: Schema, p: PublishPayload): Promise<string | null> {
  if (p.mode !== 'refresh' || !p.refreshUrl) return null;
  const id = notionPageId(p.refreshUrl);
  if (id) {
    try {
      const pg = await reqJson<{ id: string; in_trash?: boolean }>(`${API}/pages/${id}`, { headers: h(c) });
      return pg.in_trash ? null : pg.id;
    } catch (e) { if (e instanceof PublishError && e.http === 404) return null; throw e; }
  }
  const slug = p.refreshUrl.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
  if (!pr.slug || !slug) return null;
  const r = await reqJson<{ results: { id: string }[] }>(`${API}/data_sources/${pr.dsId}/query`, { method: 'POST', ...jsonBody({ filter: { property: pr.slug, rich_text: { equals: slug } }, page_size: 1 }, h(c)) });
  return r.results?.[0]?.id || null;
}

/** IDs of the page's current content blocks (child pages and databases are left alone). */
async function childIds(c: ConnCtx, id: string): Promise<string[]> {
  const ids: string[] = []; let cursor: string | null = null;
  do {
    const r: { results: { id: string; type: string }[]; has_more: boolean; next_cursor: string | null } = await reqJson(`${API}/blocks/${id}/children?page_size=100${cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''}`, { headers: h(c) });
    for (const b of r.results || []) if (b.type !== 'child_page' && b.type !== 'child_database') ids.push(b.id);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return ids;
}

export const notion: Connector = {
  async targets(c) {
    const out: { id: string; name: string; url?: string | null }[] = []; let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const r = await reqJson<{ results: any[]; has_more: boolean; next_cursor: string }>(`${API}/search`, { method: 'POST', ...jsonBody({ filter: { property: 'object', value: 'data_source' }, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }, h(c)) });
      for (const d of r.results || []) if (!d.in_trash) out.push({ id: d.id, name: (d.title || []).map((t: any) => t.plain_text).join('') || 'Untitled', url: d.url || null });
      if (!r.has_more || !r.next_cursor) break; cursor = r.next_cursor;
    }
    return out;
  },
  async test(c) {
    const pr = await schemaOf(c);
    const page = await reqJson<{ id: string }>(`${API}/pages`, { method: 'POST', ...jsonBody({ parent: { type: 'data_source_id', data_source_id: pr.dsId }, properties: { [pr.title]: { title: rt(TEST_TITLE) } } }, h(c)) });
    await trash(c, page.id);
  },
  async createDraft(c, p) {
    const pr = await schemaOf(c);
    const props: any = { [pr.title]: { title: rt(p.title) } };
    if (pr.desc) props[pr.desc] = { rich_text: rt(p.meta) };
    const cover = p.image && publicHttps(p.image.url) ? { cover: { type: 'external', external: { url: p.image.url } } } : {};
    const ex = await existingPage(c, pr, p);
    // A refresh keeps the page (same URL): publish replaces its properties and content in place.
    if (ex) return { id: ex, extra: { refresh: true, props, cover, status: pr.status } };
    if (pr.slug) props[pr.slug] = { rich_text: rt(p.slug) };
    if (pr.date) props[pr.date] = { date: { start: p.date } };
    const children = toNotionBlocks(p.blocks, p);
    const page = await reqJson<{ id: string; url: string; public_url?: string | null }>(`${API}/pages`, { method: 'POST', ...jsonBody({ parent: { type: 'data_source_id', data_source_id: pr.dsId }, properties: props, children: children.slice(0, BATCH), ...cover }, h(c)) });
    try { await append(c, page.id, children.slice(BATCH)); } catch (e) {
      // The draft isn't saved until createDraft returns, so a retry would create a second page: trash this half-built one.
      await trash(c, page.id).catch(() => {});
      throw e;
    }
    return { id: page.id, url: page.public_url || page.url, extra: { status: pr.status } };
  },
  async publish(c, p, d) {
    const st = d.extra?.status ?? null;
    let page: { url?: string; public_url?: string | null } | null = null;
    if (d.extra?.refresh) {
      page = await reqJson(`${API}/pages/${d.id}`, { method: 'PATCH', ...jsonBody({ properties: { ...d.extra.props, ...statusProp(st) }, ...(d.extra.cover || {}) }, h(c)) });
      // Append the new content first, then delete what was there before, so the live page is never left empty.
      // Safe to retry: each attempt lists what's on the page (old content plus any partial copy), appends a full copy, deletes the listed blocks.
      const old = await childIds(c, d.id);
      await append(c, d.id, toNotionBlocks(p.blocks, p));
      for (const b of old) await reqJson(`${API}/blocks/${b}`, { method: 'DELETE', headers: h(c) });
    } else if (st) {
      page = await reqJson(`${API}/pages/${d.id}`, { method: 'PATCH', ...jsonBody({ properties: statusProp(st) }, h(c)) });
    } else {
      page = await reqJson(`${API}/pages/${d.id}`, { headers: h(c) });
    }
    // A refresh found through its Slug lives at the blog's own URL (a site built on the database); keep showing that URL.
    if (d.extra?.refresh && p.refreshUrl && !notionPageId(p.refreshUrl)) return { url: p.refreshUrl };
    return { url: page?.public_url || page?.url || d.url || `https://www.notion.so/${d.id.replace(/-/g, '')}` };
  },
};
