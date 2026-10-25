// Shopify — Admin GraphQL API (OAuth, expiring offline token). Target = a blog. articleCreate (unpublished) → articleUpdate(isPublished).
// Contract (shopify.dev/docs/api/admin-graphql/2026-10/…, shopify.dev/docs/api/usage/versioning):
//  - POST https://{shop}/admin/api/{version}/graphql.json with X-Shopify-Access-Token. Errors often come back as HTTP 200 with
//    errors[].extensions.code: THROTTLED (≈429), ACCESS_DENIED (missing scope), SHOP_INACTIVE, INTERNAL_SERVER_ERROR (≈5xx)
//  - articleCreate(article: {blogId,title,author{name},handle,body,summary,image{url,altText},isPublished}); a taken handle is
//    userError code TAKEN. articleUpdate changes the live article (no staged copy). articleDelete deletes permanently.
//  - articles(query: "handle:… blog_id:…") finds an article by handle (empty = not there)
//  - Expiring offline tokens (shopify.dev/docs/apps/build/authentication-authorization/access-token-types/offline-access-tokens):
//    access token 1 h, refresh token 90 days, rotated on every refresh (POST /admin/oauth/access_token grant_type=refresh_token);
//    401 = refresh token expired/revoked → reconnect; 429/5xx = retry later with the refresh token still held.
import { env } from '@/server/env';
import type { Connector, ConnCtx, PublishPayload } from '../types';
import { TEST_HTML, TEST_TITLE } from '../types';
import { jsonBody, PublishError, reqJson } from '../http';

