// Round 2, D3: a crawl has 60 s of the reader, by the reader's clock. What counts, what the crawl returns when it runs
// out, and whether an ordinary heavy site stays inside it. One JSON line per scenario.
//   npx tsx .factory/bounded-page-parse/qa/budget.mjs [spent | slow | mixed | two | heavy | heavy-loaded | sitemaps]
import path from 'node:path';
import os from 'node:os';
import { spawn as spawnProcess } from 'node:child_process';
import { load, serve, html, xml, linking, monitor, log, timed, describeError, children, sleep, asked, O, DOMAIN, ROOT } from './lib.mjs';
const which = process.argv[2] || '';
const { crawlSite, reader } = await load();
const fx = await import(path.join(ROOT, 'src/server/services/analysis/stalling.fixtures.ts'));
let unhandled = 0; process.on('unhandledRejection', e => { unhandled++; log({ unhandledRejection: String(e) }); });
const warnings = []; console.warn = (...a) => warnings.push(a.join(' ').slice(0, 140));
const robots = { type: 'text/plain', body: 'User-agent: *\nAllow: /\n' };
const SLOW = n => html(`<!doctype html><html><head><title>Slow</title></head><body>${'<a><table>'.repeat(n)}</body></html>`);
const STALL = html(`<!doctype html><html><body>${'<div>'.repeat(64_000)}`);
const OOM = html(fx.stalling.openFonts(30_000));
const want = w => !which || which === w;
const run = async (scenario, site, domain = DOMAIN) => {
  warnings.length = 0; serve(site); const watch = monitor(); const before = children.length;
  const r = await timed(() => crawlSite(domain));
  return { scenario, outcome: r.error ? describeError(r.error) : `${r.value.pages.length} page(s) read`, crawlMs: r.ms, ...watch.stop(), fetches: asked.length, readersStarted: children.length - before, warnings: [...warnings].slice(-6) };
};

