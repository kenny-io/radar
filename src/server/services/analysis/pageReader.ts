// Reading a document that came from the site being analysed: a crawled page, the home page for brand detection, a
// sitemap. cheerio cannot be trusted with such a document in this process. A page under the crawler's 2 MB cap can keep
// the parser, or one selection, busy for tens of seconds (tens of thousands of elements, or elements nested thousands
// deep), and a 173 KB page of unclosed formatting elements ends the process with "heap out of memory".
// So every cheerio call on a site's document runs in one child process, the page reader:
//  - it is started on first use and reused, because starting one costs about as much as reading a large page;
//  - it reads one document at a time and the others wait their turn;
//  - a document gets PAGE_READ_MS of it, by the reader's own clock: a second thread inside the reader (its watchdog)
//    ends the reader at the limit, with a signal nothing else sends. That document is unreadable and the next one
//    starts a new reader. This process decides nothing by its own clock: it may be busy for longer than the limit
//    with other work, in one stretch or in pieces, and a document is not unreadable because its answer was read
//    late. An answer counts whenever it arrives. The one timer here is a backstop that kills a reader still there two
//    seconds past the limit (one frozen from outside, its watchdog with it), and it counts only time in which this
//    process was mostly idle and so able to read what the reader wrote;
//  - its heap is capped at READER_HEAP_MB, so a page that builds millions of elements ends the reader, not this process;
//  - its answer is bounded (the MAX_ constants below): at most 8 MB as JSON whatever the document (1.3 MB of control
//    characters in a <style> answers 7.4 MB), and of a page's links at most 500,000 characters, so the hundred pages
//    of a crawl keep at most 50 MB of links between them (47 MB measured on pages made for it);
//  - a reader that ends for any other reason (killed from outside, out of memory) is not taken for the document's
//    fault the first time: the document is given once more to a new reader, and is unreadable if that one ends too;
//  - it never keeps this process alive while it has no document, it exits when this process goes away (at once when
//    it has no document, at the document's limit when it has one), and it is stopped after READER_IDLE_MS without work.
// This process sends the text and gets plain data back; it runs no cheerio call on a site's document. What it still
// does itself is small and bounded by what it sends and what comes back:
//  - it writes the document out as JSON (4 ms for 2 MB of ordinary text, 38 ms for 2 MB of control characters);
//  - for each address in an answer the crawler does a set lookup and a robots.txt check (crawl.ts). A page gives at
//    most MAX_LINKS_CHARS of addresses (some 21,000 of the shortest) and a sitemap MAX_SITEMAP_URLS_CHARS. Measured
//    with no robots.txt: this process's 10 ms timer was 2 to 5 ms late for a page's 20,888 links, and between 6 and
//    37 ms over a dozen crawls of a sitemap of 75,000 addresses. With a robots.txt the check costs more per address
//    and per rule; that is not bounded here.
import { spawn, type ChildProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';

/** How long the reader may take over one document. Ordinary 1.5 MB pages take about 0.3 s. */
export const PAGE_READ_MS = 5000;
/** How long past a document's limit this process waits before it kills a reader that is still there. The reader's
 *  watchdog keeps the limit; this is for a reader whose watchdog did not (it was frozen from outside). It is counted
 *  in quarter-seconds, and a quarter-second counts only if this process spent less than half of it working (by
 *  performance.eventLoopUtilization), so that it had the time to read what the reader wrote. */
export const READER_GRACE_MS = 2000;
/** How long the reader may sit without work before it is stopped. */
export const READER_IDLE_MS = 30_000;
/** The reader's heap cap (V8 old space), in megabytes. It caps the heap, not everything the reader holds: strings in
 *  flight and the parser's own buffers come on top. Measured resident memory of the reader at its peak: 334 to
 *  469 MB on dense 2 MB pages (85,000 links, 180,000 paragraphs, 150,000 table cells, 3,300 products), and 84 to 205 MB
 *  on the pages and sitemaps whose answers were 90 to 360 MB before answers were bounded (it reached 2 GB on those).
 *  Under the cap a 2 MB page of 85,000 links, of 180,000 paragraphs or of 150,000 table cells is read ten times running
 *  by one reader, and the page of open formatting elements ends the reader in about a second. Only a page of some
 *  250,000 elements in its 2 MB (eight bytes each) does not fit; 512 would read that too, for 130 MB more. */
export const READER_HEAP_MB = 384;
/** The signal the reader's watchdog ends the reader with at a document's limit. Nothing else sends it, so a reader
 *  that ended with it ran out of time, whatever this process was doing meanwhile. Its default action ends the process
 *  without a core file. Checked on macOS (a thread ends a process whose main thread is in a loop, and the parent is
 *  told the signal); not yet run on Linux. */
export const WATCHDOG_SIGNAL = 'SIGALRM';

// What one answer may hold. The reader applies these; nothing here needs more.
/** An address longer than this is not a link and not a sitemap entry. */
export const MAX_ADDRESS_CHARS = 2048;
/** A page's links stop when together they reach this many characters (about 8,000 ordinary addresses). */
export const MAX_LINKS_CHARS = 500_000;
/** A sitemap's page addresses stop when together they reach this many characters: more than a 2 MB sitemap holds. */
export const MAX_SITEMAP_URLS_CHARS = 2_000_000;
/** A sitemap names at most this many other sitemaps (distinct ones; the crawl follows twelve). */
export const MAX_CHILD_SITEMAPS = 100;
/** Brand detection gets this many logo candidates, which is all it looks at. */
export const MAX_LOGO_CANDIDATES = 6;
/** An answer larger than this as JSON is not sent: the read fails ("answer too large"). */
export const MAX_ANSWER_BYTES = 8 * 1024 * 1024;

export const ARTICLE_PATH = /\/(blog|articles?|posts?|news|guides?|resources|insights|learn|journal|stories|notes)\/(?!(page|tag|tags|category|categories|author)\/)[^/]+\/?$/i;
export const LISTING_PATH = /\/(blog|articles?|posts?|news|guides?|resources|insights|journal)\/?$/i;
const ASSET_PATH = /\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|mp4|mp3|css|js|xml|json|txt|woff2?)$/i;

