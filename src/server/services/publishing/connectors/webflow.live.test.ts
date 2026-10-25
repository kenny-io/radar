// Live: the real Webflow connector against a real Webflow site, with a site API token (no OAuth app needed).
// Skipped unless RADAR_IT_WEBFLOW_TOKEN and RADAR_IT_WEBFLOW_COLLECTION ("{siteId}:{collectionId}") are set. The site must
// have been published once, and the collection must have no required fields beyond name/slug/body/summary/image.
// Optional: RADAR_IT_IMAGE_URL (a public https image) to check the hero. Everything it creates is deleted in afterAll.
//   RADAR_IT_WEBFLOW_TOKEN=… RADAR_IT_WEBFLOW_COLLECTION=site:coll npx vitest run src/server/services/publishing/connectors/webflow.live.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { webflow } from './webflow';
import { RUN, ctx, page, payload } from './live-fixtures';

const TOKEN = process.env.RADAR_IT_WEBFLOW_TOKEN || '';
const TARGET = process.env.RADAR_IT_WEBFLOW_COLLECTION || '';
const IMG = process.env.RADAR_IT_IMAGE_URL || '';
const ON = !!(TOKEN && TARGET);
const COLL = TARGET.split(':')[1];
const c = { ...ctx('webflow', {}, { access_token: TOKEN }), targetId: TARGET };
const api = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`https://api.webflow.com/v2${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/json', 'content-type': 'application/json', ...(init.headers || {}) } });
  return { status: r.status, body: r.status === 204 ? {} : await r.json().catch(() => ({})) as any };
};
const bySlug = async (slug: string) => ((await api(`/collections/${COLL}/items?slug=${slug}`)).body.items || []) as any[];
const made = new Set<string>();
const p = (o: Parameters<typeof payload>[0]) => payload({ ...o, ...(IMG ? { image: { url: IMG, alt: 'A designer’s desk with a pricing sheet', bytes: async () => { throw new Error('unused'); } } } : { withImage: false }) });

describe.skipIf(!ON)('Webflow (live)', () => {
  afterAll(async () => {
    for (const id of made) { await api(`/collections/${COLL}/items/${id}/live`, { method: 'DELETE' }); await api(`/collections/${COLL}/items/${id}`, { method: 'DELETE' }); }
  });

  it('Test connection creates a draft item and deletes it', async () => {
    const before = (await api(`/collections/${COLL}/items?name=${encodeURIComponent('Radar connection test')}`)).body.items?.length ?? 0;
    await webflow.test(c);
    expect((await api(`/collections/${COLL}/items?name=${encodeURIComponent('Radar connection test')}`)).body.items?.length ?? 0).toBe(before);
  });

  it('creates a draft, publishes it live, and the public URL serves it', async () => {
    const slug = `price-design-${RUN}`;
    const pl = p({ slug });
    const d = await webflow.createDraft(c, pl);
    made.add(d.id);
    const staged = (await api(`/collections/${COLL}/items/${d.id}`)).body;
    expect(staged.isDraft).toBe(true);
    expect(staged.fieldData.slug).toBe(slug);
    const { url } = await webflow.publish(c, pl, d);
    expect(url).toMatch(new RegExp(`/${slug}$`));
    expect((await api(`/collections/${COLL}/items/${d.id}/live`)).status).toBe(200);
    const live = await page(url);
    expect(live.status).toBe(200);
    expect(live.html).toContain('Work out your floor');
  });

  it('a refresh updates the same item in place; a taken slug gets "-2" and leaves the other item alone', async () => {
    const slug = `refresh-${RUN}`;
    const first = p({ slug });
    const d1 = await webflow.createDraft(c, first); made.add(d1.id);
    const { url } = await webflow.publish(c, first, d1);
    const again = p({ slug: `other-${RUN}`, title: 'How to price a design project (2026 update)', mode: 'refresh', refreshUrl: url, canonical: url });
    const d2 = await webflow.createDraft(c, again);
    expect(d2.id).toBe(d1.id);
    expect((await webflow.publish(c, again, d2)).url).toBe(url);
    expect(await bySlug(slug)).toHaveLength(1);
    expect((await api(`/collections/${COLL}/items/${d1.id}/live`)).body.fieldData.name).toBe('How to price a design project (2026 update)');

    const dup = await webflow.createDraft(c, p({ slug, title: 'A different article' })); made.add(dup.id);
    expect(dup.id).not.toBe(d1.id);
    expect(dup.extra.slug).toBe(`${slug}-2`);
    expect((await api(`/collections/${COLL}/items/${d1.id}`)).body.fieldData.name).toBe('How to price a design project (2026 update)');
  });
});
