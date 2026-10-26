// Reddit Data API (OAuth client-credentials app token). 02-system §9: search relevant subreddits + keywords, last 24–48h,
// respect subreddit rules, store where = r/…
import { env } from '@/server/env';
import { fetchJson } from '@/server/ai/adapters/http';
import { clip, engLabel, queriesFor, relevance, type Candidate } from '../plan';
import { PROMO_RULE_RE } from '../rules';
import { withRetry, type Source } from './types';

let token: { v: string; exp: number } | null = null;
async function appToken(): Promise<string> {
  if (token && token.exp > Date.now() + 60_000) return token.v;
  const basic = Buffer.from(`${env.redditClientId}:${env.redditClientSecret}`).toString('base64');
  const j = await fetchJson('https://www.reddit.com/api/v1/access_token', {
    method: 'POST', timeoutMs: 15000,
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', 'user-agent': env.redditUserAgent },
    body: 'grant_type=client_credentials',
  });
  if (!j.access_token) throw new Error('Reddit token missing');
  token = { v: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return token.v;
}
async function get(path: string): Promise<any> {
  return withRetry(async () => fetchJson('https://oauth.reddit.com' + path, { headers: { authorization: `Bearer ${await appToken()}`, 'user-agent': env.redditUserAgent }, timeoutMs: 15000 }));
}

export const hasRedditApi = () => !!(env.redditClientId && env.redditClientSecret);

export const redditSource: Source = async (ctx) => {
  const { plan } = ctx;
  // 1. Subreddits: profile seeds + API discovery from the audience terms.
  const subs = [...plan.subreddits];
  for (const q of [...ctx.profile.audience.segments.slice(0, 2), plan.terms[0]].filter(Boolean)) {
    if (subs.length >= 5) break;
    try {
      const r = await get(`/subreddits/search?q=${encodeURIComponent(q)}&limit=6&raw_json=1`);
      for (const c of r?.data?.children || []) {
        const d = c.data; if (!d || d.over18 || d.subreddit_type !== 'public' || (d.subscribers || 0) < 5000) continue;
        if (!subs.some(s => s.toLowerCase() === String(d.display_name).toLowerCase()) && subs.length < 5) subs.push(d.display_name);
      }
    } catch { /* discovery is best effort */ }
  }
  ctx.setSub(subs.map(s => 'r/' + s).join(', '));

  const out: Candidate[] = [];
  const query = queriesFor(plan.queries, 6, ctx.round).map(q => `"${q.replace(/"/g, '')}"`).join(' OR ');
  for (const sub of subs) {
    // Rules: if self-promotion is forbidden (or rules can't be read), Radar never drafts a mention there.
    let promoBanned = true;
    try {
      const rules = await get(`/r/${sub}/about/rules?raw_json=1`);
      promoBanned = (rules?.rules || []).some((r: any) => PROMO_RULE_RE.test(`${r.short_name || ''} ${r.description || ''} ${r.violation_reason || ''}`));
    } catch { /* unknown → conservative */ }
    const lists = await Promise.all([
      get(`/r/${sub}/search?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&t=week&limit=50&raw_json=1`),
      get(`/r/${sub}/new?limit=100&raw_json=1`),
    ]);
    const seen = new Set<string>();
    for (const l of lists) {
      const kids = l?.data?.children || [];
      ctx.onRead(kids.length);
      for (const c of kids) {
        const d = c.data; if (!d || seen.has(d.name)) continue; seen.add(d.name);
        if (d.stickied || d.over_18 || d.removed_by_category || d.locked || d.author === '[deleted]') continue;
        if (d.created_utc * 1000 < ctx.sinceMs) continue;
        out.push({
          id: `reddit:${d.name}`, plat: 'reddit', where: 'r/' + d.subreddit, who: 'u/' + d.author, url: 'https://www.reddit.com' + d.permalink,
          title: clip(d.title, 300), body: clip(d.selftext || '', 600), postedAt: new Date(d.created_utc * 1000).toISOString(),
          engN: d.num_comments || 0, eng: engLabel(d.num_comments || 0, 'comments'), community: d.subreddit, promoBanned,
        });
      }
    }
  }
  // 2. Comments for the most relevant threads (a reply can target a comment).
  const top = out.map(c => ({ c, r: relevance(c.title + ' ' + c.body, plan) })).filter(x => x.r > 0).sort((a, b) => b.r - a.r).slice(0, 8);
  for (const { c } of top) {
    try {
      const r = await get(`/comments/${c.id.split('_')[1]}?limit=30&depth=1&sort=top&raw_json=1`);
      const kids = (r?.[1]?.data?.children || []).filter((k: any) => k.kind === 't1');
      ctx.onRead(kids.length);
      c.comments = kids.map((k: any) => k.data).filter((d: any) => d.body && d.author !== 'AutoModerator' && d.body.length > 40 && d.body.length < 700)
        .slice(0, 5).map((d: any) => ({ who: 'u/' + d.author, text: clip(d.body, 400) }));
    } catch { /* comments optional */ }
  }
  return out;
};
