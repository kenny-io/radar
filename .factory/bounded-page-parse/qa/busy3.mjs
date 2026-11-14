// Round 2, D1 through crawlSite, with a stretch of caller work that is still longer than the limit now that a page's
// links are bounded: site A has a robots.txt of 10,000 rules and a sitemap of 75,000 addresses (the known robots ×
// addresses cost, out of scope by itself). Site B is ordinary: 13 small pages and a 1.5 MB blog index. B starts just
// after A, so one of its documents is with the reader when A keeps the process.
//   npx tsx .factory/bounded-page-parse/qa/busy3.mjs [ms between A's start and B's, default 150]
import path from 'node:path';
import { load, serve, html, xml, linking, log, sleep, describeError, ROOT } from './lib.mjs';
const { crawlSite } = await load();
const fx = await import(path.join(ROOT, 'src/server/services/analysis/stalling.fixtures.ts'));
let unhandled = 0; process.on('unhandledRejection', e => { unhandled++; log({ unhandledRejection: String(e) }); });
const warnings = []; console.warn = (...a) => { warnings.push(a.join(' ').slice(0, 200)); };
const rules = `User-agent: *\n${Array.from({ length: 10_000 }, (_, i) => `Disallow: /private-area-number-${i}/section/\n`).join('')}`;
const aMap = `<urlset>${Array.from({ length: 75_000 }, (_, i) => `<url><loc>/a${i.toString(36)}</loc></url>`).join('')}</urlset>`;
const bPaths = [...Array.from({ length: 6 }, (_, i) => `/page-${i}`), '/blog', ...Array.from({ length: 6 }, (_, i) => `/page-${i + 6}`)];
const B = { '/': linking('B home', bPaths), '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nAllow: /\n' }, '/blog': html(fx.ordinary.blogIndex()) };
for (const p of bPaths) B[p] ??= linking('B ' + p, []);
for (const gap of process.argv[2] ? [Number(process.argv[2])] : [0, 150, 400, 700]) {
  warnings.length = 0;
  serve(url => url.host === 'a.example' ? (url.pathname === '/' ? linking('A', []) : url.pathname === '/robots.txt' ? { type: 'text/plain', body: rules } : url.pathname === '/sitemap.xml' ? xml(aMap) : undefined) : url.host === 'b.example' ? B[url.pathname] : { fail: true });
  const began = performance.now(); const at = () => Math.round(performance.now() - began);
  let late = 0, last = performance.now(); const tick = setInterval(() => { const now = performance.now(); late = Math.max(late, now - last - 10); last = now; }, 10);
  const a = crawlSite('a.example').then(r => `${r.pages.length} page(s) after ${at()} ms`, e => describeError(e));
  await sleep(gap);
  const b = crawlSite('b.example').then(r => `${r.pages.length} page(s) of 14 after ${at()} ms; the blog index gave ${r.pages.find(p => p.path === '/blog')?.links.length ?? 'nothing'} links`, e => describeError(e));
  const [ra, rb] = await Promise.all([a, b]); clearInterval(tick);
  log({ scenario: `A (10,000 robots rules, a sitemap of 75,000 addresses) and B (ordinary, 14 pages) started ${gap} ms later`, A: ra, B: rb, callerLongestBusyMs: Math.round(late), warnings: [...warnings], expectedForB: '14 page(s), the blog index with 4,003 links' });
}
log({ done: true, unhandled });
