// Round 2, D2: the bounds on what the reader answers, from both sides of each, through crawlSite and detectBrand.
// Run in the branch worktree and in a checkout of the base; the two outputs are compared line by line (caps-compare).
// What matters to an analysis is which pages are crawled, what each page gives, and the 200 links per page the job
// stores; a page's full list of links is used only to queue addresses.
//   npx tsx .factory/bounded-page-parse/qa/caps.mjs > out.jsonl
import { createHash } from 'node:crypto';
import { load, serve, html, xml, linking, timed, describeError, asked, O, DOMAIN } from './lib.mjs';
const { crawlSite, detectBrand } = await load();
console.warn = () => {};
const sha = v => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 12);
const rep = (n, f) => { const out = new Array(n); for (let i = 0; i < n; i++) out[i] = f(i); return out.join(''); };
const pad = (i, n) => String(i).padStart(n, '0');
const robots = { status: 404, body: '' };
const ok = t => linking(t, []);
const out = row => console.log(JSON.stringify(row));
async function crawl(name, site) {
  for (const [path, file] of Object.entries(site)) if (file.body && Buffer.byteLength(file.body) > 2 * 1024 * 1024) throw new Error(`over 2 MB: ${name} ${path.slice(0, 40)}`);
  serve(site);
  const r = await timed(() => crawlSite(DOMAIN));
  if (r.error) return out({ name, error: describeError(r.error) });
  const p = r.value.pages;
  out({ name, pagesCrawled: p.length, pathsSha: sha(p.map(x => x.path)), firstPaths: p.slice(0, 4).map(x => x.path.slice(0, 40)), lastPath: p.at(-1).path.slice(0, 40), whatEachPageGivesSha: sha(p.map(x => [x.url, x.title, x.h1, x.description, x.text, x.kind, x.kindSure])), storedLinksSha: sha(p.map(x => x.links.slice(0, 200))), homeLinks: p[0].links.length, homeLinksChars: p[0].links.reduce((n, l) => n + l.length, 0), requests: asked.length });
}
// A link of exactly n characters once it is an address on the site.
const linkOf = (i, n) => `/${pad(i, 6)}${'l'.repeat(n - O.length - 7)}`;
// --- a page's links, 500,000 characters in all ---------------------------------------------------------------------------
for (const [label, count] of [['just under the bound: 9,999 links of 50 characters', 9_999], ['exactly the bound: 10,000 links of 50 characters', 10_000], ['just over the bound: 10,001 links of 50 characters', 10_001], ['well over: 30,000 links of 50 characters, the first 150 of them real pages', 30_000]]) {
  const site = { '/robots.txt': robots, '/': html(`<!doctype html><html><head><title>Links</title></head><body>${rep(count, i => `<a href="${linkOf(i, 50)}">x</a>`)}</body></html>`) };
  for (let i = 0; i < 150; i++) site[linkOf(i, 50)] = ok('Page ' + i);
  await crawl(`links, ${label}`, site);
}
{ // only the links past the bound lead anywhere: an early page's late links are what the rest of the site hangs from
  const site = { '/robots.txt': robots, '/': html(`<!doctype html><html><head><title>Late</title></head><body>${rep(12_000, i => `<a href="${linkOf(i, 50)}">x</a>`)}</body></html>`) };
  for (let i = 11_000; i < 11_050; i++) site[linkOf(i, 50)] = ok('Late ' + i);
  await crawl('links, 12,000 links of 50 characters and only numbers 11,000 to 11,049 are pages (the rest are 404)', site);
}
// --- one address, 2,048 characters -----------------------------------------------------------------------------------------
for (const n of [2_047, 2_048, 2_049, 3_000]) {
  const long = linkOf(1, n);
  await crawl(`address of ${n} characters, as a link`, { '/robots.txt': robots, '/': linking('Home', [long, '/after']), [long]: linking('Long', ['/from-long']), '/after': ok('After'), '/from-long': ok('From long') });
  await crawl(`address of ${n} characters, as a sitemap entry`, { '/robots.txt': robots, '/': linking('Home', ['/after']), '/sitemap.xml': xml(`<urlset><url><loc>${O}${long}</loc></url><url><loc>${O}/from-map</loc></url></urlset>`), [long]: ok('Long'), '/after': ok('After'), '/from-map': ok('From map') });
}
{ const child = `/maps/${'m'.repeat(2_049 - O.length - 10)}.xml`;
  await crawl('a child sitemap at an address of 2,049 characters', { '/robots.txt': robots, '/': linking('Home', []), '/sitemap.xml': xml(`<sitemapindex><sitemap><loc>${O}${child}</loc></sitemap><sitemap><loc>${O}/maps/b.xml</loc></sitemap></sitemapindex>`), [child]: xml(`<urlset><url><loc>${O}/from-long-map</loc></url></urlset>`), '/maps/b.xml': xml(`<urlset><url><loc>${O}/from-b</loc></url></urlset>`), '/from-long-map': ok('From long map'), '/from-b': ok('From b') }); }
