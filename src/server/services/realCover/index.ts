// Real covers: a picture from the business's own site as an article's cover. Two ways in. A person gives the address
// of a page or a picture (pictureFromAddress). During a draft Radar looks for the page of the article's subject and a
// picture that page ties to the subject (findSubjectPicture); on any doubt it finds nothing and the cover is generated.
// The automatic path never takes a share image (og:image and the like); the owner's path may.
// Nothing is fetched from another host, and every request goes through fetchOwn.
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { objectKey, putObject } from '../storage';
import { ARTICLE_PATH, uaToken } from '../analysis/crawl';
import { ownSiteUrl } from '@/lib/ownSite';
import { withRealCover } from '@/lib/articleImages';
import type { Article } from '@/lib/types';
import { ACCEPT, MAX_REQUESTS, PAGE_MAX_BYTES, PICTURE_MAX_BYTES, ROBOTS_MAX_BYTES, SitePictureError, fetchOwn, type OwnFetch, type OwnResponse } from './fetch';
import { headerType, probeImage, readPicture } from './picture';
import { listingPath, nameTokens, namesSubject, ownerPictures, readPage, sameTokens, shareImages, shareKey, slugExtra, subjectPictures, titleLead } from './page';

export { SitePictureError, type SitePictureCode } from './fetch';

export const OWNER_BUDGET_MS = 25_000, AUTO_BUDGET_MS = 20_000;
/** How long a finished search that found nothing is remembered on the article (the period `article.videos` uses). */
export const REAL_COVER_RETRY_MS = 7 * 864e5;
/** Subjects Radar looks for by itself. A page named after an organisation usually shows a logo or a screenshot. */
export const AUTO_KINDS = ['building', 'place', 'product'];
const MAX_SITEMAPS = 4, MAX_SITEMAP_ADDRESSES = 20_000, MAX_CANDIDATES = 2, MAX_PICTURES = 2;
const SITEMAP_SKIP = /post|blog|news|tag|categor|author|image|video/i;

export interface FoundPicture { png: Buffer; page: string | null; src: string; w: number; h: number; fit: 'crop' | 'backdrop'; /** the picture's own alt text on the page, '' when none */ alt: string }

/** What a miss is remembered under: another subject or another domain is another search. */
export const realCoverKey = (name: string, domain: string) => nameTokens(name).join(' ') + '@' + domain;

type Budget = Pick<OwnFetch, 'domain' | 'signal' | 'requests'>;
const pageRequest = (b: Budget): OwnFetch => ({ ...b, accept: ACCEPT.page, maxBytes: PAGE_MAX_BYTES, over: 'truncate' });
const pictureRequest = (b: Budget): OwnFetch => ({ ...b, accept: ACCEPT.picture, maxBytes: PICTURE_MAX_BYTES, over: 'reject' });
const isHtml = (r: OwnResponse) => headerType(r.type).includes('html');

/** Owner path only. The share images of the home page of the site `page` is on, as comparison keys (shareKey), read
 *  once and only when a share picture is the next candidate. null: the home page could not be read, so no share
 *  picture is used. */
function homeShare(page: string, b: Budget) {
  let read: Promise<string[] | null> | undefined;
  return () => read ??= (async () => {
    try {
      const r = await fetchOwn(new URL('/', page), pageRequest(b));
      return isHtml(r) ? shareImages(r.body.toString('utf8'), r.url, b.domain).map(shareKey) : null;
    } catch { return null; }
  })();
}

/** Owner path: the cover picture for an address a person gave, a page or a picture on the business's own site.
 *  Throws SitePictureError for everything the address or the picture can cause. */
