// Live: the real Shopify connector against a real (development) store, with an Admin API token (no public app review needed).
// Skipped unless RADAR_IT_SHOPIFY_STORE (x.myshopify.com) and either RADAR_IT_SHOPIFY_TOKEN, or RADAR_IT_SHOPIFY_CLIENT_ID +
// RADAR_IT_SHOPIFY_CLIENT_SECRET (a Dev Dashboard app installed on a dev store in the same organization: client credentials grant,
// shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant), are set. The app needs read_content and
// write_content. Optional: RADAR_IT_SHOPIFY_BLOG (Blog GID; default: the first blog), RADAR_IT_IMAGE_URL (public https image).
// Everything it creates is deleted in afterAll.
//   RADAR_IT_SHOPIFY_STORE=… RADAR_IT_SHOPIFY_TOKEN=… npx vitest run src/server/services/publishing/connectors/shopify.live.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shopify, SHOPIFY_API_VERSION } from './shopify';
import { RUN, ctx, payload } from './live-fixtures';

const STORE = process.env.RADAR_IT_SHOPIFY_STORE || '';
const ID = process.env.RADAR_IT_SHOPIFY_CLIENT_ID || ''; const SECRET = process.env.RADAR_IT_SHOPIFY_CLIENT_SECRET || '';
const IMG = process.env.RADAR_IT_IMAGE_URL || '';
const ON = !!(STORE && (process.env.RADAR_IT_SHOPIFY_TOKEN || (ID && SECRET)));
const c = { ...ctx('shopify', { store: STORE }, { shop: STORE, access_token: process.env.RADAR_IT_SHOPIFY_TOKEN || '' }), targetId: process.env.RADAR_IT_SHOPIFY_BLOG || null };
const gql = async (query: string, variables: any = {}) => (await (await fetch(`https://${STORE}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': c.creds.access_token }, body: JSON.stringify({ query, variables }) })).json()) as any;
const byHandle = async (handle: string) => ((await gql(`query($q: String!) { articles(first: 10, query: $q) { nodes { id handle title isPublished } } }`, { q: `handle:"${handle}"` })).data?.articles?.nodes || []).filter((a: any) => a.handle === handle);
const made = new Set<string>();
const p = (o: Parameters<typeof payload>[0]) => payload({ ...o, ...(IMG ? { image: { url: IMG, alt: 'A designer’s desk with a pricing sheet', bytes: async () => { throw new Error('unused'); } } } : { withImage: false }) });

describe.skipIf(!ON)('Shopify (live)', () => {
  beforeAll(async () => {
    if (!c.creds.access_token) {
      const r = await fetch(`https://${STORE}/admin/oauth/access_token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: ID, client_secret: SECRET }) });
      c.creds.access_token = ((await r.json()) as any).access_token;
    }
    if (!c.targetId) c.targetId = (await shopify.targets!(c))[0]?.id || null;
    expect(c.targetId).toBeTruthy();
  });
  afterAll(async () => { for (const id of made) await gql(`mutation($id: ID!) { articleDelete(id: $id) { deletedArticleId } }`, { id }); });

  it('Test connection creates an article and deletes it', async () => {
    const count = async () => ((await gql(`{ articles(first: 50, query: "title:'Radar connection test'") { nodes { id } } }`)).data?.articles?.nodes || []).length;
    const before = await count();
    await shopify.test(c);
    expect(await count()).toBe(before);
  });

  it('creates an unpublished article, publishes it, and returns the storefront URL', async () => {
    const slug = `price-design-${RUN}`;
    const pl = p({ slug });
    const d = await shopify.createDraft(c, pl); made.add(d.id);
    expect((await byHandle(slug))[0]).toMatchObject({ id: d.id, isPublished: false });
    const { url } = await shopify.publish(c, pl, d);
    expect(url).toMatch(new RegExp(`/blogs/[^/]+/${slug}$`));
    const a = (await gql(`query($id: ID!) { article(id: $id) { isPublished title summary body image { altText } } }`, { id: d.id })).data.article;
    expect(a).toMatchObject({ isPublished: true, title: pl.title });
    expect(a.body).toContain('Work out your floor');
    if (IMG) expect(a.image?.altText).toBe('A designer’s desk with a pricing sheet');
    // Dev stores sit behind a storefront password, so the public page itself isn't fetched here.
  });

  it('a refresh updates the same article in place; a taken handle gets "-2" and leaves the other article alone', async () => {
    const slug = `refresh-${RUN}`;
    const first = p({ slug });
    const d1 = await shopify.createDraft(c, first); made.add(d1.id);
    const { url } = await shopify.publish(c, first, d1);
    const again = p({ slug: `other-${RUN}`, title: 'How to price a design project (2026 update)', mode: 'refresh', refreshUrl: url, canonical: url });
    const d2 = await shopify.createDraft(c, again);
    expect(d2.id).toBe(d1.id);
    expect((await shopify.publish(c, again, d2)).url).toBe(url);
    expect(await byHandle(slug)).toHaveLength(1);
    expect((await byHandle(slug))[0].title).toBe('How to price a design project (2026 update)');

    const dup = await shopify.createDraft(c, p({ slug, title: 'A different article' })); made.add(dup.id);
    expect(dup.id).not.toBe(d1.id);
    expect(dup.extra.handle).toBe(`${slug}-2`);
  });
});
