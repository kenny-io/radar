// Website crawler (02-system.md §3 "site"): robots.txt + sitemap, then up to ~100 same-domain HTML pages.
// Respects robots.txt for Radar's user agent. In dev-stub mode the fetcher is the synthesized dev site (no network).
// The site controls every page and sitemap fetched here, and none of them is parsed in this process: each is read in
// the child process of ./pageReader.ts, which has a time limit per document, a memory cap and a bound on what it
// answers. A document it cannot read is passed over as a failed fetch is, the home page excepted (no home page, no
// site). A crawl stops reading and returns what it has after MAX_UNREADABLE such documents, or when its documents have
// had CRAWL_READ_MS of the reader between them: so one crawl costs the reader at most that plus one document's limit.
// Every analysis in this process uses the same reader, one document at a time, so one may wait for another's share.
import dns from 'node:dns/promises';
import net from 'node:net';
import robotsParser from 'robots-parser';
import { env } from '../../env';
import { devFetch } from './devsite';
import { assertPublicUrl, publicDispatcher } from '../../http/publicNetwork';
import { PageUnreadable, normUrl, readPage, readSitemap, sameSite, type PageRead } from './pageReader';

export { ARTICLE_PATH, LISTING_PATH } from './pageReader';

export interface FetchResult { status: number; type: string; body: Buffer; url: string }
export interface CrawledPage { url: string; path: string; title: string; h1: string; description: string; text: string; links: string[]; kind: 'article' | 'page'; kindSure: boolean; html?: string }
export interface CrawlResult { origin: string; host: string; pages: CrawledPage[]; homeHtml: string; robotsBlocked: boolean }

export class CrawlError extends Error { constructor(public reason: 'unreachable' | 'blocked') { super(reason); } }

const MAX_PAGES = 100;
const MAX_BYTES = 2 * 1024 * 1024;
/** How many documents (pages and sitemaps together) a crawl may find unreadable before it stops reading. */
const MAX_UNREADABLE = 3;
/** How much of the page reader's time one crawl's documents may take in all, by the reader's own clock. The heaviest
 *  ordinary site measured (a hundred 1.5 MB pages at 0.25 s each) takes 25 s. */
export const CRAWL_READ_MS = 60_000;
export const uaToken = () => (env.crawlerUserAgent.split('/')[0] || 'RadarBot').trim();

function isPrivateIp(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) {
    const mapped = v.slice(7);
    if (net.isIPv4(mapped)) return isPrivateIp(mapped);
    const parts = mapped.split(':');
    if (parts.length === 2 && parts.every(x => /^[a-f0-9]{1,4}$/.test(x))) {
      const value = parseInt(parts[0], 16) * 65536 + parseInt(parts[1], 16);
      return isPrivateIp([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.'));
    }
  }
  return v === '::1' || v === '::' || /^(fc|fd|fe[89ab]|ff)/.test(v);
}
async function hostAllowed(host: string) {
  const name = host.replace(/^\[|\]$/g, '');
  try {
    const addrs = net.isIP(name) ? [{ address: name }] : await dns.lookup(name, { all: true });
    return addrs.length > 0 && !addrs.some(a => isPrivateIp(a.address));
  } catch { return false; }
}

/** Fetch with Radar's UA, timeouts, size cap and SSRF guard. Dev stubs: synthesized site. */
export async function fetchUrl(url: string, accept = 'text/html,application/xhtml+xml'): Promise<FetchResult> {
  if (env.devStubs) return devFetch(url);
  let at = new URL(url);
  const signal = AbortSignal.timeout(12000);
  let r: Response;
  for (let hop = 0; ; hop++) {
    // Validate before every request. Native redirect-follow would contact a private target before we could reject it.
    assertPublicUrl(at);
    if (!(await hostAllowed(at.hostname))) throw new Error('blocked host');
    r = await fetch(at.href, { headers: { 'user-agent': env.crawlerUserAgent, accept, 'accept-language': 'en;q=0.9,*;q=0.5' }, redirect: 'manual', signal, dispatcher: publicDispatcher() } as RequestInit);
    if (![301, 302, 303, 307, 308].includes(r.status)) break;
    const location = r.headers.get('location');
    await r.body?.cancel();
    if (!location || hop >= 5) throw new Error('invalid redirect');
    at = new URL(location, at);
  }
  const reader = r.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  if (reader) { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) { try { await reader.cancel(); } catch { /* */ } break; } chunks.push(value); } }
  return { status: r.status, type: r.headers.get('content-type') || '', body: Buffer.concat(chunks), url: at.toString() };
}

/** What a crawl's reading has come to so far: documents found unreadable, and reader time used of what it may use. */
interface Reading { unreadable: number; ms: number; mayUse: number }
const gaveUp = (reading: Reading) => reading.unreadable >= MAX_UNREADABLE || reading.ms >= reading.mayUse;
/** The reader says how long each document took (an unreadable one counts as its whole limit). */
const timed = (reading: Reading) => ({ spent: (ms: number) => { reading.ms += ms; } });
/** A read whose document turned out unreadable counts against the crawl and gives null. Any other failure is not the
 *  site's doing (the reader could not run) and is thrown on. */
async function readable<T>(read: Promise<T>, reading: Reading, what: string): Promise<T | null> {
  try { return await read; }
  catch (e) {
    if (!(e instanceof PageUnreadable)) throw e;
    reading.unreadable++;
    console.warn(`[crawl] ${what.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 300)} could not be read (${e.reason})`); // the address is the site's own text
    return null;
  }
}

