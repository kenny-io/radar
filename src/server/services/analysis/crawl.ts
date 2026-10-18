// Website crawler (02-system.md §3 "site"): robots.txt + sitemap, then up to ~100 same-domain HTML pages.
// Respects robots.txt for Radar's user agent. In dev-stub mode the fetcher is the synthesized dev site (no network).
import dns from 'node:dns/promises';
import net from 'node:net';
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import { env } from '../../env';
import { devFetch } from './devsite';

export interface FetchResult { status: number; type: string; body: Buffer; url: string }
export interface CrawledPage { url: string; path: string; title: string; h1: string; description: string; text: string; links: string[]; kind: 'article' | 'page'; kindSure: boolean; html?: string }
export interface CrawlResult { origin: string; host: string; pages: CrawledPage[]; homeHtml: string; robotsBlocked: boolean }

export class CrawlError extends Error { constructor(public reason: 'unreachable' | 'blocked') { super(reason); } }

const MAX_PAGES = 100;
const MAX_BYTES = 2 * 1024 * 1024;
const uaToken = () => (env.crawlerUserAgent.split('/')[0] || 'RadarBot').trim();

function isPrivateIp(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v === '::';
}
const hostChecked = new Map<string, boolean>();
async function hostAllowed(host: string) {
  if (hostChecked.has(host)) return hostChecked.get(host)!;
  let ok = false;
  try { const addrs = await dns.lookup(host, { all: true }); ok = addrs.length > 0 && !addrs.some(a => isPrivateIp(a.address)); } catch { ok = false; }
  hostChecked.set(host, ok); return ok;
}

/** Fetch with Radar's UA, timeouts, size cap and SSRF guard. Dev stubs: synthesized site. */
export async function fetchUrl(url: string, accept = 'text/html,application/xhtml+xml'): Promise<FetchResult> {
  if (env.devStubs) return devFetch(url);
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || !(await hostAllowed(u.hostname))) throw new Error('blocked host');
  const r = await fetch(url, { headers: { 'user-agent': env.crawlerUserAgent, accept, 'accept-language': 'en;q=0.9,*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
  const final = new URL(r.url || url);
  if (!(await hostAllowed(final.hostname))) throw new Error('blocked host');
  const reader = r.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  if (reader) { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) { try { await reader.cancel(); } catch { /* */ } break; } chunks.push(value); } }
  return { status: r.status, type: r.headers.get('content-type') || '', body: Buffer.concat(chunks), url: final.toString() };
}

const sameSite = (host: string, base: string) => host.replace(/^www\./, '') === base.replace(/^www\./, '');
function normUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = ''; u.search = '';
    if (/\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|mp4|mp3|css|js|xml|json|txt|woff2?)$/i.test(u.pathname)) return null;
    let s = u.toString(); if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch { return null; }
}

const ARTICLE_PATH = /\/(blog|articles?|posts?|news|guides?|resources|insights|learn|journal|stories|notes)\/(?!(page|tag|tags|category|categories|author)\/)[^/]+\/?$/i;
const LISTING_PATH = /\/(blog|articles?|posts?|news|guides?|resources|insights|journal)\/?$/i;
/** Article vs page from URL + structure. `sure` = the signal is strong; unsure pages may be refined by the LLM. */
export function classifyPage($: cheerio.CheerioAPI, path: string): { kind: 'article' | 'page'; sure: boolean } {
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

function extract(html: string, url: string, origin: string) {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim().slice(0, 300);
  const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim().slice(0, 300);
  const description = ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').trim().slice(0, 500);
  const links = new Set<string>();
  $('a[href]').each((_, el) => { const n = normUrl($(el).attr('href') || '', url); if (n) { try { if (sameSite(new URL(n).hostname, new URL(origin).hostname)) links.add(n); } catch { /* */ } } });
  const path = new URL(url).pathname || '/';
  const cls = classifyPage($, path);
  const $t = cheerio.load(html); $t('script,style,noscript,svg,iframe,nav,footer,header form').remove();
  const text = ($t('main').text() || $t('body').text()).replace(/\s+/g, ' ').trim().slice(0, 4000);
  return { title, h1, description, text, links: [...links], kind: cls.kind, kindSure: cls.sure };
}

async function parseSitemaps(urls: string[], host: string, budget = 400): Promise<string[]> {
  const out: string[] = []; const seen = new Set<string>(); const queue = [...urls];
  while (queue.length && out.length < budget && seen.size < 12) {
    const sm = queue.shift()!; if (seen.has(sm)) continue; seen.add(sm);
    try {
      const r = await fetchUrl(sm, 'application/xml,text/xml'); if (r.status >= 400) continue;
      const $ = cheerio.load(r.body.toString('utf8'), { xmlMode: true });
      $('sitemap > loc').each((_, el) => { queue.push($(el).text().trim()); });
      $('url > loc').each((_, el) => { const n = normUrl($(el).text().trim(), sm); if (n) { try { if (sameSite(new URL(n).hostname, host)) out.push(n); } catch { /* */ } } });
    } catch { /* ignore */ }
  }
  return out;
}

/** Crawl a domain. Throws CrawlError('unreachable'|'blocked'). */
export async function crawlSite(domain: string, onPage?: (n: number) => void): Promise<CrawlResult> {
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
  const fromSitemap = await parseSitemaps(sitemapUrls, host);

  const pages: CrawledPage[] = []; const seen = new Set<string>();
  const homeUrl = normUrl(home.url, origin) || origin + '/';
  const queue: string[] = [homeUrl]; seen.add(homeUrl);
  const push = (u: string) => { if (!seen.has(u) && allowed(u)) { seen.add(u); queue.push(u); } };
  const homeHtml = home.body.toString('utf8');
  const first = extract(homeHtml, home.url, origin);
  pages.push({ url: homeUrl, path: new URL(homeUrl).pathname || '/', ...first, html: homeHtml }); queue.shift();
  // Nav links from the homepage first (most important pages), then the sitemap, then discovered links.
  first.links.forEach(push); fromSitemap.forEach(push);
  onPage?.(pages.length);
  const delay = robots?.getCrawlDelay(uaToken()) || 0;
  while (queue.length && pages.length < MAX_PAGES) {
    const batch = queue.splice(0, delay ? 1 : 4);
    const res = await Promise.all(batch.map(async u => { try { return { u, r: await fetchUrl(u) }; } catch { return { u, r: null }; } }));
    for (const { u, r } of res) {
      if (!r || r.status >= 400 || !/html/i.test(r.type) || pages.length >= MAX_PAGES) continue;
      const finalUrl = normUrl(r.url, origin) || u;
      try { if (!sameSite(new URL(finalUrl).hostname, host)) continue; } catch { continue; }
      if (pages.some(p => p.url === finalUrl)) continue;
      const html = r.body.toString('utf8');
      const e = extract(html, r.url, origin);
      pages.push({ url: finalUrl, path: new URL(finalUrl).pathname || '/', ...e });
      e.links.forEach(push);
    }
    onPage?.(pages.length);
    if (delay) await new Promise(r => setTimeout(r, Math.min(delay, 5) * 1000));
  }
  return { origin, host, pages, homeHtml, robotsBlocked: false };
}
