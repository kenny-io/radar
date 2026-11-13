// QA's corpus (corpus.mjs) and the dev stub site through crawlSite and detectBrand, everything they give written out
// in full. Run it in the branch worktree and in a checkout of the base, then compare the two files (same-compare.mjs).
//   cd <checkout> && QA_STORAGE=<scratch>/storage npx tsx <worktree>/.factory/bounded-page-parse/qa/same.mjs <out.json>
//   cd <checkout> && RADAR_DEV_STUBS=1 QA_STORAGE=... npx tsx .../same.mjs <out.json> stubs
import fs from 'node:fs';
import path from 'node:path';
const stubs = process.argv[3] === 'stubs';
const wantStubs = process.env.RADAR_DEV_STUBS;
const lib = await import('./lib.mjs'); // removes RADAR_DEV_STUBS from the environment
if (stubs) process.env.RADAR_DEV_STUBS = wantStubs || '1';
const { load, serve, asked, ROOT } = lib;
const { sites, brands } = await import('./corpus.mjs');
const { crawlSite, CrawlError, detectBrand } = await load();
const storage = process.env.QA_STORAGE; if (!storage) throw new Error('QA_STORAGE is needed');
fs.rmSync(storage, { recursive: true, force: true }); fs.mkdirSync(storage, { recursive: true });
const warnings = []; const warn = console.warn; console.warn = (...a) => { warnings.push(a.join(' ')); };
const out = { root: ROOT, stubs, crawls: {}, brands: {} };

/** What a brand detection stored, by content, and the result with the stored file's address made stable. */
const storedFiles = () => { const files = []; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } }; walk(storage); return files.filter(f => !f.endsWith('.type')).map(f => ({ type: fs.readFileSync(f + '.type', 'utf8'), ext: path.extname(f), body: fs.readFileSync(f, 'utf8') })); };
const clear = () => { fs.rmSync(storage, { recursive: true, force: true }); fs.mkdirSync(storage, { recursive: true }); };
const stable = r => r && r.logo ? { ...r, logo: r.logo.replace(/\/\d+-[\w-]+\.(\w+)$/, '/<stored>.$1') } : r;

if (stubs) {
  for (const domain of ['fieldnote.app', 'northbeam.test', 'acme-coffee.test', 'harbour-nologo.test', 'www.northbeam.test', 'quite-unreachable.test', 'bakery.example', 'law-firm.example', 'x.io']) {
    warnings.length = 0; clear();
    const progress = []; let result;
    try { result = await crawlSite(domain, n => progress.push(n)); } catch (e) { if (!(e instanceof CrawlError)) throw e; result = { crawlError: e.reason }; }
    out.crawls[domain] = { result, progress, warnings: [...warnings] };
    if (result.homeHtml) { warnings.length = 0; out.brands[domain] = { result: stable(await detectBrand('biz', result.homeHtml, result.origin)), stored: storedFiles(), warnings: [...warnings] }; }
  }
} else {
  const all = sites(ROOT);
  for (const [domain, tables] of Object.entries(all)) {
    warnings.length = 0;
    serve(url => { if (url.host !== domain && url.host !== 'www.' + domain) return { fail: true }; const t = tables(url.host, url.protocol); return t[url.pathname + url.search] ?? t[url.pathname]; });
    const progress = []; let result;
    try { result = await crawlSite(domain, n => progress.push(n)); } catch (e) { if (!(e instanceof CrawlError)) throw e; result = { crawlError: e.reason }; }
    out.crawls[domain] = { result, asked: [...asked], progress, warnings: [...warnings] };
  }
  for (const [name, html, origin, files] of brands(ROOT)) {
    warnings.length = 0; clear();
    serve(url => url.origin === origin ? files[url.pathname + url.search] ?? files[url.pathname] : undefined);
    let result; try { result = stable(await detectBrand('biz', html, origin)); } catch (e) { result = { threw: String(e && e.message || e) }; }
    out.brands[name] = { result, asked: [...asked], stored: storedFiles(), warnings: [...warnings] };
  }
}
console.warn = warn;
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
console.log(JSON.stringify({ wrote: process.argv[2], crawls: Object.fromEntries(Object.entries(out.crawls).map(([k, v]) => [k, v.result.pages ? v.result.pages.length + ' pages' : v.result.crawlError])), brands: Object.keys(out.brands).length }));
