// How deep may an ordinary, properly closed page be nested before it cannot be read? One process per depth (a new
// reader on the branch, a new process on the base), as the home page of a crawl, and again as the second page read.
// npx tsx .factory/bounded-page-parse/qa/depth.mjs <depth>
import { load, serve, html, linking, log, describeError, timed, DOMAIN } from './lib.mjs';
const depth = Number(process.argv[2]);
const { crawlSite } = await load();
console.warn = () => {};
const deep = html(`<!doctype html><html><head><title>Deep</title></head><body>${'<div>'.repeat(depth)}<p>text at the bottom</p><a href="/next">n</a>${'</div>'.repeat(depth)}</body></html>`);
serve({ '/': deep, '/robots.txt': { status: 404, body: '' } });
const cold = await timed(() => crawlSite(DOMAIN));
serve({ '/': linking('Home', ['/deep']), '/deep': deep, '/robots.txt': { status: 404, body: '' } });
const warm = await timed(() => crawlSite(DOMAIN));
log({ depth, asTheFirstDocument: cold.error ? describeError(cold.error).slice(0, 70) : `read (${cold.value.pages[0].text.slice(0, 20)})`, afterAnotherDocument: warm.error ? describeError(warm.error).slice(0, 70) : `${warm.value.pages.length} page(s)` });
