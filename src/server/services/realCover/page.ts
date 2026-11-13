// Reads one page of the business's own site for real covers: what the page calls its subject, and which pictures on
// it are on the business's own site. No request is made here and nothing is site-specific: only signals any website
// has (h1, share tags, image alt text, structured data).
import * as cheerio from 'cheerio';
import { ownSiteUrl } from '@/lib/ownSite';
import { ARTICLE_PATH, LISTING_PATH } from '../analysis/crawl';

/** Lower-cased words of a name: NFKD, combining marks removed, '&' read as 'and', split on anything that is not a
 *  letter or digit. No stemming, no stop words: "611" and "61" are different words. */
export function nameTokens(s: string): string[] {
  return String(s ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').replace(/&/g, ' and ').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
export const sameTokens = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i]);
const startsWith = (list: string[], head: string[]) => head.length > 0 && list.length >= head.length && head.every((t, i) => t === list[i]);

const LEAD_ENDS = [' — ', ' – ', ' - ', ' | ', ' · ', ' • ', ': ', ', '];
/** The lead of a title: the text before the first separator ("Wasl 611 — Apartments in Al Warsan" → "Wasl 611").
 *  A hint for where to look, never proof: "Harbour House - Annex" leads with another place's name. */
export function titleLead(title: string): string {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim();
  const cut = Math.min(...LEAD_ENDS.map(sep => { const i = t.indexOf(sep); return i < 0 ? Infinity : i; }));
  return (Number.isFinite(cut) ? t.slice(0, cut) : t).trim();
}

/** The words of an address's last path segment ("/property/wasl-611-al-warsan.html" → wasl, 611, al, warsan). */
export function slugTokens(address: string): string[] {
  let segment = '';
  try { segment = new URL(address).pathname.split('/').filter(Boolean).pop() || ''; } catch { return []; }
  try { segment = decodeURIComponent(segment); } catch { /* keep as written */ }
  return nameTokens(segment.replace(/\.(html?|php|aspx)$/i, ''));
}
/** How many words the address's last path segment has beyond the subject's, when it starts with the subject's words;
 *  null when it does not ("wasl-611-al-warsan" for "Wasl 611" → 2; for "Wasl 61" → null). */
export function slugExtra(address: string, subject: string[]): number | null {
  const slug = slugTokens(address);
  return startsWith(slug, subject) ? slug.length - subject.length : null;
}

export interface PagePicture { url: string; alt: string; from: 'ld' | 'img' | 'share'; /** from 'ld': the entity's name */ of?: string }
export interface PageFacts {
  /** The page's first h1 that has text; '' when it has none. */
  h1: string;
  /** The names of the page's structured-data entities that are not generic. */
  entityNames: string[];
  article: boolean; listing: boolean;
  /** Own-site pictures in document order: structured data, then <img>, then share images. */
  pictures: PagePicture[];
  /** Hosts of pictures that were skipped because they are not on the business's site. */
  offSite: string[];
}

// Their `name` is not a subject and their `image` is not a picture of one: the site itself, page furniture, people,
// and things said about or attached to a subject (a review of it carries the reviewer's photo, an offer a price tag).
const GENERIC = new Set(['Organization', 'WebSite', 'WebPage', 'BreadcrumbList', 'ListItem', 'ItemList', 'FAQPage', 'Question', 'Answer', 'Person', 'ImageObject', 'SearchAction',
  'Review', 'Rating', 'AggregateRating', 'Comment', 'Offer', 'AggregateOffer', 'VideoObject', 'MediaObject', 'AudioObject']);
const ARTICLE_TYPES = ['Article', 'BlogPosting', 'NewsArticle', 'TechArticle'];
const LISTING_TYPES = ['CollectionPage', 'SearchResultsPage', 'Blog', 'ItemList'];
// A path with one of these segments lists things filed under a name; it is not that name's own page.
const LISTING_SEGMENTS = new Set(['tag', 'tags', 'category', 'categories', 'topic', 'topics', 'author', 'authors', 'search', 'archive', 'archives']);
/** The address is a listing by its path alone: the home page, a blog or news index, or a tag, category, topic, author, search or archive page. */
export function listingPath(path: string): boolean {
  return path === '/' || path === '' || LISTING_PATH.test(path) || path.toLowerCase().split('/').some(segment => LISTING_SEGMENTS.has(segment));
}
/** Words an alt text may carry besides the subject's name and still be a picture of the subject, nothing more
 *  ("Wasl 611 · photo 1", "Exterior view of Wasl 611"). Any other word means the alt is about something else. */
