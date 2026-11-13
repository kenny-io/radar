// How large can the reader's answer be, and what does receiving it cost the calling process? One case per process, so
// the memory numbers are that case's alone. Every document is at most 2 MB.
// npx tsx .factory/bounded-page-parse/qa/answers.mjs <case>     (no case: lists them)
import { load, monitor, timed, describeError, watchMemory, children, mb, log, sleep, O } from './lib.mjs';
const rep = (n, f) => { const out = new Array(n); for (let i = 0; i < n; i++) out[i] = f(i); return out.join(''); };
const b36 = i => i.toString(36);
const longPage = (L, N) => ({ kind: 'page', text: `<!doctype html><html><body>${rep(N, i => `<a href=${b36(i)}>`)}</body></html>`, url: `${O}/${'A'.repeat(L)}/x` });
const nestedLocs = k => ({ kind: 'sitemap', text: `<urlset>${'<url><loc>'.repeat(k)}/${'a'.repeat(1_900_000)}` });
const nestedIndex = k => ({ kind: 'sitemap', text: `<sitemapindex>${'<sitemap><loc>'.repeat(k)}${'a'.repeat(1_900_000)}` });
const CASES = {
  'page: 170,000 short links at a short address': () => longPage(1, 170_000),
  'page: 20,000 links at an address of 2,000 characters': () => longPage(2_000, 20_000),
  'page: 50,000 links at an address of 2,000 characters': () => longPage(2_000, 50_000),
  'page: 100,000 links at an address of 2,000 characters': () => longPage(2_000, 100_000),
  'page: 12,000 links at an address of 8,000 characters': () => longPage(8_000, 12_000),
  'page: 25,000 links at an address of 8,000 characters': () => longPage(8_000, 25_000),
  'page: 1,000 links at an address of 100,000 characters': () => longPage(100_000, 1_000),
  'page: 100 links at an address of 1,900,000 characters': () => longPage(1_900_000, 100),
  'page: 200 links at an address of 1,900,000 characters': () => longPage(1_900_000, 200),
  'sitemap: 50 nested <url><loc> round 1.9 MB': () => nestedLocs(50),
  'sitemap: 100 nested <url><loc> round 1.9 MB': () => nestedLocs(100),
  'sitemap: 150 nested <url><loc> round 1.9 MB': () => nestedLocs(150),
  'sitemap: 200 nested <url><loc> round 1.9 MB': () => nestedLocs(200),
  'sitemap: 300 nested <url><loc> round 1.9 MB': () => nestedLocs(300),
  'sitemap: 100 nested <sitemap><loc> round 1.9 MB': () => nestedIndex(100),
  'sitemap: 200 nested <sitemap><loc> round 1.9 MB': () => nestedIndex(200),
  'sitemap: 400 nested <sitemap><loc> round 1.9 MB': () => nestedIndex(400),
  'brand: 2 MB of control characters in a <style>': () => ({ kind: 'brand', text: `<html><head><style>${'\u0001'.repeat(2_000_000)}</style>` }),
  'brand: 60,000 logo images with non-ASCII addresses': () => ({ kind: 'brand', text: `<html><body>${rep(3_300, i => `<img class=logo src="/${b36(i)}${'é'.repeat(300)}">`)}` }),
  'brand: three stylesheet addresses of 0.6 MB, theme and lang of 0.1 MB': () => ({ kind: 'brand', text: `<html lang="${'x'.repeat(100_000)}"><head><meta name="theme-color" content="${'#'.repeat(100_000)}">${rep(3, i => `<link rel="stylesheet" href="/${String(i).repeat(600_000)}">`)}` }),
};
const name = process.argv[2];
if (!name) { for (const n of Object.keys(CASES)) console.log(n); process.exit(0); }
const { reader } = await load();
const c = CASES[name](); const size = Buffer.byteLength(c.text);
if (size > 2 * 1024 * 1024) { log({ name, skipped: `over 2 MB: ${size}` }); process.exit(0); }
await reader.readSitemap('<urlset/>', O + '/s.xml', 'site.example'); // a warm reader, as in the middle of a crawl
await sleep(200); globalThis.gc?.();
const heapBefore = process.memoryUsage().heapUsed;
const mem = watchMemory(25); const watch = monitor();
const r = await timed(() => c.kind === 'page' ? reader.readPage(c.text, c.url, O) : c.kind === 'brand' ? reader.readBrandPage(c.text, O) : reader.readSitemap(c.text, O + '/sitemap.xml', 'site.example'));
await sleep(30);
const loop = watch.stop(); const memory = await mem.stop();
const chars = v => typeof v === 'string' ? v.length : Array.isArray(v) ? v.reduce((n, x) => n + chars(x), 0) : v && typeof v === 'object' ? Object.values(v).reduce((n, x) => n + chars(x), 0) : 0;
const shape = r.value ? Object.fromEntries(Object.entries(r.value).map(([k, v]) => [k, Array.isArray(v) ? `${v.length} entries` : typeof v === 'string' ? `${v.length} chars` : v])) : undefined;
globalThis.gc?.();
log({ name, documentMb: mb(c.text), ms: r.ms, outcome: r.error ? describeError(r.error) : 'read', ...loop, answerMb: Math.round(chars(r.value) / 10485.76) / 100, ...memory, callerHeapHeldMb: Math.round((process.memoryUsage().heapUsed - heapBefore) / 1048576), shape });
