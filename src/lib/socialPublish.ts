// Social channels: the isomorphic rules shared by the UI (features/social/channels, Calendar, Dashboard, Daily Brief)
// and the server (services/social/publish, actions). A pure TypeScript port of prototype/radar-channels.jsx helpers,
// corrected for production: business time zone instead of the browser clock, absolute `dueAt` instants, ids that may
// contain colons, real image sizes. Contract: .factory/social-channels/architecture.md. Owner: architect (via the PM).
// Rules: no React, no server imports, and never read the clock here — callers pass `nowMs`.
import type { BriefItem, MediaMeta, Pub, PubErrCode, PubStatus, SocialAccount, SocialChannel, SocialPost, Workspace } from './types';
import { addDays, fmtTime, nowHMIn, todayIn } from './format';

/* ── Channels, platforms, accounts ── */

/** Platforms Radar can post to. Everything else stays copy-and-paste. */
export type PostPlatform = 'x' | 'linkedin';
export interface ChannelDef { k: SocialChannel; plat: PostPlatform; l: string; d: string; /** OAuth provider name (`openOAuth(provider, bid)`) */ provider: string }
export const SOC_CH: ChannelDef[] = [
  { k: 'x', plat: 'x', l: 'X', d: 'Post to your X account.', provider: 'x' },
  { k: 'li_profile', plat: 'linkedin', l: 'LinkedIn profile', d: 'Post as yourself.', provider: 'linkedin' },
  { k: 'li_page', plat: 'linkedin', l: 'LinkedIn page', d: 'Post as a company page you manage.', provider: 'linkedin_page' },
];
export const chOf = (k: SocialChannel): ChannelDef => SOC_CH.find(c => c.k === k)!;
export const PLAT_L: Record<PostPlatform, string> = { x: 'X', linkedin: 'LinkedIn' };
/** Posts: X and LinkedIn. */
export const canPost = (k: string | null | undefined): k is PostPlatform => k === 'x' || k === 'linkedin';
/** Replies: X only (and only on an explicit Reply now). */
export const canReply = (k: string | null | undefined): k is 'x' => k === 'x';

export const accountsOf = (B: { social: Pick<Workspace['social'], 'accounts'> }): SocialAccount[] => B.social.accounts || [];
export const accountsFor = (accts: SocialAccount[], k: string): SocialAccount[] => accts.filter(a => chOf(a.ch).plat === k);
export const acctLabel = (a: SocialAccount | null | undefined): string =>
  !a ? '' : a.ch === 'x' ? (a.handle || a.name) : a.name + (a.ch === 'li_page' ? ' · Page' : '');

/** "Post as" for a pack post: the pub's account, then the user's pick, then the page, then any live account, then the first. */
export function pickAccount(accts: SocialAccount[], k: string, o: { pubAcct?: string | null; chosen?: string | null } = {}): SocialAccount | null {
  const as = accountsFor(accts, k);
  return as.find(a => a.id === o.pubAcct) || as.find(a => a.id === o.chosen) || as.find(a => a.ch === 'li_page' && !a.expired) || as.find(a => !a.expired) || as[0] || null;
}
/** Daily Brief routing (handoff §1): X → the X account; LinkedIn "For your feed" → the profile; company post → the page. */
export function briefAccount(accts: SocialAccount[], k: string | null | undefined, company: boolean): SocialAccount | null {
  if (k === 'x') return accts.find(a => a.ch === 'x') || null;
  if (k === 'linkedin') return accts.find(a => a.ch === (company ? 'li_page' : 'li_profile')) || null;
  return null;
}

/* ── Stable ids ── */

