// Webflow — Data API v2 (OAuth). Target = a CMS collection ("{siteId}:{collectionId}"). Items are created staged as drafts
// (not live, not queued for the next site publish), then published with /items/publish. Fields map by slug: name, slug,
// post-body, post-summary, main-image. Contract (developers.webflow.com/data/reference/…):
//  - GET  /collections/{id}: fields[] {slug, displayName, type, isRequired}
//  - GET  /collections/{id}/items?slug=: exact slug match (staged items, drafts included)
//  - POST /collections/{id}/items {isDraft, isArchived, fieldData{name, slug, …}}: Image fields take {url, alt} (public URL, ≤ 4 MB)
//  - PATCH /collections/{id}/items/{item}: updates the staged item; a live item stays live until it's published again
//  - POST /collections/{id}/items/publish {itemIds} → 202 {publishedItemIds, errors}; 409 = site published to domains at different times
//  - GET  /sites/{id}: customDomains[] {url} (a bare hostname), shortName → {shortName}.webflow.io
import type { Connector, ConnCtx, PublishPayload, Target } from '../types';
import { TEST_HTML, TEST_TITLE } from '../types';
import { jsonBody, PublishError, req, reqJson } from '../http';

const API = 'https://api.webflow.com/v2';
const HOST = 'api.webflow.com';
const h = (c: ConnCtx) => ({ authorization: `Bearer ${c.creds.access_token}`, accept: 'application/json' });
const ids = (c: ConnCtx) => { const [site, coll] = String(c.targetId || '').split(':'); if (!site || !coll) throw new PublishError(404, 'No CMS collection chosen', '', 'config'); return { site, coll }; };