/** Title, text, same-site links and article-or-page for one page, read in the page reader. */
const extract = (html: string, url: string, origin: string, reading: Reading): Promise<PageRead> => readPage(html, url, origin, timed(reading));

async function parseSitemaps(urls: string[], host: string, reading: Reading, budget = 400): Promise<string[]> {
  const out: string[] = []; const seen = new Set<string>(); const queue = [...urls];
  while (queue.length && out.length < budget && seen.size < 12 && !gaveUp(reading)) {
    const sm = queue.shift()!; if (seen.has(sm)) continue; seen.add(sm);
    let xml: string;
    try { const r = await fetchUrl(sm, 'application/xml,text/xml'); if (r.status >= 400) continue; xml = r.body.toString('utf8'); } catch { continue; }
    const map = await readable(readSitemap(xml, sm, host, timed(reading)), reading, sm); if (!map) continue;
    for (const loc of map.sitemaps) queue.push(loc);
    for (const u of map.urls) out.push(u); // already the addresses to follow on this site
  }
  return out;
}

/** Crawl a domain. Throws CrawlError('unreachable'|'blocked'). `readMs` is for tests: reader time in place of CRAWL_READ_MS. */
export async function crawlSite(domain: string, onPage?: (n: number) => void, o: { readMs?: number } = {}): Promise<CrawlResult> {
  // Resolve the canonical origin (https first, then www., then http).
  let home: FetchResult | null = null; let origin = '';
  for (const cand of [`https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`]) {
    try { const r = await fetchUrl(cand); if (r.status < 400 && /html/i.test(r.type)) { home = r; origin = new URL(r.url).origin; break; } if (r.status === 401 || r.status === 403) { home = r; origin = new URL(r.url).origin; } } catch { /* try next */ }
  }
  if (!home) throw new CrawlError('unreachable');
  const host = new URL(origin).hostname;
  // robots.txt
  let robots: ReturnType<typeof robotsParser> | null = null; let sitemapUrls: string[] = [];
  try {
    const r = await fetchUrl(origin + '/robots.txt', 'text/plain');
    if (r.status < 400) { robots = robotsParser(origin + '/robots.txt', r.body.toString('utf8')); sitemapUrls = robots.getSitemaps(); }
  } catch { /* no robots */ }
  const allowed = (u: string) => !robots || robots.isAllowed(u, uaToken()) !== false;
  if (!allowed(origin + '/')) throw new CrawlError('blocked');
  if (home.status === 401 || home.status === 403) throw new CrawlError('blocked');
  if (!sitemapUrls.length) sitemapUrls = [origin + '/sitemap.xml'];
  // The home page is read before anything else is: a home page that cannot be read is a site that cannot be analysed.
  const homeHtml = home.body.toString('utf8');
  const reading: Reading = { unreadable: 0, ms: 0, mayUse: o.readMs ?? CRAWL_READ_MS };
  let first: PageRead;
  try { first = await extract(homeHtml, home.url, origin, reading); }
  catch (e) { if (!(e instanceof PageUnreadable)) throw e; console.warn(`[crawl] ${home.url} (the home page) could not be read (${e.reason})`); throw new CrawlError('unreachable'); }
  const fromSitemap = await parseSitemaps(sitemapUrls, host, reading);

  const pages: CrawledPage[] = []; const seen = new Set<string>();
  const homeUrl = normUrl(home.url, origin) || origin + '/';
  const queue: string[] = [homeUrl]; seen.add(homeUrl);
  const push = (u: string) => { if (!seen.has(u) && allowed(u)) { seen.add(u); queue.push(u); } };
  pages.push({ url: homeUrl, path: new URL(homeUrl).pathname || '/', ...first, html: homeHtml }); queue.shift();
  // Nav links from the homepage first (most important pages), then the sitemap, then discovered links.
  first.links.forEach(push); fromSitemap.forEach(push);
  onPage?.(pages.length);
  const delay = robots?.getCrawlDelay(uaToken()) || 0;
  while (queue.length && pages.length < MAX_PAGES && !gaveUp(reading)) {
    const batch = queue.splice(0, delay ? 1 : 4);
    const res = await Promise.all(batch.map(async u => { try { return { u, r: await fetchUrl(u) }; } catch { return { u, r: null }; } }));
    for (const { u, r } of res) {
      if (!r || r.status >= 400 || !/html/i.test(r.type) || pages.length >= MAX_PAGES || gaveUp(reading)) continue;
      const finalUrl = normUrl(r.url, origin) || u;
      try { if (!sameSite(new URL(finalUrl).hostname, host)) continue; } catch { continue; }
      if (pages.some(p => p.url === finalUrl)) continue;
      const html = r.body.toString('utf8');
      const e = await readable(extract(html, r.url, origin, reading), reading, r.url); if (!e) continue;
      pages.push({ url: finalUrl, path: new URL(finalUrl).pathname || '/', ...e });
      e.links.forEach(push);
    }
    onPage?.(pages.length);
    if (delay && !gaveUp(reading)) await new Promise(r => setTimeout(r, Math.min(delay, 5) * 1000));
  }
  if (reading.ms >= reading.mayUse) console.warn(`[crawl] ${origin} has had its ${Math.round(reading.mayUse / 1000)} s of the page reader: stopped with ${pages.length} page(s) read`);
  return { origin, host, pages, homeHtml, robotsBlocked: false };
}
