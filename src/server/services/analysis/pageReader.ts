// Reading a document that came from the site being analysed: a crawled page, the home page for brand detection, a
// sitemap. cheerio cannot be trusted with such a document in this process. A page under the crawler's 2 MB cap can keep
// the parser, or one selection, busy for tens of seconds (tens of thousands of elements, or elements nested thousands
// deep), and a 173 KB page of unclosed formatting elements ends the process with "heap out of memory".
// So every cheerio call on a site's document runs in one child process, the page reader:
//  - it is started on first use and reused, because starting one costs about as much as reading a large page;
//  - it reads one document at a time and the others wait their turn;
//  - a document gets PAGE_READ_MS of it. Past that the reader is killed, that document is unreadable, and the next
//    document starts a new reader;
//  - it never spends more than its limit plus two seconds on a document, whoever is watching: a second thread inside
//    the reader ends it then, so a reader whose user was killed, or is itself too busy to stop it, does not work on;
//  - its heap is capped at READER_HEAP_MB, so a page that builds millions of elements ends the reader, not this process;
//  - it never keeps this process alive, it exits when this process goes away (at once when it has no document, at
//    the watchdog's time when it has one), and it is stopped after READER_IDLE_MS without work.
// This process sends the text and gets plain data back; it runs no cheerio call on a site's document, and does no work
// per link, per element or per sitemap address.
import { spawn, type ChildProcess } from 'node:child_process';

/** How long the reader may take over one document. Ordinary 1.5 MB pages take about 0.3 s. */
export const PAGE_READ_MS = 5000;
/** How long past a document's limit the reader's own watchdog waits before it ends the reader. The limit is kept by
 *  this process; the watchdog is for when this process is gone or busy. */
export const READER_GRACE_MS = 2000;
/** How long the reader may sit without work before it is stopped. */
export const READER_IDLE_MS = 30_000;
/** The reader's heap cap (V8 old space), in megabytes. Measured: under it a 2 MB page of 85,000 links, of 180,000
 *  paragraphs or of 150,000 table cells is read ten times running by one reader (which then holds 340 to 470 MB in
 *  all), and the page of open formatting elements ends the reader in about a second. Only a page of some 250,000
 *  elements in its 2 MB (eight bytes each) does not fit; 512 would read that too, for 130 MB more. */
export const READER_HEAP_MB = 384;

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
 *  addresses, its theme-color as written, its logo candidates in the designed order, its inline header SVG, its lang. */
export interface BrandPageRead { css: string; stylesheets: string[]; theme: string; candidates: string[]; svg: string | null; htmlLang: string | null }
/** `sitemaps`: the text of every <sitemap><loc>, trimmed, in document order. `urls`: every <url><loc> that is an
 *  address to follow on the site (normUrl against the sitemap's own address, then sameSite), in document order. */
export interface SitemapRead { sitemaps: string[]; urls: string[] }

/** The document is why the read gave nothing: the reader ran past its time and was stopped, the reader ended while
 *  reading it (out of memory), or cheerio threw on it (nested too deep). */
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
// It is told a time before each document and told 0 after the answer; if the time runs out first it kills the process.
export const READER_CODE = String.raw`
let cheerio = null, watchdog = null, unavailable = '';
try { cheerio = require('cheerio'); } catch (e) { unavailable = 'cheerio did not load: ' + String((e && e.message) || e).split('\n')[0]; }
try {
  watchdog = new (require('node:worker_threads').Worker)("let timer = null; require('node:worker_threads').parentPort.on('message', ms => { clearTimeout(timer); timer = ms > 0 ? setTimeout(() => process.kill(process.pid, 'SIGKILL'), ms) : null; });", { eval: true });
  watchdog.unref();
} catch (e) { unavailable = unavailable || 'its watchdog did not start: ' + String((e && e.message) || e).split('\n')[0]; }
const ARTICLE_PATH = ${pattern(ARTICLE_PATH)};
const LISTING_PATH = ${pattern(LISTING_PATH)};
const ASSET_PATH = ${pattern(ASSET_PATH)};

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
  const links = new Set();
  $('a[href]').each((_, el) => { const n = normUrl($(el).attr('href') || '', url); if (n) { try { if (sameSite(new URL(n).hostname, new URL(origin).hostname)) links.add(n); } catch { /* */ } } });
  const path = new URL(url).pathname || '/';
  const cls = classifyPage($, path);
  const $t = cheerio.load(html); $t('script,style,noscript,svg,iframe,nav,footer,header form').remove();
  const text = ($t('main').text() || $t('body').text()).replace(/\s+/g, ' ').trim().slice(0, 4000);
  return { title, h1, description, text, links: [...links], kind: cls.kind, kindSure: cls.sure };
}

function sitemap(xml, sm, host) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const sitemaps = [], out = [];
  $('sitemap > loc').each((_, el) => { sitemaps.push($(el).text().trim()); });
  $('url > loc').each((_, el) => { const n = normUrl($(el).text().trim(), sm); if (n) { try { if (sameSite(new URL(n).hostname, host)) out.push(n); } catch { /* */ } } });
  return { sitemaps, urls: out };
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
  const candidates = logoCandidates($, origin);
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
  watchdog.postMessage((m.limit > 0 ? m.limit : ${PAGE_READ_MS}) + ${READER_GRACE_MS});
  let answer;
  try { answer = { id: m.id, data: read[m.kind](m) }; } catch (e) { answer = { id: m.id, error: String((e && e.message) || e).slice(0, 200) }; }
  process.send(answer);
  watchdog.postMessage(0);
});
process.on('disconnect', () => process.exit(0));
`;

