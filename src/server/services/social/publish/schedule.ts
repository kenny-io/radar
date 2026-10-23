// The rules every publishing action shares (architecture.md §6): resolve a sid to its content and account, refuse with the
// shared COPY, and write a `scheduled` row without ever overwriting one that is posted, sending or locked.
import { sql } from 'drizzle-orm';
import { db } from '../../../db';
import { RadarError, notFound } from '../../../errors';
import { bizToday, getBiz, socialAutoOf, type BizRow } from '../../../workspace';
import { socialOn } from '../../../flags';
import { track } from '../../../events';
import { addDays } from '@/lib/format';
import { COPY, LOCK_MS, packSid, type PostPlatform, MAX_AHEAD_DAYS, accountsFor, acctLabel, briefAccount, isLocked, pickAccount, preflight, zonedTimeToUtc } from '@/lib/socialPublish';
import type { Pub, SocialAccount, SocialChannel } from '@/lib/types';
import { acctPublic, accountRows, type AcctRow } from './accounts';
import { P, ensureImages, loadTarget, preflightInput, pubOf, pubRow, type PubRow, type Target } from './pubs';

export const PAST_ERROR = 'Past briefs are read-only.';
export const REPLY_SCHEDULE = 'Replies go out with Reply now only.';
export const refuse = (msg: string, code = 'refused', status = 400) => new RadarError(msg, status, code);

export interface Resolved {
  t: Target; acct: AcctRow | null; ch: SocialChannel;
  existing: PubRow | null; pub: Pub | null; accts: SocialAccount[]; rows: AcctRow[];
}
/** The sid's content and the account it would go out as (pack: the pub's account, the pick, then pickAccount; Brief: routing). */
export async function resolve(bid: string, sid: string, acctId?: string | null): Promise<Resolved> {
  const t = await loadTarget(bid, sid);
  if (!t) throw notFound('Post');
  const rows = await accountRows(bid); const accts = rows.map(acctPublic);
  const existing = await pubRow(bid, sid);
  let a: SocialAccount | null; let ch: SocialChannel;
  if (t.src === 'pack') {
    if (acctId) { a = accountsFor(accts, t.platform).find(x => x.id === acctId) || null; if (!a) throw notFound('Account'); }
    else a = pickAccount(accts, t.platform, { pubAcct: existing?.status === 'scheduled' ? existing.acctId : null });
    ch = a?.ch || (t.platform === 'x' ? 'x' : 'li_profile');
  } else {
    a = briefAccount(accts, t.platform, !!t.company);
    ch = t.platform === 'x' ? 'x' : t.company ? 'li_page' : 'li_profile';
  }
  return { t, acct: a ? rows.find(r => r.id === a!.id) || null : null, ch, existing, pub: existing ? pubOf(existing, accts) : null, accts, rows };
}

/** Brief items must be live on today's brief, unless they already have a scheduled or failed pub (rescheduling a past day). */
export function briefGate(r: Resolved, today: string) {
  const it = r.t.item; if (!it) return;
  if (it.st === 'posted') throw refuse(COPY.alreadyPosted, 'posted');
  const hasPub = r.existing && (r.existing.status === 'scheduled' || r.existing.status === 'failed');
  if (r.t.day! < today && !hasPub) throw refuse(PAST_ERROR, 'read_only');
  if ((it.st === 'skipped' || it.st === 'expired') && !hasPub) throw new RadarError('That conversation wasn’t found.', 404, 'not_found');
}
export function accountGate(r: Resolved) {
  if (!r.acct) throw refuse(COPY.notConnected(r.ch), 'not_connected');
  if (r.acct.expired) throw refuse(COPY.expired(r.acct.ch), 'expired');
}
/** Render a missing visual, read unknown image sizes from the files, then run the shared preflight. */
export async function preflightGate(biz: BizRow, r: Resolved) {
  await ensureImages(biz, r.t);
  const p = preflight(r.t.platform, preflightInput(r.t));
  if (p.length) throw refuse(p[0].msg, 'preflight');
}
/** Schedule window rules for a date + time in the business zone. */
export function slotGate(date: string, time: string, today: string, tz: string, nowMs: number) {
  if (date < today) throw refuse(COPY.pastDay, 'past');
  if (date > addDays(today, MAX_AHEAD_DAYS)) throw refuse(COPY.tooFar, 'too_far');
  if (zonedTimeToUtc(date, time, tz) <= nowMs) throw refuse(COPY.pastTime, 'past');
}