export async function pictureFromAddress(o: { domain: string; address: string; subject: string | null; budgetMs?: number }): Promise<FoundPicture> {
  const own = ownSiteUrl(o.address, o.domain);
  if (!own.ok) throw new SitePictureError(own.why === 'off_site' ? 'not_your_site' : 'invalid_address', own.host);
  const b: Budget = { domain: o.domain, signal: AbortSignal.timeout(o.budgetMs ?? OWNER_BUDGET_MS), requests: { left: MAX_REQUESTS } };
  // What the address is, is decided by the response, never by the file extension.
  const first = await fetchOwn(own.url, { ...b, accept: ACCEPT.any, maxBytes: PICTURE_MAX_BYTES, over: 'reject' });
  if (headerType(first.type).startsWith('image/') || probeImage(first.body)) return { ...(await readPicture(first)), page: null, src: first.url, alt: '' };
  if (!isHtml(first)) throw new SitePictureError('not_a_picture');

  const page = readPage(first.body.subarray(0, PAGE_MAX_BYTES).toString('utf8'), first.url, o.domain);
  const home = homeShare(first.url, b);
  const errors: SitePictureError[] = [];
  for (const candidate of ownerPictures(page, o.subject)) {
    if (errors.length >= MAX_PICTURES) break;
    if (candidate.from === 'share') { const shared = await home(); if (!shared || shared.includes(shareKey(candidate.url))) continue; } // the site's default card
    try { const res = await fetchOwn(new URL(candidate.url), pictureRequest(b)); return { ...(await readPicture(res)), page: first.url, src: res.url, alt: candidate.alt }; }
    catch (error) { if (!(error instanceof SitePictureError)) throw error; errors.push(error); } // anything else is a fault of Radar's, not of the picture
  }
  if (!errors.length && page.offSite.length) throw new SitePictureError('off_site_picture', page.offSite[0]);
  if (errors.length === 1) throw errors[0];
  throw new SitePictureError('no_picture');
}

/** The site answered: there was an HTTP answer and it was not a server error. A 404 is an answer ("no such file");
 *  no answer at all, a timeout or a 5xx says nothing about what the site has. */
const answeredBy = (error: unknown) => error instanceof SitePictureError && (error.code !== 'unreachable' || (error.status !== undefined && error.status < 500));

/** Addresses listed by the site's sitemaps, own-site only. A sitemap index is followed, but not into files that by
 *  their name list posts, tags, authors or media. `answered`: at least one request got an answer from the site. */
async function sitemapAddresses(start: string[], b: Budget): Promise<{ addresses: string[]; answered: boolean }> {
  const out: string[] = []; const queue = [...start]; const seen = new Set<string>(); let answered = false;
  while (queue.length && seen.size < MAX_SITEMAPS && out.length < MAX_SITEMAP_ADDRESSES) {
    const at = queue.shift()!; if (seen.has(at)) continue; seen.add(at);
    let r: OwnResponse;
    try { r = await fetchOwn(new URL(at), { ...b, accept: ACCEPT.text, maxBytes: PAGE_MAX_BYTES, over: 'truncate' }); } catch (error) { answered ||= answeredBy(error); continue; }
    answered = true;
    const $ = cheerio.load(r.body.toString('utf8'), { xmlMode: true });
    $('sitemap > loc').each((_, el) => { const child = ownSiteUrl($(el).text().trim(), b.domain, r.url); if (child.ok && !SITEMAP_SKIP.test(child.url.href)) queue.push(child.url.href); });
    $('url > loc').each((_, el) => { if (out.length >= MAX_SITEMAP_ADDRESSES) return; const u = ownSiteUrl($(el).text().trim(), b.domain, r.url); if (u.ok) out.push(u.url.href); });
  }
  return { addresses: out, answered };
}

/** Automatic path. Never throws. `searched` is false when Radar could not finish looking (timeout, the site or the
 *  picture could not be reached); only a finished search with nothing found is remembered. */
