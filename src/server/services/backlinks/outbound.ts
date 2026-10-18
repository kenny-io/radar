// CONTRACT (CONTRACTS.md, platform area): called by the publishing service right before it sends an article's HTML.
// Inserts approved outbound network links ("Links from you") into the exact sentence the user approved, with the rel and
// the disclosure. Only when the partner (the link target) has approved its side too, and never after a removal request.
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { absUrl, hostOf, pathOf } from './network';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GAP = '(?:\\s|&nbsp;|&#160;|<(?!a[\\s>]|/a>)[^>]+>)+';

/** Regex that finds `sentence` in HTML, tolerant to entities, typographic quotes and inline tags (but not links). */
export function sentenceRegex(sentence: string): RegExp {
  const parts = sentence.trim().split(/\s+/).map(w => reEsc(w)
    .replace(/&/g, '(?:&|&amp;)')
    .replace(/[’']/g, "(?:’|'|&#8217;|&rsquo;|&#39;|&apos;)")
    .replace(/[“”"]/g, '(?:“|”|"|&quot;|&#8220;|&#8221;|&ldquo;|&rdquo;)')
    .replace(/—/g, '(?:—|&mdash;|&#8212;)')
    .replace(/–/g, '(?:–|&ndash;|&#8211;)'));
  return new RegExp(parts.join(GAP));
}

/** entryUrl may be absolute ("https://x.com/blog/a"), host-relative ("x.com/blog/a") or a path ("/blog/a"). */
function samePage(page: string, entryUrl: string) {
  const strip = (p: string) => p.replace(/\/+$/, '') || '/';
  if (strip(pathOf(page)) !== strip(entryUrl.startsWith('/') ? entryUrl.replace(/[?#].*$/, '') : pathOf(entryUrl))) return false;
  return entryUrl.startsWith('/') || hostOf(page).replace(/^www\./, '') === hostOf(entryUrl).replace(/^www\./, '');
}
function relAttr(rel: string) { return /sponsored/.test(rel) ? 'sponsored' : /nofollow/.test(rel) ? 'nofollow' : ''; }

export async function applyApprovedOutboundLinks(bid: string, entryUrl: string | null, html: string): Promise<string> {
  if (!entryUrl || !html) return html;
  try {
    const rows = await db.select().from(schema.proposals).where(and(eq(schema.proposals.businessId, bid), eq(schema.proposals.direction, 'out'), eq(schema.proposals.decision, 'approved')));
    const mine = rows.filter(r => !r.data?.removedAt && r.data?.page && samePage(r.data.page, entryUrl));
    if (!mine.length) return html;
    // Partner consent: the target's inbound row (same pairId) must be approved or auto-approved.
    const partnerIds = [...new Set(mine.map(r => r.partnerBusinessId).filter(Boolean) as string[])];
    const theirs = partnerIds.length ? await db.select().from(schema.proposals).where(and(inArray(schema.proposals.businessId, partnerIds), eq(schema.proposals.direction, 'in'))) : [];
    let out = html; const now = new Date().toISOString();
    for (const r of mine) {
      const d = r.data;
      const counterpart = d.pairId ? theirs.find(t => t.data?.pairId === d.pairId) : null;
      if (counterpart && counterpart.decision !== 'approved' && counterpart.decision !== 'auto') continue;
      const href = absUrl(d.target);
      if (out.includes(`href="${esc(href)}"`) || out.includes(`href="${href}"`)) continue; // already there
      const m = sentenceRegex(d.sentence || '').exec(out);
      if (!m) { console.warn(`[backlinks] approved outbound link ${r.id}: sentence not found in ${entryUrl}`); continue; }
      const e = d.edit || { before: d.before, anchor: d.anchor, after: d.after };
      const rel = relAttr(d.rel || '');
      const inline = /Partner link/.test(d.disclosure || '') ? ' <small>(Partner link)</small>' : '';
      const link = `<a href="${esc(href)}"${rel ? ` rel="${rel}"` : ''}>${esc(e.anchor)}</a>${inline}`;
      out = out.slice(0, m.index) + esc(e.before || '') + link + esc(e.after || '') + out.slice(m.index + m[0].length);
      await db.update(schema.proposals).set({ data: { ...d, insertedAt: now } }).where(eq(schema.proposals.id, r.id));
    }
    return out;
  } catch (e: any) {
    // Never block a publish because of a partner link.
    console.error('[backlinks] applyApprovedOutboundLinks failed', e?.message || e);
    return html;
  }
}
