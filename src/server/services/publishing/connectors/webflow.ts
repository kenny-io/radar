// Webflow — Data API v2 (OAuth). Target = a CMS collection ("{siteId}:{collectionId}"). Items are created staged
// (not live), then published with /items/publish. Fields map by slug: name, slug, post-body, post-summary, main-image.
import type { Connector, ConnCtx, PublishPayload, Target } from '../types';
import { TEST_HTML, TEST_TITLE } from '../types';
import { jsonBody, PublishError, req, reqJson } from '../http';

const API = 'https://api.webflow.com/v2';
const h = (c: ConnCtx) => ({ authorization: `Bearer ${c.creds.access_token}`, accept: 'application/json' });
const ids = (c: ConnCtx) => { const [site, coll] = String(c.targetId || '').split(':'); if (!site || !coll) throw new PublishError(404, 'No CMS collection chosen'); return { site, coll }; };

interface WfField { slug: string; displayName: string; type: string; isRequired?: boolean }
async function fieldMap(c: ConnCtx, coll: string) {
  const col = await reqJson<{ slug: string; fields: WfField[] }>(`${API}/collections/${coll}`, { headers: h(c) });
  const f = col.fields || [];
  const bySlug = (s: string) => f.find(x => x.slug === s);
  const body = bySlug('post-body') || f.find(x => x.type === 'RichText');
  const summary = bySlug('post-summary') || f.find(x => x.type === 'PlainText' && /summary|excerpt|description/i.test(x.slug + ' ' + x.displayName));
  const image = bySlug('main-image') || f.find(x => x.type === 'Image');
  return { colSlug: col.slug, body: body?.slug, summary: summary?.slug, image: image?.slug };
}
async function siteHost(c: ConnCtx, site: string): Promise<string> {
  const s = await reqJson<{ shortName: string; customDomains?: { url: string }[] }>(`${API}/sites/${site}`, { headers: h(c) }).catch(() => null);
  const custom = s?.customDomains?.[0]?.url;
  return custom ? custom.replace(/^https?:\/\//, '').replace(/\/$/, '') : s?.shortName ? `${s.shortName}.webflow.io` : c.domain;
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
    const fieldData: any = { name: TEST_TITLE, slug: 'radar-test-' + Date.now().toString(36) };
    if (m.body) fieldData[m.body] = TEST_HTML;
    const item = await reqJson<{ id: string }>(`${API}/collections/${coll}/items`, { method: 'POST', ...jsonBody({ isArchived: false, isDraft: true, fieldData }, h(c)) });
    await req(`${API}/collections/${coll}/items/${item.id}`, { method: 'DELETE', headers: h(c) });
  },
  async createDraft(c, p: PublishPayload) {
    const { coll } = ids(c);
    const m = await fieldMap(c, coll);
    const fieldData: any = { name: p.title, slug: p.slug };
    if (m.body) fieldData[m.body] = p.html;
    if (m.summary) fieldData[m.summary] = p.meta;
    if (m.image && p.image) fieldData[m.image] = { url: p.image.url, alt: p.image.alt };
    const item = await reqJson<{ id: string; fieldData: { slug: string } }>(`${API}/collections/${coll}/items`, { method: 'POST', ...jsonBody({ isArchived: false, isDraft: false, fieldData }, h(c)) });
    return { id: item.id, extra: { colSlug: m.colSlug, slug: item.fieldData?.slug || p.slug } };
  },
  async publish(c, p, d) {
    const { site, coll } = ids(c);
    await reqJson(`${API}/collections/${coll}/items/publish`, { method: 'POST', ...jsonBody({ itemIds: [d.id] }, h(c)) });
    const host = await siteHost(c, site);
    return { url: `https://${host}/${d.extra?.colSlug || 'blog'}/${d.extra?.slug || p.slug}` };
  },
};
