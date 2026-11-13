// Several analyses at once in one process, as the worker runs them (WORKER_CONCURRENCY is 4): an ordinary site B beside
// hostile ones. Is B's crawl and brand detection the same as when it runs alone, and how much later?
// npx tsx .factory/bounded-page-parse/qa/queue.mjs
import { load, serve, html, linking, monitor, log, timed, describeError, children, sleep } from './lib.mjs';
const { crawlSite, detectBrand } = await load();
let unhandled = 0; process.on('unhandledRejection', e => { unhandled++; log({ unhandledRejection: String(e) }); });
const warnings = []; console.warn = (...a) => warnings.push(a.join(' ').slice(0, 120));
const robots = { type: 'text/plain', body: 'User-agent: *\nAllow: /\n' };
// B: a home page and 30 pages, a sitemap, a logo candidate that is not there, colours in the page.
const bPaths = Array.from({ length: 30 }, (_, i) => `/b-${i}`);
const B = { '/robots.txt': robots, '/sitemap.xml': { type: 'application/xml', body: `<urlset>${bPaths.map(p => `<url><loc>https://b.example${p}</loc></url>`).join('')}</urlset>` }, '/': html(`<!doctype html><html lang="en-GB"><head><title>B</title><style>:root{--brand-primary:#2563eb;--accent:#f59e0b}</style><link rel="icon" href="/icon.svg" sizes="any"></head><body><header><svg viewBox="0 0 1 1"><path fill="#0f766e"/></svg></header><h1>B</h1>${bPaths.slice(0, 10).map(p => `<a href="${p}">${p}</a>`).join('')}</body></html>`) };
for (const p of bPaths) B[p] = linking('B ' + p, ['/']);
// Hostile sites. SLOW: every page takes the reader about 3 s and is read (never "unreadable", so the crawl never gives up).
const SLOW = html(`<!doctype html><html><body>${'<a><table>'.repeat(80_000)}</body></html>`);
const STALL = html(`<!doctype html><html><body>${'<div>'.repeat(64_000)}`);
const slowSite = n => { const s = { '/robots.txt': robots, '/': linking('Slow', Array.from({ length: n }, (_, i) => `/s-${i}`)) }; for (let i = 0; i < n; i++) s[`/s-${i}`] = SLOW; return s; };
const stallSite = { '/robots.txt': robots, '/': linking('Stall', ['/x1', '/x2', '/x3', '/x4', '/x5']), '/x1': STALL, '/x2': STALL, '/x3': STALL, '/x4': STALL, '/x5': STALL };
const SITES = { 'b.example': B, 'slow1.example': slowSite(8), 'slow2.example': slowSite(8), 'slow3.example': slowSite(8), 'stall.example': stallSite };
serve(url => { const s = SITES[url.host]; return s ? s[url.pathname] : { fail: true }; });
const analyseB = async () => { const began = performance.now(); const crawl = await crawlSite('b.example'); const brand = await detectBrand('qa', crawl.homeHtml, crawl.origin); return { ms: Math.round(performance.now() - began), result: JSON.stringify({ pages: crawl.pages.map(p => ({ ...p, html: undefined })), brand: { ...brand, logo: brand.logo && 'stored' } }), pages: crawl.pages.length }; };

const alone = await analyseB();
log({ scenario: 'B alone', ms: alone.ms, pages: alone.pages });
for (const [name, others] of [
  ['B beside one crawl whose 8 pages each take the reader about 3 s', ['slow1.example']],
  ['B beside three such crawls (the worker runs four jobs at once)', ['slow1.example', 'slow2.example', 'slow3.example']],
  ['B beside a crawl of stalling pages (gives up after three) and a brand detection on a stalling home page', ['stall.example', 'brand:stall']],
]) {
  warnings.length = 0; const watch = monitor(); const began = performance.now();
  const rest = others.map(o => o.startsWith('brand:') ? timed(() => detectBrand('qa2', STALL.body, 'https://stall.example')) : timed(() => crawlSite(o)));
  await sleep(200); // the others are already under way
  const b = await timed(analyseB);
  const bDone = Math.round(performance.now() - began);
  const done = await Promise.all(rest);
  log({ scenario: name, B: b.error ? describeError(b.error) : `${b.value.pages} pages in ${b.value.ms} ms`, sameAsAlone: b.value ? b.value.result === alone.result : false, delayMs: b.value ? b.value.ms - alone.ms : null, others: done.map(d => d.error ? describeError(d.error) : d.value.pages ? `${d.value.pages.length} page(s) in ${d.ms} ms` : `brand ${JSON.stringify(d.value).slice(0, 60)} in ${d.ms} ms`), allDoneMs: Math.round(performance.now() - began), ...watch.stop(), warnings: [...warnings] });
}
log({ done: true, unhandled, readersStarted: children.length });
