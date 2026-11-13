// The one guarded request real covers make: a page, robots.txt, a sitemap or a picture on the business's own site.
// Every hop must be on the business's domain (or a subdomain) over https and must not be an internal address; redirects
// are followed by hand so a hop is checked before it is contacted. In dev-stub mode the synthesised site answers.
import { env } from '../../env';
import { assertPublicUrl, publicDispatcher } from '../../http/publicNetwork';
import { devFetch } from '../analysis/devsite';
import { ownSiteUrl } from '@/lib/ownSite';

export type SitePictureCode = 'invalid_address' | 'not_your_site' | 'left_site' | 'unreachable' | 'no_picture'
  | 'off_site_picture' | 'too_large' | 'too_small' | 'not_a_picture' | 'blank_picture';
/** `status`: for 'unreachable', the HTTP status when the site did answer (a 404, a 502, one redirect too many).
 *  Absent when there was no answer at all: DNS, a refused or blocked connection, a timeout, no requests left. */
export class SitePictureError extends Error { constructor(public code: SitePictureCode, public host?: string, public status?: number) { super(code); } }

export const ACCEPT = {
  any: 'text/html,application/xhtml+xml,image/webp,image/png,image/jpeg;q=0.9',
  page: 'text/html,application/xhtml+xml',
  picture: 'image/webp,image/png,image/jpeg,image/*;q=0.5',
  text: 'text/plain,application/xml,text/xml',
} as const;
export const MAX_REDIRECTS = 3;
export const PICTURE_MAX_BYTES = 8 * 1024 * 1024, PAGE_MAX_BYTES = 3 * 1024 * 1024, ROBOTS_MAX_BYTES = 500 * 1024;
/** Requests one attempt may make, redirect hops included. */
export const MAX_REQUESTS = 12;

export interface OwnResponse { url: string; type: string; body: Buffer }
export interface OwnFetch { domain: string; accept: string; maxBytes: number; over: 'reject' | 'truncate'; signal: AbortSignal; requests: { left: number } }

const REDIRECT = [301, 302, 303, 307, 308];
const cancel = async (r: Response) => { try { await r.body?.cancel(); } catch { /* already closed */ } };

/** One GET on the business's own site. Every hop must pass ownSiteUrl and assertPublicUrl. Throws SitePictureError:
 *  'left_site' (a hop is off the domain; `host` names it), 'too_large' (over `maxBytes` with over: 'reject'),
 *  'unreachable' (everything else: DNS, blocked address, timeout, more than 3 redirects, a status outside 200–299,
 *  no requests left; it carries the HTTP status when the site answered with one). */
export async function fetchOwn(address: URL, o: OwnFetch): Promise<OwnResponse> {
  try { return await get(address, o); }
  catch (error) { if (error instanceof SitePictureError) throw error; throw new SitePictureError('unreachable'); }
}

async function get(address: URL, o: OwnFetch): Promise<OwnResponse> {
  let at = address;
  for (let redirects = 0; ; redirects++) {
    if (o.requests.left-- <= 0 || o.signal.aborted) throw new SitePictureError('unreachable');
    // The caller checked the first address, so a refusal here is a redirect that left the site (or asked for a port or another scheme).
    const own = ownSiteUrl(at.href, o.domain);
    if (!own.ok) throw new SitePictureError('left_site', own.host || at.hostname || undefined);
    const url = own.url;

    if (env.devStubs) {
      const r = await devFetch(url.href); // throws for an unreachable stub domain
      if (r.status >= 400) throw new SitePictureError('unreachable', undefined, r.status);
      if (r.body.length <= o.maxBytes) return { url: url.href, type: r.type, body: r.body };
      if (o.over === 'reject') throw new SitePictureError('too_large');
      return { url: url.href, type: r.type, body: r.body.subarray(0, o.maxBytes) };
    }

    assertPublicUrl(url); // an internal address is refused before any request, and is not described to the user
    // Always the re-serialised address, never the text that was typed or found. Nothing but these three headers is sent.
    const r = await fetch(url.href, {
      headers: { 'user-agent': env.crawlerUserAgent, accept: o.accept, 'accept-language': 'en;q=0.9,*;q=0.5' },
      redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', signal: o.signal, dispatcher: publicDispatcher(),
    } as RequestInit);
    const location = r.headers.get('location');
    if (REDIRECT.includes(r.status) && location) {
      await cancel(r);
      if (redirects >= MAX_REDIRECTS) throw new SitePictureError('unreachable', undefined, r.status);
      at = new URL(location, url);
      continue;
    }
    if (r.status < 200 || r.status > 299) { await cancel(r); throw new SitePictureError('unreachable', undefined, r.status); }
    const declared = Number(r.headers.get('content-length'));
    if (o.over === 'reject' && Number.isFinite(declared) && declared > o.maxBytes) { await cancel(r); throw new SitePictureError('too_large'); }

    // Bytes are counted after any content decoding, so a compressed body is bounded by what it expands to.
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = r.body?.getReader();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.length > o.maxBytes) {
          try { await reader.cancel(); } catch { /* already closed */ }
          if (o.over === 'reject') throw new SitePictureError('too_large');
          chunks.push(value.subarray(0, o.maxBytes - size)); break;
        }
        size += value.length; chunks.push(value);
      }
    }
    return { url: url.href, type: r.headers.get('content-type') || '', body: Buffer.concat(chunks) };
  }
}
