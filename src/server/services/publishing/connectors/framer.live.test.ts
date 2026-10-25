// Live: the real Framer connector against a real Framer project through the Server API (`framer-api`). Skipped unless
// RADAR_IT_FRAMER_URL (https://framer.com/projects/…) and RADAR_IT_FRAMER_KEY (a project API key) are set.
// RADAR_IT_FRAMER_COLLECTION picks the CMS collection id (default: the first user-managed collection).
// Items are created as drafts and removed in afterAll. publish() publishes the WHOLE project (including the owner's unpublished
// editor changes), so the publish case also needs RADAR_IT_FRAMER_PUBLISH=1.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { framer } from './framer';
import { PublishError } from '../http';
import { RUN, ctx, page, payload } from './live-fixtures';
import type { ConnCtx } from '../types';

const URL_ = process.env.RADAR_IT_FRAMER_URL || ''; const KEY = process.env.RADAR_IT_FRAMER_KEY || '';
const ON = !!(URL_ && KEY); const PUBLISH = process.env.RADAR_IT_FRAMER_PUBLISH === '1';
let c: ConnCtx = ctx('framer', { url: URL_ }, { key: KEY });
const made = new Set<string>();
async function items(): Promise<{ id: string; slug: string; draft: boolean }[]> {
  const { connect } = await import('framer-api');
  const f = await connect(URL_, KEY);
  try { const col = await f.getCollection(c.targetId!); return (await col!.getItems()).map(i => ({ id: i.id, slug: i.slug, draft: i.draft })); }
  finally { await f.disconnect(); }
}
const err = async (p: Promise<any>) => { try { await p; } catch (e) { return e as PublishError; } throw new Error('expected a PublishError'); };

describe.skipIf(!ON)('Framer (live)', { timeout: 120_000 }, () => {
  beforeAll(async () => {
    const t = await framer.targets!(c);
    const id = process.env.RADAR_IT_FRAMER_COLLECTION || t[0]?.id;
    expect(t.map(x => x.id)).toContain(id);
    c = { ...c, targetId: id!, target: t.find(x => x.id === id)!.name };
  });
  afterAll(async () => {
    if (!made.size) return;
    const { connect } = await import('framer-api');
    const f = await connect(URL_, KEY);
    try { await (await f.getCollection(c.targetId!))!.removeItems([...made]); } finally { await f.disconnect(); }
  });

  it('Test connection adds a draft item and removes it: the item count is unchanged', async () => {
    const before = (await items()).length;
    await framer.test(c);
    expect((await items()).length).toBe(before);
  });

  it('createDraft makes a draft item; a retry reuses it; another article with the same slug gets slug-2', async () => {
    const slug = `radar-it-${RUN}`;
    const p = payload({ slug, withImage: false });
    const d1 = await framer.createDraft(c, p); made.add(d1.id);
    const d2 = await framer.createDraft(c, p); made.add(d2.id);
    expect(d2.id).toBe(d1.id);
    expect((await items()).filter(i => i.slug === slug)).toEqual([{ id: d1.id, slug, draft: true }]);
    const other = await framer.createDraft(c, payload({ slug, title: 'A different article', withImage: false })); made.add(other.id);
    expect(other.extra.slug).toBe(`${slug}-2`);
    expect(other.id).not.toBe(d1.id);
  });

  it('a refresh finds the item by the refreshUrl slug and does not change it while drafting', async () => {
    const slug = `radar-it-refresh-${RUN}`;
    const d = await framer.createDraft(c, payload({ slug, withImage: false })); made.add(d.id);
    const r = await framer.createDraft(c, payload({ slug: `${slug}-new`, mode: 'refresh', refreshUrl: `https://example.framer.website/blog/${slug}`, withImage: false }));
    expect(r).toEqual({ id: d.id, extra: { slug, refresh: true } });
    expect((await items()).filter(i => i.slug.startsWith(slug))).toHaveLength(1);
  });

  it.skipIf(!PUBLISH)('publish makes the item live, publishes + deploys, and the returned URL serves the post', async () => {
    const p = payload({ slug: `radar-it-live-${RUN}` });
    const d = await framer.createDraft(c, p); made.add(d.id);
    const { url } = await framer.publish(c, p, d);
    expect((await items()).find(i => i.id === d.id)?.draft).toBe(false);
    const live = await page(url);
    expect(live.status).toBe(200);
    expect(live.html).toContain(p.title);
  });

  it('a bad API key is a 401, not retried', async () => {
    const e = await err(framer.test({ ...c, creds: { key: 'fr_invalid_' + RUN } }));
    expect([e.http, e.retryable]).toEqual([401, false]);
  });
});
