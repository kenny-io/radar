// WordPress.com — REST v1.1 (OAuth2, scope "global"). Target = a site. posts/new (draft) → update status publish.
import type { Connector, ConnCtx, PublishPayload } from '../types';
import { TEST_HTML, TEST_TITLE } from '../types';
import { jsonBody, PublishError, reqJson } from '../http';

const API = 'https://public-api.wordpress.com/rest/v1.1';
const h = (c: ConnCtx) => ({ authorization: `Bearer ${c.creds.access_token}` });
const site = (c: ConnCtx) => { if (!c.targetId) throw new PublishError(404, 'No site chosen'); return encodeURIComponent(c.targetId); };

async function existing(c: ConnCtx, p: PublishPayload): Promise<string | null> {
  if (p.mode !== 'refresh' || !p.refreshUrl) return null;
  const slug = p.refreshUrl.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
  if (!slug) return null;
  const r = await reqJson<{ ID: number }>(`${API}/sites/${site(c)}/posts/slug:${encodeURIComponent(slug)}`, { headers: h(c) }).catch(() => null);
  return r?.ID ? String(r.ID) : null;
}

export const wpcom: Connector = {
  async targets(c) {
    const r = await reqJson<{ sites: { ID: number; name: string; URL: string; capabilities?: { publish_posts?: boolean } }[] }>(`${API}/me/sites?fields=ID,name,URL,capabilities`, { headers: h(c) });
    return (r.sites || []).filter(s => s.capabilities?.publish_posts !== false).map(s => ({ id: String(s.ID), name: s.URL.replace(/^https?:\/\//, '').replace(/\/$/, ''), url: s.URL }));
  },
  async test(c) {
    const p = await reqJson<{ ID: number }>(`${API}/sites/${site(c)}/posts/new`, { method: 'POST', ...jsonBody({ title: TEST_TITLE, content: TEST_HTML, status: 'draft' }, h(c)) });
    // First delete moves it to the trash; the second removes it permanently.
    await reqJson(`${API}/sites/${site(c)}/posts/${p.ID}/delete`, { method: 'POST', headers: h(c) });
    await reqJson(`${API}/sites/${site(c)}/posts/${p.ID}/delete`, { method: 'POST', headers: h(c) }).catch(() => {});
  },
  async createDraft(c, p) {
    const body: any = { title: p.title, content: p.html, excerpt: p.meta, ...(p.image && /^https:/.test(p.image.url) ? { featured_image: p.image.url } : {}) };
    const ex = await existing(c, p);
    if (ex) return { id: ex, extra: { refresh: true, body } };
    const r = await reqJson<{ ID: number; URL: string }>(`${API}/sites/${site(c)}/posts/new`, { method: 'POST', ...jsonBody({ ...body, slug: p.slug, status: 'draft' }, h(c)) });
    return { id: String(r.ID), url: r.URL };
  },
  async publish(c, _p, d) {
    const r = await reqJson<{ URL: string }>(`${API}/sites/${site(c)}/posts/${d.id}`, { method: 'POST', ...jsonBody(d.extra?.refresh ? d.extra.body : { status: 'publish' }, h(c)) });
    return { url: r.URL };
  },
};