if (want('spent')) {
  // What each kind of read is counted as (the `spent` the crawl adds up), beside what it took by this process's clock.
  const said = async (what, read) => { const got = []; const began = performance.now(); const outcome = await read({ spent: ms => got.push(ms) }).then(() => 'read', e => e.reason || e.message); log({ group: 'spent', what, outcome, countedMs: got, wallMs: Math.round(performance.now() - began) }); };
  await reader.readSitemap('<urlset/>', O + '/s.xml', 'site.example');
  await said('a 100-byte page', o => reader.readPage('<title>x</title>', O + '/p', O, o));
  await said('the 1.5 MB blog index', o => reader.readPage(fx.ordinary.blogIndex(), O + '/p', O, o));
  await said('a page that takes about 3 s', o => reader.readPage(SLOW(80_000).body, O + '/p', O, o));
  await said('a page cheerio throws on', o => reader.readPage(`<html><body><main>${'<span>'.repeat(12_000)}text`, O + '/p', O, o));
  await said('a page whose answer is too large', o => reader.readBrandPage(`<html><head><style>${'\u0001'.repeat(1_900_000)}</style>`, O, o));
  await said('a stalling page', o => reader.readPage(STALL.body, O + '/p', O, o));
  await said('the out-of-memory page (two readers end)', o => reader.readPage(OOM.body, O + '/p', O, o));
  const child = children[children.length - 1]; await reader.readSitemap('<urlset/>', O + '/s.xml', 'site.example');
  const victim = children[children.length - 1]; setTimeout(() => process.kill(victim.pid, 'SIGKILL'), 1500);
  await said('a 3 s page whose reader is killed from outside 1.5 s in (read by a second reader)', o => reader.readPage(SLOW(80_000).body, O + '/p', O, o));
  await said('five 100-byte pages asked for behind a 3 s page: the fifth', async o => { const first = reader.readPage(SLOW(80_000).body, O + '/p', O); const rest = [1, 2, 3, 4].map(() => reader.readPage('<title>x</title>', O + '/p', O)); const fifth = reader.readPage('<title>x</title>', O + '/p', O, o); await Promise.all([first, ...rest]); return fifth; });
}
if (want('slow')) {
  const paths = Array.from({ length: 40 }, (_, i) => `/s-${i}`);
  log(await run('40 pages that each take the reader about 3 s and are read', { '/': linking('Home', paths), '/robots.txt': robots, ...Object.fromEntries(paths.map(p => [p, SLOW(80_000)])) }));
}
if (want('mixed')) {
  const paths = Array.from({ length: 40 }, (_, i) => `/m-${i}`);
  const site = { '/': linking('Home', paths), '/robots.txt': robots, ...Object.fromEntries(paths.map((p, i) => [p, i === 1 || i === 6 ? STALL : SLOW(80_000)])) };
  log(await run('the same with two stalling pages among them (5 s each)', site));
}
if (want('sitemaps')) {
  // Twelve sitemaps that each take the reader 3 to 4 s, named in robots.txt, and 40 pages of about 3 s linked from the home page.
  const slowMap = xml(`<urlset>${'<url>'.repeat(64_000)}<loc>https://site.example/x</loc>`);
  const maps = Array.from({ length: 12 }, (_, i) => `/m${i}.xml`); const paths = Array.from({ length: 40 }, (_, i) => `/q-${i}`);
  const t = await timed(() => reader.readSitemap(slowMap.body, O + '/m.xml', 'site.example')); log({ group: 'sitemaps', oneSuchSitemapMs: t.ms, outcome: t.error ? describeError(t.error) : `read: ${t.value.urls.length} addresses` });
  log(await run('twelve slow sitemaps, then 40 pages of about 3 s', { '/': linking('Home', paths), '/robots.txt': { type: 'text/plain', body: `User-agent: *\nAllow: /\n${maps.map(m => `Sitemap: ${O}${m}\n`).join('')}` }, ...Object.fromEntries(maps.map(m => [m, slowMap])), ...Object.fromEntries(paths.map(p => [p, SLOW(80_000)])) }));
}
if (want('two')) {
  // Two such crawls at once, and an ordinary site of 31 pages beside them: each crawl has its own 60 s, and waiting does not count.
  const slowSite = () => { const paths = Array.from({ length: 40 }, (_, i) => `/s-${i}`); return { '/': linking('Home', paths), '/robots.txt': robots, ...Object.fromEntries(paths.map(p => [p, SLOW(80_000)])) }; };
  const bPaths = Array.from({ length: 30 }, (_, i) => `/b-${i}`); const B = { '/': linking('B', bPaths), '/robots.txt': robots, ...Object.fromEntries(bPaths.map(p => [p, linking('B ' + p, [])])) };
  const SITES = { 'slow1.example': slowSite(), 'slow2.example': slowSite(), 'b.example': B };
  serve(url => { const s = SITES[url.host]; return s ? s[url.pathname] : { fail: true }; });
  warnings.length = 0; const began = performance.now(); const at = () => Math.round(performance.now() - began);
  const one = d => crawlSite(d).then(r => `${r.pages.length} page(s) after ${at()} ms`, e => describeError(e));
  const s1 = one('slow1.example'), s2 = one('slow2.example'); await sleep(200); const b = one('b.example');
  log({ scenario: 'two crawls of 3 s pages at once, and an ordinary 31-page site started 0.2 s after them', slow1: await s1, slow2: await s2, B: await b, warnings: [...warnings] });
}
const heavy = async loaded => {
  // 100 pages of about 1.5 MB each: the blog index of 4,000 cards, a different one per page, and the shop page.
  const paths = Array.from({ length: 99 }, (_, i) => `/blog/page/${i + 2}`);
  const site = { '/': html(fx.ordinary.blogIndex(4000).replace('</main>', paths.map(p => `<a href="${p}">${p}</a>`).join('') + '</main>')), '/robots.txt': robots };
  paths.forEach((p, i) => { site[p] = html(fx.ordinary.blogIndex(4000).replace(/post-/g, `p${i}-`)); });
  let hogs = [];
  if (loaded) hogs = Array.from({ length: os.cpus().length * 2 }, () => spawnProcess(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }));
  try {
    const one = await timed(() => reader.readPage(site['/blog/page/2'].body, O + '/blog/page/2', O));
    const row = await run(`an ordinary heavy site: 100 pages of 1.5 MB${loaded ? `, with ${hogs.length} other processes each keeping a core busy (${os.cpus().length} cores)` : ''}`, site);
    const counted = []; for (const p of paths.slice(0, 10)) await reader.readPage(site[p].body, O + p, O, { spent: ms => counted.push(ms) });
    log({ ...row, onePageMs: one.ms, countedPerPageMs: counted, estimatedReaderTimeFor100PagesS: Math.round(counted.reduce((a, b) => a + b, 0) / counted.length * 100 / 100) / 10 });
  } finally { for (const h of hogs) h.kill('SIGKILL'); }
};
if (want('heavy')) await heavy(false);
if (want('heavy-loaded')) await heavy(true);
log({ done: true, unhandled, readersStarted: children.length });