export const SHOPIFY_API_VERSION = env.shopifyApiVersion;
export const shopDomain = (s: string) => String(s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const shopOf = (c: ConnCtx) => shopDomain(c.creds.shop || c.fields.store);
const blogId = (c: ConnCtx) => { if (!c.targetId) throw new PublishError(404, 'No blog chosen', '', 'config'); return c.targetId; };

/** Token fields as stored on the connection (epoch ms expiries, like the social providers). */
export function shopifyTokens(t: { access_token: string; scope?: string; expires_in?: number; refresh_token?: string; refresh_token_expires_in?: number }, prev: Record<string, any> = {}) {
  const now = Date.now();
  return {
    access_token: t.access_token, scope: t.scope ?? prev.scope ?? null,
    expires_at: t.expires_in ? now + t.expires_in * 1000 : null,
    refresh_token: t.refresh_token || prev.refresh_token || null,
    refresh_expires_at: t.refresh_token_expires_in ? now + t.refresh_token_expires_in * 1000 : prev.refresh_expires_at ?? null,
  };
}

/** One refresh per token at a time: two refreshes with the same token would leave the stored pair behind. */
const inflight = new Map<string, Promise<Record<string, any>>>();
async function refresh(c: ConnCtx) {
  const shop = shopOf(c);
  const key = shop + ':' + c.creds.refresh_token;
  if (!inflight.has(key)) inflight.set(key, (async () => {
    let t;
    try {
      t = await reqJson(`https://${shop}/admin/oauth/access_token`, { method: 'POST', body: new URLSearchParams({ client_id: env.shopifyClientId, client_secret: env.shopifyClientSecret, grant_type: 'refresh_token', refresh_token: c.creds.refresh_token }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } });
    } catch (e) {
      if (e instanceof PublishError && e.http === 401) throw new PublishError(401, 'refresh token expired or revoked', shop, 'auth-expired');
      throw e;
    }
    if (!t?.access_token) throw new PublishError(502, 'No access token in refresh response', shop);
    const next = { ...c.creds, ...shopifyTokens(t, c.creds) };
    // The old refresh token stays usable until the new one is used, so a failed save only costs a later re-refresh.
    await c.saveCreds?.(next).catch(e => console.error('[shopify] saving refreshed tokens failed:', e?.message || e));
    return next;
  })().finally(() => inflight.delete(key)));
  Object.assign(c.creds, await inflight.get(key)!);
}

const CODES: Record<string, number> = { THROTTLED: 429, ACCESS_DENIED: 403, SHOP_INACTIVE: 423, INTERNAL_SERVER_ERROR: 500 };
async function gql<T = any>(c: ConnCtx, query: string, variables: any = {}, retried = false): Promise<T> {
  const shop = shopOf(c);
  if (c.creds.refresh_token && c.creds.expires_at && c.creds.expires_at - 60e3 <= Date.now()) await refresh(c);
  let r: { data?: any; errors?: { message: string; extensions?: { code?: string } }[] };
  try {
    r = await reqJson(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, { method: 'POST', ...jsonBody({ query, variables }, { 'x-shopify-access-token': c.creds.access_token }) });
  } catch (e) {
    if (e instanceof PublishError && e.http === 401) {
      if (!retried && c.creds.refresh_token) { await refresh(c); return gql(c, query, variables, true); }
      throw new PublishError(401, e.detail, e.host, 'auth-expired');
    }
    throw e;
  }
  if (r.errors?.length) throw new PublishError(CODES[r.errors[0].extensions?.code || ''] || 400, r.errors.map(e => e.message).join('; ').slice(0, 300), shop);
  return r.data as T;
}
type UErr = { code?: string; field?: string[] | null; message: string };
const userErr = (e: UErr[] | undefined) => { if (e?.length) throw new PublishError(422, 'Shopify refused the article: ' + e.map(x => x.message.replace(/\.$/, '')).join('; ') + '.', 'shopify', 'config'); };

const ART = `article { id handle title isPublished blog { id handle } }`;
const CREATE = `mutation($article: ArticleCreateInput!) { articleCreate(article: $article) { ${ART} userErrors { code field message } } }`;
const UPDATE = `mutation($id: ID!, $article: ArticleUpdateInput!) { articleUpdate(id: $id, article: $article) { ${ART} userErrors { code field message } } }`;
const DELETE = `mutation($id: ID!) { articleDelete(id: $id) { deletedArticleId userErrors { code field message } } }`;
const FIND = `query($q: String!) { articles(first: 5, query: $q) { nodes { id handle title isPublished blog { id handle } } } }`;
type Art = { id: string; handle: string; title: string; isPublished: boolean; blog?: { id: string; handle: string } };

/** The article with exactly this handle in the chosen blog, or null when there is none (errors are rethrown). */
async function byHandle(c: ConnCtx, handle: string): Promise<Art | null> {
  const blog = blogId(c);
  const d = await gql<{ articles: { nodes: Art[] } }>(c, FIND, { q: `handle:"${handle}" blog_id:${blog.split('/').pop()}` });
  return d.articles.nodes.find(a => a.handle === handle && (!a.blog || a.blog.id === blog)) || null;
}
const slugOf = (u: string) => u.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || '';
const taken = (e: UErr[]) => e.some(x => x.code === 'TAKEN' && (!x.field || x.field.includes('handle')));

function articleInput(c: ConnCtx, p: PublishPayload) {
  return {
    title: p.title, body: p.html, summary: `<p>${p.meta.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`, author: { name: p.author || c.businessName || 'Radar' },
    ...(p.image && /^https:/.test(p.image.url) ? { image: { url: p.image.url, altText: p.image.alt } } : {}),
  };
}

export const shopify: Connector = {
  async targets(c) {
    const d = await gql<{ blogs: { nodes: { id: string; title: string }[] } }>(c, `{ blogs(first: 50) { nodes { id title } } }`);
    return d.blogs.nodes.map(b => ({ id: b.id, name: b.title }));
  },
  async test(c) {
    const d = await gql(c, CREATE, { article: { blogId: blogId(c), title: TEST_TITLE, handle: 'radar-connection-test-' + Date.now().toString(36), body: TEST_HTML, isPublished: false, author: { name: c.businessName || 'Radar' } } });
    userErr(d.articleCreate.userErrors);
    const del = await gql(c, DELETE, { id: d.articleCreate.article.id });
    userErr(del.articleDelete.userErrors);
  },
  async createDraft(c, p) {
    const article = articleInput(c, p);
    // A refresh updates the live article in place on publish (same id, handle and URL); nothing is written here.
    if (p.mode === 'refresh' && p.refreshUrl) {
      const ex = await byHandle(c, slugOf(p.refreshUrl));
      // The byline stays whoever wrote the article (a staff member's post isn't re-attributed to the business).
      const { author: _keep, ...content } = article;
      if (ex) return { id: ex.id, extra: { refresh: true, handle: ex.handle, blog: ex.blog?.handle, article: content } };
    }
    // A taken handle never touches the other article: the next free "-2", "-3"… is used. An unpublished article with our
    // handle and title is our own earlier attempt whose response was lost, so it's reused rather than duplicated.
    for (let i = 1; i <= 10; i++) {
      const handle = i === 1 ? p.slug : `${p.slug}-${i}`;
      const ex = await byHandle(c, handle);
      if (ex) { if (!ex.isPublished && ex.title === p.title) return { id: ex.id, extra: { handle, blog: ex.blog?.handle, article } }; continue; }
      const d = await gql(c, CREATE, { article: { blogId: blogId(c), handle, ...article, isPublished: false } });
      const errs: UErr[] = d.articleCreate.userErrors || [];
      if (taken(errs)) continue;
      userErr(errs);
      const a = d.articleCreate.article;
      return { id: a.id, extra: { handle: a.handle, blog: a.blog?.handle } };
    }
    throw new PublishError(422, `Every handle from “${p.slug}” to “${p.slug}-10” is taken on this blog. Change the article’s slug and try again.`, shopOf(c), 'config');
  },
  async publish(c, p, d) {
    const r = await gql(c, UPDATE, { id: d.id, article: d.extra?.refresh ? d.extra.article : { ...(d.extra?.article || {}), isPublished: true } });
    userErr(r.articleUpdate.userErrors);
    const a = r.articleUpdate.article;
    const s = await gql<{ shop: { primaryDomain: { url: string } } }>(c, `{ shop { primaryDomain { url } } }`).catch(() => null);
    const base = (s?.shop?.primaryDomain?.url || `https://${shopOf(c)}`).replace(/\/$/, '');
    return { url: `${base}/blogs/${a?.blog?.handle || d.extra?.blog}/${a?.handle || d.extra?.handle || p.slug}` };
  },
};