export interface ReadOptions { /** For tests: this document's time limit, in place of PAGE_READ_MS. */ timeoutMs?: number; /** For tests: the idle time after this document, in place of READER_IDLE_MS. */ idleMs?: number }

interface Request { id: number; message: Record<string, unknown>; timeoutMs: number; idleMs: number; resolve: (data: any) => void; reject: (error: Error) => void }
let reader: ChildProcess | null = null;
let current: (Request & { timer: ReturnType<typeof setTimeout> }) | null = null;
const waiting: Request[] = [];
let idle: ReturnType<typeof setTimeout> | null = null;
let lastId = 0;

/** Not the document's fault: the reader could not be started, could not be given the document, or could not load cheerio or start its watchdog. */
const cannotRun = (why: unknown) => new Error('The page reader could not run: ' + String((why as { message?: string } | null)?.message || why));

/** A child gets its listeners once, when it starts, and each acts only while that child is the reader: nothing is
 *  added per document, and a child that was stopped can no longer settle anything. */
function start(): ChildProcess {
  // The reader gets no secrets: its environment is PATH and NODE_ENV alone.
  const child = spawn(process.execPath, [`--max-old-space-size=${READER_HEAP_MB}`, '-e', READER_CODE], { cwd: process.cwd(), env: { PATH: process.env.PATH || '', NODE_ENV: process.env.NODE_ENV }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  child.on('message', (m: any) => {
    if (reader !== child || !current || !m || m.id !== current.id) return;
    if (typeof m.unavailable === 'string') { stop(); settle(cannotRun(m.unavailable)); }
    else if (typeof m.error === 'string') settle(new PageUnreadable('failed', m.error));
    else settle(null, m.data);
  });
  child.on('exit', (status, signal) => { if (reader === child) { reader = null; settle(new PageUnreadable('crashed', signal || 'exit ' + status)); } });
  child.on('error', error => { if (reader === child) { stop(); settle(cannotRun(error)); } });
  // Neither the child nor its channel keeps this process alive.
  child.unref(); child.channel?.unref();
  return child;
}

function stop() {
  const child = reader; reader = null;
  if (child) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
}

/** The document in flight is done, one way or the other: the next one starts, or the idle time does. */
function settle(error: Error | null, data?: unknown) {
  const done = current; if (!done) return;
  current = null; clearTimeout(done.timer);
  if (error) done.reject(error); else done.resolve(data);
  if (waiting.length) { queueMicrotask(next); return; }
  if (!reader) return;
  const timer = setTimeout(() => { if (idle !== timer) return; idle = null; if (!current) stop(); }, done.idleMs);
  timer.unref(); idle = timer;
}

function next() {
  if (current || !waiting.length) return;
  const request = waiting.shift()!;
  if (idle) { clearTimeout(idle); idle = null; }
  // The limit starts here, when the document is sent, not when it was asked for.
  current = { ...request, timer: setTimeout(() => { stop(); settle(new PageUnreadable('timed_out')); }, request.timeoutMs) };
  try {
    if (!reader || !reader.connected) { stop(); reader = start(); }
    const child = reader;
    if (typeof child.send !== 'function' || !child.connected) throw new Error('it has no channel to this process');
    child.send({ id: request.id, limit: request.timeoutMs, ...request.message }, error => { if (error && reader === child && current?.id === request.id) { stop(); settle(cannotRun(error)); } });
  } catch (error) { stop(); settle(cannotRun(error)); }
}

function read<T>(message: Record<string, unknown>, o: ReadOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    waiting.push({ id: ++lastId, message, timeoutMs: o.timeoutMs ?? PAGE_READ_MS, idleMs: o.idleMs ?? READER_IDLE_MS, resolve, reject });
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
