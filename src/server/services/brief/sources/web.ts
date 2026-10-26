// LinkedIn and Quora have no public search APIs (DIVERGENCES #1, #2). Radar finds public posts through the research
// model's web search tool, and keeps only results whose URL was actually returned by the search (no invented threads).
// Also the fallback for Reddit/X when their API credentials aren't configured.
import { z } from 'zod';
import { ai } from '@/server/ai';
import { BPLAT } from '@/lib/constants';
import type { BriefPlatform } from '@/lib/types';
import { clip, engLabel, queriesFor, shortHash, type Candidate } from '../plan';
import { SourceError, type Source } from './types';

export const HOSTS: Partial<Record<BriefPlatform, RegExp>> = {
  linkedin: /(^|\.)linkedin\.com$/i, quora: /(^|\.)quora\.com$/i, reddit: /(^|\.)reddit\.com$/i, x: /(^|\.)(x|twitter)\.com$/i,
};
export const PATHS: Partial<Record<BriefPlatform, RegExp>> = {
  linkedin: /^\/(posts|feed\/update|pulse)\//i, quora: /^\/(?!profile\/|topic\/)[^/]+/i, reddit: /^\/r\/[^/]+\/comments\//i, x: /^\/[^/]+\/status\/\d+/i,
};
const Threads = z.object({ threads: z.array(z.object({
  url: z.string(), title: z.string(), author: z.string().nullable(), authorHeadline: z.string().nullable(),
  excerpt: z.string().nullable(), postedAt: z.string().nullable(), engagementCount: z.number().nullable(),
})) });

export const norm = (u: string) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, '')).toLowerCase(); } catch { return u.toLowerCase(); } };

/** Web search can't filter to the last 48 hours the way platform APIs can, so web-found threads may be up to a week old
 *  (recency still lowers their score). */
const WEB_WINDOW_MS = 7 * 864e5;

export const webSource = (plat: BriefPlatform): Source => async (ctx) => {
  const { plan, profile } = ctx;
  const site = plat === 'linkedin' ? 'linkedin.com/posts' : plat === 'quora' ? 'quora.com' : plat === 'reddit' ? 'reddit.com' : 'x.com';
  const sinceMs = Math.min(ctx.sinceMs, Date.now() - WEB_WINDOW_MS);
  const days = Math.max(2, Math.round((Date.now() - sinceMs) / 864e5));
  const subs = plat === 'reddit' ? plan.subreddits.slice(0, 3) : [];
  const searches = [
    ...queriesFor(plan.queries, 6, ctx.round).map(q => `site:${site} ${q}`),
    ...subs.map((r, i) => `site:reddit.com/r/${r} ${plan.queries[i % Math.max(1, plan.queries.length)] || ''}`.trim()),
  ];
  const prompt = [
    `Find public ${BPLAT[plat]} ${plat === 'quora' ? 'questions' : 'posts'} from the last ${days} days where people in this audience ask for help or discuss problems this business can genuinely help with.`,
    `Audience: ${profile.audience.segments.join('; ')}. Buyers: ${profile.audience.buyers.join('; ')}. Needs: ${profile.audience.needs.join('; ')}.`,
    `Run several separate web searches (short keyword searches work best; do not put whole sentences in quotes), for example:\n${searches.map(q => '- ' + q).join('\n')}`,
    `Prefer the most recent posts. Skip anything older than ${days} days, and skip pages that are not individual ${plat === 'quora' ? 'questions' : 'posts or threads'} (profiles, topic pages, search pages).`,
    `Only include pages on ${site}. Do not include posts by ${profile.business.name} or by these competitors: ${plan.competitors.join(', ') || 'none'}.`,
    `For each result give the exact URL you found, the post title or first sentence, the author, the author's headline if shown, a short excerpt, the posting date (ISO) if shown, and the comment/answer count if shown. Return up to 10 results. Never invent results.`,
  ].join('\n');
  let res;
  try {
    res = await ai.run('research', { purpose: 'brief.web', system: 'You are a careful research assistant. You report only what your search actually returned.', prompt, schema: Threads, schemaName: 'threads', webSearch: true, maxTokens: 3000, timeoutMs: 150000 }, { businessId: ctx.bid, retries: 1 });
  } catch { throw new SourceError(`${plat} web search failed`); }
  const found = new Set(res.citations.map(c => norm(c.url)));
  const out: Candidate[] = [];
  const list = res.json?.threads || [];
  ctx.onRead(Math.max(list.length, res.citations.length));
  for (const t of list) {
    let u: URL; try { u = new URL(t.url); } catch { continue; }
    if (!HOSTS[plat]!.test(u.hostname) || !PATHS[plat]!.test(u.pathname)) continue;
    if (found.size && !found.has(norm(t.url))) continue; // must come from the search itself
    const posted = t.postedAt && !isNaN(Date.parse(t.postedAt)) ? new Date(t.postedAt).toISOString() : null;
    if (posted && Date.parse(posted) < sinceMs - 864e5) continue;
    const who = clip(t.author || '', 60);
    const n = Math.max(0, Math.round(t.engagementCount || 0));
    out.push({
      id: `${plat}:w${shortHash(norm(t.url))}`, plat,
      where: plat === 'linkedin' ? [who, clip(t.authorHeadline || '', 60)].filter(Boolean).join(' · ') || 'LinkedIn' : plat === 'reddit' ? ('r/' + (u.pathname.split('/')[2] || '')) : plat === 'x' ? '@' + (u.pathname.split('/')[1] || '') : 'Quora',
      who: who || (plat === 'x' ? '@' + u.pathname.split('/')[1] : ''), url: t.url, title: clip(t.title, 300), body: clip(t.excerpt || '', 600), postedAt: posted,
      engN: n, eng: n ? engLabel(n, plat === 'quora' ? 'answers' : plat === 'x' ? 'replies' : 'comments') : '',
      community: plat === 'reddit' ? u.pathname.split('/')[2] : undefined,
      // Subreddit rules can't be read without the Reddit API: the plug is drafted, and the user is asked to check them.
      rulesUnknown: plat === 'reddit' ? true : undefined,
    });
  }
  return out;
};