// sameSite and normUrl are needed here (sitemap entries, the crawl queue) and in the reader (a page's links). The
// reader's copies are in READER_CODE below; pageReader.test.ts holds the two equal on a table of addresses.
export const sameSite = (host: string, base: string) => host.replace(/^www\./, '') === base.replace(/^www\./, '');
export function normUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = ''; u.search = '';
    if (ASSET_PATH.test(u.pathname)) return null;
    let s = u.toString(); if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch { return null; }
}

export interface PageRead { title: string; h1: string; description: string; text: string; links: string[]; kind: 'article' | 'page'; kindSure: boolean }
/** What brand detection needs from the home page: the text of its <style> elements, its first three stylesheet
 *  addresses, its theme-color as written, its first logo candidates in the designed order, its inline header SVG, its lang. */
export interface BrandPageRead { css: string; stylesheets: string[]; theme: string; candidates: string[]; svg: string | null; htmlLang: string | null }
/** `sitemaps`: the text of each <sitemap><loc>, trimmed, each one once, in document order. `urls`: every <url><loc>
 *  that is an address to follow on the site (normUrl against the sitemap's own address, then sameSite), in document
 *  order. Both within the MAX_ bounds above. */
export interface SitemapRead { sitemaps: string[]; urls: string[] }

/** The document is why the read gave nothing: the reader ran past its time and was ended (timed_out), two readers in a
 *  row ended while they had it, as when it runs them out of memory (crashed), or cheerio threw on it or its answer
 *  was too large (failed). */
export class PageUnreadable extends Error {
  constructor(public reason: 'timed_out' | 'crashed' | 'failed', detail = '') { super('The document could not be read: ' + reason + (detail ? ` (${detail})` : '')); this.name = 'PageUnreadable'; }
}

