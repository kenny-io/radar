// Live: the publisher (publishEntry) end to end with the real WordPress / Ghost / webhook connectors and a real Postgres.
// Needs DATABASE_URL plus the harness env (source .data/connectors/harness.env); each platform is skipped without it.
// Each run creates its own user + business and deletes them afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.RADAR_DEV_STUBS = '1';
  process.env.RADAR_REAL_CONNECTORS = 'wordpress,ghost,webhook';
  process.env.STORAGE_DIR = '.data/test-publish-uploads';
});

import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { encrypt } from '@/server/crypto';
import { connPublic } from '@/server/workspace';
import type { ConnType } from '@/lib/types';
import { publishEntry } from './publisher';
import { connectorFor } from './connectors';
import { PublishError } from './http';
import { BODY, H, RUN, page } from './connectors/live-fixtures';

const S = schema;
const DB = !!process.env.DATABASE_URL;
let uid = ''; let bid = '';
let n = 0;

async function conn(type: ConnType, fields: Record<string, string>, creds: Record<string, any> | null, secret: string | null = null) {
  const [r] = await db.insert(S.connections).values({ businessId: bid, type, url: fields.url || fields.hook, fields, credentialsEnc: creds ? encrypt(creds) : null, secretEnc: secret ? encrypt(secret) : null }).returning();
  return r;
}
async function entry(connId: string, o: { mode?: 'new' | 'refresh'; url?: string | null; slug?: string } = {}) {
  const id = `e_${RUN}_${++n}`;
  const slug = o.slug || `pub-${RUN}-${n}`;
  await db.insert(S.calendarEntries).values({ id, businessId: bid, title: `Pricing freelance design (${n})`, kw: 'price freelance design', type: 'Guide', date: '2026-10-25', mode: o.mode || 'new', url: o.url || null, status: 'scheduled', dest: connId });
  await db.insert(S.articles).values({ entryId: id, businessId: bid, data: {
    entryId: id, generated: true, body: BODY, brief: { angle: '', outline: [], words: 900 }, seo: { title: 'Freelance design pricing guide', meta: 'How to price freelance design work.', slug },
    img: { style: 'branded', seed: 1, prompt: '', alt: 'Pricing sheet on a desk', url: null }, videos: ['dQw4w9WgXcQ'], videoMeta: [{ id: 'dQw4w9WgXcQ', title: 'Pricing design work', channel: 'The Futur', dur: '', views: '', why: '' }],
    sources: [{ title: 'Freelance rates survey 2026', url: 'https://example.org/survey', use: '' }], claims: [],
  } });
  return { id, slug };
}
const row = async (id: string) => (await db.select().from(S.calendarEntries).where(eq(S.calendarEntries.id, id)))[0];
const connRowNow = async (id: string) => (await db.select().from(S.connections).where(eq(S.connections.id, id)))[0];
const run = (id: string, attempt = 1) => publishEntry(id, { attempt, maxAttempts: 4, manual: true });

beforeAll(async () => {
  if (!DB) return;
  const tag = RUN + Math.random().toString(36).slice(2, 6);
  const [u] = await db.insert(S.users).values({ name: 'Publish Test', email: `pub-${tag}@test.local` }).returning();
  uid = u.id;
  const [b] = await db.insert(S.businesses).values({ ownerId: uid, domain: `pub-${tag}.test`, status: 'active', timezone: 'America/New_York', profile: { business: { name: 'Fieldnote' }, brand: { primary: '#1F4D3A', secondary: '#F2B544' } } }).returning();
  bid = b.id;
});
afterAll(async () => {
  if (!DB || !bid) return;
  await db.delete(S.events).where(eq(S.events.businessId, bid));
  await db.delete(S.notifications).where(eq(S.notifications.businessId, bid));
  await db.delete(S.businesses).where(eq(S.businesses.id, bid));
  await db.delete(S.users).where(inArray(S.users.id, [uid]));
});

