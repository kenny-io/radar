// WordPress.com — REST v1.1 (OAuth2, scope "global"). Target = a site (ID). posts/new (draft) → update status publish.
// Contract (developer.wordpress.com/docs/api/1.1/…):
//  - POST /sites/$site/media/new: multipart `media[]` + `attrs[0][alt]` → { media: [{ ID }] }
//  - POST /sites/$site/posts/new: `featured_image` is an attachment ID (not a URL); a taken slug is auto-suffixed by WordPress
//  - POST /sites/$site/posts/$id: update (status, title, content, excerpt, featured_image)
//  - POST /sites/$site/posts/$id/delete: the first call trashes, a second call deletes permanently
//  - GET  /sites/$site/posts/slug:$slug: 404 when there is no such post
import type { Connector, ConnCtx, PublishPayload } from '../types';
import { TEST_HTML, TEST_TITLE } from '../types';
import { jsonBody, PublishError, reqJson } from '../http';

const API = 'https://public-api.wordpress.com/rest/v1.1';
const h = (c: ConnCtx) => ({ authorization: `Bearer ${c.creds.access_token}` });
const site = (c: ConnCtx) => { if (!c.targetId) throw new PublishError(404, 'No site chosen', '', 'config'); return encodeURIComponent(c.targetId); };

/** WordPress.com can answer a bad or revoked token with 400 `invalid_token` / `authorization_required` rather than 401:
 *  treat those as an expired authorization so the connection shows "Needs reconnecting". */
async function call<T = any>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  try { return await reqJson<T>(url, init); } catch (e) {
    if (e instanceof PublishError && e.http === 400 && /"error"\s*:\s*"(invalid_token|authorization_required)"/.test(e.detail)) throw new PublishError(401, e.detail, e.host, 'auth-expired');
    throw e;
  }
}

/** Upload the hero image with its alt text; returns the attachment ID for `featured_image`. */
async function uploadMedia(c: ConnCtx, p: PublishPayload): Promise<number | null> {
  if (!p.image) return null;
  const { buf, type, name } = await p.image.bytes();
  const fd = new FormData();
  fd.append('media[]', new Blob([new Uint8Array(buf)], { type }), name);
  if (p.image.alt) fd.append('attrs[0][alt]', p.image.alt);
  const r = await call<{ media?: { ID: number }[]; errors?: unknown[] }>(`${API}/sites/${site(c)}/media/new`, { method: 'POST', body: fd, headers: h(c), timeoutMs: 60000 });
  const id = r.media?.[0]?.ID;
  // A rejected file comes back as 200 with `errors`; a retry won't fix it.
  if (!id) throw new PublishError(422, 'Image upload rejected: ' + JSON.stringify(r.errors || []).slice(0, 200), 'public-api.wordpress.com');
  return id;
}

/** Refresh entries update the existing post, found by the slug at the end of its URL. Only a 404 means "not there";
 *  any other failure is rethrown so a transient error can't turn a refresh into a duplicate post. */
async function existing(c: ConnCtx, p: PublishPayload): Promise<string | null> {
  if (p.mode !== 'refresh' || !p.refreshUrl) return null;
  const slug = p.refreshUrl.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
  if (!slug) return null;
  try {
    const r = await call<{ ID: number }>(`${API}/sites/${site(c)}/posts/slug:${encodeURIComponent(slug)}?fields=ID`, { headers: h(c) });
    return r?.ID ? String(r.ID) : null;
  } catch (e) {
    if (e instanceof PublishError && e.http === 404) return null;
    throw e;
  }
}

export const wpcom: Connector = {
  async targets(c) {
    const r = await call<{ sites: { ID: number; name: string; URL: string; capabilities?: { publish_posts?: boolean } }[] }>(`${API}/me/sites?fields=ID,name,URL,capabilities`, { headers: h(c) });
    return (r.sites || []).filter(s => s.capabilities?.publish_posts !== false).map(s => ({ id: String(s.ID), name: s.URL.replace(/^https?:\/\//, '').replace(/\/$/, ''), url: s.URL }));
  },
  async test(c) {
    const p = await call<{ ID: number }>(`${API}/sites/${site(c)}/posts/new`, { method: 'POST', ...jsonBody({ title: TEST_TITLE, content: TEST_HTML, status: 'draft' }, h(c)) });
    if (!p?.ID) throw new PublishError(502, 'No post id returned', 'public-api.wordpress.com');
    // First delete moves it to the trash; the second removes it permanently.
    await call(`${API}/sites/${site(c)}/posts/${p.ID}/delete`, { method: 'POST', headers: h(c) });
    await call(`${API}/sites/${site(c)}/posts/${p.ID}/delete`, { method: 'POST', headers: h(c) }).catch(() => {});
  },
  async createDraft(c, p) {
    const ex = await existing(c, p);
    const media = await uploadMedia(c, p);
    const body: Record<string, string> = { title: p.title, content: p.html, excerpt: p.meta, ...(media ? { featured_image: String(media) } : {}) };
    // A refresh keeps the live post live (same ID, same URL): the new content replaces it in place on publish.
    if (ex) return { id: ex, extra: { refresh: true, body } };
    const r = await call<{ ID: number; URL: string }>(`${API}/sites/${site(c)}/posts/new`, { method: 'POST', ...jsonBody({ ...body, slug: p.slug, status: 'draft' }, h(c)) });
    return { id: String(r.ID), url: r.URL };
  },
  async publish(c, _p, d) {
    // The response URL is the real permalink (WordPress suffixes a taken slug, e.g. "-2").
    const r = await call<{ URL: string }>(`${API}/sites/${site(c)}/posts/${encodeURIComponent(d.id)}`, { method: 'POST', ...jsonBody(d.extra?.refresh ? d.extra.body : { status: 'publish' }, h(c)) });
    return { url: r.URL };
  },
};
