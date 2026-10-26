// Discover step (02-system §9.1): queries from priority keywords, offerings, audience needs and competitor names,
// plus the human-readable "where Radar is looking" line for each platform's scan step.
import type { BriefPlatform, Profile } from '@/lib/types';
import { lcf, listL } from '@/lib/format';

export interface Candidate {
  /** Stable source id, e.g. "reddit:t3_abc123" */
  id: string;
  plat: BriefPlatform;
  /** r/freelance · @handle · "Name · Headline" · Ask HN */
  where: string;
  who: string;
  url: string;
  title: string;
  body: string;
  postedAt: string | null;
  engN: number;
  eng: string;
  comments?: { who: string; text: string }[];
  /** Subreddit/community name, when the platform has one */
  community?: string;
  /** Community rules forbid self-promotion → no plug variant */
  promoBanned?: boolean;
  /** Found by search, so the community's rules weren't read: the plug variant is drafted and the user is told to check them */
  rulesUnknown?: boolean;
}

export interface Plan {
  name: string;
  terms: string[];
  needs: string[];
  competitors: string[];
  /** Short search phrases (keywords and "X alternative"), most important first. Never full sentences: search engines
   *  and platform APIs match these literally, and long profile sentences match nothing. */
  queries: string[];
  /** "alternative to X" asks */
  alt: string[];
  subreddits: string[];
  subs: Record<BriefPlatform, string>;
  tokens: string[];
}

const STOP = new Set('a an and are as at be by for from how i in is it of on or our the to with without you your we my me this that what when who why can do does not no more less into over than their they them its it’s'.split(' '));
export const tokenize = (s: string) => s.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w));
const stem = (w: string) => w.replace(/(ing|ers|er|es|ed|s)$/, '').slice(0, 6);

/** Lexical relevance of a text to the plan (0..1-ish). Used to pre-filter before ranking and in dev stubs. */
export function relevance(text: string, plan: Pick<Plan, 'tokens'>): number {
  const t = new Set(tokenize(text).map(stem));
  if (!t.size) return 0;
  let hit = 0; for (const k of plan.tokens) if (t.has(k)) hit++;
  return Math.min(1, hit / Math.max(3, Math.min(8, plan.tokens.length / 3)));
}

/** Seed subreddits from the profile's audience and industry (the Reddit source adds API-discovered ones). */
const SUB_MAP: [RegExp, string[]][] = [
  [/freelanc/, ['freelance']],
  [/graphic|brand designer|design studio|designer/, ['graphic_design']],
  [/web design|web develop/, ['web_design']],
  [/small\b.*\b(?:business|team|studio|compan)|smb|owner/, ['smallbusiness']],
  [/agency|studio/, ['agency']],
  [/consult/, ['consulting']],
  [/startup|founder|saas/, ['startups', 'SaaS']],
  [/developer|engineer|software|devops/, ['webdev', 'ExperiencedDevs']],
  [/marketing|seo|growth/, ['marketing', 'SEO']],
  [/e-?commerce|shopify|online store|retail/, ['ecommerce', 'shopify']],
  [/restaurant|cafe|food/, ['restaurateur']],
  [/real estate|realtor/, ['realtors']],
  [/photograph/, ['photography']],
  [/account|bookkeep|tax|invoic/, ['Accounting', 'Bookkeeping']],
  [/productiv|time track/, ['productivity']],
  [/fitness|gym|trainer/, ['personaltraining']],
  [/writer|copywrit|content/, ['freelanceWriters', 'copywriting']],
];
export function seedSubreddits(p: Profile, max = 3): string[] {
  const texts = [...p.audience.segments, ...p.audience.buyers, p.business.industry, p.business.description].map(s => (s || '').toLowerCase());
  const out: string[] = [];
  for (const t of texts) for (const [re, subs] of SUB_MAP) if (re.test(t)) for (const s of subs) if (!out.includes(s)) out.push(s);
  for (const f of ['smallbusiness', 'Entrepreneur']) if (out.length < 2 && !out.includes(f)) out.push(f);
  return out.slice(0, max);
}

const plural = (s: string) => (/s$/i.test(s) ? s : /[^aeiou]y$/i.test(s) ? s.slice(0, -1) + 'ies' : s + 's');

