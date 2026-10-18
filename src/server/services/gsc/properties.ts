// Property list for the connect flow (02-system.md §4): sites.list → radio rows with "Recommended" and the different-website warning.
import { accessToken, listSites } from './client';
import { stubSites } from './stub';

export interface GscProperty { v: string; l: string; note: string; recommended: boolean; otherSite: boolean }

const bare = (h: string) => h.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
/** Host a property covers: sc-domain:example.com → example.com, https://www.example.com/ → example.com */
export function propertyHost(siteUrl: string): string {
  if (siteUrl.startsWith('sc-domain:')) return bare(siteUrl.slice(10));
  try { return bare(new URL(siteUrl).hostname); } catch { return bare(siteUrl); }
}
const sameSite = (host: string, domain: string) => host === domain || host.endsWith('.' + domain) || domain.endsWith('.' + host);

export function rankProperties(siteUrls: string[], domainIn: string): GscProperty[] {
  const domain = bare(domainIn);
  const rows = [...new Set(siteUrls)].map(v => {
    const host = propertyHost(v); const isDomain = v.startsWith('sc-domain:'); const same = sameSite(host, domain);
    return { v, l: v, host, isDomain, same };
  });
  // Recommended: the sc-domain property for the domain; otherwise a URL-prefix property for the domain itself (www or apex), then a subdomain.
  const rec = rows.find(r => r.isDomain && r.host === domain)
    || rows.find(r => !r.isDomain && r.host === domain && /^https:/.test(r.v))
    || rows.find(r => !r.isDomain && r.host === domain)
    || rows.find(r => r.same);
  const out: GscProperty[] = rows.map(r => ({
    v: r.v, l: r.l, recommended: r === rec, otherSite: !r.same,
    note: !r.same ? 'Different website' : r.isDomain ? (r.host === domain ? 'Matches your website · Domain property' : 'Domain property') : (r === rec && r.host === domain ? 'Matches your website · URL prefix' : 'URL prefix'),
  }));
  const rank = (p: GscProperty) => (p.recommended ? 0 : p.otherSite ? 2 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.v.localeCompare(b.v));
}

export async function propertiesFor(bid: string, domain: string): Promise<GscProperty[]> {
  const { tokens, token } = await accessToken(bid);
  const sites = tokens.stub ? stubSites(domain) : (await listSites(token!)).map(s => s.siteUrl);
  return rankProperties(sites, domain);
}