export const GENERIC_PICTURE_WORDS = new Set(['photo', 'photos', 'image', 'images', 'picture', 'pictures', 'pic', 'view', 'exterior', 'interior', 'front', 'building', 'main', 'cover', 'hero', 'gallery', 'of', 'the', 'a']);
const SKIP_EXT = /\.(svg|gif|ico|avif)$/i;
const SKIP_WORDS = new Set(['logo', 'favicon', 'icon', 'sprite', 'placeholder', 'avatar', 'default']);
const SOURCE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_IMGS = 40;

interface Entity { types: string[]; name: string; images: string[] }
const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const typesOf = (v: any): string[] => [v?.['@type']].flat().filter((t): t is string => typeof t === 'string').map(t => t.replace(/^https?:\/\/schema\.org\//i, ''));
/** `image` as a string, an array, or an object with `url` or `contentUrl`. */
const imagesOf = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(imagesOf) : typeof v === 'string' ? [v] : v && typeof v === 'object' ? [text((v as any).url) || text((v as any).contentUrl)] : []).filter(Boolean);
/** Every entity in the page's JSON-LD blocks, `@graph` included. A block that does not parse is ignored. */
function entities($: cheerio.CheerioAPI): Entity[] {
  const out: Entity[] = [];
  const take = (v: any, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 3) return;
    if (Array.isArray(v)) { v.forEach(x => take(x, depth + 1)); return; }
    if (Array.isArray(v['@graph'])) take(v['@graph'], depth + 1);
    const types = typesOf(v);
    if (types.length) out.push({ types, name: text(v.name), images: imagesOf(v.image) });
  };
  $('script[type="application/ld+json"]').each((_, el) => { try { take(JSON.parse($(el).text()), 0); } catch { /* not JSON */ } });
  return out;
}

type Candidate = { url: string; w: number | null };
/** `srcset` as its addresses with their width descriptors (null when the candidate has none). */
function srcset(value: string | undefined): Candidate[] {
  // An address may contain commas, so it is read up to the next white space; a comma ends a candidate only at the end
  // of the address or after its descriptor.
  const s = String(value || '').trim(); const out: Candidate[] = [];
  for (let i = 0; i < s.length;) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    let j = i; while (j < s.length && !/\s/.test(s[j])) j++;
    let url = s.slice(i, j), descriptor = '';
    if (url.endsWith(',')) { url = url.replace(/,+$/, ''); i = j; }
    else { const comma = s.indexOf(',', j); const end = comma < 0 ? s.length : comma; descriptor = s.slice(j, end).trim(); i = end + 1; }
    const m = /^(\d+)w$/.exec(descriptor);
    if (url) out.push({ url, w: m ? Number(m[1]) : null });
  }
  return out;
}
/** The address to use for one <img>: from the width-described candidates, the smallest at least 1200 wide, else the
 *  largest; with none, `src`; when `src` is empty or inline data, the lazy-loading attributes. */
function imgAddress($: cheerio.CheerioAPI, el: any): string {
  const img = $(el);
  const sources = img.parent('picture').children('source').toArray().filter(s => { const type = ($(s).attr('type') || '').trim().toLowerCase(); return !type || SOURCE_TYPES.has(type); });
  const sets = [img.attr('srcset'), img.attr('data-srcset'), ...sources.flatMap(s => [$(s).attr('srcset'), $(s).attr('data-srcset')])].flatMap(srcset);
  const sized = sets.filter((c): c is { url: string; w: number } => c.w !== null).sort((a, b) => a.w - b.w);
  if (sized.length) return (sized.find(c => c.w >= 1200) || sized[sized.length - 1]).url;
  const usable = (v: string | undefined) => { const s = (v || '').trim(); return s && !/^data:/i.test(s) ? s : ''; };
  return usable(img.attr('src')) || usable(img.attr('data-src')) || usable(img.attr('data-lazy-src')) || usable(img.attr('data-original')) || sets[0]?.url || '';
}

