// Framer — Server API (`framer-api`): connect(projectUrl, apiKey) over a WebSocket, write to a CMS collection, then
// publish + deploy. The key is project-bound (Site Settings → General → API Keys) and acts as the user who created it.
// Contract (node_modules/framer-api/dist/index.d.ts 5.1.0, framer.com/developers/server-api-quick-start, …/server-api-reference,
// …/reference/plugins-collection-add-items):
//  - addItems: an `id` that matches updates that item; "omitted top-level fields remain unchanged"; returns void
//  - fieldData is keyed by field id: string/formattedText ({ contentType: 'html' }), image (a URL + alt), date (ISO string)
//  - publish() publishes the whole project (production, or staging when enabled) → { deployment, hostnames };
//    deploy(id) promotes it to the custom domain(s) → Hostname[] ([] when there is none: the default hostname is already live)
//  - failures are FramerAPIError { code: ErrorCode, retryable } (connection) or FramerPluginError (message only, method calls)
import type { Collection, CollectionItem, Field, FieldDataInput, Framer, Hostname } from 'framer-api';
import type { Connector, ConnCtx, PublishPayload, RemoteDraft } from '../types';
import { TEST_TITLE } from '../types';
import { PublishError } from '../http';

const HOST = 'framer.com';

async function withFramer<T>(c: ConnCtx, fn: (f: Framer) => Promise<T>): Promise<T> {
  const url = (c.fields.url || '').trim(); const key = String(c.creds.key || '').trim();
  // connect() falls back to FRAMER_PROJECT_URL / FRAMER_API_KEY from the environment: never let a blank field do that.
  if (!url) throw new PublishError(404, 'No project URL', HOST, 'config');
  if (!key) throw new PublishError(401, 'No API key', HOST, 'config');
  const mod = await import('framer-api');
  let f: Framer;
  try { f = await mod.connect(url, key); }
  catch (e: any) { throw mapErr(e, true); }
  try { return await fn(f); }
  catch (e: any) { throw e instanceof PublishError ? e : mapErr(e); }
  finally { try { await f.disconnect(); } catch { /* */ } }
}

/** FramerAPIError carries a code; FramerPluginError (a failed method call) only a message. */
export function mapErr(e: any, connecting = false): PublishError {
  const m = String(e?.message || e).slice(0, 300);
  if (e?.name === 'FramerAPIError' && typeof e.code === 'string') {
    const http = e.code === 'UNAUTHORIZED' ? 401 : e.code === 'INVALID_REQUEST' ? (connecting ? 404 : 400) : e.code === 'NODE_NOT_FOUND' ? 404
      : e.code === 'TOKEN_SESSION_LIMIT' || e.code === 'POOL_EXHAUSTED' ? 429 : e.retryable || ['TIMEOUT', 'PROJECT_CLOSED'].includes(e.code) ? 503 : 502;
    return new PublishError(http, m, HOST, http === 404 && connecting ? 'config' : 'http');
  }
  if (e?.name === 'FramerPluginError') {
    const http = /unauthori|invalid (api )?(key|token)|authenticat/i.test(m) ? 401 : /forbidden|permission|not allowed/i.test(m) ? 403 : /not found/i.test(m) ? 404 : /rate limit|too many/i.test(m) ? 429 : /timed? ?out/i.test(m) ? 503 : 422;
    return new PublishError(http, m, HOST);
  }
  return new PublishError(502, m, HOST);
}

async function mapping(col: Collection) {
  const fields: Field[] = await col.getFields();
  const named = fields.filter((x): x is Extract<Field, { name: string }> => 'name' in x && typeof x.name === 'string');
  const by = (type: string, re: RegExp) => named.find(x => x.type === type && re.test(x.name))?.id;
  const first = (type: string) => named.find(x => x.type === type)?.id;
  return {
    title: by('string', /^(title|name|headline)$/i) || first('string'),
    content: by('formattedText', /content|body|post/i) || first('formattedText'),
    desc: by('string', /description|summary|excerpt|meta/i),
    image: by('image', /image|cover|thumbnail|hero/i) || first('image'),
    date: by('date', /date|publish/i) || first('date'),
  };
}
type Mapping = Awaited<ReturnType<typeof mapping>>;
async function collection(f: Framer, c: ConnCtx): Promise<Collection> {
  if (!c.targetId) throw new PublishError(404, 'No CMS collection chosen', HOST, 'config');
  const col = await f.getCollection(c.targetId);
  if (!col) throw new PublishError(404, 'Collection not found', HOST);
  return col;
}
async function bodyMapping(col: Collection) {
  const m = await mapping(col);
  if (!m.content) throw new PublishError(422, 'The collection has no formatted text field for the article body', HOST, 'config');
  return m;
}
const bySlug = (items: CollectionItem[], slug: string) => items.find(i => i.slug === slug) || null;
const titleOf = (it: CollectionItem, m: Mapping) => { const v = m.title ? it.fieldData[m.title] : undefined; return v && v.type === 'string' ? v.value : null; };
const slugOf = (url: string) => url.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || '';