/** Every refusal of social.schedule for one sid (also used by scheduleAll and the automatic schedule). */
export async function scheduleChecks(biz: BizRow, r: Resolved, date: string, time: string, nowMs: number) {
  const today = bizToday(biz);
  if (r.t.kind === 'reply') throw refuse(REPLY_SCHEDULE, 'reply');
  if (r.existing?.status === 'posted') throw refuse(COPY.alreadyPosted, 'posted');
  if (r.existing && isLocked(r.pub, nowMs)) throw refuse(COPY.lockedMove, 'locked', 409);
  briefGate(r, today);
  accountGate(r);
  slotGate(date, time, today, biz.timezone, nowMs);
  await preflightGate(biz, r);
}

type Q = Pick<typeof db, 'insert'>;
/** Upsert the row as `scheduled` (resetting attempts and errors). Never takes over a row that is posted, sending, or scheduled
 *  inside the lock window — except a held one (its account expired), which may always be moved. null = not written. */
export async function writeScheduled(q: Q, o: { biz: BizRow; r: Resolved; date: string; time: string; userId: string | null; auto?: boolean }): Promise<PubRow | null> {
  const a = o.r.acct!;
  const v = {
    platform: o.r.t.platform, kind: o.r.t.kind, acctId: a.id, ch: a.ch, acctLabel: acctLabel(acctPublic(a)), status: 'scheduled' as const,
    date: o.date, time: o.time, dueAt: new Date(zonedTimeToUtc(o.date, o.time, o.biz.timezone)), attempts: 0, attemptKey: null, stage: null,
    retryAt: null, err: null, errCode: null, errDetail: null, auto: !!o.auto, updatedBy: o.userId,
  };
  const [row] = await q.insert(P).values({ businessId: o.biz.id, sid: o.r.t.sid, src: o.r.t.src, ...v, createdBy: o.userId })
    .onConflictDoUpdate({
      target: [P.businessId, P.sid], set: { ...v, updatedAt: sql`now()` },
      setWhere: sql`${P.status} = 'failed' OR (${P.status} = 'scheduled' AND (${P.dueAt} > now() + ${`${LOCK_MS / 1000} seconds`}::interval OR EXISTS (SELECT 1 FROM social_accounts sa WHERE sa.id = ${P.acctId} AND sa.expired)))`,
    }).returning();
  return row || null;
}

/** Automatic generation, "When a pack is ready → Schedule posts" (AC-16): the new pack's X and LinkedIn posts go out tomorrow at
 *  auto.time to the connected accounts. A platform with no live account or a preflight problem stays in the library. */
export async function autoSchedule(bid: string, packId: string): Promise<number> {
  const biz = await getBiz(bid);
  if (!(await socialOn(biz)) || socialAutoOf(biz).post !== 'schedule') return 0;
  const date = addDays(bizToday(biz), 1); const time = socialAutoOf(biz).time || '08:00'; let n = 0;
  for (const k of ['x', 'linkedin'] as PostPlatform[]) {
    try {
      const r = await resolve(bid, packSid(packId, k));
      await scheduleChecks(biz, r, date, time, Date.now());
      const row = await writeScheduled(db, { biz, r, date, time, userId: null, auto: true });
      if (!row) continue;
      n++;
      await track('social.scheduled', { bid, ref: row.sid, props: { sid: row.sid, src: row.src, platform: row.platform, acct: row.acctId, ch: row.ch, date, time, dueAt: row.dueAt.toISOString(), auto: true } });
    } catch (e: any) { if (!(e instanceof RadarError)) throw e; console.log(`[social] auto: ${k} stays in the library for ${packId}: ${e.code}`); }
  }
  return n;
}