function shareAddresses($: cheerio.CheerioAPI): string[] {
  const out: string[] = [];
  for (const key of ['og:image', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']) {
    $('meta').each((_, el) => { const m = $(el); if ((m.attr('property') || m.attr('name') || '').trim().toLowerCase() === key) out.push((m.attr('content') || '').trim()); });
  }
  $('link[rel]').each((_, el) => { if (($(el).attr('rel') || '').trim().toLowerCase() === 'image_src') out.push(($(el).attr('href') || '').trim()); });
  return out.filter(Boolean);
}

/** A file that is not a picture of anything (a format Radar refuses, or a logo, icon or stand-in by its file name). */
function skippedByName(raw: string, pageUrl: string): boolean {
  let path: string;
  try { path = new URL(raw, pageUrl).pathname; } catch { return false; }
  if (SKIP_EXT.test(path)) return true;
  const file = path.split('/').filter(Boolean).pop() || '';
  let name = file; try { name = decodeURIComponent(file); } catch { /* keep as written */ }
  return name.toLowerCase().split(/[-_.]+/).some(word => SKIP_WORDS.has(word));
}

export function readPage(html: string, pageUrl: string, domain: string): PageFacts {
  const $ = cheerio.load(html);
  const found = entities($);
  const specific = found.filter(e => !e.types.some(t => GENERIC.has(t)));
  let path = '/'; try { path = new URL(pageUrl).pathname || '/'; } catch { /* keep '/' */ }
  const meta = (key: string) => { let v = ''; $('meta').each((_, el) => { const m = $(el); if (!v && (m.attr('property') || m.attr('name') || '').trim().toLowerCase() === key) v = (m.attr('content') || '').trim(); }); return v; };
  const types = new Set(found.flatMap(e => e.types));

  const h1 = $('h1').toArray().map(el => text($(el).text())).find(Boolean) || '';
  const pictures: PagePicture[] = []; const offSite: string[] = []; const seen = new Set<string>();
  const add = (raw: string, from: PagePicture['from'], alt: string, of?: string) => {
    if (!raw || skippedByName(raw, pageUrl)) return;
    const own = ownSiteUrl(raw, domain, pageUrl);
    if (!own.ok) { if (own.why === 'off_site' && own.host && !offSite.includes(own.host)) offSite.push(own.host); return; }
    const key = from + ' ' + own.url.href;
    // The same picture again: listed once, with the first alt text any mention of it has.
    if (seen.has(key)) { const first = pictures.find(p => p.from === from && p.url === own.url.href); if (first && !first.alt && alt) first.alt = alt; return; }
    seen.add(key); pictures.push({ url: own.url.href, alt, from, ...(of ? { of } : {}) });
  };

  for (const e of specific) for (const image of e.images.slice(0, 2)) add(image, 'ld', '', e.name || undefined);
  $('img').slice(0, MAX_IMGS).each((_, el) => {
    const img = $(el);
    if (img.closest('header, nav, footer, aside').length) return;
    if ((img.attr('aria-hidden') || '').trim().toLowerCase() === 'true' || (img.attr('role') || '').trim().toLowerCase() === 'presentation') return;
    const declared = (v: string | undefined) => (/^\d+(\.\d+)?(px)?$/i.test((v || '').trim()) ? parseFloat(v!) : null);
    const w = declared(img.attr('width')), h = declared(img.attr('height'));
    if ((w !== null && w < 200) || (h !== null && h < 200)) return;
    add(imgAddress($, el), 'img', text(img.attr('alt')));
  });
  for (const raw of shareAddresses($)) add(raw, 'share', '');

  return {
    h1, entityNames: [...new Set(specific.map(e => e.name).filter(Boolean))],
    article: meta('og:type').toLowerCase() === 'article' || ARTICLE_TYPES.some(t => types.has(t)) || ARTICLE_PATH.test(path),
    listing: listingPath(path) || LISTING_TYPES.some(t => types.has(t)),
    pictures, offSite,
  };
}

/** The own-site share images of a page (owner action only): a share image the home page also carries is the site's
 *  default card, not a picture of anything. */
export function shareImages(html: string, pageUrl: string, domain: string): string[] {
  const $ = cheerio.load(html);
  return [...new Set(shareAddresses($).flatMap(raw => { const own = ownSiteUrl(raw, domain, pageUrl); return own.ok ? [own.url.href] : []; }))];
}
/** What two share images are compared by: the host without `www.` and the path. The query string is left out, so a
 *  cache-buster (`/og.png?v=2`) does not make the site's default card look like a page's own. */
export function shareKey(address: string): string {
  try { const u = new URL(address); return u.hostname.replace(/^www\./, '') + u.pathname; } catch { return address; }
}

/** The page is the subject's own page: its h1 has the subject's words and no others ("Wasl 611 Tower B" is not the
 *  page for "Wasl 611"). Only a page with no h1 at all may be confirmed by structured data instead, when an entity
 *  that is not generic carries exactly the subject's name. The title never confirms a page. */
export function namesSubject(page: Pick<PageFacts, 'h1' | 'entityNames'>, subject: string): boolean {
  const st = nameTokens(subject);
  if (!st.length) return false;
  if (page.h1) return sameTokens(nameTokens(page.h1), st);
  return page.entityNames.some(name => sameTokens(nameTokens(name), st));
}

/** The alt text names the subject and nothing else: the subject's words as a run, and every other word a numeral or
 *  a generic picture word. "Harbour House Annex · photo 1" is not a picture of "Harbour House". A numeral directly
 *  after the name is read as part of a longer name ("Marina Gate 2", "iPhone 15"), so it does not tie either. An alt
 *  that begins "Illustration" is a cover Radar generated and the site published, not a picture of the subject. */
export function altNamesSubject(alt: string, subject: string[]): boolean {
  const words = nameTokens(alt);
  if (!subject.length || words[0] === 'illustration') return false;
  const numeral = (w: string) => /^\p{N}+$/u.test(w);
  for (let at = 0; at + subject.length <= words.length; at++) {
    if (!startsWith(words.slice(at), subject)) continue;
    const before = words.slice(0, at), after = words.slice(at + subject.length);
    if (after.length && numeral(after[0])) continue;
    if ([...before, ...after].every(w => numeral(w) || GENERIC_PICTURE_WORDS.has(w))) return true;
  }
  return false;
}

/** Pictures the page ties to the subject, best first: structured data of that entity, then pictures whose alt text
 *  names it and nothing else. Never a share image: nothing ties one to the subject, and a card generated for each
 *  page from its title is common. */
export function subjectPictures(page: PageFacts, subject: string): PagePicture[] {
  const st = nameTokens(subject);
  if (!st.length) return [];
  const ld = page.pictures.filter(p => p.from === 'ld' && !!p.of && sameTokens(nameTokens(p.of), st));
  const img = page.pictures.filter(p => p.from === 'img' && altNamesSubject(p.alt, st));
  return unique([...ld, ...img]);
}

/** What the owner action tries on a page, best first: the subject's pictures, then every structured-data picture,
 *  then share images (the caller compares those with the home page's before using one), then every <img>. A picture
 *  with no alt text of its own takes the alt of the <img> on the page with the same address. */
export function ownerPictures(page: PageFacts, subject: string | null): PagePicture[] {
  const from = (kind: PagePicture['from']) => page.pictures.filter(p => p.from === kind);
  const alts = new Map<string, string>();
  for (const p of from('img')) if (p.alt && !alts.has(p.url)) alts.set(p.url, p.alt);
  return unique([...(subject ? subjectPictures(page, subject) : []), ...from('ld'), ...from('share'), ...from('img')]).map(p => (p.alt ? p : { ...p, alt: alts.get(p.url) || '' }));
}

/** No address twice; the first mention keeps its place. */
function unique(list: PagePicture[]): PagePicture[] {
  const seen = new Set<string>();
  return list.filter(p => !seen.has(p.url) && !!seen.add(p.url));
}