/** Social pack post: `s:{packId}:{platform}`. Daily Brief item: `b:{YYYY-MM-DD}:{itemId}` (item ids may contain ':', e.g. `x:1843…`). */
export type Sid = { src: 'pack'; packId: string; platform: PostPlatform } | { src: 'brief'; day: string; itemId: string };
export const SID_MAX = 160;
export const packSid = (packId: string, k: PostPlatform) => `s:${packId}:${k}`;
export const briefSid = (day: string, itemId: string) => `b:${day}:${itemId}`;
export function parseSid(sid: string): Sid | null {
  if (typeof sid !== 'string' || sid.length > SID_MAX) return null;
  if (sid.startsWith('s:')) {
    const rest = sid.slice(2); const i = rest.lastIndexOf(':');
    const packId = rest.slice(0, i); const platform = rest.slice(i + 1);
    if (i < 1 || !canPost(platform) || packId.includes(':')) return null;
    return { src: 'pack', packId, platform };
  }
  if (sid.startsWith('b:')) {
    const day = sid.slice(2, 12); const itemId = sid.slice(13);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || sid[12] !== ':' || !itemId) return null;
    return { src: 'brief', day, itemId };
  }
  return null;
}

/* ── Preflight (handoff §3 "Checks before posting"; the server enforces the same function) ── */

export const LIMITS: Record<PostPlatform, { chars: number; imgs: number }> = { x: { chars: 280, imgs: 4 }, linkedin: { chars: 3000, imgs: 9 } };
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES: Record<PostPlatform, string[]> = { x: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], linkedin: ['image/jpeg', 'image/png', 'image/gif'] };
/** LinkedIn Images API: fewer than 36,152,320 pixels (checked on the server, where dimensions are known). */
export const LINKEDIN_MAX_PIXELS = 36_152_320;
const X_URL_LEN = 23;
// URLs as X counts them: with a scheme, or a bare domain on a known TLD (twitter-text links "radar.app" too). Not emails or @/#/$ tokens.
const X_TLDS = 'com|net|org|io|app|ai|co|dev|xyz|me|us|uk|de|fr|ca|au|in|info|biz|tv|so|gg|ly|sh|to|fm|news|blog|shop|store|site|online|tech|cloud|page|link|today|world|live|life|design|studio|agency|ventures|capital|finance|money|email|digital|network|solutions|group|media|services|company|inc|llc|ng|ke|za|ae|eu|es|it|nl|se|no|fi|dk|pl|ch|at|be|pt|br|mx|jp|cn|kr|sg|hk|nz|ie';
const URL_RE = new RegExp(`https?:\\/\\/[^\\s<>"]+|(?<![\\w@.$#/-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${X_TLDS})(?![a-z0-9-])(?:[/?#][^\\s<>"]*)?`, 'gi');
// twitter-text v3: these code point ranges weigh 1, everything else 2 (CJK…); every emoji sequence (ZWJ families, skin tones,
// flags, ❤️) counts 2 as a whole. Max weighted length 280.
const X_LIGHT: [number, number][] = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const graphemes = (t: string): string[] => typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t), g => g.segment) : [...t];

/** Characters as each platform counts them: X uses weighted length (every URL = 23, emoji = 2), LinkedIn code points. */
export function charCount(k: PostPlatform, text: string): number {
  if (k === 'linkedin') return [...text].length;
  let n = 0;
  const rest = text.replace(URL_RE, () => { n += X_URL_LEN; return ''; });
  for (const g of graphemes(rest)) {
    if (EMOJI_RE.test(g)) { n += 2; continue; }
    for (const ch of g) { const cp = ch.codePointAt(0)!; n += X_LIGHT.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2; }
  }
  return n;
}
/** Does the text carry a link as X sees it (scheme or bare domain)? Drives the link price. */
export const hasLink = (text: string) => new RegExp(URL_RE.source, 'i').test(text);

export type ProblemCode = 'empty' | 'too_long' | 'too_many_images' | 'images_pending' | 'image_too_big' | 'image_format';
export interface Problem { code: ProblemCode; msg: string; fix?: { l: string; action: 'compress' } }
export interface PreflightInput {
  text: string;
  /** One entry per image that would be uploaded; null/undefined meta = unknown (the server checks the real file). */
  images: (MediaMeta | null | undefined)[];
  /** Daily Brief: images are still being made. */
  imagesPending?: boolean;
}
const n0 = (x: number) => x.toLocaleString('en-US');
const mb = (b: number) => (b / (1024 * 1024)).toFixed(1);
const fmtName = (type: string) => (type.split('/')[1] || type).toUpperCase().replace('JPEG', 'JPG');

