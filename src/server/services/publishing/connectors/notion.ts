// Notion — public integration (OAuth). Target = a database. Publishing creates a page with the title + converted blocks;
// "published" = the page exists (and a Status/select property is set to Published when the database has one).
import type { Block } from '@/lib/types';
import type { Connector, ConnCtx, PublishPayload } from '../types';
import { TEST_TITLE } from '../types';
import { jsonBody, PublishError, reqJson } from '../http';

const API = 'https://api.notion.com/v1';
const h = (c: ConnCtx) => ({ authorization: `Bearer ${c.creds.access_token}`, 'notion-version': '2022-06-28' });

const rt = (s: string, link?: string) => {
  const out: any[] = []; const str = String(s || '');
  for (let i = 0; i < Math.max(1, str.length); i += 1900) out.push({ type: 'text', text: { content: str.slice(i, i + 1900), ...(link ? { link: { url: link } } : {}) } });
  return out;
};
export function toNotionBlocks(blocks: Block[], p: Pick<PublishPayload, 'videos' | 'sources'>): any[] {
  const out: any[] = [];
  const at = blocks.findIndex((x, j) => j > 0 && x[0] === 'h2'); const anchor = at > 0 ? at - 1 : blocks.length - 1;
  blocks.forEach((b, i) => {
    if (b[0] === 'ul') (b[1] as string[]).forEach(li => out.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(li) } }));
    else if (b[0] === 'h2') out.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: rt(b[1] as string) } });
    else if (b[0] === 'h3') out.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: rt(b[1] as string) } });
    else out.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(b[1] as string) } });
    if (i === anchor) p.videos.forEach(v => out.push({ object: 'block', type: 'video', video: { type: 'external', external: { url: v.url }, caption: rt([v.title, 'YouTube', v.channel].filter(Boolean).join(' · ')) } }));
  });
  if (p.sources.length) {
    out.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: rt('Sources') } });
    p.sources.forEach(s => out.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: rt(s.title || s.url, s.url) } }));
  }
  return out;
}

async function dbProps(c: ConnCtx) {
  if (!c.targetId) throw new PublishError(404, 'No database chosen');
  const db = await reqJson<{ properties: Record<string, { type: string; status?: { options: { name: string }[] }; select?: { options: { name: string }[] } }> }>(`${API}/databases/${c.targetId}`, { headers: h(c) });
  const entries = Object.entries(db.properties || {});
  const title = entries.find(([, v]) => v.type === 'title')?.[0] || 'Name';
  const statusE = entries.find(([, v]) => v.type === 'status') || entries.find(([k, v]) => v.type === 'select' && /status/i.test(k));
  let status: any = null;
  if (statusE) {
    const [k, v] = statusE; const opts = (v.status || v.select)?.options || [];
    const pick = opts.find(o => /^published$/i.test(o.name)) || opts.find(o => /publish|live|done/i.test(o.name));
    if (pick) status = { key: k, type: v.type, name: pick.name };
  }
  const find = (re: RegExp, type: string) => entries.find(([k, v]) => v.type === type && re.test(k))?.[0];
  return { title, status, slug: find(/slug/i, 'rich_text'), desc: find(/description|summary|excerpt|meta/i, 'rich_text'), date: find(/date|publish/i, 'date') };
}

export const notion: Connector = {
  async targets(c) {
    const out: { id: string; name: string }[] = []; let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const r = await reqJson<{ results: any[]; has_more: boolean; next_cursor: string }>(`${API}/search`, { method: 'POST', ...jsonBody({ filter: { value: 'database', property: 'object' }, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }, h(c)) });
      for (const d of r.results || []) out.push({ id: d.id, name: (d.title || []).map((t: any) => t.plain_text).join('') || 'Untitled' });
      if (!r.has_more) break; cursor = r.next_cursor;
    }
    return out;
  },
  async test(c) {
    const pr = await dbProps(c);
    const page = await reqJson<{ id: string }>(`${API}/pages`, { method: 'POST', ...jsonBody({ parent: { database_id: c.targetId }, properties: { [pr.title]: { title: rt(TEST_TITLE) } } }, h(c)) });
    await reqJson(`${API}/pages/${page.id}`, { method: 'PATCH', ...jsonBody({ archived: true }, h(c)) });
  },
  async createDraft(c, p) {
    const pr = await dbProps(c);
    const props: any = { [pr.title]: { title: rt(p.title) } };
    if (pr.slug) props[pr.slug] = { rich_text: rt(p.slug) };
    if (pr.desc) props[pr.desc] = { rich_text: rt(p.meta) };
    if (pr.date) props[pr.date] = { date: { start: p.date } };
    const children = toNotionBlocks(p.blocks, p);
    const page = await reqJson<{ id: string; url: string; public_url?: string }>(`${API}/pages`, { method: 'POST', ...jsonBody({ parent: { database_id: c.targetId }, properties: props, children: children.slice(0, 100), ...(p.image && /^https:/.test(p.image.url) ? { cover: { type: 'external', external: { url: p.image.url } } } : {}) }, h(c)) });
    for (let i = 100; i < children.length; i += 100) await reqJson(`${API}/blocks/${page.id}/children`, { method: 'PATCH', ...jsonBody({ children: children.slice(i, i + 100) }, h(c)) });
    return { id: page.id, url: page.public_url || page.url, extra: { status: pr.status } };
  },
  async publish(c, _p, d) {
    const st = d.extra?.status;
    if (st) await reqJson(`${API}/pages/${d.id}`, { method: 'PATCH', ...jsonBody({ properties: { [st.key]: st.type === 'status' ? { status: { name: st.name } } : { select: { name: st.name } } } }, h(c)) });
    return { url: d.url || `https://www.notion.so/${d.id.replace(/-/g, '')}` };
  },
};
