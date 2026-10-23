// Claim and send one pub (architecture.md §9). One code path for the worker (scheduled) and Post now / Try again (manual).
// Never twice: a conditional claim gives each attempt a fresh attempt_key and every later write is conditional on it; only
// the final create request is non-idempotent, and an unknown outcome there is read back (X) or failed (LinkedIn), never resent.
// Logs carry the pub id and sid, never post text or tokens.
import { and, eq, lte, sql } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { env } from '../../../env';
import { track } from '../../../events';
import { notify } from '../../../notify';
import { bump, getBiz } from '../../../workspace';
import { enqueue } from '../../../jobs/queue';
import { withDay } from '../../brief/store';
import { acctOf } from '@/features/brief/model';
import { LOCK_MS, PLAT_L, STALE_MS, acctLabel, errCopy, localParts, publishCostUsd, type PostPlatform } from '@/lib/socialPublish';
import type { BriefItem, PubErrCode } from '@/lib/types';
import { type AcctCtx, type Adapter, SendError } from './api';
import { AccountExpired, acctPublic, adapterFor, ensureToken, type AcctRow } from './accounts';
import { CONTENT_MISSING, P, ensureImages, loadTarget, type PubRow, type Target } from './pubs';
import { mediaProblem, readImage } from './media';

/** Scheduled sends: attempts 1–3 return to `scheduled` after this backoff; the 4th failure is final. */
export const MAX_ATTEMPTS = 4;
export const backoffMs = (attempt: number) => (env.devStubs ? [3, 6, 12] : [60, 300, 900])[Math.min(attempt, 3) - 1] * 1000;
/** A `sending` row this old belongs to a dead process: verify (create stage) or retry (earlier stages). */
export const STUCK_MS = 3 * 60_000;
const log = (r: Pick<PubRow, 'id' | 'sid'>, msg: string) => console.log(`[social.send] pub ${r.id} ${r.sid}: ${msg}`);

/* ── Claims ── */

/** Worker claim: only a due, not stale, not held, not backing-off `scheduled` row. */
export async function claimScheduled(pubId: string): Promise<PubRow | null> {
  const [r] = await db.update(P).set({ status: 'sending', attemptKey: sql`gen_random_uuid()`, attempts: sql`${P.attempts} + 1`, claimedAt: sql`now()`, stage: 'media', err: null, errCode: null, updatedAt: sql`now()` })
    .where(and(eq(P.id, pubId), eq(P.status, 'scheduled'), lte(P.dueAt, sql`now()`), sql`${P.dueAt} > now() - ${`${STALE_MS / 1000} seconds`}::interval`,
      sql`(${P.retryAt} IS NULL OR ${P.retryAt} <= now())`, sql`EXISTS (SELECT 1 FROM social_accounts a WHERE a.id = ${P.acctId} AND NOT a.expired)`))
    .returning();
  return r || null;
}

/** Post now / Try again: create or take over the row unless it is posted, sending, or scheduled within the lock window.
 *  Returns null when someone else has the post. */
export async function claimManual(o: { bid: string; t: Target; acct: AcctRow; userId: string | null; tz: string }): Promise<PubRow | null> {
  const now = Date.now(); const { date, time } = localParts(now, o.tz);
  const v = { platform: o.t.platform, kind: o.t.kind, acctId: o.acct.id, ch: o.acct.ch, acctLabel: acctLabel(acctPublic(o.acct)), date, time, dueAt: new Date(now), updatedBy: o.userId };
  const [r] = await db.insert(P).values({ businessId: o.bid, sid: o.t.sid, src: o.t.src, ...v, status: 'sending', attempts: 1, attemptKey: sql`gen_random_uuid()`, claimedAt: sql`now()`, stage: 'media', createdBy: o.userId })
    .onConflictDoUpdate({
      target: [P.businessId, P.sid],
      set: { ...v, status: 'sending', attempts: sql`${P.attempts} + 1`, attemptKey: sql`gen_random_uuid()`, claimedAt: sql`now()`, stage: 'media', retryAt: null, err: null, errCode: null, errDetail: null, updatedAt: sql`now()` },
      setWhere: sql`${P.status} = 'failed' OR (${P.status} = 'scheduled' AND ${P.dueAt} > now() + ${`${LOCK_MS / 1000} seconds`}::interval)`,
    }).returning();
  return r || null;
}

/* ── Outcome writes (all conditional on the attempt) ── */

const mine = (r: PubRow) => and(eq(P.id, r.id), eq(P.attemptKey, r.attemptKey!), eq(P.status, 'sending'));
const packHref = (r: PubRow, platform: string) => { const m = /^s:(.+):(x|linkedin)$/.exec(r.sid); return m ? `/social?pack=${encodeURIComponent(m[1])}&plat=${platform}` : '/brief'; };
const sidDay = (sid: string) => (sid.startsWith('b:') ? { day: sid.slice(2, 12), itemId: sid.slice(13) } : null);