export async function findSubjectPicture(o: { bid: string; domain: string; subject: { name: string; kind: string }; budgetMs?: number }): Promise<{ picture: FoundPicture | null; searched: boolean }> {
  try {
    const st = nameTokens(o.subject.name);
    if (st.join('').length < 4) return { picture: null, searched: true }; // too short to match on safely
    const b: Budget = { domain: o.domain, signal: AbortSignal.timeout(o.budgetMs ?? AUTO_BUDGET_MS), requests: { left: MAX_REQUESTS } };

    // Pages the crawl already knows, on the business's own site. No request. A crawled page is a candidate when its h1
    // is the subject's name, or, having no h1, when its title leads with it. Either way the page itself is read and
    // must confirm it (namesSubject) before anything is taken from it.
    const stored = await db.select({ url: schema.crawlPages.url, title: schema.crawlPages.title, h1: schema.crawlPages.h1 }).from(schema.crawlPages).where(eq(schema.crawlPages.businessId, o.bid));
    const rows = stored.flatMap(r => { const own = ownSiteUrl(r.url, o.domain); return own.ok ? [{ url: own.url.href, origin: own.url.origin, title: r.title || '', h1: (r.h1 || '').trim() }] : []; });
    const counts = new Map<string, number>(); for (const r of rows) counts.set(r.origin, (counts.get(r.origin) || 0) + 1);
    const origin = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0] || `https://${o.domain}`;
    const named = rows.filter(r => sameTokens(nameTokens(r.h1 || titleLead(r.title)), st)).map(r => r.url);

    // robots.txt applies here, as in the crawl: this search is Radar's own initiative. A file that cannot be read means no rules.
    let robots: ReturnType<typeof robotsParser> | null = null; let answered = false;
    try { const r = await fetchOwn(new URL('/robots.txt', origin), { ...b, accept: ACCEPT.text, maxBytes: ROBOTS_MAX_BYTES, over: 'truncate' }); answered = true; robots = robotsParser(origin + '/robots.txt', r.body.toString('utf8')); }
    catch (error) { answered = answeredBy(error); /* no rules */ }
    const allowed = (u: string) => !robots || robots.isAllowed(u, uaToken()) !== false;

    let listed: string[] = [];
    if (!named.length) {
      const declared = (robots?.getSitemaps() || []).flatMap(s => { const own = ownSiteUrl(s, o.domain, origin + '/robots.txt'); return own.ok ? [own.url.href] : []; });
      const maps = await sitemapAddresses(declared.length ? declared : [origin + '/sitemap.xml'], b);
      listed = maps.addresses; answered ||= maps.answered;
    }
    // A page qualifies by its address when its last path segment starts with the subject's words; fewest extra words first.
    const bySlug = [...new Set([...rows.map(r => r.url), ...listed])].flatMap(url => { const extra = slugExtra(url, st); return extra === null ? [] : [{ url, extra }]; })
      .sort((x, y) => x.extra - y.extra || x.url.length - y.url.length).map(c => c.url);
    const candidates = [...new Set([...named, ...bySlug])].filter(u => { const path = new URL(u).pathname; return allowed(u) && !ARTICLE_PATH.test(path) && !listingPath(path); }).slice(0, MAX_CANDIDATES);

    // Nowhere to look, and the site never answered (no connection, a timeout, a server error): Radar did not finish
    // looking, so nothing is remembered. A site that answered "no such file" for its sitemap was looked at.
    let searched = candidates.length > 0 || answered;
    const unfinished = (error: unknown) => { if (!(error instanceof SitePictureError) || error.code === 'unreachable') searched = false; };
    for (const candidate of candidates) {
      let res: OwnResponse;
      try { res = await fetchOwn(new URL(candidate), pageRequest(b)); } catch (error) { unfinished(error); continue; }
      if (!isHtml(res)) continue;
      const page = readPage(res.body.toString('utf8'), res.url, o.domain);
      if (page.article || page.listing) continue;
      // The page must be the subject's own: "Wasl 611 Tower B" is not the page for "Wasl 611".
      if (!namesSubject(page, o.subject.name)) continue;
      let tried = 0;
      for (const p of subjectPictures(page, o.subject.name)) {
        if (tried >= MAX_PICTURES) break;
        if (!allowed(p.url)) continue;
        tried++;
        try { const file = await fetchOwn(new URL(p.url), pictureRequest(b)); return { picture: { ...(await readPicture(file)), page: res.url, src: file.url, alt: p.alt }, searched: true }; }
        catch (error) { unfinished(error); }
      }
    }
    return { picture: null, searched: searched && !b.signal.aborted };
  } catch (error: any) {
    console.error('[real cover] search failed', error?.message);
    return { picture: null, searched: false };
  }
}

/** Store the file and return the cover fields. Throws on a storage failure. */
export async function storeRealCover(bid: string, img: Article['img'], p: FoundPicture, by: 'radar' | 'owner', o: { subject?: string; alt?: string } = {}): Promise<Article['img']> {
  const url = await putObject(objectKey(bid, 'hero', 'png'), p.png, 'image/png');
  return withRealCover(img, url, { by, page: p.page, src: p.src, at: new Date().toISOString(), w: p.w, h: p.h, fit: p.fit, ...(o.subject ? { subject: o.subject } : {}) }, o.alt);
}