interface WfField { slug: string; displayName: string; type: string; isRequired?: boolean }
interface WfItem { id: string; isDraft?: boolean; lastPublished?: string | null; fieldData: { name: string; slug: string } }
async function fieldMap(c: ConnCtx, coll: string) {
  const col = await reqJson<{ slug: string; displayName?: string; fields: WfField[] }>(`${API}/collections/${coll}`, { headers: h(c) });
  const f = col.fields || [];
  const bySlug = (s: string) => f.find(x => x.slug === s);
  const body = bySlug('post-body') || f.find(x => x.type === 'RichText');
  const summary = bySlug('post-summary') || f.find(x => x.type === 'PlainText' && /summary|excerpt|description/i.test(x.slug + ' ' + x.displayName));
  const image = bySlug('main-image') || f.find(x => x.type === 'Image');
  const mapped = ['name', 'slug', body?.slug, summary?.slug, image?.slug];
  // Required fields Radar has nothing for would make every create fail with a bare 400.
  const unfilled = f.filter(x => x.isRequired && !mapped.includes(x.slug)).map(x => x.displayName || x.slug);
  return { colSlug: col.slug, colName: col.displayName || col.slug, body: body?.slug, summary: summary?.slug, image: image?.slug, unfilled };
}
function assertFillable(m: Awaited<ReturnType<typeof fieldMap>>) {
  if (m.unfilled.length) throw new PublishError(422, `The Webflow collection “${m.colName}” has required ${m.unfilled.length > 1 ? 'fields' : 'field'} Radar can’t fill: ${m.unfilled.map(n => `“${n}”`).join(', ')}. Make ${m.unfilled.length > 1 ? 'them' : 'it'} optional in Webflow, then try again.`, HOST, 'config');
}
async function siteHost(c: ConnCtx, site: string): Promise<string> {
  const s = await reqJson<{ shortName: string; customDomains?: { url: string }[] }>(`${API}/sites/${site}`, { headers: h(c) }).catch(() => null);
  const custom = s?.customDomains?.[0]?.url;
  return custom ? custom.replace(/^https?:\/\//, '').replace(/\/$/, '') : s?.shortName ? `${s.shortName}.webflow.io` : c.domain;
}
/** The item with exactly this slug, or null when there is none (errors are rethrown, so a blip can't create a duplicate). */
async function bySlug(c: ConnCtx, coll: string, slug: string): Promise<WfItem | null> {
  const r = await reqJson<{ items: WfItem[] }>(`${API}/collections/${coll}/items?slug=${encodeURIComponent(slug)}`, { headers: h(c) });
  return (r.items || []).find(i => i.fieldData?.slug === slug) || null;
}
const slugOf = (u: string) => u.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || '';
const slugTaken = (e: unknown) => e instanceof PublishError && (e.http === 409 || e.http === 400) && /slug/i.test(e.detail) && /unique|taken|already|exists|duplicate/i.test(e.detail);

function content(m: Awaited<ReturnType<typeof fieldMap>>, p: PublishPayload) {
  const fieldData: Record<string, any> = { name: p.title };
  if (m.body) fieldData[m.body] = p.html;
  if (m.summary) fieldData[m.summary] = p.meta;
  if (m.image && p.image && /^https:/.test(p.image.url)) fieldData[m.image] = { url: p.image.url, alt: p.image.alt };
  return fieldData;
}

export const webflow: Connector = {
  async targets(c) {
    const { sites } = await reqJson<{ sites: { id: string; displayName: string; shortName: string; customDomains?: { url: string }[] }[] }>(`${API}/sites`, { headers: h(c) });
    const out: Target[] = [];
    for (const s of sites || []) {
      const { collections } = await reqJson<{ collections: { id: string; displayName: string }[] }>(`${API}/sites/${s.id}/collections`, { headers: h(c) });
      const host = s.customDomains?.[0]?.url || `https://${s.shortName}.webflow.io`;
      for (const col of collections || []) out.push({ id: `${s.id}:${col.id}`, name: (sites.length > 1 ? s.displayName + ' · ' : '') + col.displayName, url: /^https?:/.test(host) ? host : 'https://' + host });
    }
    return out;
  },
  async test(c) {
    const { coll } = ids(c);
    const m = await fieldMap(c, coll);
    assertFillable(m);
    const fieldData: any = { name: TEST_TITLE, slug: 'radar-test-' + Date.now().toString(36) };
    if (m.body) fieldData[m.body] = TEST_HTML;
    if (m.summary) fieldData[m.summary] = TEST_TITLE;
    const item = await reqJson<{ id: string }>(`${API}/collections/${coll}/items`, { method: 'POST', ...jsonBody({ isArchived: false, isDraft: true, fieldData }, h(c)) });
    await req(`${API}/collections/${coll}/items/${item.id}`, { method: 'DELETE', headers: h(c) });
  },
  async createDraft(c, p) {
    const { coll } = ids(c);
    const m = await fieldMap(c, coll);
    assertFillable(m);
    const fieldData = content(m, p);
    // A refresh updates the staged copy of the existing item (keeping its slug); the live item stays up until publish.
    if (p.mode === 'refresh' && p.refreshUrl) {
      const ex = await bySlug(c, coll, slugOf(p.refreshUrl));
      if (ex) {
        await reqJson(`${API}/collections/${coll}/items/${ex.id}`, { method: 'PATCH', ...jsonBody({ fieldData }, h(c)) });
        return { id: ex.id, extra: { colSlug: m.colSlug, slug: ex.fieldData.slug, refresh: true } };
      }
    }
    // A taken slug never touches the other item: the next free "-2", "-3"… is used. A never-published draft with our slug
    // and title is our own earlier attempt whose response was lost, so it's reused rather than duplicated.
    for (let i = 1; i <= 10; i++) {
      const slug = i === 1 ? p.slug : `${p.slug}-${i}`;
      const ex = await bySlug(c, coll, slug);
      if (ex) {
        if (!ex.lastPublished && ex.fieldData.name === p.title) {
          await reqJson(`${API}/collections/${coll}/items/${ex.id}`, { method: 'PATCH', ...jsonBody({ fieldData }, h(c)) });
          return { id: ex.id, extra: { colSlug: m.colSlug, slug } };
        }
        continue;
      }
      try {
        const item = await reqJson<WfItem>(`${API}/collections/${coll}/items`, { method: 'POST', ...jsonBody({ isArchived: false, isDraft: true, fieldData: { ...fieldData, slug } }, h(c)) });
        return { id: item.id, extra: { colSlug: m.colSlug, slug: item.fieldData?.slug || slug } };
      } catch (e) { if (!slugTaken(e)) throw e; }
    }
    throw new PublishError(422, `Every slug from “${p.slug}” to “${p.slug}-10” is taken in this collection. Change the article’s slug and try again.`, HOST, 'config');
  },
  async publish(c, p, d) {
    const { site, coll } = ids(c);
    let r: { publishedItemIds?: string[]; errors?: string[] };
    try {
      r = await reqJson(`${API}/collections/${coll}/items/publish`, { method: 'POST', ...jsonBody({ itemIds: [d.id] }, h(c)) });
    } catch (e) {
      // Neither fixes itself, so they're not retried (http.ts retries 409s).
      if (e instanceof PublishError && e.http === 409) throw new PublishError(422, 'Webflow can’t publish single items while the site’s domains were published at different times. Publish the whole site once in Webflow, then try again.', HOST, 'config');
      if (e instanceof PublishError && e.http === 400 && /not (been )?published|never (been )?published|unpublished site|publish the site/i.test(e.detail)) throw new PublishError(422, 'Publish your Webflow site once in the Designer, then try again. Webflow can’t publish single items on a site that has never been published.', HOST, 'config');
      throw e;
    }
    if (r.publishedItemIds && !r.publishedItemIds.includes(d.id)) throw new PublishError(422, `Webflow didn’t publish the item${r.errors?.length ? ': ' + r.errors.join('; ').slice(0, 200).replace(/\.$/, '') : ''}. Try again, or publish it in Webflow.`, HOST, 'config');
    const host = await siteHost(c, site);
    return { url: `https://${host}/${d.extra?.colSlug || 'blog'}/${d.extra?.slug || p.slug}` };
  },
};