/** Tests only: side effects after a post is live (P2 — they may fail, and must never cause a resend). */
export const sendHooks = { afterPosted: afterPostedDefault };

/** Success. The `posted` write comes first and is retried in process; everything after it only logs on failure, so nothing
 *  that happens once a post is live can lead to a retry, a verify or a second create (architecture.md §21 P2). */
async function finishPosted(r: PubRow, c: { remoteId: string; url: string }, manual: boolean, userId: string | null, text: string): Promise<PubRow | null> {
  let u: PubRow | undefined;
  for (let i = 0; i < 3 && !u; i++) {
    try {
      const tz = (await db.select({ tz: schema.businesses.timezone }).from(schema.businesses).where(eq(schema.businesses.id, r.businessId)).limit(1))[0]?.tz || 'America/New_York';
      const now = Date.now(); const { date, time } = localParts(now, tz);
      const [x] = await db.update(P).set({ status: 'posted', remoteId: c.remoteId, remoteUrl: c.url, postedAt: new Date(now), date, time, stage: null, retryAt: null, err: null, errCode: null, errDetail: null, updatedAt: new Date() }).where(mine(r)).returning();
      if (!x) return null; // another attempt owns the row
      u = x;
    } catch (e: any) {
      console.error(`[social.send] pub ${r.id} ${r.sid}: posted as ${c.remoteId} but saving failed (try ${i + 1}): ${e?.message || e}`);
      if (i < 2) await new Promise(res => setTimeout(res, 500 * (i + 1)));
    }
  }
  if (!u) { console.error(`[social.send] pub ${r.id} ${r.sid}: LIVE as ${c.remoteId} (${c.url}) but not saved; left 'sending' for verify`); return null; }
  log(r, `posted (attempt ${r.attempts}${manual ? ', now' : ''})`);
  try { await sendHooks.afterPosted(r, c, manual, userId, text); }
  catch (e: any) { console.error(`[social.send] pub ${r.id} ${r.sid}: posted; follow-up failed: ${e?.message || e}`); }
  return u;
}
async function afterPostedDefault(r: PubRow, c: { remoteId: string; url: string }, manual: boolean, userId: string | null, text: string) {
  const bd = sidDay(r.sid);
  if (bd) {
    // A Brief item posted directly is "posted" for good, exactly like "I posted it"; impact metrics keep counting it.
    const it = await withDay(r.businessId, bd.day, row => {
      const items = row.items as BriefItem[]; const i = items.findIndex(x => x.id === bd.itemId);
      if (i < 0) return null;
      const next = [...items]; next[i] = { ...items[i], st: 'posted' };
      return { items: next, ret: items[i] };
    });
    if (it) await track(it.kind === 'post' ? 'brief.post_posted' : 'brief.reply_posted', { bid: r.businessId, uid: userId, ref: it.id, props: { date: bd.day, kind: it.kind, acct: acctOf(it), plat: it.kind === 'post' ? it.pl : it.plat, edited: Object.keys(it.edits || {}).length > 0, where: it.where, url: it.url, title: it.title, direct: true } });
  }
  await track('social.posted', { bid: r.businessId, uid: userId, ref: r.sid, props: { sid: r.sid, src: r.src, kind: r.kind, platform: r.platform, acct: r.acctId, ch: r.ch, remoteId: c.remoteId, url: c.url, scheduled: !manual, attempt: r.attempts, direct: r.src === 'brief', costUsd: publishCostUsd(r.platform, 'post', text) } });
  await bump(r.businessId);
}

async function finishFailed(r: PubRow, code: PubErrCode, detail: string, manual: boolean, userId: string | null, userMsg?: string | null): Promise<PubRow | null> {
  const [u] = await db.update(P).set({ status: 'failed', err: userMsg || errCopy(code, r.platform), errCode: code, errDetail: detail.slice(0, 500), stage: null, retryAt: null, updatedAt: new Date() }).where(mine(r)).returning();
  if (!u) return null;
  log(r, `failed ${code} after ${r.attempts} attempt(s): ${detail.slice(0, 200)}`);
  if (detail !== CONTENT_MISSING) {
    await track('social.failed', { bid: r.businessId, uid: userId, ref: r.sid, props: { sid: r.sid, src: r.src, kind: r.kind, platform: r.platform, acct: r.acctId, ch: r.ch, code, attempts: r.attempts, scheduled: !manual } });
    if (!manual) await notify(r.businessId, `${r.platform === 'x' ? 'An' : 'A'} ${PLAT_L[r.platform]} post didn’t go out.`, { tone: 'bad', action: { label: 'Open', href: packHref(r, r.platform) } });
  }
  await bump(r.businessId);
  return u;
}

