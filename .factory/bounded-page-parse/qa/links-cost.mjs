// What the calling process still does per link and per sitemap address, with and without a robots.txt: the longest its
// 10 ms timer was late during a crawl whose home page (or sitemap) carries n addresses. Every other address is a 404.
// npx tsx .factory/bounded-page-parse/qa/links-cost.mjs
import { load, serve, html, xml, monitor, timed, log, sleep, O, DOMAIN, asked } from './lib.mjs';
const { crawlSite } = await load();
const b36 = i => i.toString(36);
const page = n => `<!doctype html><html><head><title>x</title></head><body>${Array.from({ length: n }, (_, i) => `<a href=${b36(i)}>`).join('')}</body></html>`;
const map = n => `<urlset>${Array.from({ length: n }, (_, i) => `<url><loc>/${b36(i)}</loc></url>`).join('')}</urlset>`;
const ROBOTS = { 'no robots.txt': { status: 404, body: '' }, 'a two-line robots.txt': { type: 'text/plain', body: 'User-agent: *\nAllow: /\n' }, 'a robots.txt of 20 rules': { type: 'text/plain', body: 'User-agent: *\n' + Array.from({ length: 20 }, (_, i) => `Disallow: /private-${i}/\n`).join('') } };
for (const [what, n, build] of [['home page links', 4_000, page], ['home page links', 35_000, page], ['home page links', 85_000, page], ['home page links', 160_000, page], ['sitemap addresses', 35_000, map], ['sitemap addresses', 75_000, map]]) {
  for (const [robots, file] of Object.entries(ROBOTS)) {
    const body = build(n); if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error('over 2 MB');
    serve(what.startsWith('home') ? { '/': html(body), '/robots.txt': file } : { '/': html('<html><head><title>h</title></head><body>h</body></html>'), '/robots.txt': file, '/sitemap.xml': xml(body) });
    await sleep(50); const watch = monitor();
    const r = await timed(() => crawlSite(DOMAIN)); await sleep(20);
    log({ what, n, robots, crawlMs: r.ms, ...watch.stop(), fetches: asked.length, pages: r.value?.pages.length });
  }
}
