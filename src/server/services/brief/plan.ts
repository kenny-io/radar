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
  /** Community rules forbid self-promotion (or the rules couldn't be read) → no mention variant */
  promoBanned?: boolean;
}

export interface Plan {
  name: string;
  terms: string[];
  needs: string[];
  competitors: string[];
  /** Search phrases, most important first */
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
  const queries = [...new Set([...pri, ...needs, ...offerings, ...alt])].filter(Boolean);
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
