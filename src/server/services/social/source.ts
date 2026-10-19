// What a pack is about: reads an article URL (server-side fetch, SSRF-guarded) or a Radar article to ground the posts.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import * as cheerio from 'cheerio';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { env } from '../../env';
import { RadarError } from '../../errors';
import { shortHead } from '@/lib/format';
import type { Article, Block } from '@/lib/types';

export interface Grounding { headline: string; brief: string; link: string | null }
export const URL_READ_ERROR = 'Radar couldn’t read that page. Check the link and try again.';

/* ── SSRF guard: public unicast addresses only ── */
export function isPublicIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80') || s.startsWith('ff')) return false;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s); if (m) return isPublicIp(m[1]);
    return true;
  }
  return false;
}
const safeLookup: any = (host: string, opts: any, cb: any) => {
  dns.lookup(host, { ...(typeof opts === 'object' ? opts : {}), all: true }, (err, addrs: any) => {
    if (err) return cb(err);
    const list = (Array.isArray(addrs) ? addrs : [{ address: addrs, family: 4 }]) as { address: string; family: number }[];
    const ok = list.filter(a => isPublicIp(a.address));
    if (!ok.length) return cb(new Error('blocked address'));
    if (opts && opts.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
};

function get(url: URL, hops = 0): Promise<{ status: number; type: string; body: Buffer; url: string }> {
  return new Promise((resolve, reject) => {
    if (!/^https?:$/.test(url.protocol)) return reject(new Error('protocol'));
    if (url.port && !['80', '443', '8080', '8443'].includes(url.port)) return reject(new Error('port'));
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && !isPublicIp(host)) return reject(new Error('blocked address')); // IP literals skip DNS lookup
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, { method: 'GET', lookup: safeLookup, timeout: 12000, headers: { 'user-agent': env.crawlerUserAgent, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'en' } }, res => {
      const st = res.statusCode || 0;
      if (st >= 300 && st < 400 && res.headers.location) {
        res.resume();
        if (hops >= 4) return reject(new Error('redirects'));
        try { return resolve(get(new URL(res.headers.location, url), hops + 1)); } catch (e) { return reject(e); }
      }
      const chunks: Buffer[] = []; let n = 0;
      res.on('data', (c: Buffer) => { n += c.length; if (n > 2_000_000) { req.destroy(); return; } chunks.push(c); });
      res.on('end', () => resolve({ status: st, type: String(res.headers['content-type'] || ''), body: Buffer.concat(chunks), url: url.toString() }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Extract the readable gist of an HTML page: title, description and body text (≤ 3,500 chars). */
export function extractPage(html: string): { title: string; description: string; text: string } {
  const $ = cheerio.load(html);
  const title = clean($('meta[property="og:title"]').attr('content') || $('title').first().text() || $('h1').first().text() || '');
  const description = clean($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '');
  $('script,style,noscript,svg,iframe,nav,footer,header,form,aside').remove();
  const root = $('article').first().length ? $('article').first() : $('main').first().length ? $('main').first() : $('body');
  const parts: string[] = [];
  root.find('h1,h2,h3,p,li,blockquote').each((_, el) => { const t = clean($(el).text()); if (t.length > 2) parts.push(/^h\d$/.test((el as any).tagName || '') ? `## ${t}` : t); });
  return { title, description, text: parts.join('\n').slice(0, 3500) };
}

/** Read an article URL to ground a pack. Dev stub never touches the network. */
export async function readUrl(raw: string): Promise<Grounding> {
  let u: URL; try { u = new URL(raw.trim()); } catch { throw new RadarError(URL_READ_ERROR); }
  if (env.devStubs) {
    const seg = u.pathname.split('/').filter(Boolean).pop() || ''; const head = (seg ? shortHead(seg, 90) : u.hostname).replace(/\.(html?|php|aspx?)$/i, '');
    return { headline: head || u.hostname, brief: `Page title: ${head}\nSite: ${u.hostname}\nSummary: An article on ${u.hostname} about ${head.toLowerCase()}. It walks through the problem, why it happens, and a few practical steps readers can take.`, link: u.toString() };
  }
  let r;
  try { r = await get(u); } catch (e: any) { console.error('[social] url read failed', u.hostname, e?.message); throw new RadarError(URL_READ_ERROR); }
  if (r.status >= 400 || !/html|text\/plain/i.test(r.type)) throw new RadarError(URL_READ_ERROR);
  const html = r.body.toString('utf8');
  const p = /html/i.test(r.type) ? extractPage(html) : { title: '', description: '', text: clean(html).slice(0, 3500) };
  if (!p.title && p.text.length < 120) throw new RadarError(URL_READ_ERROR);
  return { headline: p.title || shortHead(u.toString(), 90), brief: [`Page title: ${p.title}`, p.description && `Description: ${p.description}`, `Content:\n${p.text}`].filter(Boolean).join('\n'), link: r.url };
}

function blocksText(blocks: Block[], max = 2800): string {
  const out: string[] = [];
  for (const b of blocks || []) { if (b[0] === 'ul') out.push((b[1] as string[]).map(x => '- ' + x).join('\n')); else out.push(b[0] === 'p' ? String(b[1]) : `## ${b[1]}`); if (out.join('\n').length > max) break; }
  return out.join('\n').slice(0, max);
}
/** A Radar article (calendar entry + draft when there is one). */
export async function readArticle(bid: string, entryId: string): Promise<Grounding & { title: string }> {
  const e = (await db.select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.businessId, bid), eq(schema.calendarEntries.id, entryId))).limit(1))[0];
  if (!e) throw new RadarError('Choose an article.');
  const a = (await db.select().from(schema.articles).where(and(eq(schema.articles.businessId, bid), eq(schema.articles.entryId, entryId))).limit(1))[0];
  const art = a?.data as Article | undefined;
  const brief = [
    `Article title: ${e.title}`, `Target keyword: ${e.kw}`, e.audience && `Written for: ${e.audience}`, e.relevance && `Why it matters: ${e.relevance}`,
    art?.brief?.angle && `Angle: ${art.brief.angle}`, art?.seo?.meta && `Summary: ${art.seo.meta}`,
    art?.generated && art.body?.length ? `Article text:\n${blocksText(art.body)}` : art?.brief?.outline?.length ? `Outline:\n${art.brief.outline.map(x => '- ' + x).join('\n')}` : '',
  ].filter(Boolean).join('\n');
  return { title: e.title, headline: e.title, brief, link: e.status === 'published' ? e.publishedUrl : null };
}
