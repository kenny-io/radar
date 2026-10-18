// YouTube suggestions for the Media tab (02-system.md §7 Videos): Data API search.list (q = keyword, type=video,
// videoEmbeddable=true, order=relevance, recent) then videos.list for duration/views/embeddable. 3 results + a one-line why.
// Dev stub (RADAR_DEV_STUBS=1): deterministic suggestions with `stub-` ids (rendered without a network embed).
import { z } from 'zod';
import { env } from '../../env';
import { ai } from '../../ai';
import { normKw } from '../gsc/metrics';
import type { VideoRef } from '@/lib/types';
import './stubs';

const REGION: Record<string, string> = { 'United States': 'US', 'United Kingdom': 'GB', Canada: 'CA', Australia: 'AU', Germany: 'DE', France: 'FR' };
const LANG = (l: string) => ({ english: 'en', spanish: 'es', portuguese: 'pt', german: 'de', french: 'fr', italian: 'it', dutch: 'nl', japanese: 'ja' } as Record<string, string>)[(l || 'English').toLowerCase().replace(/\s*\(.*$/, '')] || 'en';

export const youtubeConfigured = () => env.devStubs || !!env.youtubeKey;

/** ISO-8601 duration → "8:42" / "1:02:03" */
export function fmtDur(iso: string): string {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '') || [];
  const h = Number(m[2] || 0) + Number(m[1] || 0) * 24, mi = Number(m[3] || 0), s = Number(m[4] || 0);
  return h ? `${h}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${mi}:${String(s).padStart(2, '0')}`;
}
export const durSecs = (iso: string) => { const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '') || []; return Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0); };
/** 124000 → "124k", 1250000 → "1.3M" */
export function fmtViews(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(n);
}

interface RawVideo { id: string; title: string; channel: string; secs: number; dur: string; views: number; published: string; description: string }

async function yt(path: string, params: Record<string, string>) {
  const q = new URLSearchParams({ ...params, key: env.youtubeKey });
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${q}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`YouTube ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function searchReal(kw: string, market: string, language: string, exclude: string[]): Promise<RawVideo[]> {
  const after = new Date(Date.now() - 2 * 365 * 864e5).toISOString();
  const s = await yt('search', { part: 'snippet', q: kw, type: 'video', videoEmbeddable: 'true', order: 'relevance', maxResults: '12', publishedAfter: after, regionCode: REGION[market] || 'US', relevanceLanguage: LANG(language), safeSearch: 'strict' });
  const ids: string[] = (s.items || []).map((i: any) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const v = await yt('videos', { part: 'snippet,contentDetails,statistics,status', id: ids.join(',') });
  const byId = new Map<string, any>((v.items || []).map((x: any) => [x.id, x]));
  const ex = exclude.map(e => e.toLowerCase()).filter(Boolean);
  return ids.map(id => byId.get(id)).filter(Boolean).filter((x: any) => x.status?.embeddable && x.status?.privacyStatus === 'public')
    .map((x: any): RawVideo => ({ id: x.id, title: x.snippet.title, channel: x.snippet.channelTitle, secs: durSecs(x.contentDetails.duration), dur: fmtDur(x.contentDetails.duration), views: Number(x.statistics?.viewCount || 0), published: x.snippet.publishedAt, description: String(x.snippet.description || '').slice(0, 300) }))
    .filter(x => x.secs >= 90 && x.secs <= 45 * 60 && !ex.some(e => x.channel.toLowerCase().includes(e) || x.title.toLowerCase().includes(e)));
}

function hash(s: string) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h); }
function searchStub(kw: string): RawVideo[] {
  const k = kw.charAt(0).toUpperCase() + kw.slice(1); const h = hash(kw);
  return [
    { id: 'stub-' + (h % 9973), title: `${k}: a practical walkthrough`, channel: 'Studio Practice', secs: 522, dur: '8:42', views: 124000 + (h % 900), published: new Date(Date.now() - 40 * 864e5).toISOString(), description: `A step-by-step look at ${kw}.` },
    { id: 'stub-' + ((h >> 3) % 9973), title: `What I changed about ${kw} this year`, channel: 'Small Business Weekly', secs: 725, dur: '12:05', views: 61000 + (h % 500), published: new Date(Date.now() - 12 * 864e5).toISOString(), description: `Lessons on ${kw} from running a small team.` },
    { id: 'stub-' + ((h >> 6) % 9973), title: `5 mistakes with ${kw}`, channel: 'Indie Ops', secs: 378, dur: '6:18', views: 33000 + (h % 300), published: new Date(Date.now() - 200 * 864e5).toISOString(), description: `Common mistakes people make with ${kw}.` },
  ];
}

const WhyOut = z.object({ why: z.array(z.string()) });
function fallbackWhy(v: RawVideo, outline: string[]): string {
  const vt = new Set(normKw(v.title + ' ' + v.description).split(' ').filter(w => w.length > 3));
  const hit = outline.find(h => normKw(h).split(' ').filter(w => w.length > 3 && vt.has(w)).length >= 1);
  const recent = Date.now() - new Date(v.published).getTime() < 183 * 864e5;
  if (hit) return `Covers the same ground as “${hit}”`;
  return recent ? `Recent · ${fmtViews(v.views)} views on this topic` : `Popular on this topic · ${fmtViews(v.views)} views`;
}

/** 3 embeddable videos with a one-line, substantiated why. Returns [] when YouTube isn't configured. */
export async function suggestVideos(bid: string, o: { kw: string; title: string; outline: string[]; market: string; language: string; competitors: string[] }): Promise<VideoRef[]> {
  if (!youtubeConfigured()) return [];
  let raw: RawVideo[] = [];
  try { raw = env.devStubs ? searchStub(o.kw) : await searchReal(o.kw, o.market, o.language, o.competitors); } catch (e: any) { console.error('[youtube]', e.message); return []; }
  const top = raw.slice(0, 3);
  if (!top.length) return [];
  let whys: string[] = [];
  try {
    const out = await ai.run('writing', {
      purpose: 'article.videoWhy', schema: WhyOut, schemaName: 'why', maxTokens: 600, temperature: 0.2,
      system: 'You are Radar. Explain in one short line (max 60 characters) why each video suits the article. Use only the data given: titles, descriptions, publish dates, view counts and the outline. Never claim anything else.',
      prompt: `Article: “${o.title}” (keyword: ${o.kw})\nOutline:\n${o.outline.map(h => '- ' + h).join('\n') || '- (none yet)'}\n\nVideos:\n${top.map((v, i) => `${i + 1}. ${v.title} · ${v.channel} · ${v.dur} · ${v.views} views · published ${v.published.slice(0, 10)}\n   ${v.description.replace(/\s+/g, ' ')}`).join('\n')}\n\nReturn why[] in the same order.`,
      stubContext: { top, outline: o.outline },
    }, { businessId: bid });
    whys = out.json!.why;
  } catch { /* fall back to deterministic lines */ }
  return top.map((v, i) => ({ id: v.id, title: v.title, channel: v.channel, dur: v.dur, views: fmtViews(v.views), why: (whys[i] || '').trim().slice(0, 80) || fallbackWhy(v, o.outline) }));
}
export { fallbackWhy };
