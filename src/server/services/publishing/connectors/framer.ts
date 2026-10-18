// Framer — Server API (`framer-api` package): connect(projectUrl, apiToken) over Framer's API, write to a CMS collection,
// then publish + deploy. The token is project-bound (Site Settings → General → API keys).
// The package is loaded at runtime so the rest of Radar builds without it; if it isn't installed, the test reports it.
import type { Connector, ConnCtx, PublishPayload } from '../types';
import { TEST_TITLE } from '../types';
import { PublishError } from '../http';

// Not analyzable by the bundler on purpose (optional runtime dependency).
const dynImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>;

async function withFramer<T>(c: ConnCtx, fn: (f: any) => Promise<T>): Promise<T> {
  let mod: any;
  try { mod = await dynImport('framer-api'); } catch { throw new PublishError(501, 'framer-api package not installed', 'framer.com', 'config'); }
  const url = (c.fields.url || '').trim();
  let f: any;
  try { f = await mod.connect(url, String(c.creds.key || '').trim()); }
  catch (e: any) { throw mapErr(e); }
  try { return await fn(f); }
  catch (e: any) { throw e instanceof PublishError ? e : mapErr(e); }
  finally { try { await f.disconnect(); } catch { /* */ } }
}
function mapErr(e: any): PublishError {
  const m = String(e?.message || e);
  const http = /unauthori|invalid (api )?(key|token)|authenticat|401/i.test(m) ? 401 : /forbidden|permission|not allowed|403/i.test(m) ? 403 : /not found|404|no project/i.test(m) ? 404 : /rate|429/i.test(m) ? 429 : 502;
  return new PublishError(http, m.slice(0, 300), 'framer.com');
}

async function mapping(col: any) {
  const fields: { id: string; name: string; type: string }[] = await col.getFields();
  const by = (type: string, re?: RegExp) => fields.find(x => x.type === type && (!re || re.test(x.name)))?.id || (re ? undefined : undefined);
  const first = (type: string) => fields.find(x => x.type === type)?.id;
  return {
    title: by('string', /^(title|name|headline)$/i) || first('string'),
    content: by('formattedText', /content|body|post/i) || first('formattedText'),
    desc: by('string', /description|summary|excerpt|meta/i),
    image: by('image', /image|cover|thumbnail|hero/i) || first('image'),
    date: by('date', /date|publish/i) || first('date'),
  };
}
async function collection(f: any, c: ConnCtx) {
  if (!c.targetId) throw new PublishError(404, 'No CMS collection chosen');
  const cols: any[] = await f.getCollections();
  const col = cols.find(x => x.id === c.targetId);
  if (!col) throw new PublishError(404, 'Collection not found');
  return col;
}
async function itemBySlug(col: any, slug: string) { const items: any[] = await col.getItems(); return items.find(i => i.slug === slug) || null; }

function fieldData(m: Awaited<ReturnType<typeof mapping>>, p: PublishPayload) {
  const fd: Record<string, any> = {};
  if (m.title) fd[m.title] = { type: 'string', value: p.title };
  if (m.content) fd[m.content] = { type: 'formattedText', value: p.html, contentType: 'html' };
  if (m.desc && m.desc !== m.title) fd[m.desc] = { type: 'string', value: p.meta };
  if (m.image && p.image && /^https:/.test(p.image.url)) fd[m.image] = { type: 'image', value: p.image.url, alt: p.image.alt };
  if (m.date) fd[m.date] = { type: 'date', value: new Date(p.date + 'T12:00:00Z').toISOString() };
  return fd;
}

export const framer: Connector = {
  async targets(c) {
    return withFramer(c, async f => {
      const cols: any[] = await f.getCollections();
      return cols.filter(x => !x.readonly).map(x => ({ id: x.id, name: x.name }));
    });
  },
  async test(c) {
    await withFramer(c, async f => {
      const col = await collection(f, c);
      const m = await mapping(col);
      const slug = 'radar-test-' + Date.now().toString(36);
      await col.addItems([{ slug, draft: true, fieldData: m.title ? { [m.title]: { type: 'string', value: TEST_TITLE } } : {} }]);
      const it = await itemBySlug(col, slug);
      if (!it) throw new PublishError(502, 'Test item was not created', 'framer.com');
      await col.removeItems([it.id]);
    });
  },
  async createDraft(c, p) {
    return withFramer(c, async f => {
      const col = await collection(f, c);
      const m = await mapping(col);
      const ex = await itemBySlug(col, p.slug);
      await col.addItems([{ ...(ex ? { id: ex.id } : {}), slug: p.slug, draft: true, fieldData: fieldData(m, p) }]);
      const it = ex || await itemBySlug(col, p.slug);
      if (!it) throw new PublishError(502, 'Item was not created', 'framer.com');
      return { id: it.id };
    });
  },
  async publish(c, p, d) {
    return withFramer(c, async f => {
      const col = await collection(f, c);
      await col.addItems([{ id: d.id, draft: false }]);
      const res = await f.publish();
      const hosts: any[] = await f.deploy(res.deployment.id).catch(() => res.hostnames || []);
      const host = (hosts.find((h: any) => h.isPrimary) || hosts[0] || (res.hostnames || [])[0])?.hostname;
      let path = `/${p.slug}`;
      try {
        const pages: any[] = await f.getNodesWithType('WebPageNode');
        const page = pages.find(x => x.collectionId === col.id && x.path);
        if (page) path = String(page.path).replace(/:[A-Za-z]+/, p.slug);
      } catch { /* default path */ }
      return { url: host ? `https://${host}${path}` : `https://${c.domain}${path}` };
    });
  },
};
