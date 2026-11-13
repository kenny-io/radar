// Pages that are large but not hostile in shape, as the home page of a crawl and through detectBrand: what the base
// gave and what the branch gives (the heap cap, and the limit for a home page that brand detection needs longer over).
// npx tsx .factory/bounded-page-parse/qa/dense.mjs      (in the branch worktree, and in a checkout of the base)
import { load, serve, html, log, timed, describeError, DOMAIN, O } from './lib.mjs';
const { crawlSite, detectBrand } = await load();
console.warn = () => {};
const wrap = b => `<!doctype html><html lang="en"><head><title>Dense</title><style>:root{--brand:#2563eb}</style></head><body>${b}</body></html>`;
const rep = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
const PAGES = {
  '200,000 <p>x</p> (1.5 MB)': wrap('<p>x</p>'.repeat(200_000)),
  '250,000 <p>x</p> (1.9 MB)': wrap('<p>x</p>'.repeat(250_000)),
  '290,000 <b></b> (1.9 MB)': wrap('<b></b>'.repeat(290_000)),
  '480,000 <li> (1.8 MB)': wrap('<ul>' + '<li>'.repeat(480_000) + '</ul>'),
  '200,000 <option> in a <select> (1.7 MB)': wrap(`<select>${'<option>o'.repeat(200_000)}</select>`),
  '55,000 <img class="logo"> (1.9 MB)': wrap(rep(55_000, i => `<img class="logo" src="/l${i}.png">`)),
  '300 open <font>, then 3,000 <p> (17 KB)': wrap(`<p>${rep(300, i => `<font size="${i}">`)}${'<p>x'.repeat(3_000)}`),
};
for (const [name, body] of Object.entries(PAGES)) {
  if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error('over 2 MB: ' + name);
  serve({ '/': html(body), '/robots.txt': { status: 404, body: '' } });
  const crawl = await timed(() => crawlSite(DOMAIN));
  serve({});
  const brand = await timed(() => detectBrand('qa-dense', body, O));
  log({ page: name, crawl: crawl.error ? describeError(crawl.error).slice(0, 50) : `read: ${crawl.value.pages[0].text.length} characters of text`, crawlMs: crawl.ms, brand: brand.error ? describeError(brand.error).slice(0, 50) : `primary ${brand.value.primary}, lang ${brand.value.htmlLang}`, brandMs: brand.ms });
}
