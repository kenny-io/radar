// Hacker News via the Algolia HN Search API (free, no key). Stories (incl. Ask HN / Show HN) and comments from ~48h.
import { fetchJson } from '@/server/ai/adapters/http';
import { clip, engLabel, stripHtml, type Candidate } from '../plan';
import { withRetry, type Source } from './types';

const API = 'https://hn.algolia.com/api/v1/search_by_date';
const whereOf = (title: string, tags: string[] = []) => (tags.includes('ask_hn') || /^ask hn/i.test(title) ? 'Ask HN' : tags.includes('show_hn') || /^show hn/i.test(title) ? 'Show HN' : 'Hacker News');

export const hnSource: Source = async (ctx) => {
  const since = Math.floor(ctx.sinceMs / 1000);
  const out = new Map<string, Candidate>();
  const queries = [...new Set([...ctx.plan.terms.slice(0, 4), ...ctx.plan.alt.slice(0, 2)])];
  for (const q of queries) {
    const base = `query=${encodeURIComponent(q)}&numericFilters=created_at_i>${since}&hitsPerPage=25`;
    const [stories, comments] = await Promise.all([
      withRetry(() => fetchJson(`${API}?${base}&tags=(story,ask_hn,show_hn)`, { timeoutMs: 15000 })),
      withRetry(() => fetchJson(`${API}?${base}&tags=comment`, { timeoutMs: 15000 })),
    ]);
    ctx.onRead((stories?.hits?.length || 0) + (comments?.hits?.length || 0));
    for (const h of stories?.hits || []) {
      if (!h.title || out.has('hn:' + h.objectID)) continue;
      out.set('hn:' + h.objectID, {
        id: 'hn:' + h.objectID, plat: 'hn', where: whereOf(h.title, h._tags), who: h.author, url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: h.title, body: clip(stripHtml(h.story_text || ''), 600), postedAt: h.created_at || null, engN: h.num_comments || 0, eng: engLabel(h.num_comments || 0, 'comments'),
      });
    }
    for (const h of comments?.hits || []) {
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
