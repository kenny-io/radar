/** The domain rule for pictures taken from a business's own site. Pure: the client may import it, the server is the authority. */

export type OwnUrl = { ok: true; url: URL } | { ok: false; why: 'invalid' | 'off_site'; host?: string };

const MAX_ADDRESS = 2000;
const CONTROL_OR_BACKSLASH = /[\p{Cc}\\]/u;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const withoutTrailingDot = (host: string) => host.replace(/\.$/, '');

/** The business's host name as the URL parser writes it (lower case, an IDN as `xn--…`), or null when `domain` is not a bare host name. */
function siteHost(domain: string): string | null {
  const text = withoutTrailingDot(domain.trim().toLowerCase());
  if (!text || /[\s/:@?#\\]/.test(text)) return null; // a path, port or userinfo is not a domain
  let u: URL;
  try { u = new URL('https://' + text); } catch { return null; }
  if (u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash) return null;
  const host = withoutTrailingDot(u.hostname);
  return host.includes('.') ? host : null;
}

/** The https address for `raw` when it is on the business's own site: the domain itself or a subdomain of it.
 *  With `base` (the page an address was found on), `raw` may be relative. Without it, `raw` is what a person typed:
 *  a missing scheme and a path-only address are completed. Never throws. */
export function ownSiteUrl(raw: string, domain: string, base?: string | URL): OwnUrl {
  const invalid: OwnUrl = { ok: false, why: 'invalid' };
  if (typeof raw !== 'string' || typeof domain !== 'string') return invalid;
  const d = siteHost(domain);
  if (!d) return invalid;

  let text = raw.trim();
  if (!text || text.length > MAX_ADDRESS || CONTROL_OR_BACKSLASH.test(text)) return invalid;
  if (base === undefined) {
    if (text.startsWith('/') && !text.startsWith('//')) text = `https://${d}${text}`;
    else if (!HAS_SCHEME.test(text)) text = `https://${text}`;
  }

  let u: URL;
  try { u = new URL(text, base); } catch { return invalid; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return invalid;
  // Read the port as the parser left it, before the upgrade: it has already dropped the scheme's own default
  // (:443 on https, :80 on http), so anything still here is refused and no port is ever passed through.
  if (u.username || u.password || u.port) return invalid;
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:') return invalid;

  const host = withoutTrailingDot(u.hostname);
  if (host !== d && !host.endsWith('.' + d)) return { ok: false, why: 'off_site', host };
  u.hostname = host;
  u.hash = '';
  return { ok: true, url: u };
}