// --- a sitemap's page addresses, 2,000,000 characters in all -----------------------------------------------------------
{ const entries = 35_000; const site = { '/robots.txt': robots, '/': linking('Home', []), '/sitemap.xml': xml(`<?xml version="1.0" encoding="UTF-8"?><urlset>${rep(entries, i => `<url><loc>${O}/page-${i}</loc></url>`)}</urlset>`) };
  for (let i = 0; i < 150; i++) site[`/page-${i}`] = ok('Page ' + i);
  await crawl('sitemap, a full 1.8 MB of 35,000 ordinary addresses', site); }
{ // Addresses written as they are spoken, not percent-encoded: each grows three times when it is made into an address.
  const name = i => `/製品/カテゴリー/${pad(i, 5)}-手作りの家具と道具の紹介ページ`;
  const entries = 17_000; const body = `<?xml version="1.0" encoding="UTF-8"?><urlset>${rep(entries, i => `<url><loc>${O}${name(i)}</loc></url>`)}</urlset>`;
  const site = { '/robots.txt': robots, '/': linking('Home', []), '/sitemap.xml': xml(body) };
  for (let i = 0; i < 150; i++) site[new URL(O + name(i)).pathname] = ok('製品 ' + i);
  await crawl(`sitemap, ${Math.round(Buffer.byteLength(body) / 104857.6) / 10} MB of 17,000 addresses in Japanese, not percent-encoded (3.9 million characters once encoded: over the bound)`, site); }
{ const site = { '/robots.txt': robots, '/': linking('Home', []), '/sitemap.xml': xml(`<sitemapindex>${rep(150, i => `<sitemap><loc>${O}/maps/${i}.xml</loc></sitemap>`)}</sitemapindex>`) };
  for (let i = 0; i < 150; i++) { site[`/maps/${i}.xml`] = xml(`<urlset><url><loc>${O}/m${i}/a</loc></url><url><loc>${O}/m${i}/b</loc></url></urlset>`); site[`/m${i}/a`] = ok(`M${i} a`); site[`/m${i}/b`] = ok(`M${i} b`); }
  await crawl('sitemap index naming 150 sitemaps of two pages each', site);
  const dup = { ...site, '/sitemap.xml': xml(`<sitemapindex>${rep(300, i => `<sitemap><loc>${O}/maps/${i % 3}.xml</loc></sitemap>`)}${rep(20, i => `<sitemap><loc>${O}/maps/${i + 3}.xml</loc></sitemap>`)}</sitemapindex>`) };
  await crawl('sitemap index naming the same three sitemaps 100 times each, then 20 others', dup); }
// --- brand detection --------------------------------------------------------------------------------------------------------
async function brand(name, page, files = {}) {
  serve(url => url.origin === O ? files[url.pathname] : undefined);
  const r = await timed(() => detectBrand('qa-caps', page, O));
  out({ name, result: r.error ? describeError(r.error) : { ...r.value, logo: r.value.logo && 'stored' }, askedFor: asked.map(a => a.slice(0, 30)) });
}
const svg = { type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#1d4ed8"/><circle r="2" fill="#1d4ed8"/></svg>' };
await brand('seven logo candidates, only the seventh is there', `<html lang="en"><head></head><body><header>${rep(7, i => `<img src="/h${i}.svg">`)}</header></body></html>`, { '/h6.svg': svg });
await brand('six logo candidates, the sixth is there', `<html lang="en"><head></head><body><header>${rep(6, i => `<img src="/h${i}.svg">`)}</header></body></html>`, { '/h5.svg': svg });
await brand('a header logo written into the page as a data: address of 0.5 MB, and an icon file', `<html lang="en"><head><link rel="icon" sizes="any" href="/icon.svg"></head><body><header><img alt="logo" src="data:image/png;base64,${'A'.repeat(500_000)}"></header></body></html>`, { '/icon.svg': svg });
await brand('1.9 MB of ordinary CSS, a line to each declaration', `<html lang="de"><head><style>\n:root {\n${rep(45_000, i => `\t--color-${i}: #${(i * 7919 % 0xffffff).toString(16).padStart(6, '0')};\r\n`)}}\n</style></head></html>`);
await brand('1.3 MB of control characters in a style (an answer of 7.8 MB)', `<html lang="de"><head><style>:root{--brand:#2563eb}${'\u0001'.repeat(1_300_000)}</style></head></html>`);
await brand('1.4 MB of control characters in a style (an answer over 8 MB)', `<html lang="de"><head><style>:root{--brand:#2563eb}${'\u0001'.repeat(1_400_000)}</style></head></html>`);
