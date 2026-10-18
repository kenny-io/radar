// Link verification: fetch the page that should carry the link and confirm an <a href> to the target exists with the right rel.
import * as cheerio from 'cheerio';
import { env } from '../../env';
import { absUrl, displayUrl } from './network';

export interface LinkCheck {
  /** the page answered and was parsed */
  reachable: boolean;
  /** a link to the target exists */
  found: boolean;
  /** the found link satisfies the expected rel */
  relOk: boolean;
  /** observed rel short form: 'sponsored' | 'nofollow' | 'Editorial' (no qualifier) */
  rel: string | null;
  anchorText: string | null;
  http: number | null;
}

const norm = (u: string) => displayUrl(u).toLowerCase();

/**
 * expectRel: 'sponsored' → rel must include sponsored; 'nofollow' → nofollow or sponsored; anything else → any rel.
 * stub (dev only): the deterministic outcome to report instead of fetching.
 */
export async function checkLink(from: string, to: string, expectRel: string, stub: 'present' | 'absent'): Promise<LinkCheck> {
  if (env.devStubs) {
    const rel = /sponsored/.test(expectRel) ? 'sponsored' : /nofollow/.test(expectRel) ? 'nofollow' : 'Editorial';
    return stub === 'present' ? { reachable: true, found: true, relOk: true, rel, anchorText: null, http: 200 } : { reachable: true, found: false, relOk: false, rel: null, anchorText: null, http: 200 };
  }
  let http: number | null = null;
  try {
    const r = await fetch(absUrl(from), { headers: { 'user-agent': env.crawlerUserAgent, accept: 'text/html,application/xhtml+xml' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    http = r.status;
    // A page that's gone (404/410) no longer carries the link. Anything else non-2xx is inconclusive.
    if (r.status === 404 || r.status === 410) return { reachable: true, found: false, relOk: false, rel: null, anchorText: null, http };
    if (!r.ok) return { reachable: false, found: false, relOk: false, rel: null, anchorText: null, http };
    const html = (await r.text()).slice(0, 3_000_000);
    const $ = cheerio.load(html);
    const target = norm(to); const base = r.url || absUrl(from);
    let best: LinkCheck | null = null;
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      let abs: string; try { abs = new URL(href, base).toString(); } catch { return; }
      if (norm(abs) !== target) return;
      const relAttr = ($(el).attr('rel') || '').toLowerCase();
      const rel = /sponsored/.test(relAttr) ? 'sponsored' : /nofollow/.test(relAttr) ? 'nofollow' : 'Editorial';
      const relOk = /sponsored/.test(expectRel) ? rel === 'sponsored' : /nofollow/.test(expectRel) ? rel !== 'Editorial' : true;
      const hit: LinkCheck = { reachable: true, found: true, relOk, rel, anchorText: $(el).text().trim().slice(0, 200), http };
      if (!best || (relOk && !best.relOk)) best = hit;
    });
    return best || { reachable: true, found: false, relOk: false, rel: null, anchorText: null, http };
  } catch (e: any) {
    console.warn('[backlinks] link check failed', from, e?.message || e);
    return { reachable: false, found: false, relOk: false, rel: null, anchorText: null, http };
  }
}