/** Problems that block Post now and Schedule, in display order. Empty = ready. */
export function preflight(k: PostPlatform, p: PreflightInput): Problem[] {
  const L = LIMITS[k]; const pl = PLAT_L[k]; const out: Problem[] = [];
  if (!p.text.trim()) out.push({ code: 'empty', msg: 'Write something to post.' });
  const len = charCount(k, p.text);
  if (len > L.chars) out.push({ code: 'too_long', msg: `Shorten to ${n0(L.chars)} characters to post on ${pl}. It’s ${n0(len)} now.` });
  if (p.imagesPending) out.push({ code: 'images_pending', msg: 'Radar is still making the images.' });
  if (p.images.length > L.imgs) out.push({ code: 'too_many_images', msg: `${pl} allows up to ${L.imgs} images.` });
  const big = p.images.findIndex(m => !!m && m.bytes > MAX_IMAGE_BYTES);
  if (big >= 0) out.push({ code: 'image_too_big', msg: `Image ${big + 1} is ${mb(p.images[big]!.bytes)} MB. ${pl}’s limit is 5 MB.`, fix: { l: 'Compress images', action: 'compress' } });
  const bad = p.images.findIndex(m => !!m && !IMAGE_TYPES[k].includes(m.type));
  if (bad >= 0 && big < 0) out.push({ code: 'image_format', msg: `Image ${bad + 1} is a ${fmtName(p.images[bad]!.type)} file, which ${pl} doesn’t accept.`, fix: { l: 'Compress images', action: 'compress' } });
  return out;
}

/** What a pack post would upload: always its one visual (rendered on the server if `imageUrl` is missing). */
export const packPreflightInput = (p: Pick<SocialPost, 'text' | 'imageMeta'>): PreflightInput => ({ text: p.text, images: [p.imageMeta ?? null] });
/** What a Brief post would upload: its finished images (X takes the first 4, as the X preview shows). Replies have none. */
export function briefPreflightInput(it: Pick<BriefItem, 'kind' | 'img'>, k: PostPlatform, text: string): PreflightInput {
  if (it.kind !== 'post' || !it.img) return { text, images: [] };
  const metas = it.img.urls.map((u, i) => (u ? (it.img!.meta?.[i] ?? null) : undefined)).filter(m => m !== undefined) as (MediaMeta | null)[];
  return { text, images: k === 'x' ? metas.slice(0, LIMITS.x.imgs) : metas, imagesPending: it.img.status === 'generating' };
}

/* ── Time: business time zone, absolute instants, locking ── */

/** A post locks 5 minutes before it sends (and while sending, or past due and not yet confirmed). */
export const LOCK_MS = 5 * 60_000;
/** A scheduled post more than 24 hours late is never sent; it fails as `stale`. */
export const STALE_MS = 24 * 3600_000;
/** Dates a scheduled post may use: today … +365 days. */
export const MAX_AHEAD_DAYS = 365;
export const STAGGER: Record<PostPlatform, string> = { linkedin: '09:00', x: '12:30' };
export const BRIEF_DEFAULT_TIME = '17:00';
/** Schedule window times: 6:00 AM–10:00 PM in 30-minute steps. */
export const TIME_SLOTS: string[] = (() => { const o: string[] = []; for (let h = 6; h <= 22; h++) for (const m of ['00', '30']) { if (h === 22 && m === '30') break; o.push(String(h).padStart(2, '0') + ':' + m); } return o; })();
export const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function offsetMs(tz: string, ms: number): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p: Record<string, string> = {}; for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}
/** The instant (epoch ms) of a wall-clock date+time in an IANA zone. A time skipped by DST moves forward; a repeated time takes the earlier instant. */
export function zonedTimeToUtc(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number); const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const o1 = offsetMs(tz, wall);
  let t = wall - o1;
  const o2 = offsetMs(tz, t);
  if (o2 !== o1) {
    const t2 = wall - o2;
    t = offsetMs(tz, t2) === o2 ? t2 : Math.max(t, t2);
  }
  return t;
}
/** Wall-clock date and time of an instant in a zone. */
export const localParts = (ms: number, tz: string): { date: string; time: string } => ({ date: todayIn(tz, new Date(ms)), time: nowHMIn(tz, new Date(ms)) });
export const dueAtIso = (date: string, time: string, tz: string) => new Date(zonedTimeToUtc(date, time, tz)).toISOString();
/** True when date+time in `tz` is not after now (the Schedule window's "That time has passed"). */
export const isPastSlot = (date: string, time: string, tz: string, nowMs: number) => zonedTimeToUtc(date, time, tz) <= nowMs;
/** The next 14 days from `today` (business today, B.today). */
export const dayOptions = (today: string, n = 14) => Array.from({ length: n }, (_, i) => addDays(today, i));
/** Schedule window default: packs → tomorrow at the platform's usual slot; Brief → today 5:00 PM. */
export const defaultSlot = (src: 'pack' | 'brief', k: PostPlatform, today: string) =>
  src === 'brief' ? { date: today, time: BRIEF_DEFAULT_TIME } : { date: addDays(today, 1), time: STAGGER[k] };

