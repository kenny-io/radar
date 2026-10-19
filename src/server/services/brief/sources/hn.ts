// Hacker News via the Algolia HN Search API (free, no key). Stories (incl. Ask HN / Show HN) and comments from ~48h.
// Relevance-ranked search (not newest-first) with every word optional: a multi-word keyword like "keep docs in sync
// with code" rarely appears verbatim, so threads matching most of its words rank first and ranking filters the rest.
import { fetchJson } from '@/server/ai/adapters/http';
import { clip, engLabel, stripHtml, type Candidate } from '../plan';
import { withRetry, type Source } from './types';

const API = 'https://hn.algolia.com/api/v1/search';
const STOPW = new Set('a an and are as at be by for from how in is it of on or the to with what why when your my our do does can'.split(' '));
const whereOf = (title: string, tags: string[] = []) => (tags.includes('ask_hn') || /^ask hn/i.test(title) ? 'Ask HN' : tags.includes('show_hn') || /^show hn/i.test(title) ? 'Show HN' : 'Hacker News');

export const hnSource: Source = async (ctx) => {
  const since = Math.floor(ctx.sinceMs / 1000);
  const out = new Map<string, Candidate>();
  const queries = [...new Set([...ctx.plan.terms.slice(0, 5), ...ctx.plan.competitors.slice(0, 2)])];
  for (const q of queries) {
    const words = q.toLowerCase().replace(/[^a-z0-9.+# -]/g, ' ').split(/\s+/).filter(w => w && !STOPW.has(w));
    if (!words.length) continue;
    const query = words.join(' ');
    const base = `query=${encodeURIComponent(query)}&optionalWords=${encodeURIComponent(query)}&numericFilters=created_at_i>${since}&hitsPerPage=20&getRankingInfo=1`;
    // At least two of the keyword's words must match (one, for one-word keywords and product names).
    const strong = (h: any) => (h?._rankingInfo?.words ?? words.length) >= Math.min(2, words.length);
    const [stories, comments] = await Promise.all([
      withRetry(() => fetchJson(`${API}?${base}&tags=(story,ask_hn,show_hn)`, { timeoutMs: 15000 })),
      withRetry(() => fetchJson(`${API}?${base}&tags=comment`, { timeoutMs: 15000 })),
    ]);
    ctx.onRead((stories?.hits?.length || 0) + (comments?.hits?.length || 0));
    for (const h of (stories?.hits || []).filter(strong)) {
      if (!h.title || out.has('hn:' + h.objectID)) continue;
      out.set('hn:' + h.objectID, {
        id: 'hn:' + h.objectID, plat: 'hn', where: whereOf(h.title, h._tags), who: h.author, url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: h.title, body: clip(stripHtml(h.story_text || ''), 600), postedAt: h.created_at || null, engN: h.num_comments || 0, eng: engLabel(h.num_comments || 0, 'comments'),
      });
    }
    for (const h of (comments?.hits || []).filter(strong)) {
      if (!h.story_title || out.has('hn:' + h.objectID)) continue;
      const text = clip(stripHtml(h.comment_text || ''), 400);
      if (text.length < 40) continue;
      out.set('hn:' + h.objectID, {
        id: 'hn:' + h.objectID, plat: 'hn', where: whereOf(h.story_title, h._tags), who: h.author, url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: h.story_title, body: '', postedAt: h.created_at || null, engN: 0, eng: '', comments: [{ who: h.author, text }],
      });
    }
  }
  return [...out.values()];
};
