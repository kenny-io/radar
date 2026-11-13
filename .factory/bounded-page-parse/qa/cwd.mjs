// The way production runs it (tsx on a script that imports crawlSite), from whatever directory it is started in.
// From the repository: a crawl and a brand detection. From elsewhere: the reader cannot load cheerio, which must come
// out as a plain Error ("could not run"), not as an unreachable site.
//   cd <anywhere> && QA_ROOT=<worktree> TSX_TSCONFIG_PATH=<worktree>/tsconfig.json <worktree>/node_modules/.bin/tsx <worktree>/.factory/bounded-page-parse/qa/cwd.mjs
import { load, serve, linking, log, describeError, timed, DOMAIN, O, children, sleep } from './lib.mjs';
const { crawlSite, detectBrand, CrawlError } = await load();
let unhandled = 0; process.on('unhandledRejection', () => { unhandled++; });
const warnings = []; console.warn = (...a) => warnings.push(a.join(' '));
serve({ '/': linking('Home', ['/a', '/b']), '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nAllow: /\n' }, '/a': linking('A', []), '/b': linking('B', []) });
const crawl = await timed(() => crawlSite(DOMAIN));
const brand = await timed(() => detectBrand('qa', '<html lang="en-GB"><head><style>:root{--brand:#2563eb}</style></head></html>', O));
const again = await timed(() => crawlSite(DOMAIN));
await sleep(300);
log({ cwd: process.cwd(), crawl: crawl.error ? describeError(crawl.error) : `${crawl.value.pages.length} pages`, crawlIsCrawlError: crawl.error instanceof CrawlError, crawlMs: crawl.ms, brand: brand.error ? describeError(brand.error) : JSON.stringify(brand.value), again: again.error ? describeError(again.error) : `${again.value.pages.length} pages`, warnings, unhandled, readersStarted: children.length, readersStillRunning: children.filter(c => c.exitCode === null && c.signalCode === null).length });
