// Self-hosted WordPress — REST API (/wp-json/wp/v2) with an Application Password (HTTP Basic auth).
import type { Connector, ConnCtx, PublishPayload } from '../types';
import { TEST_HTML, TEST_TITLE } from '../types';
import { jsonBody, PublishError, reqJson, siteBase } from '../http';

const api = (c: ConnCtx) => siteBase(c.fields.url) + '/wp-json/wp/v2';
const auth = (c: ConnCtx) => ({ authorization: 'Basic ' + Buffer.from(`${(c.fields.user || '').trim()}:${String(c.creds.pass || '').replace(/\s+/g, ' ').trim()}`).toString('base64') });

async function uploadMedia(c: ConnCtx, p: PublishPayload): Promise<number | null> {
  if (!p.image) return null;
  const { buf, type, name } = await p.image.bytes();
  const m = await reqJson<{ id: number }>(api(c) + '/media', { method: 'POST', body: new Uint8Array(buf), headers: { ...auth(c), 'content-type': type, 'content-disposition': `attachment; filename="${name}"` }, timeoutMs: 60000 });
  if (p.image.alt) await reqJson(api(c) + '/media/' + m.id, { method: 'POST', ...jsonBody({ alt_text: p.image.alt }, auth(c)) }).catch(() => {});
  return m.id;
}
/** Refresh entries update the existing post (found by the slug at the end of its URL). */
async function existingPostId(c: ConnCtx, p: PublishPayload): Promise<number | null> {
  if (p.mode !== 'refresh' || !p.refreshUrl) return null;
  const slug = p.refreshUrl.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
  if (!slug) return null;
  const r = await reqJson<any[]>(api(c) + `/posts?slug=${encodeURIComponent(slug)}&status=publish,draft,future&context=edit`, { headers: auth(c) }).catch(() => []);
  return Array.isArray(r) && r[0] ? r[0].id : null;
}

export const wordpress: Connector = {
  async test(c) {
    const post = await reqJson<{ id: number }>(api(c) + '/posts', { method: 'POST', ...jsonBody({ title: TEST_TITLE, content: TEST_HTML, status: 'draft' }, auth(c)) });
    if (!post?.id) throw new PublishError(502, 'No post id returned');
    await reqJson(api(c) + `/posts/${post.id}?force=true`, { method: 'DELETE', headers: auth(c) });
  },
  async createDraft(c, p) {
    const media = await uploadMedia(c, p);
    const existing = await existingPostId(c, p);
    const body: any = { title: p.title, content: p.html, excerpt: p.meta, ...(existing ? {} : { slug: p.slug, status: 'draft' }), ...(media ? { featured_media: media } : {}) };
    // A refresh keeps the live post live: the new content replaces it in place on publish.
    if (existing) return { id: String(existing), extra: { body, refresh: true } };
    const post = await reqJson<{ id: number; link: string }>(api(c) + '/posts', { method: 'POST', ...jsonBody(body, auth(c)) });
    return { id: String(post.id), url: post.link };
  },
  async publish(c, p, d) {
    const body = d.extra?.refresh ? d.extra.body : { status: 'publish' };
    const post = await reqJson<{ link: string }>(api(c) + '/posts/' + d.id, { method: 'POST', ...jsonBody(body, auth(c)) });
    return { url: post.link };
  },
};