const PLATFORMS: { type: ConnType; on: boolean; good: () => Promise<any>; bad: () => Promise<any>; down: () => Promise<any>; count: (slug: string) => Promise<number> }[] = [
  {
    type: 'wordpress', on: !!H.wpUrl,
    good: () => conn('wordpress', { url: H.wpUrl, user: H.wpUser }, { pass: H.wpPass }),
    bad: () => conn('wordpress', { url: H.wpUrl, user: H.wpUser }, { pass: 'abcd efgh ijkl mnop qrst uvwx' }),
    down: () => conn('wordpress', { url: 'http://localhost:1', user: H.wpUser }, { pass: H.wpPass }),
    count: async slug => ((await (await fetch(`${H.wpUrl}/wp-json/wp/v2/posts?slug=${slug}&status=publish,draft&context=edit`, { headers: { authorization: 'Basic ' + Buffer.from(`${H.wpUser}:${H.wpPass}`).toString('base64') } })).json()) as any[]).length,
  },
  {
    type: 'ghost', on: !!H.ghostUrl,
    good: () => conn('ghost', { url: H.ghostUrl }, { key: H.ghostKey }),
    bad: () => conn('ghost', { url: H.ghostUrl }, { key: `${H.ghostKey.split(':')[0]}:${'ab'.repeat(32)}` }),
    down: () => conn('ghost', { url: 'http://localhost:1' }, { key: H.ghostKey }),
    count: async slug => (await page(`${H.ghostUrl}/${slug}/`)).status === 200 ? 1 + ((await page(`${H.ghostUrl}/${slug}-2/`)).status === 200 ? 1 : 0) : 0,
  },
  {
    type: 'webhook', on: !!H.hookUrl,
    good: () => conn('webhook', { hook: H.hookUrl }, null, H.hookSecret),
    bad: () => conn('webhook', { hook: H.hookUrl }, null, 'whsec_not-the-receivers-secret-000000'),
    down: () => conn('webhook', { hook: 'https://localhost:1/hook' }, null, H.hookSecret),
    count: async slug => ((await (await fetch(H.hookUrl.replace(/\/hook$/, '/__received'))).json()) as any[]).filter(r => r.verified && r.body?.data?.article?.slug === slug).length,
  },
];

describe.skipIf(!DB)('publishEntry with real connectors (live)', () => {
  for (const P of PLATFORMS) {
    describe.skipIf(!P.on)(P.type, () => {
      let good: any; let firstUrl = '';
      beforeAll(async () => { good = await P.good(); });

      it('publishes an approved article: Published, a working View post URL, the hero image, no leftover draft', async () => {
        const e = await entry(good.id);
        const out = await run(e.id);
        expect(out.status).toBe('published');
        const r = await row(e.id);
        expect(r.status).toBe('published');
        expect(r.publishedUrl).toBe((out as any).url);
        expect(r.publishRemote).toBeNull();
        expect(r.publishError).toBeNull();
        firstUrl = r.publishedUrl!;
        const live = await page(firstUrl);
        expect(live.status).toBe(200);
        expect(live.html).toContain('Work out your floor');
        expect(live.html).toMatch(/youtube(-nocookie)?\.com\/embed\/dQw4w9WgXcQ/);
        if (P.type !== 'webhook') expect(live.html).toMatch(/Pricing sheet on a desk/);
        expect(await P.count(e.slug)).toBe(1);
      });

      it('a retry after a failed publish reuses the saved remote draft: one post, not two', async () => {
        const e = await entry(good.id);
        const k = connectorFor(P.type);
        const created = vi.spyOn(k, 'createDraft');
        const pub = vi.spyOn(k, 'publish').mockRejectedValueOnce(new PublishError(503, 'injected', 'test'));
        await expect(run(e.id, 1)).rejects.toMatchObject({ http: 503 });
        const mid = await row(e.id);
        expect(mid.status).toBe('publishing');
        expect(mid.publishRemote?.connId).toBe(good.id);
        const draftId = mid.publishRemote.id;
        const out = await run(e.id, 2);
        expect(out.status).toBe('published');
        expect(created).toHaveBeenCalledTimes(1);
        expect(pub).toHaveBeenCalledTimes(2);
        expect(pub.mock.calls[1][2].id).toBe(draftId);
        created.mockRestore(); pub.mockRestore();
        expect(await P.count(e.slug)).toBe(1);
      });

      it.skipIf(P.type === 'webhook')('a refresh entry updates the published post in place (same URL)', async () => {
        const e = await entry(good.id, { mode: 'refresh', url: firstUrl, slug: `other-slug-${RUN}-${P.type}` });
        const out = await run(e.id);
        expect(out).toEqual({ status: 'published', url: firstUrl });
        expect(await P.count(`other-slug-${RUN}-${P.type}`)).toBe(0);
        expect((await page(firstUrl)).html).toContain(`Pricing freelance design (${n})`);
      });

      it('a rejected credential fails at once with "{platform} returned 401 Unauthorized" and marks the connection Needs reconnecting', async () => {
        const bad = await P.bad();
        const e = await entry(bad.id);
        const out = await run(e.id);
        expect(out.status).toBe('failed');
        const r = await row(e.id);
        expect(r.status).toBe('failed');
        expect(r.publishError).toMatchObject({ http: 401, message: '401 Unauthorized' });
        const c = connPublic(await connRowNow(bad.id));
        expect(c.status).toBe('error'); // Settings → Publishing shows "Needs reconnecting"
        expect(c.lastError).toBe('401 Unauthorized');
      });

      it('an unreachable host is retried, then fails with "no response from {host}"', async () => {
        const down = await P.down();
        const e = await entry(down.id);
        await expect(run(e.id, 1)).rejects.toMatchObject({ http: 0 });
        expect((await row(e.id)).status).toBe('publishing');
        const out = await run(e.id, 4);
        expect(out.status).toBe('failed');
        expect((await row(e.id)).publishError).toMatchObject({ http: 0, message: 'no response from localhost:1' });
        expect((await connRowNow(down.id)).status).toBe('ok'); // not a credential problem
      });
    });
  }
});
