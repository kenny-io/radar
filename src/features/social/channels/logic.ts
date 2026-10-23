// Social channels: UI decisions the components share (drop routing, drag moves, optimistic pubs, Needs attention items,
// Schedule all rows). No React here so it can be tested. The rules themselves (lock, past, preflight, copy) come from
// '@/lib/socialPublish' and are never re-implemented.
import { PLAT_L, accountsFor, acctLabel, atTz, chOf, dueAtIso, failedLine, moveCheck, parseSid, scheduleAllWhy, socialItems, STAGGER, type PostPlatform, type ScheduleAllWhy, type SocialItem } from '@/lib/socialPublish';
import { fmtDW, fmtTime } from '@/lib/format';
import type { BriefItem, Platform, Pub, SocialAccount, SocialPack, SocialPost, Workspace } from '@/lib/types';

/** What a dropped drag payload is: a social post (`s:` or `b:` sid) or an article id. */
export const dropKind = (id: string): 'social' | 'article' => (parseSid(id) ? 'social' : 'article');

export interface PubRef { sid: string; src: 'pack' | 'brief'; pub: Pub | null; k: PostPlatform | null; name: string }
/** The pub behind a sid in this workspace (null when the pack post or Brief item is gone). */
export function findPub(B: Pick<Workspace, 'social' | 'brief'>, sid: string): PubRef | null {
  const s = parseSid(sid); if (!s) return null;
  if (s.src === 'pack') {
    const p = B.social.packs.find(x => x.id === s.packId); const q = p?.posts[s.platform];
    return q ? { sid, src: 'pack', pub: q.pub || null, k: s.platform, name: p!.name } : null;
  }
  const it = B.brief.days[s.day]?.items.find(i => i.id === s.itemId);
  return it ? { sid, src: 'brief', pub: it.pub || null, k: it.pub?.platform ?? null, name: it.title } : null;
}

const briefSt = (it: BriefItem, pub: Pub | null): BriefItem['st'] =>
  pub && (pub.status === 'scheduled' || pub.status === 'sending') ? 'scheduled' : pub?.status === 'posted' ? 'posted' : it.st === 'scheduled' ? 'open' : it.st;
/** Optimistic workspace with `pub` set on a sid (null clears it). Brief items also get the projected `st`, and the sidebar count follows. */
export function withPub(B: Workspace, sid: string, pub: Pub | null): Workspace {
  const s = parseSid(sid); if (!s) return B;
  if (s.src === 'pack') return { ...B, social: { ...B.social, packs: B.social.packs.map(p => (p.id !== s.packId || !p.posts[s.platform] ? p : { ...p, posts: { ...p.posts, [s.platform]: { ...p.posts[s.platform]!, pub } } })) } };
  const d = B.brief.days[s.day]; if (!d) return B;
  const items = d.items.map(i => (i.id === s.itemId ? { ...i, pub, st: briefSt(i, pub) } : i));
  const days = { ...B.brief.days, [s.day]: { ...d, items } }; const t = days[B.today];
  return { ...B, brief: { ...B.brief, days }, counts: { ...B.counts, briefOpen: t ? t.items.filter(i => i.st === 'open' || i.st === 'copied').length : B.counts.briefOpen } };
}
/** A pub at a new wall-clock date/time in the business zone (keeps everything else). */
export const repub = (pub: Pub, date: string, time: string, tz: string): Pub => ({ ...pub, date, time, dueAt: dueAtIso(date, time, tz) });

export type MovePlan = { kind: 'noop' } | { kind: 'refuse'; msg: string } | { kind: 'move'; pub: Pub; toast: string };
/** Drag a chip to `date` (keeps its time): the client-side moveCheck before `social.move`. Unscheduled or missing posts are a silent no-op, as in the prototype. */
export function planMove(B: Pick<Workspace, 'social' | 'brief' | 'today' | 'tz'>, sid: string, date: string, nowMs: number): MovePlan {
  const ref = findPub(B, sid); const pub = ref?.pub;
  if (!ref || !pub || pub.status !== 'scheduled') return { kind: 'noop' };
  const why = moveCheck(pub, date, B.today, B.tz, nowMs);
  if (why === 'same') return { kind: 'noop' };
  if (why) return { kind: 'refuse', msg: why };
  const at = `${fmtDW(date)} at ${atTz(B.tz, date, pub.time)}`;
  return { kind: 'move', pub: repub(pub, date, pub.time, B.tz), toast: ref.src === 'pack' ? `${PLAT_L[pub.platform]} post moved to ${at}` : `Post moved to ${at}` };
}