const pattern = (r: RegExp) => `new RegExp(${JSON.stringify(r.source)}, ${JSON.stringify(r.flags)})`;
// The reader: plain JavaScript run with `node -e`, so it needs no file on disk and no build step. It answers one
// message at a time over the channel to this process and exits when that channel closes. The three patterns above are
// written once and placed here by their source and flags.
// Its functions are the crawler's extract, classifyPage and the two selections of parseSitemaps, and brand detection's
// logoCandidates, inlineHeaderSvg and three selections for colors, statement for statement as they ran in this process
// before.
// The watchdog is a worker thread, because the reader's own thread cannot notice anything while cheerio keeps it busy.
// It is told the document's limit before each document and told 0 once the answer is written; if the limit runs out
// first it ends the process with WATCHDOG_SIGNAL. Each answer says how long the document took, by the reader's clock.
export const READER_CODE = String.raw`
let cheerio = null, watchdog = null, unavailable = '';
try { cheerio = require('cheerio'); } catch (e) { unavailable = 'cheerio did not load: ' + String((e && e.message) || e).split('\n')[0]; }
try {
  watchdog = new (require('node:worker_threads').Worker)("let timer = null; require('node:worker_threads').parentPort.on('message', ms => { clearTimeout(timer); timer = ms > 0 ? setTimeout(() => process.kill(process.pid, '${WATCHDOG_SIGNAL}'), ms) : null; });", { eval: true });
  watchdog.unref();
} catch (e) { unavailable = unavailable || 'its watchdog did not start: ' + String((e && e.message) || e).split('\n')[0]; }
const ARTICLE_PATH = ${pattern(ARTICLE_PATH)};
const LISTING_PATH = ${pattern(LISTING_PATH)};
const ASSET_PATH = ${pattern(ASSET_PATH)};
const MAX_ADDRESS_CHARS = ${MAX_ADDRESS_CHARS}, MAX_LINKS_CHARS = ${MAX_LINKS_CHARS}, MAX_SITEMAP_URLS_CHARS = ${MAX_SITEMAP_URLS_CHARS}, MAX_CHILD_SITEMAPS = ${MAX_CHILD_SITEMAPS}, MAX_LOGO_CANDIDATES = ${MAX_LOGO_CANDIDATES}, MAX_ANSWER_BYTES = ${MAX_ANSWER_BYTES};

const sameSite = (host, base) => host.replace(/^www\./, '') === base.replace(/^www\./, '');
function normUrl(href, base) {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = ''; u.search = '';
    if (ASSET_PATH.test(u.pathname)) return null;
    let s = u.toString(); if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch { return null; }
}

/** Article vs page from URL + structure. sure = the signal is strong; unsure pages may be refined by the LLM. */
function classifyPage($, path) {
  const og = ($('meta[property="og:type"]').attr('content') || '').toLowerCase();
  let ld = false;
  $('script[type="application/ld+json"]').each((_, el) => { const t = $(el).text(); if (/"@type"\s*:\s*"(BlogPosting|Article|NewsArticle|TechArticle)"/.test(t)) ld = true; });
  if (LISTING_PATH.test(path) || path === '/') return { kind: 'page', sure: true };
  if (og === 'article' || ld) return { kind: 'article', sure: true };
  if (ARTICLE_PATH.test(path)) return { kind: 'article', sure: true };
  const hasArticle = $('article').length > 0 && $('article time[datetime], time[datetime]').length > 0;
  if (hasArticle) return { kind: 'article', sure: false };
  const words = $('main, body').first().text().split(/\s+/).length;
  return { kind: 'page', sure: words < 600 };
}

function extract(html, url, origin) {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim().slice(0, 300);
  const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim().slice(0, 300);
  const description = ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').trim().slice(0, 500);
  const links = new Set(); let linksChars = 0;
  // As before, and bounded: an over-long address is passed over, and the links end where they would pass their total.
  $('a[href]').each((_, el) => { const n = normUrl($(el).attr('href') || '', url); if (n) { try { if (sameSite(new URL(n).hostname, new URL(origin).hostname)) { if (n.length > MAX_ADDRESS_CHARS || links.has(n)) return; if (linksChars + n.length > MAX_LINKS_CHARS) return false; links.add(n); linksChars += n.length; } } catch { /* */ } } });
  const path = new URL(url).pathname || '/';
  const cls = classifyPage($, path);
  const $t = cheerio.load(html); $t('script,style,noscript,svg,iframe,nav,footer,header form').remove();
  const text = ($t('main').text() || $t('body').text()).replace(/\s+/g, ' ').trim().slice(0, 4000);
  return { title, h1, description, text, links: [...links], kind: cls.kind, kindSure: cls.sure };
}

function sitemap(xml, sm, host) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const sitemaps = new Set(), out = []; let outChars = 0;
  // As before, and bounded: each sitemap it names once, up to MAX_CHILD_SITEMAPS; page addresses up to their total.
  $('sitemap > loc').each((_, el) => { const loc = $(el).text().trim(); if (loc.length > MAX_ADDRESS_CHARS || sitemaps.has(loc)) return; sitemaps.add(loc); if (sitemaps.size >= MAX_CHILD_SITEMAPS) return false; });
  $('url > loc').each((_, el) => { const n = normUrl($(el).text().trim(), sm); if (n) { try { if (sameSite(new URL(n).hostname, host)) { if (n.length > MAX_ADDRESS_CHARS) return; if (outChars + n.length > MAX_SITEMAP_URLS_CHARS) return false; out.push(n); outChars += n.length; } } catch { /* */ } } });
  return { sitemaps: [...sitemaps], urls: out };
}

const maxSize = s => String(s || '').split(/\s+/).reduce((mx, x) => Math.max(mx, x === 'any' ? 512 : parseInt(x.split('x')[0]) || 0), 0);

/** Candidate logo URLs in the designed order. */
function logoCandidates($, base) {
  const abs = h => { try { return h ? new URL(h, base).toString() : null; } catch { return null; } };
  const icons = $('link[rel~="icon"]').map((_, el) => ({ href: abs($(el).attr('href')), size: maxSize($(el).attr('sizes')), svg: /svg/.test($(el).attr('type') || '') || /\.svg(\?|$)/.test($(el).attr('href') || '') })).get()
    .filter(i => i.href && (i.size >= 96 || i.svg)).sort((a, b) => b.size - a.size).map(i => i.href);
  const apple = $('link[rel~="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').map((_, el) => abs($(el).attr('href'))).get().filter(Boolean);
  const headerImgs = $('header img, [class*="logo"] img, img[class*="logo"], img[alt*="logo" i], img[src*="logo" i]').map((_, el) => abs($(el).attr('src'))).get().filter(Boolean);
  const og = abs($('meta[property="og:image"]').attr('content'));
  return [...new Set([...icons, ...apple, ...headerImgs, ...(og ? [og] : [])])];
}

/** Inline header SVG (serialized) when no URL candidate works. */
function inlineHeaderSvg($) {
  const el = $('header svg, [class*="logo"] svg').first();
  if (!el.length) return null;
  let html; try { html = $.html(el); } catch { return null; } // an element nested too deep to write out
  if (html.length > 200000) return null;
  return html.includes('xmlns') ? html : html.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
}

function brand(html, origin) {
  const $ = cheerio.load(html);
  const candidates = logoCandidates($, origin).slice(0, MAX_LOGO_CANDIDATES);
  const svg = inlineHeaderSvg($);
  const css = $('style').map((_, el) => $(el).text()).get().join('\n');
  const stylesheets = $('link[rel="stylesheet"]').map((_, el) => $(el).attr('href')).get().filter(Boolean).slice(0, 3);
  const theme = $('meta[name="theme-color"]').attr('content') || '';
  const htmlLang = $('html').attr('lang') || null;
  return { css, stylesheets, theme, candidates, svg, htmlLang };
}

const read = { page: m => extract(m.text, m.url, m.origin), brand: m => brand(m.text, m.origin), sitemap: m => sitemap(m.text, m.url, m.host) };
process.on('message', m => {
  if (unavailable) { process.send({ id: m.id, unavailable }); return; }
  const began = performance.now();
  watchdog.postMessage(m.limit > 0 ? m.limit : ${PAGE_READ_MS});
  let answer;
  try {
    answer = { id: m.id, data: read[m.kind](m) };
    if (Buffer.byteLength(JSON.stringify(answer.data)) > MAX_ANSWER_BYTES) answer = { id: m.id, error: 'answer too large' };
  } catch (e) { answer = { id: m.id, error: String((e && e.message) || e).slice(0, 200) }; }
  answer.ms = Math.round(performance.now() - began);
  process.send(answer);
  watchdog.postMessage(0);
});
process.on('disconnect', () => process.exit(0));
`;

