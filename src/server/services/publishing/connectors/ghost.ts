// Ghost — Admin API. Admin API key "id:secret" → short-lived HS256 JWT (aud "/admin/"), header "Authorization: Ghost <jwt>".
import { SignJWT } from 'jose';
import type { Connector, ConnCtx, PublishPayload } from '../types';
import { TEST_HTML, TEST_TITLE } from '../types';
import { jsonBody, PublishError, req, reqJson, siteBase } from '../http';

const api = (c: ConnCtx) => siteBase(c.fields.url) + '/ghost/api/admin';
async function token(c: ConnCtx): Promise<string> {
  const [id, secret] = String(c.creds.key || '').trim().split(':');
  if (!id || !secret || !/^[0-9a-f]+$/i.test(secret)) throw new PublishError(401, 'Malformed Admin API key');
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256', kid: id, typ: 'JWT' }).setIssuedAt().setExpirationTime('5m').setAudience('/admin/').sign(Buffer.from(secret, 'hex'));
}
const headers = async (c: ConnCtx) => ({ authorization: `Ghost ${await token(c)}`, 'accept-version': 'v5.0' });

async function uploadImage(c: ConnCtx, p: PublishPayload): Promise<string | null> {
  if (!p.image) return null;
  const { buf, type, name } = await p.image.bytes();
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(buf)], { type }), name);
  fd.append('purpose', 'image');
  fd.append('ref', name);
  const r = await reqJson<{ images: { url: string }[] }>(api(c) + '/images/upload/', { method: 'POST', body: fd, headers: await headers(c), timeoutMs: 60000 });
  return r.images?.[0]?.url || null;
}

export const ghost: Connector = {
  async test(c) {
    const r = await reqJson<{ posts: { id: string }[] }>(api(c) + '/posts/?source=html', { method: 'POST', ...jsonBody({ posts: [{ title: TEST_TITLE, html: TEST_HTML, status: 'draft' }] }, await headers(c)) });
    const id = r.posts?.[0]?.id; if (!id) throw new PublishError(502, 'No post id returned');
    await req(api(c) + `/posts/${id}/`, { method: 'DELETE', headers: await headers(c) });
  },
  async createDraft(c, p) {
    const feature = await uploadImage(c, p);
    const fields: any = {
      title: p.title, html: p.html, custom_excerpt: p.meta.slice(0, 300), meta_description: p.meta.slice(0, 500), meta_title: p.title.slice(0, 300),
      ...(feature ? { feature_image: feature, feature_image_alt: (p.image?.alt || '').slice(0, 191) } : {}),
      ...(p.canonical ? { canonical_url: p.canonical } : {}),
    };
    if (p.mode === 'refresh' && p.refreshUrl) {
      const slug = p.refreshUrl.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
      const ex = slug ? await reqJson<{ posts: { id: string; updated_at: string }[] }>(api(c) + `/posts/slug/${encodeURIComponent(slug)}/`, { headers: await headers(c) }).catch(() => null) : null;
      const post = ex?.posts?.[0];
      if (post) { delete fields.canonical_url; return { id: post.id, extra: { refresh: true, fields } }; }
    }
    const r = await reqJson<{ posts: { id: string; url: string }[] }>(api(c) + '/posts/?source=html', { method: 'POST', ...jsonBody({ posts: [{ ...fields, slug: p.slug, status: 'draft' }] }, await headers(c)) });
    return { id: r.posts[0].id, url: r.posts[0].url };
  },
  async publish(c, p, d) {
    const cur = await reqJson<{ posts: { updated_at: string }[] }>(api(c) + `/posts/${d.id}/`, { headers: await headers(c) });
    const upd = d.extra?.refresh ? { ...d.extra.fields, updated_at: cur.posts[0].updated_at } : { status: 'published', updated_at: cur.posts[0].updated_at };
    const r = await reqJson<{ posts: { url: string }[] }>(api(c) + `/posts/${d.id}/?source=html`, { method: 'PUT', ...jsonBody({ posts: [upd] }, await headers(c)) });
    return { url: r.posts[0].url };
  },
};