export const minsUntil = (pub: Pick<Pub, 'dueAt'>, nowMs: number) => (Date.parse(pub.dueAt) - nowMs) / 60_000;
/** Locked: sending, or scheduled within 5 minutes of (or past) its send time and not on hold. Locked posts can't be moved, edited, rescheduled or unscheduled. */
export function isLocked(pub: Pick<Pub, 'status' | 'dueAt' | 'held'> | null | undefined, nowMs: number): boolean {
  if (!pub) return false;
  if (pub.status === 'sending') return true;
  return pub.status === 'scheduled' && !pub.held && Date.parse(pub.dueAt) - nowMs <= LOCK_MS;
}

/* ── Time zone labels (any IANA zone, from Intl; D1) ── */

const UTC_ZONES = ['UTC', 'Etc/UTC', 'Etc/GMT', 'GMT', 'Etc/Universal', 'Universal', 'Etc/Zulu', 'Zulu'];
const ABBR = /^[A-Z]{2,5}$/;
const tzPart = (loc: string, tz: string, name: string, ms: number) => {
  try { return new Intl.DateTimeFormat(loc, { timeZone: tz, timeZoneName: name as any }).formatToParts(new Date(ms)).find(p => p.type === 'timeZoneName')?.value || ''; } catch { return ''; }
};
/** `{ abbr, name }` for a zone at an instant: "ET"/"Eastern Time", "BST"/"United Kingdom Time", "CET"/"Central European Time",
 *  "GMT+1"/"West Africa Standard Time". abbr: US generic (ET, PT…) → specific alphabetic (GMT, MST) → en-GB alphabetic (BST, CET, GST) → offset (GMT+1). */
export function tzLabel(tz: string, atMs: number): { abbr: string; name: string } {
  if (UTC_ZONES.includes(tz)) return { abbr: 'UTC', name: 'Coordinated Universal Time' };
  const g = tzPart('en-US', tz, 'shortGeneric', atMs); const s = tzPart('en-US', tz, 'short', atMs);
  const abbr = ABBR.test(g) ? g : ABBR.test(s) ? s : (() => { const b = tzPart('en-GB', tz, 'short', atMs); return ABBR.test(b) ? b : s || tz; })();
  const lg = tzPart('en-US', tz, 'longGeneric', atMs);
  const name = lg && !/^GMT/.test(lg) ? lg : tzPart('en-US', tz, 'long', atMs) || tz;
  return { abbr, name };
}
/** "9:00 AM ET" for a wall-clock time on a date in the business zone (abbr at that date, so BST/GMT is right). */
export const atTz = (tz: string, date: string, time: string) => `${fmtTime(time)} ${tzLabel(tz, zonedTimeToUtc(date, time, tz)).abbr}`;
/** Schedule window note. */
export const tzNote = (tz: string, nowMs: number) => { const l = tzLabel(tz, nowMs); return `Times are in ${l.name} (${l.abbr}). Change it in Settings → Publishing.`; };
/** Calendar chip time: "9a", "12:30p". */
export const shortTime = (t: string) => { const [h, m] = t.split(':').map(Number); return ((h % 12) || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? 'a' : 'p'); };

