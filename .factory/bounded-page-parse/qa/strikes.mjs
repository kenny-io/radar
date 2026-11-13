// The outcomes of the brief through crawlSite with the limit every document gets (5 s): a crawl stops after three
// unreadable documents (pages and sitemaps together) and returns what it has; how long that takes; and whether the
// exported patterns are the ones the base exports.
import path from 'node:path';
import { load, serve, html, xml, linking, monitor, log, timed, describeError, asked, DOMAIN, O, ROOT } from './lib.mjs';
const { crawlSite } = await load();
const crawl = await import(path.join(ROOT, 'src/server/services/analysis/crawl.ts'));
log({ ARTICLE_PATH: String(crawl.ARTICLE_PATH), LISTING_PATH: String(crawl.LISTING_PATH), uaToken: crawl.uaToken(), exports: Object.keys(crawl).sort().join(' ') });
if (!crawl.default && process.argv[2] !== 'crawl') process.exit(0);
const warnings = []; console.warn = (...a) => warnings.push(a.join(' ').slice(0, 120));
const STALL = `<!doctype html><html><body>${'<div>'.repeat(64_000)}`, OOM = `<!doctype html><html><body><p>${Array.from({ length: 3000 }, (_, i) => `<font size="${i}">`).join('')}${'<p>x'.repeat(30_000)}`, THROWS = `<!doctype html><html><body><main>${'<span>'.repeat(12_000)}text</main></body></html>`;
const robots = maps => ({ type: 'text/plain', body: `User-agent: *\nAllow: /\n${maps.map(m => `Sitemap: ${O}${m}\n`).join('')}` });
for (const [name, site] of [
  ['a stalling sitemap, then a stalling page and an out-of-memory page among six', { '/': linking('Home', ['/p1', '/p2', '/p3', '/p4', '/p5', '/p6']), '/robots.txt': robots(['/s.xml']), '/s.xml': xml(`<urlset>${'<url>'.repeat(64_000)}<loc>/x</loc>`), '/p1': linking('One', ['/from-one']), '/p2': html(STALL), '/p3': html(OOM), '/p4': linking('Four', []), '/p5': linking('Five', []), '/p6': linking('Six', []), '/from-one': linking('From one', []) }],
  ['three stalling sitemaps and a fourth good one', { '/': linking('Home', ['/a']), '/robots.txt': robots(['/1.xml', '/2.xml', '/3.xml', '/4.xml']), '/1.xml': xml(`<urlset>${'<a>'.repeat(400_000)}`), '/2.xml': xml(`<urlset>${'<a>'.repeat(400_000)}`), '/3.xml': xml(`<urlset>${'<a>'.repeat(400_000)}`), '/4.xml': xml(`<urlset><url><loc>${O}/from-four</loc></url></urlset>`), '/a': linking('A', []) }],
  ['two pages cheerio throws on, then good ones', { '/': linking('Home', ['/t1', '/t2', '/g1', '/g2']), '/robots.txt': robots([]), '/t1': html(THROWS), '/t2': html(THROWS), '/g1': linking('G1', []), '/g2': linking('G2', []) }],
  ['every page but the home page stalls (ten of them)', Object.fromEntries([['/', linking('Home', Array.from({ length: 10 }, (_, i) => `/s${i}`))], ['/robots.txt', robots([])], ...Array.from({ length: 10 }, (_, i) => [`/s${i}`, html(STALL)])])],
]) {
  warnings.length = 0; serve(site); const watch = monitor();
  const r = await timed(() => crawlSite(DOMAIN));
  log({ scenario: name, outcome: r.error ? describeError(r.error) : r.value.pages.map(p => p.path).join(' '), ms: r.ms, ...watch.stop(), asked: [...asked], warnings: [...warnings] });
}