/** Hover and screen-reader text: "LinkedIn · Scheduled 9:00 AM · {name} · {account} · drag to another day". */
export function chipLabel(it: SocialItem) {
  const draggable = it.status === 'scheduled' && !it.locked;
  const st = it.status === 'posted' ? 'Posted' : it.status === 'failed' ? 'Didn’t post' : it.locked ? 'Sending soon' : it.held ? 'On hold' : 'Scheduled ' + fmtTime(it.time);
  return `${PLAT_L[it.k]} · ${st} · ${it.name}${it.acctLabel ? ' · ' + it.acctLabel : ''}${draggable ? ' · drag to another day' : ''}`;
}

/** "As …" on a posted panel: the account's current label, else the label saved when it went out ('' = omit the line, e.g. after a disconnect). */
export const postedAs = (pub: Pick<Pub, 'acct' | 'acctLabel'>, accts: SocialAccount[]) => {
  const a = accts.find(x => x.id === pub.acct); return a ? acctLabel(a) : pub.acctLabel || '';
};

/* ── Dashboard → Needs attention ── */
export interface SocialIssue { id: string; tone: 'bad' | 'warn'; label: string; head: string; body: string; open?: SocialItem; reconnect?: SocialAccount }
/** "A post didn’t go out" (Fix and retry opens the first failed post) and one "Reconnect {channel}" per expired account. */
export function socialIssues(B: Pick<Workspace, 'social' | 'brief'>, nowMs: number): SocialIssue[] {
  const items = socialItems(B, nowMs); const out: SocialIssue[] = [];
  const sf = items.filter(i => i.status === 'failed');
  if (sf.length) {
    const f = sf[0]; const pl = PLAT_L[f.k];
    out.push({ id: 'socfail', tone: 'bad', label: sf.length > 1 ? `${sf.length} posts didn’t go out` : 'A post didn’t go out', head: `A ${pl} post didn’t go out.`, body: `“${f.name}” on ${pl}: ${failedLine({ err: f.err, code: f.code, platform: f.k })}`, open: f });
  }
  for (const a of B.social.accounts || []) {
    if (!a.expired) continue;
    const n = items.filter(i => i.held && i.acct?.id === a.id).length; const c = chOf(a.ch);
    out.push({ id: 'exp' + a.id, tone: 'warn', label: `Reconnect ${c.l}`, head: `Reconnect ${c.l} to keep posting.`, body: `${PLAT_L[c.plat]} access for ${acctLabel(a)} expired.${n ? ` ${n} scheduled post${n > 1 ? 's are' : ' is'} on hold.` : ''}`, reconnect: a });
  }
  return out;
}

/* ── Schedule all ── */
export interface AllRow { k: Platform; post: SocialPost; as: SocialAccount[]; a: SocialAccount | null; why: ScheduleAllWhy | null; time: string }
/** Rows of the Schedule this pack window: eligible rows first (by time), then dimmed rows with their reason. */
export function scheduleAllRows(pack: Pick<SocialPack, 'posts'>, keys: Platform[], accts: SocialAccount[], nowMs: number, o: { mode: 'stagger' | 'same'; same: string; times: Partial<Record<string, string>>; acc: Partial<Record<string, string>> }): AllRow[] {
  return keys.filter(k => pack.posts[k]).map(k => {
    const post = pack.posts[k]!; const as = accountsFor(accts, k).filter(a => !a.expired);
    const a = as.find(x => x.id === o.acc[k]) || as.find(x => x.ch === 'li_page') || as[0] || null;
    const time = o.mode === 'same' ? o.same : o.times[k] || STAGGER[k as PostPlatform] || '09:00';
    return { k, post, as, a, why: scheduleAllWhy(k, post, accts, nowMs), time };
  }).sort((x, y) => (Number(!!x.why) - Number(!!y.why)) || (x.time < y.time ? -1 : x.time > y.time ? 1 : 0));
}