/* ── Copy shared by server errors and the UI ── */

export const COPY = {
  lockedMove: 'This post sends in a few minutes, so it can’t be moved now.',
  lockedEdit: 'This post sends in a few minutes, so it can’t be changed now.',
  pastDay: 'Pick today or a later day.',
  pastTime: 'That time has passed. Pick a later time.',
  tooFar: 'Pick a day within the next year.',
  alreadyPosted: 'This post is already live.',
  sending: 'This post is going out now.',
  notScheduled: 'This post isn’t scheduled.',
  notEnabled: 'Posting from Radar isn’t available for this business yet.',
  notConnected: (ch: SocialChannel) => `Connect ${chOf(ch).l} first.`,
  expired: (ch: SocialChannel) => `${chOf(ch).l} needs reconnecting.`,
  unscheduleFirst: 'Unschedule it first.',
  noAccountForAuto: 'Connect X or LinkedIn in Settings first.',
  replyNotAllowed: 'X only lets apps reply when the post mentions you. Reply in X’s own box instead.',
} as const;

export function errCopy(code: PubErrCode, k: PostPlatform): string {
  const pl = PLAT_L[k];
  switch (code) {
    case 'duplicate': return `${pl} rejected it as a duplicate of a recent post.`;
    case 'too_long': return `${pl} said the text is too long.`;
    case 'media': return `${pl} rejected the image.`;
    case 'rate_limit': return `${pl} is limiting posts right now. Try again later.`;
    case 'unavailable': return `${pl} didn’t respond.`;
    case 'auth': return `${pl} refused Radar’s access. Reconnect and try again.`;
    case 'quota': return `${pl} isn’t accepting posts from Radar right now. Try again later.`;
    case 'unknown': return `Radar couldn’t confirm the post went out. Check ${pl} before trying again.`;
    case 'stale': return 'It couldn’t go out on time, so Radar held it back.';
    default: return `${pl} rejected the post.`;
  }
}
/** The failed panel's second line: the error, then "Nothing was published." unless the outcome is unknown. */
export const failedLine = (pub: Pick<Pub, 'err' | 'code' | 'platform'>) => {
  const e = pub.err || errCopy(pub.code || 'rejected', pub.platform);
  return pub.code === 'unknown' ? e : `${e} Nothing was published.`;
};

/* ── X replies (X API, Feb 2026: self-serve apps may reply only when the post mentions or quotes the account) ── */

/** The post ID in an X status URL. */
export const xStatusId = (url: string | null | undefined): string | null => (url ? (/(?:x|twitter)\.com\/[^/]+\/status\/(\d{1,19})/i.exec(url)?.[1] ?? null) : null);
/** Does the text @mention this handle? */
export const mentions = (text: string, handle: string | null | undefined) => {
  const h = (handle || '').replace(/^@/, ''); if (!h) return false;
  return new RegExp(`(^|[^A-Za-z0-9_@])@${h.replace(/[^A-Za-z0-9_]/g, '')}(?![A-Za-z0-9_])`, 'i').test(text);
};
/** X's own reply box, prefilled. Reply now always uses it: self-serve X API plans refuse replies unless the author mentioned the
 *  account (Feb 2026), so Radar never posts replies itself. Opened in a new tab from the click; the user presses Reply on X and the
 *  item then goes to "I posted it". Needs no connected account (the user's own X session posts it). */
export const xReplyIntentUrl = (statusId: string, text: string) => `https://x.com/intent/tweet?in_reply_to=${encodeURIComponent(statusId)}&text=${encodeURIComponent(text)}`;
/** How Reply now works for an X reply: 'intent' (X's reply box) or null (no status id in the thread URL: Copy flow only). */
export function xReplyMode(it: Pick<BriefItem, 'kind' | 'plat' | 'url'>): 'intent' | null {
  return it.kind === 'reply' && it.plat === 'x' && xStatusId(it.url) ? 'intent' : null;
}

