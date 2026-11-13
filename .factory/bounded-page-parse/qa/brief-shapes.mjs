// AC2, AC3, AC4 on the brief's own table (the engineer's stalling.fixtures.ts), with the limit every document gets:
// each page through readPage, readBrandPage and readSitemap, then as a crawled page and as the home page of a crawl
// and through detectBrand; the two sitemap shapes through readSitemap and as the sitemap of a crawl.
// npx tsx .factory/bounded-page-parse/qa/brief-shapes.mjs
import path from 'node:path';
import { load, serve, html, xml, linking, monitor, timed, describeError, log, sleep, O, DOMAIN, ROOT, children } from './lib.mjs';
const { crawlSite, detectBrand, reader } = await load();
const { stalling } = await import(path.join(ROOT, 'src/server/services/analysis/stalling.fixtures.ts'));
let unhandled = 0; process.on('unhandledRejection', () => { unhandled++; }); process.on('uncaughtException', () => { unhandled++; });
console.warn = () => {};
const robots = { type: 'text/plain', body: 'User-agent: *\nAllow: /\n' };
const PAGES = { '100,000 <style>': stalling.styleElements(), '60,000 <img> in a <header>': stalling.headerImages(), '45,000 stylesheet links': stalling.stylesheetLinks(), 'header SVG nested 64,000 deep': stalling.deepHeaderSvg(), '64,000 nested <div>': stalling.nestedDivs(), '16,000 nested <div>, then 16,000 <img>': stalling.nestedDivsThenImages(), '100,000 nested <span> with text': stalling.nestedSpans(), '300 open <font>, then 3,000 <p>': stalling.openFonts(3_000), '3,000 open <font>, then 30,000 <p> (173 KB)': stalling.openFonts(30_000) };
const MAPS = { 'sitemap: one address under 200,000 nested elements': stalling.deepSitemap(), 'sitemap: a <loc> inside 64,000 nested <url>': stalling.nestedSitemap() };
const run = async (page, how, work) => { await sleep(30); const watch = monitor(); const r = await timed(work); await sleep(20); const loop = watch.stop(); log({ page, how, ms: r.ms, withinLimitPlus1s: r.ms < 6000, outcome: r.error ? describeError(r.error).replace('The document could not be read: ', '').slice(0, 60) : (r.value.pages ? `${r.value.pages.length} page(s)` : r.value.logo !== undefined ? `brand: ${JSON.stringify(r.value).slice(0, 70)}` : 'read'), lateMs: loop.lateMs, timerNeverMoreThan100msLate: loop.lateMs <= 100 }); };
for (const [name, text] of Object.entries(PAGES)) {
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('over 2 MB: ' + name);
  await run(name, 'readPage', () => reader.readPage(text, O + '/p', O));
  await run(name, 'readBrandPage', () => reader.readBrandPage(text, O));
  await run(name, 'readSitemap', () => reader.readSitemap(text, O + '/sitemap.xml', 'site.example'));
  serve({ '/': html(text), '/robots.txt': robots }); await run(name, 'crawlSite, as the home page', () => crawlSite(DOMAIN));
  serve({ '/': linking('Home', ['/h']), '/robots.txt': robots, '/h': html(text) }); await run(name, 'crawlSite, as a crawled page', () => crawlSite(DOMAIN));
  serve({}); await run(name, 'detectBrand', () => detectBrand('qa', text, O));
}
for (const [name, text] of Object.entries(MAPS)) {
  await run(name, 'readSitemap', () => reader.readSitemap(text, O + '/sitemap.xml', 'site.example'));
  serve({ '/': linking('Home', []), '/robots.txt': robots, '/sitemap.xml': xml(text) }); await run(name, 'crawlSite, as the sitemap', () => crawlSite(DOMAIN));
}
log({ done: true, unhandledInCaller: unhandled, callerStillRunning: true, readersStarted: children.length });
