// Shopify — Admin GraphQL API (OAuth, offline token). Target = a blog. articleCreate (unpublished) → articleUpdate(isPublished).
import type { Connector, ConnCtx } from '../types';
import { TEST_HTML, TEST_TITLE } from '../types';
import { jsonBody, PublishError, reqJson } from '../http';

export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';
export const shopDomain = (s: string) => String(s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

async function gql<T = any>(c: ConnCtx, query: string, variables: any = {}): Promise<T> {
  const shop = shopDomain(c.creds.shop || c.fields.store);
  const r = await reqJson<{ data?: any; errors?: { message: string; extensions?: { code?: string } }[] }>(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, { method: 'POST', ...jsonBody({ query, variables }, { 'x-shopify-access-token': c.creds.access_token }) });
  if (r.errors?.length) {
    const code = r.errors[0].extensions?.code;
    throw new PublishError(code === 'ACCESS_DENIED' ? 403 : code === 'THROTTLED' ? 429 : 400, r.errors.map(e => e.message).join('; ').slice(0, 300), shop);
  }
  return r.data as T;
}
const userErr = (e: { message: string }[] | undefined) => { if (e?.length) throw new PublishError(422, e.map(x => x.message).join('; ')); };

const CREATE = `mutation($article: ArticleCreateInput!) { articleCreate(article: $article) { article { id handle blog { handle } } userErrors { field message } } }`;
const PUBLISH = `mutation($id: ID!, $article: ArticleUpdateInput!) { articleUpdate(id: $id, article: $article) { article { id handle blog { handle } } userErrors { field message } } }`;
const DELETE = `mutation($id: ID!) { articleDelete(id: $id) { deletedArticleId userErrors { field message } } }`;

export const shopify: Connector = {
  async targets(c) {
    const d = await gql<{ blogs: { nodes: { id: string; title: string }[] } }>(c, `{ blogs(first: 50) { nodes { id title } } }`);
    return d.blogs.nodes.map(b => ({ id: b.id, name: b.title }));
  },
  async test(c) {
    if (!c.targetId) throw new PublishError(404, 'No blog chosen');
    const d = await gql(c, CREATE, { article: { blogId: c.targetId, title: TEST_TITLE, body: TEST_HTML, isPublished: false, author: { name: c.businessName || 'Radar' } } });
    userErr(d.articleCreate.userErrors);
    const del = await gql(c, DELETE, { id: d.articleCreate.article.id });
    userErr(del.articleDelete.userErrors);
  },
  async createDraft(c, p) {
    if (!c.targetId) throw new PublishError(404, 'No blog chosen');
    const d = await gql(c, CREATE, { article: {
      blogId: c.targetId, title: p.title, handle: p.slug, body: p.html, summary: `<p>${p.meta.replace(/[<>&]/g, '')}</p>`, isPublished: false,
      author: { name: p.author || c.businessName || 'Radar' },
      ...(p.image && /^https:/.test(p.image.url) ? { image: { url: p.image.url, altText: p.image.alt } } : {}),
    } });
    userErr(d.articleCreate.userErrors);
    const a = d.articleCreate.article;
    return { id: a.id, extra: { handle: a.handle, blog: a.blog?.handle } };
  },
  async publish(c, p, d) {
    const r = await gql(c, PUBLISH, { id: d.id, article: { isPublished: true } });
    userErr(r.articleUpdate.userErrors);
    const a = r.articleUpdate.article;
    const s = await gql<{ shop: { primaryDomain: { url: string } } }>(c, `{ shop { primaryDomain { url } } }`).catch(() => null);
    const base = (s?.shop.primaryDomain.url || `https://${shopDomain(c.creds.shop || c.fields.store)}`).replace(/\/$/, '');
    return { url: `${base}/blogs/${a.blog?.handle || d.extra?.blog}/${a.handle || p.slug}` };
  },
};