/* ── Estimated platform cost per publish (X pay-per-use, Oct 2026; LinkedIn is free). Logged in event props, never shown. ── */
export const X_COST_USD = { post: 0.015, postWithLink: 0.2 } as const;
/** Radar never posts replies (X's reply box is used), so only posts are priced. */
export const publishCostUsd = (k: PostPlatform, _kind: 'post', text: string) =>
  k !== 'x' ? 0 : hasLink(text) ? X_COST_USD.postWithLink : X_COST_USD.post;

/* ── Account expiry (LinkedIn tokens that can't be renewed in the background) ── */
/** True when the account's access ends before this send time: the post will be held until the user reconnects. */
export const expiresBefore = (acct: Pick<SocialAccount, 'expiresAt'> | null | undefined, dueMs: number) => !!acct?.expiresAt && Date.parse(acct.expiresAt) <= dueMs;
/** Non-blocking note in the Schedule window when the post is due after the account's access ends. */
export const expiryNote = (acct: SocialAccount, tz: string) => {
  const d = localParts(Date.parse(acct.expiresAt!), tz).date;
  return `${chOf(acct.ch).l} access for ${acctLabel(acct)} ends ${fmtDWShort(d)}. Reconnect before then, or this post waits until you do.`;
};
const fmtDWShort = (d: string) => new Date(d + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/* ── Sending helpers (server adapters; pure so they're tested here) ── */

/** LinkedIn Posts API `commentary` is "little" text: | { } @ [ ] ( ) < > # \ * _ ~ must be backslash-escaped to stay
 *  plain text. A '#' that starts a word is left as a hashtag. */
export const liCommentary = (text: string) => text.replace(/[|{}@[\]()<>#\\*_~]/g, (c, i: number, s: string) => (c === '#' && /[\p{L}\p{N}]/u.test(s[i + 1] || '') && (i === 0 || /\s/.test(s[i - 1])) ? c : '\\' + c));
/** Compare what Radar sent with a post read back from the platform (X rewrites links to t.co). */
export const normForMatch = (s: string) => s.replace(URL_RE, '').replace(/\s+/g, ' ').trim().slice(0, 120).toLowerCase();

/* ── Panel state (handoff §3) ── */

export type PanelState = 'copy_only' | 'not_connected' | 'posted' | 'sending' | 'expired' | 'scheduled' | 'failed' | 'ready';
/** Which §3 state a pack post's panel shows (same order as the prototype's PublishBox). */
export function packPanelState(k: string, post: Pick<SocialPost, 'pub'>, accts: SocialAccount[], cur: SocialAccount | null, nowMs: number): PanelState {
  if (!canPost(k)) return 'copy_only';
  if (!accountsFor(accts, k).length) return 'not_connected';
  const pub = post.pub || null;
  if (pub?.status === 'posted') return 'posted';
  if (isLocked(pub, nowMs)) return 'sending';
  if (cur?.expired) return 'expired';
  if (pub?.status === 'scheduled') return 'scheduled';
  if (pub?.status === 'failed') return 'failed';
  return 'ready';
}

/** Daily Brief: where an item would go and whether Post now / Reply now / Schedule are offered. X replies: `replyMode`
 *  'intent' → open xReplyIntentUrl in a new tab, then mark the item copied ("I posted it"); no account needed, never social.postNow. */
export function briefPublish(accts: SocialAccount[], it: Pick<BriefItem, 'kind' | 'plat' | 'pl' | 'acct' | 'url' | 'title' | 'body' | 'replyTo'>) {
  const k = it.kind === 'post' ? it.pl : it.plat;
  const can = it.kind === 'post' ? canPost(k) : canReply(k);
  const acct = can ? briefAccount(accts, k, (it.acct || 'founder') === 'company') : null;
  const replyMode = it.kind === 'reply' && can ? xReplyMode(it) : null;
  const direct = it.kind === 'reply' ? !!replyMode : !!(can && acct && !acct.expired);
  return { platform: can ? (k as PostPlatform) : null, can, acct, direct, replyMode: direct ? replyMode : null };
}

/* ── Schedule all ── */

export type ScheduleAllWhy = 'Copy and paste' | 'Not connected' | 'Reconnect needed' | 'Already posted' | 'Sending soon' | 'Fix issues first';
/** Shown in the pack header when two or more of the pack's platforms are postable. */
export const showScheduleAll = (platforms: string[]) => platforms.filter(canPost).length >= 2;
/** Why a row can't be scheduled (null = eligible). */
export function scheduleAllWhy(k: string, post: Pick<SocialPost, 'pub' | 'text' | 'imageMeta'>, accts: SocialAccount[], nowMs: number): ScheduleAllWhy | null {
  if (!canPost(k)) return 'Copy and paste';
  if (post.pub?.status === 'posted') return 'Already posted';
  if (isLocked(post.pub, nowMs)) return 'Sending soon';
  const as = accountsFor(accts, k);
  if (!as.some(a => !a.expired)) return as.length ? 'Reconnect needed' : 'Not connected';
  if (preflight(k, packPreflightInput(post)).length) return 'Fix issues first';
  return null;
}

/* ── Drag to reschedule ── */

/** Can this pub move to `toDate` (keeping its time)? null = yes; 'same' = no-op; otherwise the refusal copy. */
export function moveCheck(pub: Pick<Pub, 'status' | 'dueAt' | 'held' | 'date' | 'time'> | null | undefined, toDate: string, today: string, tz: string, nowMs: number): null | 'same' | string {
  if (!pub || pub.status !== 'scheduled') return COPY.notScheduled;
  if (pub.date === toDate) return 'same';
  if (isLocked(pub, nowMs)) return COPY.lockedMove;
  if (toDate < today) return COPY.pastDay;
  if (isPastSlot(toDate, pub.time, tz, nowMs)) return COPY.pastTime;
  return null;
}

/* ── Calendar / This week / Needs attention items ── */

export interface SocialItem {
  /** Stable id (sid): `s:{packId}:{platform}` | `b:{day}:{itemId}`. Drag payload. */
  id: string; src: 'pack' | 'brief';
  packId?: string; day?: string; itemId?: string;
  k: PostPlatform; kind: 'post' | 'reply'; name: string;
  date: string; time: string; dueAt: string; status: PubStatus; err?: string | null; code?: PubErrCode | null;
  acct: SocialAccount | null; acctLabel: string; held: boolean; locked: boolean;
}
/** Every scheduled, sending, posted or failed pub, sorted by send time (prototype `socialItems`, plus failed Brief posts). */
export function socialItems(B: Pick<Workspace, 'social' | 'brief'>, nowMs: number): SocialItem[] {
  const accts = accountsOf(B); const out: SocialItem[] = [];
  const mk = (pub: Pub) => { const acct = accts.find(a => a.id === pub.acct) || null; return { date: pub.date, time: pub.time, dueAt: pub.dueAt, status: pub.status, err: pub.err ?? null, code: pub.code ?? null, acct, acctLabel: acctLabel(acct) || pub.acctLabel || '', held: !!pub.held, locked: isLocked(pub, nowMs) }; };
  for (const [day, dd] of Object.entries(B.brief?.days || {})) for (const it of dd?.items || []) {
    const pub = it.pub; if (!pub || (pub.status === 'posted' && !pub.direct)) continue;
    out.push({ id: briefSid(day, it.id), src: 'brief', day, itemId: it.id, k: pub.platform, kind: it.kind, name: it.title, ...mk(pub) });
  }
  for (const p of B.social.packs || []) for (const [k, q] of Object.entries(p.posts || {})) {
    const pub = q?.pub; if (!pub || !canPost(k)) continue;
    out.push({ id: packSid(p.id, k), src: 'pack', packId: p.id, k, kind: 'post', name: p.name, ...mk(pub) });
  }
  return out.sort((a, b) => (a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0));
}
/** Pack thumbnail "· N scheduled". */
export const scheduledCount = (posts: Partial<Record<string, Pick<SocialPost, 'pub'>>>) => Object.values(posts || {}).filter(q => q?.pub?.status === 'scheduled' || q?.pub?.status === 'sending').length;