function fieldData(m: Mapping, p: PublishPayload): FieldDataInput {
  const fd: FieldDataInput = {};
  if (m.title) fd[m.title] = { type: 'string', value: p.title };
  if (m.content) fd[m.content] = { type: 'formattedText', value: p.html, contentType: 'html' };
  if (m.desc && m.desc !== m.title) fd[m.desc] = { type: 'string', value: p.meta };
  // Framer fetches the image from its URL, so only a public https URL can work.
  if (m.image && p.image && /^https:/.test(p.image.url)) fd[m.image] = { type: 'image', value: p.image.url, alt: p.image.alt };
  if (m.date) fd[m.date] = { type: 'date', value: new Date(p.date + 'T12:00:00Z').toISOString() };
  return fd;
}

/**
 * A new article never takes over another item: walk slug, slug-2, … and use the first free one. An item with the slug that
 * is still a draft with this article's title is this article's own item from an interrupted attempt (addItems returns
 * nothing, so a failure after the write can't know the id): it's reused, so a retry never makes a second item.
 */
async function newItem(col: Collection, m: Mapping, p: PublishPayload): Promise<{ id: string; slug: string }> {
  const items = await col.getItems();
  for (let i = 0; i < 20; i++) {
    const slug = i ? `${p.slug}-${i + 1}` : p.slug;
    const ex = bySlug(items, slug);
    if (ex && !(ex.draft && titleOf(ex, m) === p.title)) continue;
    await col.addItems([ex ? { id: ex.id, draft: true, fieldData: fieldData(m, p) } : { slug, draft: true, fieldData: fieldData(m, p) }]);
    const it = ex || bySlug(await col.getItems(), slug);
    if (!it) throw new PublishError(502, 'Item was not created', HOST);
    return { id: it.id, slug };
  }
  throw new PublishError(422, `Slug "${p.slug}" and its next 19 variants are taken`, HOST, 'config');
}

/** The live URL: the collection's detail page (e.g. /blog/:slug) on the deployed custom domain, else the published default one. */
function liveUrl(c: ConnCtx, deployed: Hostname[], published: Hostname[], path: string): string {
  const live = (hs: Hostname[]) => hs.filter(h => h.type === 'custom' || h.type === 'default');
  const host = live(deployed).find(h => h.isPrimary) || live(deployed)[0] || live(published).find(h => h.isPrimary && h.type === 'custom')
    || live(published).find(h => h.type === 'custom') || live(published).find(h => h.type === 'default');
  return `https://${host?.hostname || c.domain}${path}`;
}

export const framer: Connector = {
  async targets(c) {
    return withFramer(c, async f => (await f.getCollections()).filter(x => x.managedBy === 'user').map(x => ({ id: x.id, name: x.name })));
  },
  async test(c) {
    await withFramer(c, async f => {
      const col = await collection(f, c);
      const m = await bodyMapping(col);
      const slug = 'radar-test-' + Date.now().toString(36);
      await col.addItems([{ slug, draft: true, fieldData: m.title ? { [m.title]: { type: 'string', value: TEST_TITLE } } : {} }]);
      const it = bySlug(await col.getItems(), slug);
      if (!it) throw new PublishError(502, 'Test item was not created', HOST);
      await col.removeItems([it.id]);
    });
  },
  async createDraft(c, p): Promise<RemoteDraft> {
    return withFramer(c, async f => {
      const col = await collection(f, c);
      const m = await bodyMapping(col);
      // A refresh updates the existing item in place on publish (it stays live meanwhile). Only "no item with that slug"
      // creates a new one; a failed lookup throws.
      if (p.mode === 'refresh' && p.refreshUrl) {
        const ex = bySlug(await col.getItems(), slugOf(p.refreshUrl));
        if (ex) return { id: ex.id, extra: { slug: ex.slug, refresh: true } };
      }
      const it = await newItem(col, m, p);
      return { id: it.id, extra: { slug: it.slug } };
    });
  },
  async publish(c, p, d) {
    return withFramer(c, async f => {
      const col = await collection(f, c);
      // Refresh: new content onto the same item, slug untouched. New: flip the draft live (a partial update).
      await col.addItems([d.extra?.refresh ? { id: d.id, draft: false, fieldData: fieldData(await mapping(col), p) } : { id: d.id, draft: false }]);
      // Framer publishes the whole project: the owner's unpublished editor changes go live with the post (DIVERGENCES).
      const res = await f.publish();
      if (res.deployment.status === 'failed') throw new PublishError(502, `Framer deployment failed (${res.deployment.failureStage})`, HOST);
      const deployed = await f.deploy(res.deployment.id);
      const slug = d.extra?.slug || p.slug;
      let path = `/${slug}`;
      try {
        const page = (await f.getNodesWithType('WebPageNode')).find(x => x.collectionId === col.id && x.path);
        if (page?.path) path = page.path.replace(/:[A-Za-z]+/, slug);
      } catch { /* default path */ }
      return { url: liveUrl(c, deployed, res.hostnames, path) };
    });
  },
};
