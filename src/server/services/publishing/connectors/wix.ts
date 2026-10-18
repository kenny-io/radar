// Wix — app installed on a site (OAuth). Access tokens come from the app's client credentials + the site's instanceId.
// Blog API v3: create a draft post (HTML converted to Ricos rich content), then publish it.
import { env } from '@/server/env';
import type { Connector, ConnCtx, PublishPayload } from '../types';
import { TEST_HTML, TEST_TITLE } from '../types';
import { jsonBody, PublishError, req, reqJson } from '../http';

const API = 'https://www.wixapis.com';
export async function wixToken(instanceId: string): Promise<string> {
  const r = await reqJson<{ access_token: string }>(`${API}/oauth2/token`, { method: 'POST', ...jsonBody({ grant_type: 'client_credentials', client_id: env.wixClientId, client_secret: env.wixClientSecret, instance_id: instanceId }) });
  if (!r.access_token) throw new PublishError(401, 'No access token');
  return r.access_token;
}
async function h(c: ConnCtx) {
  const inst = c.creds.instanceId; if (!inst) throw new PublishError(401, 'Missing site instance', '', 'auth-expired');
  return { authorization: await wixToken(inst) };
}
async function ricos(c: ConnCtx, html: string) {
  const r = await reqJson<{ document: any }>(`${API}/ricos/v1/ricos-document/convert/to-ricos`, { method: 'POST', ...jsonBody({ html }, await h(c)) });
  return r.document;
}
async function memberId(c: ConnCtx): Promise<string | undefined> {
  if (c.creds.memberId) return c.creds.memberId;
  const r = await reqJson<{ members: { id: string }[] }>(`${API}/members/v1/members/query`, { method: 'POST', ...jsonBody({ query: { paging: { limit: 1 } } }, await h(c)) }).catch(() => null);
  return r?.members?.[0]?.id;
}
async function importImage(c: ConnCtx, p: PublishPayload) {
  if (!p.image || !/^https:/.test(p.image.url)) return null;
  const r = await reqJson<{ file: { id: string; url: string } }>(`${API}/site-media/v1/files/import`, { method: 'POST', ...jsonBody({ url: p.image.url, mediaType: 'IMAGE', displayName: p.slug + '.png' }, await h(c)) }).catch(() => null);
  return r?.file || null;
}
async function draft(c: ConnCtx, body: any) {
  const r = await reqJson<{ draftPost: { id: string } }>(`${API}/blog/v3/draft-posts`, { method: 'POST', ...jsonBody({ draftPost: body }, await h(c)) });
  return r.draftPost.id;
}

export const wix: Connector = {
  async targets(c) {
    const r = await reqJson<{ site?: { siteDisplayName?: string; url?: string; siteId?: string } }>(`${API}/apps/v1/instance`, { headers: await h(c) });
    const s = r.site || {};
    return [{ id: s.siteId || c.creds.instanceId, name: (s.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '') || s.siteDisplayName || c.domain, url: s.url || null }];
  },
  async test(c) {
    const id = await draft(c, { title: TEST_TITLE, memberId: await memberId(c), richContent: await ricos(c, TEST_HTML) });
    await req(`${API}/blog/v3/draft-posts/${id}?permanent=true`, { method: 'DELETE', headers: await h(c) });
  },
  async createDraft(c, p) {
    const img = await importImage(c, p);
    const id = await draft(c, {
      title: p.title, memberId: await memberId(c), richContent: await ricos(c, p.html), excerpt: p.meta.slice(0, 500), seoSlug: p.slug,
      seoData: { tags: [{ type: 'meta', props: { name: 'description', content: p.meta } }] },
      ...(img ? { media: { wixMedia: { image: { id: img.id, url: img.url, altText: p.image?.alt } }, displayed: true, custom: true } } : {}),
    });
    return { id };
  },
  async publish(c, p, d) {
    const r = await reqJson<{ postId: string }>(`${API}/blog/v3/draft-posts/${d.id}/publish`, { method: 'POST', ...jsonBody({}, await h(c)) });
    const post = await reqJson<{ post: { url?: { base: string; path: string } } }>(`${API}/blog/v3/posts/${r.postId}?fieldsets=URL`, { headers: await h(c) }).catch(() => null);
    const u = post?.post?.url;
    return { url: u ? u.base.replace(/\/$/, '') + u.path : `https://${c.target || c.domain}/post/${p.slug}` };
  },
};
