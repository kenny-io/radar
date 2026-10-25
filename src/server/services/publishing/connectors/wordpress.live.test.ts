// Live: the real WordPress connector against a real WordPress 6.x (scripts/connectors/wordpress-up.sh).
// Skipped unless RADAR_IT_WP_URL is set (source .data/connectors/harness.env).
import { describe, expect, it } from 'vitest';
import { wordpress } from './wordpress';
import { PublishError } from '../http';
import { H, RUN, ctx, expectRendered, page, payload } from './live-fixtures';

const ON = !!H.wpUrl;
const c = ctx('wordpress', { url: H.wpUrl, user: H.wpUser }, { pass: H.wpPass });
const auth = { authorization: 'Basic ' + Buffer.from(`${H.wpUser}:${H.wpPass.replace(/\s+/g, '')}`).toString('base64') };
const wp = async (path: string) => (await fetch(`${H.wpUrl}/wp-json/wp/v2${path}`, { headers: auth })).json() as Promise<any>;
const bySlug = async (slug: string) => (await wp(`/posts?slug=${slug}&status=publish,draft,future,pending,private&context=edit`)) as any[];
const err = async (p: Promise<any>) => { try { await p; } catch (e) { return e as PublishError; } throw new Error('expected a PublishError'); };

describe.skipIf(!ON)('WordPress (live)', () => {
  it('Test connection creates a draft and deletes it for good', async () => {
    const before = await wp('/posts?search=Radar%20connection%20test&status=draft,trash&context=edit');
    await wordpress.test(c);
    const after = await wp('/posts?search=Radar%20connection%20test&status=draft,trash&context=edit');
    expect(after.length).toBe(before.length);
  });

  it('creates a draft, publishes it, and the public URL serves the formatted post with its hero image', async () => {
    const slug = `price-design-${RUN}`;
    const p = payload({ slug });
    const d = await wordpress.createDraft(c, p);
    expect(d.id).toMatch(/^\d+$/);
    const draft = await wp(`/posts/${d.id}?context=edit`);
    expect(draft.status).toBe('draft');
    expect(draft.slug).toBe(slug);

    const { url } = await wordpress.publish(c, p, d);
    expect(url).toBe(`${H.wpUrl}/${slug}/`);
    const post = await wp(`/posts/${d.id}?context=edit`);
    expect(post.status).toBe('publish');
    expect(post.title.raw).toBe(p.title);
    expect(post.excerpt.raw).toBe(p.meta);
    // No categories/tags are sent: WordPress files the post under its default category.
    expect(post.categories).toEqual([1]);
    expect(post.tags).toEqual([]);
    expect(post.featured_media).toBeGreaterThan(0);
    const media = await wp(`/media/${post.featured_media}`);
    expect(media.alt_text).toBe(p.image!.alt);
    expect(media.mime_type).toBe('image/png');

    const live = await page(url);
    expect(live.status).toBe(200);
    expect(live.html).toContain(p.title);
    expectRendered(live.html, expect);
    expect(live.html).toContain(media.source_url.replace(/\.png$/, ''));
  });

  it('a refresh updates the same post in place (same id and URL, no duplicate)', async () => {
    const slug = `refresh-${RUN}`;
    const first = payload({ slug, withImage: false });
    const d1 = await wordpress.createDraft(c, first);
    const { url } = await wordpress.publish(c, first, d1);

    const again = payload({ slug: `refresh-new-slug-${RUN}`, title: 'How to price a design project (2026 update)', mode: 'refresh', refreshUrl: url, canonical: url, withImage: false });
    again.html = again.html.replace('Clients compare totals', 'Updated: clients compare totals');
    const d2 = await wordpress.createDraft(c, again);
    expect(d2.id).toBe(d1.id);
    const r = await wordpress.publish(c, again, d2);
    expect(r.url).toBe(url);
    expect(await bySlug(slug)).toHaveLength(1);
    expect(await bySlug(`refresh-new-slug-${RUN}`)).toHaveLength(0);
    const live = await page(url);
    expect(live.html).toContain('2026 update');
    expect(live.html).toContain('Updated: clients compare totals');
  });

  it('publishing the saved draft again (a retry) never makes a second post', async () => {
    const slug = `retry-${RUN}`;
    const p = payload({ slug, withImage: false });
    const d = await wordpress.createDraft(c, p);
    await wordpress.publish(c, p, d);
    const r = await wordpress.publish(c, p, d);
    expect(r.url).toBe(`${H.wpUrl}/${slug}/`);
    expect(await bySlug(slug)).toHaveLength(1);
  });

  it('a taken slug gets WordPress\'s next free slug, and Radar records the real URL', async () => {
    const slug = `collide-${RUN}`;
    const a = payload({ slug, withImage: false }); const b = payload({ slug, withImage: false, entryId: 'e_other' });
    const ua = (await wordpress.publish(c, a, await wordpress.createDraft(c, a))).url;
    const ub = (await wordpress.publish(c, b, await wordpress.createDraft(c, b))).url;
    expect(ua).toBe(`${H.wpUrl}/${slug}/`);
    expect(ub).toBe(`${H.wpUrl}/${slug}-2/`);
    expect((await page(ub)).status).toBe(200);
  });

  it('a wrong application password is a 401 (→ "Needs reconnecting" on publish)', async () => {
    const e = await err(wordpress.test(ctx('wordpress', { url: H.wpUrl, user: H.wpUser }, { pass: 'abcd efgh ijkl mnop qrst uvwx' })));
    expect(e).toBeInstanceOf(PublishError);
    expect(e.http).toBe(401);
    expect(e.retryable).toBe(false);
  });

  it('an unknown user is a 401 too', async () => {
    const e = await err(wordpress.test(ctx('wordpress', { url: H.wpUrl, user: 'nobody' }, { pass: H.wpPass })));
    expect(e.http).toBe(401);
  });

  it('a site URL that isn\'t WordPress is a readable 404', async () => {
    const e = await err(wordpress.test(ctx('wordpress', { url: H.wpUrl + '/no-such-blog' }, { pass: H.wpPass })));
    expect(e.http).toBe(404);
  });

  it('an unreachable host is a network failure (http 0), retried by the publisher', async () => {
    const e = await err(wordpress.test(ctx('wordpress', { url: 'http://localhost:1', user: H.wpUser }, { pass: H.wpPass })));
    expect(e.http).toBe(0);
    expect(e.kind).toBe('network');
    expect(e.retryable).toBe(true);
    expect(e.line).toBe('no response from localhost:1');
  });

  it.skipIf(!H.wpAuthor)('an Author refreshing a post they can\'t edit gets a 403 — never a second post', async () => {
    const ac = ctx('wordpress', { url: H.wpUrl, user: H.wpAuthor }, { pass: H.wpAuthorPass });
    const slug = `owner-post-${RUN}`;
    const first = payload({ slug, withImage: false });
    const { url } = await wordpress.publish(c, first, await wordpress.createDraft(c, first));
    const again = payload({ slug: `author-copy-${RUN}`, mode: 'refresh', refreshUrl: url, canonical: url, withImage: false });
    const d = await wordpress.createDraft(ac, again);
    const e = await err(wordpress.publish(ac, again, d));
    expect(e.http).toBe(403); // the account's role is too low (Editor or higher can refresh others' posts)
    expect(await bySlug(`author-copy-${RUN}`)).toHaveLength(0);
    expect(await bySlug(slug)).toHaveLength(1);
  });

  it.skipIf(!H.wpAuthor)('an Author-role account (no unfiltered_html) still gets the video, headings, lists and sources', async () => {
    const ac = ctx('wordpress', { url: H.wpUrl, user: H.wpAuthor }, { pass: H.wpAuthorPass });
    const slug = `author-${RUN}`;
    const p = payload({ slug, withImage: false });
    const { url } = await wordpress.publish(ac, p, await wordpress.createDraft(ac, p));
    const live = await page(url);
    expect(live.status).toBe(200);
    expectRendered(live.html, expect);
  });
});
