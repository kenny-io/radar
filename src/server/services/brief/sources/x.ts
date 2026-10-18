// X API v2 recent search (Bearer token, paid tier). Original posts from the last ~48h matching the plan's terms.
import { env } from '@/server/env';
import { fetchJson } from '@/server/ai/adapters/http';
import { clip, engLabel, type Candidate } from '../plan';
import { withRetry, type Source } from './types';

export const hasXApi = () => !!env.xBearer;

export const xSource: Source = async (ctx) => {
  const { plan } = ctx;
  // Basic tier: 512-char query limit.
  const parts: string[] = [];
  for (const q of [...plan.terms.slice(0, 4), ...plan.alt.slice(0, 2)]) {
    const next = [...parts, `"${q.replace(/"/g, '')}"`];
    if (`(${next.join(' OR ')}) -is:retweet -is:reply lang:en`.length > 500) break;
    parts.push(`"${q.replace(/"/g, '')}"`);
  }
  if (!parts.length) return [];
  const query = `(${parts.join(' OR ')}) -is:retweet -is:reply lang:en`;
  const start = new Date(Math.max(ctx.sinceMs, Date.now() - 6.9 * 864e5)).toISOString();
  const qs = new URLSearchParams({ query, max_results: '100', start_time: start, 'tweet.fields': 'created_at,public_metrics,author_id,lang', expansions: 'author_id', 'user.fields': 'username,name' });
  const j = await withRetry(() => fetchJson(`https://api.x.com/2/tweets/search/recent?${qs}`, { headers: { authorization: `Bearer ${env.xBearer}` }, timeoutMs: 20000 }));
  const users = new Map<string, any>((j?.includes?.users || []).map((u: any) => [u.id, u]));
  const tweets: any[] = j?.data || [];
  ctx.onRead(tweets.length);
  const out: Candidate[] = [];
  for (const t of tweets) {
    const u = users.get(t.author_id); if (!u) continue;
    const replies = t.public_metrics?.reply_count || 0;
    out.push({
      id: `x:${t.id}`, plat: 'x', where: '@' + u.username, who: '@' + u.username, url: `https://x.com/${u.username}/status/${t.id}`,
      title: clip(t.text.replace(/https?:\/\/\S+/g, '').trim(), 280), body: '', postedAt: t.created_at || null,
      engN: replies + Math.round((t.public_metrics?.like_count || 0) / 20), eng: engLabel(replies, 'replies'),
    });
  }
  return out;
};
