// Every hostile document of docs.mjs through crawlSite and detectBrand, with the real five-second limit:
//   home    the document is the site's home page                         (expected: CrawlError('unreachable') or a crawl)
//   page    the home page is ordinary and links to the document          (expected: a crawl of 1 or 2 pages)
//   brand   detectBrand on the document                                  (expected: a result, never a throw)
//   sitemap the document is the site's sitemap (docs.mjs sitemaps)       (expected: a crawl)
// npx tsx .factory/bounded-page-parse/qa/crawl-hostile.mjs home|page|brand|sitemap [name filter]
import { load, serve, html, xml, linking, monitor, timed, describeError, watchMemory, children, mb, log, sleep, O, DOMAIN, asked } from './lib.mjs';
import { pages, sitemaps, invalidUtf8 } from './docs.mjs';
const [mode = 'home', filter = ''] = process.argv.slice(2);
const { crawlSite, detectBrand } = await load();
const docs = mode === 'sitemap' ? { ...sitemaps, 'sitemap: invalid UTF-8': invalidUtf8 } : { ...pages, 'bytes: invalid UTF-8': invalidUtf8 };
let unhandled = 0; process.on('unhandledRejection', e => { unhandled++; log({ unhandledRejection: String(e) }); }); process.on('uncaughtException', e => { unhandled++; log({ uncaughtException: String(e) }); });
const warnings = []; console.warn = (...a) => { warnings.push(a.join(' ').slice(0, 160)); };
const robots = { type: 'text/plain', body: 'User-agent: *\nAllow: /\n' };
for (const [name, make] of Object.entries(docs)) {
  if (filter && !name.includes(filter)) continue;
  const body = make(); const size = Buffer.byteLength(body);
  if (size > 2 * 1024 * 1024) { log({ mode, name, skipped: `over 2 MB: ${size}` }); continue; }
  warnings.length = 0;
  if (mode === 'home') serve({ '/': html(body), '/robots.txt': robots });
  if (mode === 'page') serve({ '/': linking('Home', ['/h']), '/robots.txt': robots, '/h': html(body) });
  if (mode === 'sitemap') serve({ '/': linking('Home', ['/a']), '/robots.txt': { type: 'text/plain', body: `User-agent: *\nAllow: /\nSitemap: ${O}/s.xml\n` }, '/s.xml': xml(body), '/a': linking('A', []) });
  if (mode === 'brand') serve({});
  await sleep(30);
  const mem = watchMemory(50); const watch = monitor();
  const r = await timed(() => mode === 'brand' ? detectBrand('qa', typeof body === 'string' ? body : body.toString('utf8'), O) : crawlSite(DOMAIN));
  await sleep(20);
  const loop = watch.stop(); const memory = await mem.stop();
  const got = r.error ? describeError(r.error) : mode === 'brand' ? JSON.stringify(r.value).slice(0, 120) : `${r.value.pages.length} page(s); links ${r.value.pages.map(p => p.links.length).join('+')}`;
  log({ mode, name, mb: mb(body), ms: r.ms, outcome: got, ...loop, ...memory, asked: asked.length, warnings: [...warnings] });
}
log({ mode, done: true, unhandled, readersStarted: children.length });
