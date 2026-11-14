// What a crawl keeps in the calling process when every page's answer is large: a site whose pages sit at addresses of
// 2,000 characters and each hold 50,000 short relative links (0.57 MB of HTML per page; each read takes about a second,
// so none is "unreadable"). One line per batch of pages read: pages so far, this process's heap and resident memory,
// and how late its 10 ms timer has been.
//   node --max-old-space-size=1536 --import tsx .factory/bounded-page-parse/qa/grow.mjs [pages=100] [links=50000] [address=2000]
import { load, serve, html, monitor, log, DOMAIN } from './lib.mjs';
const [pagesWanted = 100, links = 50_000, address = 2_000] = process.argv.slice(2).map(Number);
const { crawlSite } = await load();
const b36 = i => i.toString(36);
const LONG = 'A'.repeat(address);
const body = `<!doctype html><html><head><title>p</title></head><body>${Array.from({ length: links }, (_, i) => `<a href=${b36(i)}>`).join('')}</body></html>`;
const home = `<!doctype html><html><head><title>Home</title></head><body>${Array.from({ length: pagesWanted }, (_, i) => `<a href="/${LONG}/${i}/x">${i}</a>`).join('')}</body></html>`;
serve(url => url.pathname === '/' ? html(home) : url.pathname === '/robots.txt' || url.pathname === '/sitemap.xml' ? { status: 404, body: '' } : url.pathname.endsWith('/x') ? html(body) : { status: 404, body: '' });
log({ pageKb: Math.round(Buffer.byteLength(body) / 1024), links, addressCharacters: address, heapLimitMb: Math.round((await import('node:v8')).getHeapStatistics().heap_size_limit / 1048576) });
const watch = monitor(); const began = performance.now();
const warn = console.warn; console.warn = (...a) => log({ warning: a.join(' ').slice(0, 200) });
try {
  const crawl = await crawlSite(DOMAIN, n => { const m = process.memoryUsage(); log({ pages: n, s: Math.round((performance.now() - began) / 100) / 10, heapUsedMb: Math.round(m.heapUsed / 1048576), rssMb: Math.round(m.rss / 1048576), lateMs: Math.round(watch.late) }); });
  log({ finished: crawl.pages.length, linksKeptMb: Math.round(crawl.pages.reduce((n, p) => n + p.links.reduce((k, l) => k + l.length, 0), 0) / 1048576) });
} catch (e) { log({ threw: String(e && e.message || e) }); }
console.warn = warn; watch.stop();
