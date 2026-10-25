// Live: the real Ghost connector against a real Ghost 5.x (scripts/connectors/ghost-up.sh).
// Skipped unless RADAR_IT_GHOST_URL is set (source .data/connectors/harness.env).
import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { ghost } from './ghost';
import { PublishError } from '../http';
import { H, RUN, ctx, expectRendered, page, payload } from './live-fixtures';

const ON = !!H.ghostUrl;
const c = ctx('ghost', { url: H.ghostUrl }, { key: H.ghostKey });
const [kid, secret] = H.ghostKey.split(':');
const jwt = (exp: string, iat?: number) => {
  const j = new SignJWT({}).setProtectedHeader({ alg: 'HS256', kid, typ: 'JWT' }).setAudience('/admin/').setExpirationTime(exp);
  return (iat ? j.setIssuedAt(iat) : j.setIssuedAt()).sign(Buffer.from(secret || '00', 'hex'));
};
const admin = async (path: string, token?: string) => {
  const r = await fetch(`${H.ghostUrl}/ghost/api/admin${path}`, { headers: { authorization: `Ghost ${token || (await jwt('5m'))}`, 'accept-version': 'v5.0' } });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const bySlug = async (slug: string) => (await admin(`/posts/?filter=${encodeURIComponent(`slug:${slug}`)}&formats=html`)).body.posts as any[];
const err = async (p: Promise<any>) => { try { await p; } catch (e) { return e as PublishError; } throw new Error('expected a PublishError'); };

describe.skipIf(!ON)('Ghost (live)', () => {
  it('Test connection creates a draft and deletes it', async () => {
    const count = async () => (await admin(`/posts/?filter=${encodeURIComponent("title:'Radar connection test'")}&limit=all`)).body.posts.length;
    const before = await count();
    await ghost.test(c);
    expect(await count()).toBe(before);
  });

  it('creates a draft, publishes it without e-mailing members, and the public URL serves the formatted post', async () => {
    const slug = `price-design-${RUN}`;
    const p = payload({ slug });
    const d = await ghost.createDraft(c, p);
    const draft = (await admin(`/posts/${d.id}/`)).body.posts[0];
    expect(draft.status).toBe('draft');
    expect(draft.slug).toBe(slug);

    const { url } = await ghost.publish(c, p, d);
    expect(url).toBe(`${H.ghostUrl}/${slug}/`);
    const post = (await admin(`/posts/${d.id}/?include=email,newsletter&formats=html`)).body.posts[0];
    expect(post.status).toBe('published');
    expect(post.title).toBe(p.title);
    expect(post.custom_excerpt).toBe(p.meta);
    expect(post.meta_description).toBe(p.meta);
    expect(post.meta_title).toBe(p.seoTitle);
    expect(post.feature_image).toMatch(new RegExp(`^${H.ghostUrl}/content/images/.+\\.png$`));
    expect(post.feature_image_alt).toBe(p.image!.alt);
    // No newsletter: Ghost only e-mails when the publish request names one (?newsletter=…), which Radar never sends.
    expect(post.newsletter ?? null).toBeNull();
    expect(post.email ?? null).toBeNull();
    expect(post.email_segment).toBe('all');
    expect(post.canonical_url ?? null).toBeNull();

    const live = await page(url);
    expect(live.status).toBe(200);
    expect(live.html).toContain(p.title);
    expectRendered(live.html, expect);
    expect(live.html).toContain(post.feature_image.replace(H.ghostUrl, ''));
    expect(live.html).toContain(p.image!.alt.replace('’', '&#x27;').replace("'", '&#x27;').slice(0, 10));
    expect((await page(post.feature_image)).status).toBe(200);
  });

  it('a refresh updates the same post in place (same id and URL, no duplicate)', async () => {
    const slug = `refresh-${RUN}`;
    const first = payload({ slug, withImage: false });
    const d1 = await ghost.createDraft(c, first);
    const { url } = await ghost.publish(c, first, d1);

    const again = payload({ slug: `refresh-new-slug-${RUN}`, title: 'How to price a design project (2026 update)', mode: 'refresh', refreshUrl: url, canonical: url, withImage: false });
    again.html = again.html.replace('Clients compare totals', 'Updated: clients compare totals');
    const d2 = await ghost.createDraft(c, again);
    expect(d2.id).toBe(d1.id);
    const r = await ghost.publish(c, again, d2);
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
    const d = await ghost.createDraft(c, p);
    await ghost.publish(c, p, d);
    const r = await ghost.publish(c, p, d);
    expect(r.url).toBe(`${H.ghostUrl}/${slug}/`);
    expect(await bySlug(slug)).toHaveLength(1);
  });

  it('a taken slug gets Ghost\'s next free slug, and Radar records the real URL', async () => {
    const slug = `collide-${RUN}`;
    const a = payload({ slug, withImage: false }); const b = payload({ slug, withImage: false });
    const ua = (await ghost.publish(c, a, await ghost.createDraft(c, a))).url;
    const ub = (await ghost.publish(c, b, await ghost.createDraft(c, b))).url;
    expect(ua).toBe(`${H.ghostUrl}/${slug}/`);
    expect(ub).toBe(`${H.ghostUrl}/${slug}-2/`);
    expect((await page(ub)).status).toBe(200);
  });

  it('a key with the wrong secret is a 401 (→ "Needs reconnecting" on publish)', async () => {
    const e = await err(ghost.test(ctx('ghost', { url: H.ghostUrl }, { key: `${kid}:${'ab'.repeat(32)}` })));
    expect(e.http).toBe(401);
    expect(e.retryable).toBe(false);
  });

  it('an unknown key id is a 401', async () => {
    const e = await err(ghost.test(ctx('ghost', { url: H.ghostUrl }, { key: `${'0'.repeat(24)}:${secret}` })));
    expect(e.http).toBe(401);
  });

  it('a malformed key fails before any request (401)', async () => {
    const e = await err(ghost.test(ctx('ghost', { url: H.ghostUrl }, { key: 'not-a-key' })));
    expect(e.http).toBe(401);
  });

  it('JWT: the connector\'s 5-minute token (fresh iat) works; Ghost rejects a token issued more than 5 minutes ago', async () => {
    expect((await admin('/posts/?limit=1', await jwt('5m'))).status).toBe(200);
    // Ghost enforces a 5-minute maxAge on iat (not on exp - iat): every request must carry a freshly signed token,
    // which is what the connector does (headers() signs a new one per call).
    const old = Math.floor(Date.now() / 1000) - 6 * 60;
    expect((await admin('/posts/?limit=1', await jwt('10m', old))).status).toBe(401);
  });

  it('an unreachable host is a network failure (http 0)', async () => {
    const e = await err(ghost.test(ctx('ghost', { url: 'http://localhost:1' }, { key: H.ghostKey })));
    expect(e.http).toBe(0);
    expect(e.retryable).toBe(true);
  });

  it('a URL that isn\'t a Ghost site is a readable 404', async () => {
    const e = await err(ghost.test(ctx('ghost', { url: H.ghostUrl + '/no-such-blog' }, { key: H.ghostKey })));
    expect(e.http).toBe(404);
  });
});