export function buildPlan(p: Profile): Plan {
  const pri = p.keywords.list.filter(k => k.priority).map(k => k.kw);
  const terms = [...new Set([...pri, ...p.keywords.list.filter(k => !k.priority).map(k => k.kw)])].slice(0, 8);
  const needs = p.audience.needs.map(lcf);
  const competitors = p.audience.competitors.filter(Boolean);
  const alt = competitors.map(c => `alternative to ${c}`);
  const offerings = p.business.offerings.map(lcf).slice(0, 3);
  const short = (s: string) => s.split(/\s+/).length <= 6 && s.length <= 60;
  const q0 = [...new Set([...terms.filter(short), ...competitors.slice(0, 3).map(c => `${c} alternative`)])].filter(Boolean);
  const queries = q0.length ? q0 : [lcf(p.business.industry || p.business.name)].filter(Boolean);
  const subreddits = seedSubreddits(p);
  const xTerms = (pri.length ? pri : terms).slice(0, 3);
  const quoraTerms = (pri.length ? pri : terms).slice(0, 2);
  const people = (p.audience.buyers.length ? p.audience.buyers : p.audience.segments).slice(0, 2).map(b => plural(lcf(b)));
  const tokens = [...new Set([...terms, ...needs, ...offerings, ...p.audience.segments, ...p.business.differentiators].flatMap(tokenize).map(stem))];
  return {
    name: p.business.name, terms, needs, competitors, queries, alt, subreddits, tokens,
    subs: {
      reddit: subreddits.map(s => 'r/' + s).join(', '),
      x: xTerms.length ? `posts about ${listL(xTerms)}` : `posts about ${lcf(p.business.industry || 'your industry')}`,
      linkedin: people.length ? listL(people) : `posts about ${lcf(p.business.industry || 'your industry')}`,
      hn: 'Ask HN and Show HN threads',
      quora: quoraTerms.length ? `questions about ${listL(quoraTerms)}` : `questions about ${lcf(p.business.industry || 'your industry')}`,
    },
  };
}

/** The `n` queries a source searches on scan `round` of the day (0 = the first scan): the first 3 (priority keywords)
 *  every time, and the rest of the budget rotating through the remaining queries, so successive scans search different
 *  terms. Round 0 is exactly `queries.slice(0, n)`. */
export function queriesFor(queries: string[], n: number, round = 0): string[] {
  const head = Math.min(3, n), k = n - head, rest = queries.slice(head);
  if (queries.length <= n || k <= 0) return queries.slice(0, n);
  const off = (Math.max(0, Math.floor(round || 0)) * k) % rest.length;
  return [...queries.slice(0, head), ...Array.from({ length: k }, (_, i) => rest[(off + i) % rest.length])];
}

/** The same post found twice (a Show HN posted again, a Reddit cross-post) has another id but the same title. The key is
 *  the platform plus the title in lower case without punctuation or accents. Null when the title is too generic to tell
 *  posts apart: under 5 words, or a search result titled only by its author ("Dan Kornas (@DanKornas) on X"). Scoped to
 *  the platform: the same title elsewhere is another audience, and a generic question elsewhere is another conversation. */
export function threadKey(t: { plat?: string; title: string }): string | null {
  const k = (t.title || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!t.plat || k.split(' ').length < 5 || /\bon (x|twitter|linkedin|reddit|quora)$/.test(k)) return null;
  return `${t.plat}:${k}`;
}

/** What the day has already seen: thread ids, and thread keys from earlier scans' candidates and today's replies. */
export function seenOf(cands: { id: string; tk?: string }[], items: { kind: string; plat?: string; title: string }[]) {
  return { ids: new Set(cands.map(c => c.id)), keys: new Set([...cands.map(c => c.tk), ...items.filter(i => i.kind === 'reply').map(threadKey)].filter(Boolean) as string[]) };
}

/** New candidates, one per thread: never a thread the day has seen (by id or thread key), and of two new threads with the
 *  same key only the one with more engagement (then the newer) is kept. */
export function uniqueCands(cs: Candidate[], seen: ReturnType<typeof seenOf>): Candidate[] {
  const out = new Map<string, Candidate>();
  const newer = (a: Candidate, b: Candidate) => Date.parse(a.postedAt || '') > Date.parse(b.postedAt || '');
  for (const c of cs) {
    const tk = threadKey(c);
    if (seen.ids.has(c.id) || (tk && seen.keys.has(tk))) continue;
    const k = tk || 'id:' + c.id; const cur = out.get(k);
    if (!cur || (cur.id !== c.id && (c.engN > cur.engN || (c.engN === cur.engN && newer(c, cur))))) out.set(k, c);
  }
  return [...out.values()];
}

/** "214 comments" / "38 replies" */
export const engLabel = (n: number, noun: 'comments' | 'replies' | 'answers') => `${n.toLocaleString('en-US')} ${n === 1 ? noun.replace(/ies$/, 'y').replace(/s$/, '') : noun}`;

/** Short stable hash for item ids. */
export function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
export const clip = (s: string, n: number) => { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s\S*$/, '') + '…' : t; };
export const stripHtml = (s: string) => (s || '').replace(/<p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&#x27;|&#39;/g, '’').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&#x2F;/g, '/').replace(/&amp;/g, '&').trim();