export interface ReadOptions {
  /** Told once how long the document took, by the reader's clock; an unreadable document counts as its whole limit.
   *  Not told when the reader could not run. */
  spent?: (ms: number) => void;
  /** For tests: this document's time limit, in place of PAGE_READ_MS. */ timeoutMs?: number;
  /** For tests: the idle time after this document, in place of READER_IDLE_MS. */ idleMs?: number;
}

interface Request { id: number; message: Record<string, unknown>; timeoutMs: number; idleMs: number; spent?: (ms: number) => void; resolve: (data: any) => void; reject: (error: Error) => void }
/** A reader process and what is known of its end. A failure is decided only when it has both exited and closed its
 *  channel: `exit` alone can come before an answer it wrote is read. */
interface Reader { child: ChildProcess; closed: boolean; ended: { status: number | null; signal: NodeJS.Signals | null } | null; /** this process killed it past its limit */ late: boolean }
/** The document in flight: who has it, and whether that is the second reader to be given it. */
interface Flight { request: Request; reader: Reader | null; tries: number; backstop: ReturnType<typeof setInterval> | null }
let reader: Reader | null = null;
let current: Flight | null = null;
const waiting: Request[] = [];
let idle: ReturnType<typeof setTimeout> | null = null;
let lastId = 0;