/** Transient: a scheduled send backs off and returns to `scheduled` (attempts 1–3); a manual send fails at once. */
async function transient(r: PubRow, e: SendError, manual: boolean, userId: string | null): Promise<PubRow | null> {
  if (manual || r.attempts >= MAX_ATTEMPTS) return finishFailed(r, e.code === 'rate_limit' ? 'rate_limit' : 'unavailable', e.detail, manual, userId);
  const at = Math.max(Date.now() + backoffMs(r.attempts), e.retryAt || 0);
  const [u] = await db.update(P).set({ status: 'scheduled', stage: null, retryAt: new Date(at), errDetail: e.detail.slice(0, 500), updatedAt: new Date() }).where(mine(r)).returning();
  if (!u) return null;
  log(r, `retry ${r.attempts}/${MAX_ATTEMPTS - 1} at ${new Date(at).toISOString()} (${e.code})`);
  // A per-attempt key: the running job still holds `social.send:{id}`. The claim decides who sends.
  await enqueue('social.send', { pubId: r.id }, { businessId: r.businessId, ref: r.sid, runAt: new Date(at), singletonKey: `social.send:${r.id}:${r.attempts}`, maxAttempts: 1 }).catch(() => {});
  await bump(r.businessId);
  return u;
}

/** The account expired mid-send (refresh refused): a scheduled post goes back to `scheduled`, now held until Reconnect. */
async function hold(r: PubRow, manual: boolean, userId: string | null): Promise<PubRow | null> {
  if (manual) return finishFailed(r, 'auth', 'account expired', manual, userId);
  const [u] = await db.update(P).set({ status: 'scheduled', stage: null, retryAt: null, updatedAt: new Date() }).where(mine(r)).returning();
  if (u) { log(r, 'held: account needs reconnecting'); await bump(r.businessId); }
  return u || null;
}

/** Unknown outcome after create: read back on X; LinkedIn can't, so it fails as `unknown`. Never resends. */
async function verifyOrFail(r: PubRow, ad: Adapter, a: AcctCtx, text: string, manual: boolean, userId: string | null, why: string): Promise<PubRow | null> {
  if (ad.verify && text) {
    try {
      if (ad.verifyDelayMs) await new Promise(res => setTimeout(res, ad.verifyDelayMs));
      const since = (r.claimedAt ? r.claimedAt.getTime() : Date.now()) - 2 * 60_000;
      const hit = await ad.verify(a, { text, sinceMs: since });
      if (hit) { log(r, 'unknown outcome; found on read-back'); return finishPosted(r, hit, manual, userId, text); }
    } catch (e: any) { why += `; verify failed: ${String(e?.detail || e?.message || e).slice(0, 120)}`; }
  }
  return finishFailed(r, 'unknown', why, manual, userId);
}

/* ── Send ── */

async function loadAccount(id: string | null): Promise<AcctRow | null> {
  return id ? (await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, id)).limit(1))[0] || null : null;
}

