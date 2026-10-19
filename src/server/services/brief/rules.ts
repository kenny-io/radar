// Platform and voice rules applied to every Daily Brief draft, whatever the model returned (02-system §9 step 4).
// - Reddit: never include links.  - X: 280 characters or fewer.  - No hashtags or emoji.
// - `help` never names the business; `mention` names it with a plain disclosure.
import type { BriefPlatform } from '@/lib/types';

const URL_RE = /\bhttps?:\/\/[^\s)\]]+|\bwww\.[^\s)\]]+/gi;
const BARE_DOMAIN_RE = /\b[a-z0-9][a-z0-9-]*\.(?:com|app|io|co|net|org|dev|ai|so|xyz|me|studio|tools?)\b(?:\/[^\s)\]]*)?/gi;
const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/gu;
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍]/gu;
const DISCLOSURE_RE = /disclosure|\bi work (?:on|at|for)\b|\bi[’']m on the team\b|\b(?:we|i) built\b|\bi[’']m (?:one of )?the (?:founder|maker)s?\b|\bi run\b|\bi[’']m building\b|\bwhat i[’']m building\b|\bfounder of\b/i;

export const X_LIMIT = 280;
/** Remove quotes wrapping the whole text (models sometimes quote their answer). */
const unwrap = (t: string) => { const s = String(t || '').trim(); return /^["“][\s\S]*["”]$/.test(s) && !/["“”]/.test(s.slice(1, -1)) ? s.slice(1, -1).trim() : s; };

function tidy(t: string) {
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').replace(/\(\s*\)/g, '').replace(/\s+([.,;:!?])/g, '$1').trim();
}
export function stripLinks(t: string, extraDomains: string[] = []) {
  let out = t.replace(URL_RE, '').replace(BARE_DOMAIN_RE, '');
  for (const d of extraDomains.filter(Boolean)) out = out.replace(new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
  return tidy(out);
}
export const stripHashtags = (t: string) => tidy(t.replace(HASHTAG_RE, '$1'));
export const stripEmoji = (t: string) => tidy(t.replace(EMOJI_RE, ''));
export const hasDisclosure = (t: string) => DISCLOSURE_RE.test(t);
export const namesBusiness = (t: string, name: string) => !!name && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t);

/** Trim to ≤ max at a sentence boundary (falls back to a word boundary). */
export function fitLength(t: string, max = X_LIMIT): string {
  if (t.length <= max) return t;
  const parts = t.match(/[^.!?\n]+[.!?]+["”’)]*\s*|[^.!?\n]+$|\n+/g) || [t];
  let out = '';
  for (const p of parts) { if ((out + p).trimEnd().length > max) break; out += p; }
  out = out.trim();
  if (out.length >= Math.min(60, max / 3)) return out;
  const cut = t.slice(0, max - 1); return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:\s]+$/, '') + '…';
}

function dropSentencesNaming(t: string, name: string) {
  return tidy(t.split(/\n/).map(line => (line.match(/[^.!?]+[.!?]*["”’)]*\s*/g) || [line]).filter(s => !namesBusiness(s, name)).join('')).join('\n'));
}

export interface RuleCtx { plat: BriefPlatform; name: string; domain: string }
/** Clean any community-reply draft. variant 'help' must not mention the business; 'mention' must disclose. */
export function cleanReply(text: string, variant: 'help' | 'mention', c: RuleCtx): string {
  let t = stripEmoji(stripHashtags(unwrap(text)));
  if (c.plat === 'reddit') t = stripLinks(t, [c.domain]);
  if (variant === 'help' && namesBusiness(t, c.name)) t = dropSentencesNaming(t, c.name);
  if (variant === 'mention' && !hasDisclosure(t)) {
    const add = c.plat === 'x' ? ` (I work on ${c.name}.)` : `\n\nDisclosure: I work on ${c.name}.`;
    t = c.plat === 'x' ? fitLength(t, X_LIMIT - add.length) + add : t + add;
  }
  if (c.plat === 'x' && t.length > X_LIMIT) {
    if (variant === 'mention') {
      // keep the disclosure: trim the body before it
      const m = t.match(/\s*\((?:I work|Disclosure)[^)]*\)\s*$|\s*Disclosure:[^\n]*$/i);
      const tail = m ? m[0].trim() : '';
      const body = m ? t.slice(0, t.length - m[0].length) : t;
      t = tail ? fitLength(body, X_LIMIT - tail.length - 1) + ' ' + tail : fitLength(t);
    } else t = fitLength(t);
  }
  return tidy(t);
}
/** Clean a post for the business's own feed. */
export function cleanPost(text: string, plat: BriefPlatform): string {
  let t = stripEmoji(stripHashtags(unwrap(text)));
  if (plat === 'reddit') t = stripLinks(t);
  if (plat === 'x') t = fitLength(t);
  return tidy(t);
}

/** Subreddit rules that forbid self-promotion (a mention variant is never drafted there). */
export const PROMO_RULE_RE = /self[\s-]?promo|no (?:self[\s-]?)?promotion|no advertis|no (?:product|service|business) (?:plugs?|promotion|mentions?)|no spam(?:ming)?(?: or| \/)? (?:self|promo)|promoting your|no soliciting|no shilling/i;
