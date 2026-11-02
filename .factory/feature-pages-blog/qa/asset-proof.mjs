// Independent post-deploy proof: public GETs only, byte-match all declared preview assets.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const base = process.env.BASE_URL || 'https://radar.thally.io';
const local = JSON.parse(await fs.readFile('.factory/feature-pages-blog/qa/local-results.json', 'utf8'));
const result = { atUTC: new Date().toISOString(), revision: process.env.QA_REVISION || 'unspecified', base, assets: [] };
for (const image of local.images) {
  const pathname = new URL(image.url).pathname; assert.match(pathname, /^\/social\/[a-z0-9-]+\.png$/);
  const response = await fetch(new URL(pathname, base), { signal: AbortSignal.timeout(20000) }); const actual = Buffer.from(await response.arrayBuffer()); const expected = await fs.readFile(path.join('public', pathname.slice(1)));
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /^image\/png/); assert(!/noindex/.test(response.headers.get('x-robots-tag') || '')); assert(actual.equals(expected), 'asset differs from tested source: ' + pathname);
  result.assets.push({ pathname, bytes: actual.length, sha256: createHash('sha256').update(actual).digest('hex'), matchesTestedSource: true, contentType: response.headers.get('content-type'), xRobots: response.headers.get('x-robots-tag') });
}
assert.equal(result.assets.length, 18);
const feed = await fetch(new URL('/blog/rss.xml', base), { signal: AbortSignal.timeout(20000) }); const xml = await feed.text(); assert.equal(feed.status, 200); assert.match(feed.headers.get('content-type'), /application\/rss\+xml/); assert.equal([...xml.matchAll(/<item>/g)].length, 5); assert(!feed.headers.get('set-cookie'));
result.feed = { status: feed.status, contentType: feed.headers.get('content-type'), bytes: Buffer.byteLength(xml), items: 5, sha256: createHash('sha256').update(xml).digest('hex'), cache: feed.headers.get('cache-control'), prerendered: feed.headers.get('x-nextjs-prerender') };
const health = await fetch(new URL('/api/health', base), { signal: AbortSignal.timeout(20000) }); assert.equal(health.status, 200); const body = await health.json(); assert.equal(body.ok, true); result.readiness = { status: health.status, body };
await fs.writeFile(process.env.QA_OUTPUT || '.factory/feature-pages-blog/qa/live-asset-proof.json', JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ revision: result.revision, assets: result.assets.length, matches: true, feed: result.feed, readiness: result.readiness }, null, 2));