/** Send a claimed row (status 'sending'). Returns the final row, or null when another attempt took it over. */
export async function runSend(r: PubRow, o: { manual: boolean; userId?: string | null }): Promise<PubRow | null> {
  const manual = o.manual; const userId = o.userId ?? null;
  const acct = await loadAccount(r.acctId);
  if (!acct) return finishFailed(r, 'auth', 'account disconnected', manual, userId);
  const biz = await getBiz(r.businessId);
  // The latest text and images, read now (edits are refused from 5 minutes before the send).
  let t = await loadTarget(r.businessId, r.sid);
  if (!t || t.platform !== r.platform) return finishFailed(r, 'rejected', CONTENT_MISSING, manual, userId);
  try { t = await ensureImages(biz, t); } catch (e: any) { return finishFailed(r, 'media', `render: ${e?.message || e}`, manual, userId); }
  const k = r.platform as PostPlatform;
  const ok = await db.update(P).set({ payload: { text: t.text, media: t.images.map(i => ({ url: i.url, bytes: i.meta?.bytes ?? null, type: i.meta?.type ?? null })), manual } }).where(mine(r)).returning({ id: P.id });
  if (!ok.length) return null;

  let ad: Adapter; const a: AcctCtx = { ch: acct.ch, remoteId: acct.remoteId, handle: acct.handle, token: '' };
  try { const tok = await ensureToken(acct.id); a.token = tok.t.access_token; ad = adapterFor(acct.ch, tok.t); }
  catch (e: any) {
    if (e instanceof AccountExpired) return hold(r, manual, userId);
    if (e instanceof SendError) return transient(r, e, manual, userId);
    return transient(r, new SendError('transient', 'unavailable', `token: ${e?.message || e}`), manual, userId);
  }
  // One forced refresh after a 401; if the account is then expired the post is held, a second 401 is `auth`.
  const authed = async <T>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } catch (e: any) {
      if (!(e instanceof SendError) || e.kind !== 'auth') throw e;
      const tok = await ensureToken(acct.id, { stale: a.token }); a.token = tok.t.access_token;
      try { return await fn(); } catch (e2: any) { if (e2 instanceof SendError && e2.kind === 'auth') throw new SendError('definitive', 'auth', e2.detail); throw e2; }
    }
  };
  let created: { remoteId: string; url: string };
  try {
    const ids: string[] = [];
    for (const img of t.images) {
      const f = await readImage(img.url);
      if (!f) throw new SendError('definitive', 'media', 'image file missing');
      const bad = await mediaProblem(k, f);
      if (bad) throw new SendError('definitive', 'media', `image ${bad}`); // never auto-compress at send time
      ids.push(await authed(() => ad.upload(a, f)));
    }
    if (ad.awaitMedia && ids.length) await ad.awaitMedia(a, ids);
    const go = await db.update(P).set({ stage: 'create', updatedAt: new Date() }).where(mine(r)).returning({ id: P.id });
    if (!go.length) return null;
    try { created = await authed(() => ad.create(a, { text: t!.text, mediaIds: ids, aiMedia: !!t!.aiMedia })); }
    catch (e: any) {
      if (e instanceof SendError && e.kind === 'unknown') return verifyOrFail(r, ad, a, t.text, manual, userId, e.detail);
      if (e instanceof SendError || e instanceof AccountExpired) throw e;
      return verifyOrFail(r, ad, a, t.text, manual, userId, `create: ${e?.message || e}`); // a crash mid-request: unknown
    }
  } catch (e: any) {
    if (e instanceof AccountExpired) return hold(r, manual, userId);
    if (e instanceof SendError) {
      if (e.kind === 'transient') return transient(r, e, manual, userId);
      if (e.kind === 'unknown') return verifyOrFail(r, ad, a, t.text, manual, userId, e.detail);
      return finishFailed(r, e.code, e.detail, manual, userId, e.userMsg);
    }
    return transient(r, new SendError('transient', 'unavailable', String(e?.message || e)), manual, userId);
  }
  // Live: outside every retry/verify path (P2).
  return finishPosted(r, created, manual, userId, t.text);
}

/** A `sending` row left behind by a dead process. Re-key it (the old attempt can no longer write), then: create stage →
 *  verify or fail; earlier stages never reached the platform → the transient path (a manual send fails). */
export async function recoverStuck(pubId: string): Promise<PubRow | null> {
  const [r] = await db.update(P).set({ attemptKey: sql`gen_random_uuid()`, updatedAt: sql`now()` })
    .where(and(eq(P.id, pubId), eq(P.status, 'sending'), sql`${P.claimedAt} < now() - ${`${STUCK_MS / 1000} seconds`}::interval`)).returning();
  if (!r) return null;
  const manual = !!r.payload?.manual;
  if (r.stage !== 'create') return transient(r, new SendError('transient', 'unavailable', `stuck at ${r.stage || 'claim'}`), manual, null);
  const acct = await loadAccount(r.acctId);
  if (!acct) return finishFailed(r, 'unknown', 'stuck at create; account gone', manual, null);
  try {
    const tok = await ensureToken(acct.id);
    return verifyOrFail(r, adapterFor(acct.ch, tok.t), { ch: acct.ch, remoteId: acct.remoteId, handle: acct.handle, token: tok.t.access_token }, String(r.payload?.text || ''), manual, null, 'stuck at create');
  } catch { return finishFailed(r, 'unknown', 'stuck at create; no token to verify', manual, null); }
}

/** Mark a row more than 24 h late as `failed`/`stale` (never sent without the user). */
export async function failStale(r: PubRow): Promise<boolean> {
  const [u] = await db.update(P).set({ status: 'failed', err: errCopy('stale', r.platform), errCode: 'stale', errDetail: 'more than 24 h late', stage: null, retryAt: null, updatedAt: new Date() })
    .where(and(eq(P.id, r.id), eq(P.status, 'scheduled'), sql`${P.dueAt} <= now() - ${`${STALE_MS / 1000} seconds`}::interval`)).returning();
  if (!u) return false;
  log(r, 'failed stale');
  await track('social.failed', { bid: r.businessId, ref: r.sid, props: { sid: r.sid, src: r.src, kind: r.kind, platform: r.platform, acct: r.acctId, ch: r.ch, code: 'stale', attempts: r.attempts, scheduled: true } });
  await notify(r.businessId, `${r.platform === 'x' ? 'An' : 'A'} ${PLAT_L[r.platform]} post didn’t go out.`, { tone: 'bad', action: { label: 'Open', href: packHref(r, r.platform) } });
  await bump(r.businessId);
  return true;
}
