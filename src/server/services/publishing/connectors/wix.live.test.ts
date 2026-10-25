// Live: the real Wix connector's Blog, Ricos and Media calls against a real Wix site, authenticated with a site-owner API key
// through the test seam in wx() (creds.apiKey + creds.siteId), so no Wix app or app review is needed. The app install flow and
// token minting (client credentials + instanceId) are NOT covered here: they need the Radar Wix app (docs/LAUNCH.md §7).
// Skipped unless RADAR_IT_WIX_API_KEY, RADAR_IT_WIX_SITE_ID and RADAR_IT_WIX_MEMBER_ID (the owner's site-member id) are set.
// The site needs Wix Blog installed (and published, for the public-page check). Optional: RADAR_IT_IMAGE_URL (public https image).
// Every post it creates is deleted permanently in afterAll.
//   RADAR_IT_WIX_API_KEY=… RADAR_IT_WIX_SITE_ID=… RADAR_IT_WIX_MEMBER_ID=… npx vitest run src/server/services/publishing/connectors/wix.live.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { wix } from './wix';
import { RUN, ctx, page, payload } from './live-fixtures';

const KEY = process.env.RADAR_IT_WIX_API_KEY || ''; const SITE = process.env.RADAR_IT_WIX_SITE_ID || ''; const MEMBER = process.env.RADAR_IT_WIX_MEMBER_ID || '';
const IMG = process.env.RADAR_IT_IMAGE_URL || '';
const ON = !!(KEY && SITE && MEMBER);
const c = { ...ctx('wix', {}, { apiKey: KEY, siteId: SITE, memberId: MEMBER }), targetId: SITE };
const api = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`https://www.wixapis.com${path}`, { ...init, headers: { authorization: KEY, 'wix-site-id': SITE, 'content-type': 'application/json', ...(init.headers || {}) } });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const made = new Set<string>();
const p = (o: Parameters<typeof payload>[0]) => payload({ ...o, ...(IMG ? { image: { url: IMG, alt: 'A designer’s desk with a pricing sheet', bytes: async () => { throw new Error('unused'); } } } : { withImage: false }) });

describe.skipIf(!ON)('Wix (live, API key)', () => {
  afterAll(async () => { for (const id of made) await api(`/blog/v3/draft-posts/${id}?permanent=true`, { method: 'DELETE' }); });

  it('Test connection creates a draft and deletes it permanently', async () => {
    const q = async () => ((await api('/blog/v3/draft-posts/query', { method: 'POST', body: JSON.stringify({ query: { filter: { title: { $eq: 'Radar connection test' } } } }) })).body.draftPosts || []).length;
    const before = await q();
    await wix.test(c);
    expect(await q()).toBe(before);
  });

  it('creates a draft, publishes it, and the post page shows the formatted article', async () => {
    const slug = `price-design-${RUN}`;
    const pl = p({ slug });
    const d = await wix.createDraft(c, pl); made.add(d.id);
    const draft = (await api(`/blog/v3/draft-posts/${d.id}?fieldsets=RICH_CONTENT`)).body.draftPost;
    expect(draft).toMatchObject({ title: pl.title, seoSlug: slug, memberId: MEMBER, status: 'UNPUBLISHED' });
    expect(JSON.stringify(draft.richContent)).toContain('Work out your floor');
    expect(draft.richContent.nodes.some((n: any) => n.type === 'HEADING')).toBe(true);
    if (IMG) expect(draft.media?.wixMedia?.image).toBeTruthy();
    const { url } = await wix.publish(c, pl, d);
    expect(url).toMatch(new RegExp(`/${slug}$`));
    const live = await page(url);
    if (live.status === 200) expect(live.html).toContain('Work out your floor');
  });

  it('a refresh updates the same post in place; a taken slug gets "-2" and leaves the other post alone', async () => {
    const slug = `refresh-${RUN}`;
    const first = p({ slug });
    const d1 = await wix.createDraft(c, first); made.add(d1.id);
    const { url } = await wix.publish(c, first, d1);
    const again = p({ slug: `other-${RUN}`, title: 'How to price a design project (2026 update)', mode: 'refresh', refreshUrl: url, canonical: url });
    const d2 = await wix.createDraft(c, again);
    expect(d2.id).toBe(d1.id);
    expect((await wix.publish(c, again, d2)).url).toBe(url);
    expect((await api(`/blog/v3/posts/slugs/${slug}`)).body.post).toMatchObject({ id: d1.id, title: 'How to price a design project (2026 update)' });

    const dup = await wix.createDraft(c, p({ slug, title: 'A different article' })); made.add(dup.id);
    expect(dup.id).not.toBe(d1.id);
    expect((await api(`/blog/v3/draft-posts/${dup.id}`)).body.draftPost.seoSlug).toBe(`${slug}-2`);
  });
});
