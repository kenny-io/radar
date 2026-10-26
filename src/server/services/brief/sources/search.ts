// Reddit, LinkedIn, Quora and X without their own APIs: Perplexity's Search API (PERPLEXITY_API_KEY) restricted to the
// platform's domain and the past week. It returns real page URLs with publish dates (no model in between), so every
// candidate is a thread that exists. Falls back to the research model's web search (web.ts) when no key is set.
import { env } from '@/server/env';
import { fetchJson } from '@/server/ai/adapters/http';
import { BPLAT } from '@/lib/constants';
import { listL } from '@/lib/format';
import type { BriefPlatform } from '@/lib/types';
import { clip, queriesFor, shortHash, type Candidate } from '../plan';
import { HOSTS, PATHS, norm } from './web';
import { SourceError, withRetry, type Source } from './types';

export const hasSearchApi = () => !!env.perplexityKey;

const DOMAIN: Partial<Record<BriefPlatform, string>> = { reddit: 'reddit.com', linkedin: 'linkedin.com', quora: 'quora.com', x: 'x.com' };

/** "How do I … : r/webdev" · "r/webdev on Reddit: How do I …" · "… | LinkedIn" → "How do I …" */
export function cleanTitle(t: string): string {
  return (t || '')
    .replace(/^r\/[\w-]+ on Reddit:\s*/i, '')
    .replace(/\s*:\s*r\/[\w-]+\s*$/i, '')
    .replace(/\s*[|–-]\s*(LinkedIn|Quora|Reddit|X)\s*$/i, '')
    .replace(/\s+on X:\s*"?/i, ': ')
    .trim();
}

export const searchSource = (plat: BriefPlatform): Source => async (ctx) => {
  const domain = DOMAIN[plat];
  if (!domain) return [];
  const queries = queriesFor(ctx.plan.queries, 5, ctx.round);
  if (!queries.length) return [];
  let j: any;
  try {
    j = await withRetry(() => fetchJson('https://api.perplexity.ai/search', {
      method: 'POST', timeoutMs: 30000,
      headers: { authorization: `Bearer ${env.perplexityKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: queries, max_results: 20, search_domain_filter: [domain], search_recency_filter: 'week' }),
    }));
  } catch (e: any) {
    console.error(`[brief.search] ${plat}`, e?.message || e);
    throw new SourceError(`${BPLAT[plat]} search failed`);
  }
  // A multi-query request returns one result list per query.
  const rows: any[] = Array.isArray(j?.results?.[0]) ? j.results.flat() : (j?.results || []);
  ctx.onRead(rows.length);
  const out = new Map<string, Candidate>();
  for (const r of rows) {
    let u: URL; try { u = new URL(r.url); } catch { continue; }
    if (!HOSTS[plat]!.test(u.hostname) || !PATHS[plat]!.test(u.pathname)) continue;
    const id = `${plat}:s${shortHash(norm(r.url))}`;
    if (out.has(id)) continue;
    const posted = r.date && !isNaN(Date.parse(r.date)) ? new Date(r.date).toISOString() : null;
    const seg = u.pathname.split('/');
    const sub = plat === 'reddit' ? seg[2] : undefined;
    const handle = plat === 'x' ? '@' + seg[1] : '';
    out.set(id, {
      id, plat, url: r.url, title: clip(cleanTitle(r.title || ''), 300), body: clip(r.snippet || '', 600), postedAt: posted,
      where: plat === 'reddit' ? 'r/' + sub : plat === 'x' ? handle : plat === 'linkedin' ? 'LinkedIn' : 'Quora',
      who: handle, engN: 0, eng: '', community: sub,
      // Subreddit rules can't be read without the Reddit API: the plug is drafted, and the user is asked to check them.
      rulesUnknown: plat === 'reddit' ? true : undefined,
    });
  }
  const list = [...out.values()];
  if (plat === 'reddit') {
    const subs = [...new Set(list.map(c => c.where))].slice(0, 3);
    if (subs.length) ctx.setSub(listL(subs));
  }
  return list;
};
