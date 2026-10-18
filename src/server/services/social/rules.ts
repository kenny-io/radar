// Per-platform writing rules for social packs (02-system.md §8.1) — prompt text plus deterministic enforcement.
// Pure module (no DB): unit-tested in rules.test.ts.
import type { Platform, Profile } from '@/lib/types';

export const X_MAX = 280;

export const PLATFORM_RULES: Record<Platform, string> = {
  linkedin: 'LinkedIn: professional. A few short paragraphs (2–5), each one to three sentences. You may end with one genuine question to the reader. At most 2 hashtags, on the last line. No emoji walls, no "I’m thrilled to announce".',
  x: `X: short and direct. The whole post must be ${X_MAX} characters or fewer, including line breaks. No hashtags unless essential (max 1). No threads.`,
  facebook: 'Facebook: friendly and conversational, like talking to customers who already follow the page. Two short paragraphs at most. No hashtags.',
  reddit: 'Reddit: community-first. Start with a line "Title: …" then the body. Share something genuinely useful or ask a real question; never a hard sell, no marketing language, no calls to action. NEVER include any link or URL. ALWAYS end with a disclosure line in parentheses that starts "Disclosure: I work on {name}" (adapt the rest of the sentence).',
  quora: 'Quora: written as a helpful answer. Start with "Q: " followed by the question, then a blank line, then "Short answer: " with a one- or two-sentence answer, then a longer explanation. Be genuinely helpful first. If you mention {name} at all, add a disclosure such as "I work on {name}" or "Disclosure: I work at {name}."',
};

export const rulesFor = (k: Platform, name: string) => PLATFORM_RULES[k].replace(/\{name\}/g, name || 'this product');

const URL_RE = /\bhttps?:\/\/[^\s)\]]+/gi;
const BARE_DOMAIN_RE = /\b(?:www\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s)]*)?/gi;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Remove every link: markdown links keep their label, bare URLs are dropped. */
export function stripLinks(t: string): string {
  return t
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi, '$1')
    .replace(URL_RE, '')
    .replace(BARE_DOMAIN_RE, '')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
/** Keep only the allowed URL (the pack's own source), drop any other link. */
export function keepOnlyLink(t: string, allowed: string | null): string {
  const norm = (u: string) => u.replace(/[.,;:!?]+$/, '').replace(/\/$/, '').toLowerCase();
  const ok = allowed ? norm(allowed) : null;
  const out = t.replace(URL_RE, m => (ok && norm(m) === ok ? m : ''));
  return out === t ? t : out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

export function hasDisclosure(t: string, name: string): boolean {
  if (!name) return /disclosure|i work (on|at|for)/i.test(t);
  const n = esc(name);
  return new RegExp(`(disclosure[^\\n]*${n}|i work (on|at|for|with) ${n}|i(’|')m (on the team at|one of the people behind|with) ${n})`, 'i').test(t);
}
export const mentionsName = (t: string, name: string) => !!name && new RegExp(`\\b${esc(name)}\\b`, 'i').test(t);

/** Competitor names that appear in the text (whole-word, case-insensitive). */
export function competitorHits(t: string, competitors: string[]): string[] {
  return competitors.filter(c => c && c.trim().length > 1 && new RegExp(`\\b${esc(c.trim())}\\b`, 'i').test(t));
}

/** Cap hashtags at `max` — keeps the first ones, drops the rest. */
export function capHashtags(t: string, max: number): string {
  let n = 0;
  const out = t.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, (m) => (++n <= max ? m : ''));
  return out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Trim to ≤ max characters at a sentence (or word) boundary. Last resort after regenerating. */
export function fitTo(t: string, max: number): string {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const s = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('? '), cut.lastIndexOf('! '), cut.lastIndexOf('\n\n'));
  if (s > max * 0.5) return cut.slice(0, s + 1).trim();
  return cut.slice(0, max - 1).replace(/\s\S*$/, '').trim() + '…';
}

export interface Check { ok: boolean; problems: string[] }
/** Validate a draft against the platform rules. Problems are fed back to the writer on a retry. */
export function check(k: Platform, text: string, p: Profile, opts: { sourceLabel?: string } = {}): Check {
  const name = p.business.name; const problems: string[] = [];
  if (!text.trim()) problems.push('The post is empty.');
  if (k === 'x' && text.length > X_MAX) problems.push(`It is ${text.length} characters; X allows ${X_MAX}. Make it shorter.`);
  if (k === 'reddit' && /https?:\/\/|www\./i.test(text)) problems.push('Reddit posts must not contain links.');
  if (k === 'reddit' && !hasDisclosure(text, name)) problems.push(`Add a disclosure line: "Disclosure: I work on ${name}…".`);
  if (k === 'quora' && !/^\s*Q:/.test(text)) problems.push('Start with "Q: " and the question.');
  if (k === 'quora' && !/Short answer:/i.test(text)) problems.push('Include "Short answer: " right after the question.');
  if (k === 'quora' && mentionsName(text.replace(/^\s*Q:.*$/m, ''), name) && !hasDisclosure(text, name)) problems.push(`You mention ${name}; add "I work on ${name}" as a disclosure.`);
  if (k === 'linkedin' && (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length > 2) problems.push('Use at most 2 hashtags.');
  const comp = competitorHits(text, p.audience.competitors || []).filter(c => !(opts.sourceLabel && new RegExp(`\\b${esc(c)}\\b`, 'i').test(opts.sourceLabel)));
  if (comp.length) problems.push(`Don’t mention or promote competitors (${comp.join(', ')}).`);
  return { ok: !problems.length, problems };
}

/** Deterministic enforcement applied to every draft (after any retries). Guarantees the hard rules. */
export function enforce(k: Platform, text: string, p: Profile, opts: { allowedLink?: string | null; sourceLabel?: string } = {}): string {
  const name = p.business.name;
  let t = text.replace(/\r\n/g, '\n').trim();
  // Competitors are never promoted: drop sentences that name one (unless the source itself is about that competitor).
  const comp = competitorHits(t, p.audience.competitors || []).filter(c => !(opts.sourceLabel && new RegExp(`\\b${esc(c)}\\b`, 'i').test(opts.sourceLabel)));
  if (comp.length) {
    const re = new RegExp(`\\b(${comp.map(esc).join('|')})\\b`, 'i');
    t = t.split('\n').map(line => line.split(/(?<=[.!?])\s+/).filter(s => !re.test(s)).join(' ')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  if (k === 'reddit') {
    t = stripLinks(t);
    if (!hasDisclosure(t, name)) t = `${t}\n\n(Disclosure: I work on ${name}.)`;
  } else {
    t = keepOnlyLink(t, opts.allowedLink || null);
  }
  if (k === 'linkedin') t = capHashtags(t, 2);
  if (k === 'quora') {
    if (!/^\s*Q:/.test(t)) t = `Q: ${(opts.sourceLabel || '').replace(/[.?!…]+$/, '')}?\n\n${t}`;
    if (mentionsName(t.replace(/^\s*Q:.*$/m, ''), name) && !hasDisclosure(t, name)) t = `${t}\n\nDisclosure: I work on ${name}.`;
  }
  if (k === 'x') t = fitTo(t, X_MAX);
  return t;
}
