// The numbers the brief and pageReader.ts state, measured: cold start, ordinary 1.5 MB pages, what fits under the heap cap.
// npx tsx .factory/bounded-page-parse/qa/claims.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { load, children, alive, sleep, log, O, timed, describeError, watchMemory, ROOT } from './lib.mjs';
const { reader } = await load();
const fx = await import(path.join(ROOT, 'src/server/services/analysis/stalling.fixtures.ts'));
const same = await import(path.join(ROOT, 'src/server/services/analysis/sameAsMain.fixtures.ts'));
const stats = a => { const s = [...a].sort((x, y) => x - y); return { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] }; };
const map = o => reader.readSitemap('<urlset/>', O + '/s.xml', 'site.example', o);
const stop = async () => { await map({ idleMs: 1 }); const c = children[children.length - 1]; while (alive(c.pid)) await sleep(5); };

// Cold start: the first read of an empty sitemap by a reader that has to be started.
const cold = []; for (let i = 0; i < 12; i++) { await stop(); const t = performance.now(); await map(); cold.push(Math.round(performance.now() - t)); }
const bare = []; for (let i = 0; i < 12; i++) { const t = performance.now(); execFileSync(process.execPath, ['-e', "require('cheerio')"], { cwd: process.cwd() }); bare.push(Math.round(performance.now() - t)); }
log({ claim: 'a reader costs about 130 ms to start (Node start plus loading cheerio)', firstReadOfAColdReaderMs: stats(cold), nodeStartPlusCheerioMs: stats(bare) });

// Ordinary 1.5 MB pages: the brief says 0.3 s in all (crawler's read plus brand's read).
for (const [name, html] of [['blog index, 4,000 cards', fx.ordinary.blogIndex(4000)], ['shop home page, 2,500 products', same.shopHome(2500)]]) {
  const page = [], brand = [];
  for (let i = 0; i < 7; i++) { let t = performance.now(); await reader.readPage(html, O + '/', O); page.push(Math.round(performance.now() - t)); t = performance.now(); await reader.readBrandPage(html, O); brand.push(Math.round(performance.now() - t)); }
  log({ claim: 'ordinary 1.5 MB pages take about 0.3 s', page: name, mb: Math.round(Buffer.byteLength(html) / 10485.76) / 100, readPageMs: stats(page), readBrandPageMs: stats(brand), bothMedianMs: stats(page).median + stats(brand).median });
}

// The heap-cap comment: what is read ten times running by one reader, how much the reader then holds, and what does not fit.
const rep = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
const wrap = b => `<!doctype html><html><head><title>x</title></head><body>${b}</body></html>`;
const DENSE = {
  '85,000 links (the engineer\'s page)': fx.ordinary.links(),
  '180,000 paragraphs <p>x</p> (1.4 MB)': wrap('<p>x</p>'.repeat(180_000)),
  '150,000 table cells (1.4 MB)': wrap(`<table>${rep(15_000, () => '<tr>' + '<td>c</td>'.repeat(10) + '</tr>')}</table>`),
  '200,000 paragraphs <p>x</p> (1.5 MB)': wrap('<p>x</p>'.repeat(200_000)),
  '250,000 paragraphs <p>x</p> (1.9 MB: "250,000 elements of eight bytes each")': wrap('<p>x</p>'.repeat(250_000)),
  '250,000 <p></p> (1.7 MB)': wrap('<p></p>'.repeat(250_000)),
  '290,000 <b></b> (2.0 MB)': wrap('<b></b>'.repeat(290_000)),
  '160,000 <li><a href> (2.0 MB, a long ordinary menu or index)': wrap(`<ul>${rep(95_000, i => `<li><a href="/p${i}">x</a>`)}</ul>`),
};
for (const [name, html] of Object.entries(DENSE)) {
  if (Buffer.byteLength(html) > 2 * 1024 * 1024) { log({ name, skipped: 'over 2 MB' }); continue; }
  await stop(); await map(); const child = children[children.length - 1];
  const mem = watchMemory(50); const ms = []; let outcome = 'read ten times by one reader';
  for (let i = 0; i < 10; i++) { const r = await timed(() => reader.readPage(html, O + '/p', O)); ms.push(r.ms); if (r.error) { outcome = `read ${i} time(s), then ${describeError(r.error)}`; break; } }
  const brand = await timed(() => reader.readBrandPage(html, O));
  const m = await mem.stop();
  log({ claim: 'heap cap comment', page: name, mb: Math.round(Buffer.byteLength(html) / 10485.76) / 100, outcome, sameReaderThroughout: children[children.length - 1] === child && alive(child.pid), readMs: stats(ms), brandRead: brand.error ? describeError(brand.error) : 'read', readerPeakRssMb: m.readerRssMb });
}
for (const n of [3_000, 30_000]) { await stop(); await map(); const mem = watchMemory(25); const r = await timed(() => reader.readPage(fx.stalling.openFonts(n), O + '/p', O)); log({ claim: 'the page of open formatting elements ends the reader in about a second', fonts: n / 10, paragraphs: n, outcome: r.error ? describeError(r.error) : 'read', ms: r.ms, ...(await mem.stop()) }); }
