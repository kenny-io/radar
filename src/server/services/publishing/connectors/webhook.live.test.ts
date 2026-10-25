// Live: the real Webhook connector against the local HTTPS receiver (scripts/connectors/webhook-up.sh), which verifies
// Radar-Signature exactly as docs/webhook.md describes. Skipped unless RADAR_IT_WEBHOOK_URL is set (source
// .data/connectors/harness.env — it also sets NODE_EXTRA_CA_CERTS so Node trusts the receiver's self-signed certificate).
import { describe, expect, it } from 'vitest';
import { webhook } from './webhook';
import { PublishError } from '../http';
import { H, RUN, ctx, expectRendered, page, payload } from './live-fixtures';

const ON = !!H.hookUrl;
const c = ctx('webhook', { hook: H.hookUrl }, {}, H.hookSecret);
const base = H.hookUrl.replace(/\/hook$/, '');
const received = async (id: string) => (await (await fetch(`${base}/__received?id=${encodeURIComponent(id)}`)).json()) as any[];
const err = async (p: Promise<any>) => { try { await p; } catch (e) { return e as PublishError; } throw new Error('expected a PublishError'); };
const DOC_ARTICLE_FIELDS = ['id', 'title', 'slug', 'html', 'markdown', 'meta_description', 'keyword', 'publish_date', 'canonical_url', 'mode', 'refresh_url', 'author', 'featured_image', 'videos', 'sources'];

describe.skipIf(!ON)('Webhook (live)', () => {
  it('Test connection sends a signed radar.test event that verifies', async () => {
    const before = (await received('')).length;
    await webhook.test(c);
    const all = await (await fetch(`${base}/__received`)).json() as any[];
    const last = all[all.length - 1];
    expect(all.length).toBeGreaterThan(before);
    expect(last.verified).toBe(true);
    expect(last.headers['radar-event']).toBe('radar.test');
    expect(last.body).toMatchObject({ type: 'radar.test', data: { business: { domain: 'fieldnote.test', name: 'Fieldnote' }, test: true } });
    expect(last.body.id).toMatch(/^evt_/);
  });

  it('article.published: verified signature, documented headers and every documented field; View post serves it', async () => {
    const slug = `hook-${RUN}`;
    const p = payload({ slug });
    const d = await webhook.createDraft(c, p);
    const { url } = await webhook.publish(c, p, d);
    expect(url).toBe(`${base}/posts/${slug}`);
    const rows = await received(p.entryId);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.verified).toBe(true);
    expect(r.headers['content-type']).toBe('application/json');
    expect(r.headers['user-agent']).toBe('Radar-Webhooks/1.0');
    expect(r.headers['radar-event']).toBe('article.published');
    expect(r.headers['idempotency-key']).toBe(p.entryId);
    expect(r.headers['radar-signature']).toMatch(/^t=\d{10},v1=[0-9a-f]{64}$/);
    expect(Object.keys(r.body).sort()).toEqual(['created', 'data', 'id', 'type']);
    expect(new Date(r.body.created).toISOString()).toBe(r.body.created);
    expect(r.body.data.business).toEqual({ domain: 'fieldnote.test', name: 'Fieldnote' });
    const a = r.body.data.article;
    expect(Object.keys(a).sort()).toEqual([...DOC_ARTICLE_FIELDS].sort());
    expect(a).toMatchObject({ id: p.entryId, title: p.title, slug, meta_description: p.meta, keyword: p.keyword, publish_date: '2026-10-25', canonical_url: null, mode: 'new', refresh_url: null, author: 'Fieldnote' });
    expect(a.featured_image).toEqual({ url: p.image!.url, alt: p.image!.alt });
    expect(a.videos[0]).toEqual({ id: 'dQw4w9WgXcQ', title: 'Pricing design work', channel: 'The Futur', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    expect(a.sources).toHaveLength(2);
    expect(a.markdown).toContain('## Work out your floor');
    const live = await page(url);
    expect(live.status).toBe(200);
    expectRendered(live.html, expect);
  });

  it('a refresh carries mode, refresh_url and canonical_url', async () => {
    const p = payload({ slug: `hook-refresh-${RUN}`, mode: 'refresh', refreshUrl: 'https://fieldnote.test/blog/old', canonical: 'https://fieldnote.test/blog/old', withImage: false });
    await webhook.publish(c, p, await webhook.createDraft(c, p));
    const a = (await received(p.entryId))[0].body.data.article;
    expect(a).toMatchObject({ mode: 'refresh', refresh_url: 'https://fieldnote.test/blog/old', canonical_url: 'https://fieldnote.test/blog/old', featured_image: null });
  });

  it('retries resend the same Idempotency-Key with a fresh event id and signature', async () => {
    const p = payload({ slug: `hook-retry-${RUN}`, withImage: false });
    await webhook.publish(c, p, { id: 'webhook' });
    await webhook.publish(c, p, { id: 'webhook' });
    const rows = await received(p.entryId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(r => r.headers['idempotency-key']))).toEqual(new Set([p.entryId]));
    expect(rows[0].body.id).not.toBe(rows[1].body.id);
  });

  it('a wrong signing secret is rejected by the receiver (401, not retried)', async () => {
    const e = await err(webhook.test(ctx('webhook', { hook: H.hookUrl }, {}, 'whsec_wrong-secret-0000000000000000')));
    expect(e.http).toBe(401);
    expect(e.retryable).toBe(false);
  });

  it('a 5xx from the receiver is retryable; a 4xx is not', async () => {
    const e5 = await err(webhook.test(ctx('webhook', { hook: H.hookUrl + '?status=503' }, {}, H.hookSecret)));
    expect(e5.http).toBe(503); expect(e5.retryable).toBe(true);
    const e4 = await err(webhook.test(ctx('webhook', { hook: H.hookUrl + '?status=400' }, {}, H.hookSecret)));
    expect(e4.http).toBe(400); expect(e4.retryable).toBe(false);
  });

  it('an unreachable endpoint is a network failure; http:// is refused before sending', async () => {
    const e = await err(webhook.test(ctx('webhook', { hook: 'https://localhost:1/hook' }, {}, H.hookSecret)));
    expect(e.http).toBe(0); expect(e.retryable).toBe(true);
    const plain = await err(webhook.test(ctx('webhook', { hook: base.replace('https:', 'http:') + '/hook' }, {}, H.hookSecret)));
    expect(plain.http).toBe(400);
  });
});