/** Not the document's fault: the reader could not be started, could not be given the document, or could not load cheerio or start its watchdog. */
const cannotRun = (why: unknown) => new Error('The page reader could not run: ' + String((why as { message?: string } | null)?.message || why));

const kill = (r: Reader) => { try { r.child.kill('SIGKILL'); } catch { /* already gone */ } };
/** The reader in use is given up: the next document starts another. */
function stop() { const r = reader; reader = null; if (r) kill(r); }

/** A child gets its listeners once, when it starts, and each acts only for the document that child has: nothing is
 *  added per document, and a child that has been given up can still deliver the answer it wrote, and nothing else. */
function start(): Reader {
  // The reader gets no secrets: its environment is PATH and NODE_ENV alone.
  const child = spawn(process.execPath, [`--max-old-space-size=${READER_HEAP_MB}`, '-e', READER_CODE], { cwd: process.cwd(), env: { PATH: process.env.PATH || '', NODE_ENV: process.env.NODE_ENV }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  const r: Reader = { child, closed: !child.connected, ended: null, late: false };
  child.on('message', (m: any) => {
    if (current?.reader !== r || !m || m.id !== current.request.id) return;
    if (typeof m.unavailable === 'string') { if (reader === r) reader = null; kill(r); settle(cannotRun(m.unavailable)); }
    else if (typeof m.error === 'string') settle(new PageUnreadable('failed', m.error), undefined, m.ms);
    else settle(null, m.data, m.ms);
  });
  child.on('disconnect', () => { r.closed = true; over(r); });
  child.on('exit', (status, signal) => { r.ended = { status, signal }; over(r); });
  child.on('error', error => { if (reader === r) reader = null; kill(r); if (current?.reader === r) settle(cannotRun(error)); });
  // Neither the child nor its channel keeps this process alive. While a document is with the reader its backstop does.
  child.unref(); child.channel?.unref();
  return r;
}

/** A reader has exited, or its channel has closed, or both. It is never used again. If it had the document in
 *  flight, that is decided here, once nothing more can arrive from it. */
function over(r: Reader) {
  if (reader === r) reader = null;
  if (!r.ended) { kill(r); return; } // its channel closed while it runs: it can no longer answer
  if (!r.closed || current?.reader !== r) return;
  const flight = current;
  // Ended by its watchdog, or by this process past its limit: the document took too long.
  if (r.ended.signal === WATCHDOG_SIGNAL || r.late) settle(new PageUnreadable('timed_out'), undefined, flight.request.timeoutMs);
  // Ended some other way. That may not be the document's doing (killed from outside), so another reader is given it,
  // once; when that one ends too, it is.
  else if (flight.tries < 2) { flight.tries++; give(flight); }
  else settle(new PageUnreadable('crashed', r.ended.signal || 'exit ' + r.ended.status), undefined, flight.request.timeoutMs);
}

const BACKSTOP_TICK_MS = 250;
/** The document in flight goes to the reader, a new one if need be. While it is there a backstop runs, which also
 *  keeps this process alive until the document is settled: a reader still there READER_GRACE_MS past the document's
 *  limit (frozen, its watchdog with it) is killed. The backstop decides nothing. It counts ticks, and only those
 *  since the last of which this process was mostly idle: while this process is busy with something else, in one
 *  stretch or a piece in every turn of its event loop, no tick counts, so what the reader has written is read
 *  before a reader is ever killed for it. */
function give(flight: Flight) {
  if (flight.backstop) clearInterval(flight.backstop);
  flight.backstop = null; flight.reader = null;
  try {
    if (!reader || !reader.child.connected) { stop(); reader = start(); }
    const r = flight.reader = reader;
    if (typeof r.child.send !== 'function' || !r.child.connected) throw new Error('it has no channel to this process');
    let ticks = Math.ceil((flight.request.timeoutMs + READER_GRACE_MS) / BACKSTOP_TICK_MS), before = performance.eventLoopUtilization();
    flight.backstop = setInterval(() => {
      const now = performance.eventLoopUtilization(), busy = performance.eventLoopUtilization(now, before).utilization; before = now;
      if (ticks <= 0 || busy >= 0.5 || --ticks > 0) return;
      r.late = true; if (reader === r) reader = null; kill(r);
    }, BACKSTOP_TICK_MS);
    // A document that cannot be written to the reader means the reader is ending: over() hears of it.
    r.child.send({ id: flight.request.id, limit: flight.request.timeoutMs, ...flight.request.message }, error => { if (error) kill(r); });
  } catch (error) { stop(); settle(cannotRun(error)); }
}

/** The document in flight is done, one way or the other: the next one starts, or the idle time does. */
function settle(error: Error | null, data?: unknown, ms?: number) {
  const done = current; if (!done) return;
  current = null;
  if (done.backstop) clearInterval(done.backstop);
  if (typeof ms === 'number' && done.request.spent) { try { done.request.spent(ms); } catch { /* the caller's own */ } }
  if (error) done.request.reject(error); else done.request.resolve(data);
  if (waiting.length) { queueMicrotask(next); return; }
  if (!reader) return;
  const timer = setTimeout(() => { if (idle !== timer) return; idle = null; if (!current) stop(); }, done.request.idleMs);
  timer.unref(); idle = timer;
}

function next() {
  if (current || !waiting.length) return;
  const request = waiting.shift()!;
  if (idle) { clearTimeout(idle); idle = null; }
  give(current = { request, reader: null, tries: 1, backstop: null });
}

function read<T>(message: Record<string, unknown>, o: ReadOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    waiting.push({ id: ++lastId, message, timeoutMs: o.timeoutMs ?? PAGE_READ_MS, idleMs: o.idleMs ?? READER_IDLE_MS, spent: o.spent, resolve, reject });
    next();
  });
}

/** Each of these rejects with PageUnreadable when the document is why there is no answer, and with a plain Error when
 *  the reader itself could not run. */
/** A crawled page: title, h1, description, text, same-site links, and article or page. */
export const readPage = (html: string, url: string, origin: string, o?: ReadOptions) => read<PageRead>({ kind: 'page', text: html, url, origin }, o);
/** The home page, for brand detection. */
export const readBrandPage = (html: string, origin: string, o?: ReadOptions) => read<BrandPageRead>({ kind: 'brand', text: html, origin }, o);
/** A sitemap or a sitemap index, fetched from `url`, for the site on `host`. */
export const readSitemap = (xml: string, url: string, host: string, o?: ReadOptions) => read<SitemapRead>({ kind: 'sitemap', text: xml, url, host }, o);
