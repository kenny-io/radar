// Posting from Radar: connected X / LinkedIn accounts, Post now, Schedule, drag to reschedule (architecture.md §6,
// CONTRACTS.md § Social channels). Every action is behind RADAR_SOCIAL_PUBLISHING (404 not_enabled when off) and needs Editor.
// Errors are RadarError with the shared COPY (src/lib/socialPublish.ts); provider details go to logs only.
import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { action, type ActCtx, type ActionMap } from './define';
import { db, schema } from '../db';
import { env } from '../env';
import { RadarError, notFound } from '../errors';
import { track } from '../events';
import { socialOn } from '../flags';
import { bizToday } from '../workspace';
import { updatePack } from '../services/social/generate';
import { withDay } from '../services/brief/store';
import { COPY, DATE_RE, HM_RE, PLAT_L, SID_MAX, acctLabel, isLocked, moveCheck, packSid, zonedTimeToUtc } from '@/lib/socialPublish';
import type { BriefItem, Profile, SocialChannel, SocialPage } from '@/lib/types';
import { AccountExpired, acctPublic, accountRow, adapterFor, deletePendingSocial, ensureToken, readPendingSocial, tokenFields, tokensOf } from '../services/social/publish/accounts';
import type { Tokens } from '../services/social/publish/api';
import { liPages } from '../services/social/publish/linkedin';
import { stubPages } from '../services/social/publish/stubs';
import { P, pubOf, scheduledCountFor } from '../services/social/publish/pubs';
import { claimManual, runSend } from '../services/social/publish/send';
import { accountGate, briefGate, preflightGate, refuse, resolve, scheduleChecks, slotGate, writeScheduled, type Resolved } from '../services/social/publish/schedule';
import { compressIfNeeded } from '../services/social/publish/media';
import { STALE_MS } from '@/lib/socialPublish';

const Sid = z.string().min(3).max(SID_MAX);
const AcctId = z.string().uuid();
const Day = z.string().regex(DATE_RE);
const HM = z.string().regex(HM_RE);
const Ch = z.enum(['x', 'li_profile', 'li_page']);
const SIGN_IN_EXPIRED = 'The sign-in expired. Try again.';
const LI_DOWN = 'LinkedIn didn’t respond. Nothing changed — try again.';

/** The flag gate every action here starts with. */
export async function requireSocial(ctx: ActCtx) { if (!(await socialOn(ctx.biz))) throw new RadarError(COPY.notEnabled, 404, 'not_enabled'); }
const bizName = (ctx: ActCtx) => (ctx.biz.profile as Profile)?.business?.name || ctx.biz.domain;

/** Pages the signed-in LinkedIn member administers (stub: two fixed pages). */
async function pagesFor(ctx: ActCtx, t: Tokens): Promise<SocialPage[]> { return t.stub && env.devStubs ? stubPages(bizName(ctx), ctx.user.name) : liPages(t.access_token); }

function scheduledEvent(ctx: ActCtx, kind: 'social.scheduled' | 'social.rescheduled', row: typeof P.$inferSelect, from?: string | null, auto?: boolean) {
  return track(kind, { bid: ctx.bid, uid: ctx.user.id, ref: row.sid, props: { sid: row.sid, src: row.src, platform: row.platform, acct: row.acctId, ch: row.ch, date: String(row.date), time: row.time, dueAt: row.dueAt.toISOString(), from: from || undefined, auto: auto || undefined } });
}
/** Re-read after a conditional write lost: say why. */
async function lostWrite(bid: string, sid: string): Promise<never> {
  const r = (await db.select().from(P).where(and(eq(P.businessId, bid), eq(P.sid, sid))).limit(1))[0];
  if (r?.status === 'posted') throw refuse(COPY.alreadyPosted, 'posted');
  if (r?.status === 'sending') throw refuse(COPY.sending, 'sending', 409);
  throw refuse(COPY.lockedMove, 'locked', 409);
}

async function scheduleOne(ctx: ActCtx, r: Resolved, date: string, time: string) {
  const now = Date.now();
  await scheduleChecks(ctx.biz, r, date, time, now);
  const row = await writeScheduled(db, { biz: ctx.biz, r, date, time, userId: ctx.user.id });
  if (!row) return lostWrite(ctx.bid, r.t.sid);
  const was = r.existing?.status === 'scheduled';
  await scheduledEvent(ctx, was ? 'social.rescheduled' : 'social.scheduled', row, was ? String(r.existing!.date) : null);
  return row;
}

const base: ActionMap = {
  /** LinkedIn page picker, after the linkedin_page popup. An empty list means the member manages no pages. */
  'social.pages': action({
    read: true, role: 'Editor', input: z.object({ oauthRef: z.string().min(1).max(100) }),
    run: async (ctx, i) => {
      await requireSocial(ctx);
      const pend = await readPendingSocial(ctx.bid, ctx.user.id, i.oauthRef, 'li_page');
      if (!pend) return { pages: [], error: SIGN_IN_EXPIRED };
      try { return { pages: await pagesFor(ctx, pend.tokens) }; }
      catch (e: any) { console.error('[social.oauth] pages failed', String(e?.message || e).slice(0, 200)); return { pages: [], error: LI_DOWN }; }
    },
  }),

  /** Finish a connect (or reconnect) from a pending authorization. A reconnect keeps the account id, so held posts go out
   *  as scheduled; signing in as a different remote account is refused (disconnect first to switch). */
  'social.connect': action({
    input: z.object({ ch: Ch, oauthRef: z.string().min(1).max(100), pageId: z.string().min(1).max(40).optional() }),
    run: async (ctx, i) => {
      await requireSocial(ctx);
      const ch = i.ch as SocialChannel;
      const pend = await readPendingSocial(ctx.bid, ctx.user.id, i.oauthRef, ch);
      if (!pend) throw refuse(SIGN_IN_EXPIRED, 'auth_expired');
      const A = schema.socialAccounts;
      const old = (await db.select().from(A).where(and(eq(A.businessId, ctx.bid), eq(A.ch, ch))).limit(1))[0] || null;
      let remoteId = pend.id.remoteId; let name = pend.id.name; const handle = ch === 'x' ? pend.id.handle || null : null;
      if (ch === 'li_page') {
        const pageId = old ? old.remoteId : i.pageId;
        if (!pageId) throw refuse('Pick a page to connect.', 'invalid');
        let pages: SocialPage[];
        try { pages = await pagesFor(ctx, pend.tokens); } catch { throw refuse(LI_DOWN, 'unavailable', 502); }
        const pg = pages.find(p => p.id === pageId);
        if (old && i.pageId && i.pageId !== old.remoteId) {
          const other = pages.find(p => p.id === i.pageId);
          throw refuse(`You signed in as ${acctLabel({ id: '', ch, name: other?.name || 'another page' })}. Sign in as ${acctLabel(acctPublic(old))} to keep its scheduled posts, or disconnect it first.`, 'other_account', 409);
        }
        if (!pg) throw old ? refuse(`Your LinkedIn account doesn’t manage ${old.name} anymore. Sign in with one that does, or disconnect the page.`, 'not_admin', 409) : notFound('That page');
        remoteId = pg.id; name = pg.name;
      }
      if (old && old.remoteId !== remoteId) {
        throw refuse(`You signed in as ${acctLabel({ id: '', ch, name, handle })}. Sign in as ${acctLabel(acctPublic(old))} to keep its scheduled posts, or disconnect it first.`, 'other_account', 409);
      }
      let row;
      if (old) [row] = await db.update(A).set({ name, handle, ...tokenFields(pend.tokens), expired: false, expiredAt: null, updatedAt: new Date() }).where(eq(A.id, old.id)).returning();
      else [row] = await db.insert(A).values({ businessId: ctx.bid, ch, remoteId, name, handle, ...tokenFields(pend.tokens), connectedBy: ctx.user.id }).returning();
      await deletePendingSocial(i.oauthRef);
      const released = old ? await scheduledCountFor(row.id, Date.now() - STALE_MS) : 0;
      await track(old ? 'social.reconnected' : 'social.connected', { bid: ctx.bid, uid: ctx.user.id, ref: row.id, props: { ch, acct: row.id, released: old ? released : undefined } });
      return { account: acctPublic(row), reconnected: !!old, released };
    },
  }),

  /** Disconnect: revoke (best effort), delete the tokens and the account's scheduled and failed posts; posted ones keep history. */
  'social.disconnect': action({
    input: z.object({ acctId: AcctId }),
    run: async (ctx, i) => {
      await requireSocial(ctx);
      const row = await accountRow(ctx.bid, i.acctId);
      if (!row) throw notFound('Account');
      const t = tokensOf(row);
      if (t) { try { await adapterFor(row.ch, t).revoke(t); } catch { /* best effort */ } }
      const unscheduled = await db.transaction(async tx => {
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(P).where(and(eq(P.acctId, row.id), eq(P.status, 'scheduled')));
        await tx.delete(P).where(and(eq(P.acctId, row.id), inArray(P.status, ['scheduled', 'failed'])));
        await tx.delete(schema.socialAccounts).where(eq(schema.socialAccounts.id, row.id)); // posted/sending rows: acct_id → NULL, label kept
        return n;
      });
      await track('social.disconnected', { bid: ctx.bid, uid: ctx.user.id, ref: row.id, props: { ch: row.ch, acct: row.id, unscheduled } });
      return { ch: row.ch, unscheduled };
    },
  }),

  /** Post now / Try again (pack and Brief posts). Sends inline; a failed send returns the failed pub, it isn't an error. */
  'social.postNow': action({
    input: z.object({ sid: Sid, acctId: AcctId.optional() }),
    run: async (ctx, i) => {
      await requireSocial(ctx);
      const r = await resolve(ctx.bid, i.sid, i.acctId);
      // Replies always go through X's own reply box (architecture.md §14).
      if (r.t.kind === 'reply') throw refuse(COPY.replyNotAllowed, 'reply');
      const now = Date.now();
      if (r.existing?.status === 'posted') throw refuse(COPY.alreadyPosted, 'posted');
      if (r.existing && (r.existing.status === 'sending' || isLocked(r.pub, now))) throw refuse(COPY.sending, 'sending', 409);
      briefGate(r, bizToday(ctx.biz));
      accountGate(r);
      await preflightGate(ctx.biz, r);
      const claimed = await claimManual({ bid: ctx.bid, t: r.t, acct: r.acct!, userId: ctx.user.id, tz: ctx.biz.timezone });
      if (!claimed) return lostWrite(ctx.bid, i.sid);
      const done = await runSend(claimed, { manual: true, userId: ctx.user.id });
      const fin = done || (await db.select().from(P).where(eq(P.id, claimed.id)).limit(1))[0];
      return { pub: pubOf(fin, r.accts) };
    },
  }),

  /** Schedule / Reschedule / Move post window. */
  'social.schedule': action({
    input: z.object({ sid: Sid, date: Day, time: HM, acctId: AcctId.optional() }),
    run: async (ctx, i) => {
      await requireSocial(ctx);
      const r = await resolve(ctx.bid, i.sid, i.acctId);
      const row = await scheduleOne(ctx, r, i.date, i.time);
      return { pub: pubOf(row, r.accts) };
    },
  }),

  /** Drag to another day: keeps the stored time. */
  'social.move': action({
    input: z.object({ sid: Sid, date: Day }),
    run: async (ctx, i) => {
      await requireSocial(ctx);
      const r = await resolve(ctx.bid, i.sid);
      const now = Date.now(); const today = bizToday(ctx.biz);
      const why = moveCheck(r.pub, i.date, today, ctx.biz.timezone, now);
      if (why === 'same') return { pub: r.pub };
      if (why) throw refuse(why, why === COPY.lockedMove ? 'locked' : 'refused', why === COPY.lockedMove ? 409 : 400);
      slotGate(i.date, r.existing!.time, today, ctx.biz.timezone, now);
      const old = r.existing!;
      const [row] = await db.update(P).set({ date: i.date, dueAt: new Date(zonedTimeToUtc(i.date, old.time, ctx.biz.timezone)), retryAt: null, updatedBy: ctx.user.id, updatedAt: new Date() })
        .where(and(eq(P.id, old.id), eq(P.status, 'scheduled'), eq(P.dueAt, old.dueAt))).returning();
      if (!row) return lostWrite(ctx.bid, i.sid);
      await scheduledEvent(ctx, 'social.rescheduled', row, String(old.date));
      return { pub: pubOf(row, r.accts) };
    },
  }),

  'social.unschedule': action({
    input: z.object({ sid: Sid }),
    run: async (ctx, i) => {
      await requireSocial(ctx);
      const r = await resolve(ctx.bid, i.sid);
      if (!r.existing || r.existing.status !== 'scheduled') throw refuse(COPY.notScheduled, 'not_scheduled');
      if (isLocked(r.pub, Date.now())) throw refuse(COPY.lockedMove, 'locked', 409);
      const old = r.existing;
      const del = await db.delete(P).where(and(eq(P.id, old.id), eq(P.status, 'scheduled'), eq(P.dueAt, old.dueAt))).returning({ id: P.id });
      if (!del.length) return lostWrite(ctx.bid, i.sid);
      await track('social.unscheduled', { bid: ctx.bid, uid: ctx.user.id, ref: old.sid, props: { sid: old.sid, src: old.src, platform: old.platform, acct: old.acctId, ch: old.ch, date: String(old.date), time: old.time, dueAt: old.dueAt.toISOString() } });
      return { ok: true };
    },
  }),

  /** Schedule all: every row or none, in one transaction. A refusal names its platform. */
  'social.scheduleAll': action({
    input: z.object({ packId: z.string().min(1).max(64), date: Day, rows: z.array(z.object({ platform: z.enum(['x', 'linkedin']), time: HM, acctId: AcctId })).min(1).max(2) }),
    run: async (ctx, i) => {
      await requireSocial(ctx);
      if (new Set(i.rows.map(x => x.platform)).size !== i.rows.length) throw new RadarError('Some fields aren’t valid.', 400, 'invalid');
      const now = Date.now(); const prepared: { r: Resolved; time: string }[] = [];
      for (const x of i.rows) {
        try {
          const r = await resolve(ctx.bid, packSid(i.packId, x.platform), x.acctId);
          await scheduleChecks(ctx.biz, r, i.date, x.time, now);
          prepared.push({ r, time: x.time });
        } catch (e: any) { if (e instanceof RadarError) throw new RadarError(`${PLAT_L[x.platform]}: ${e.userMessage}`, e.status, e.code); throw e; }
      }
      const rows = await db.transaction(async tx => {
        const out = [];
        for (const p of prepared) {
          const row = await writeScheduled(tx, { biz: ctx.biz, r: p.r, date: i.date, time: p.time, userId: ctx.user.id });
          if (!row) throw new RadarError(`${PLAT_L[p.r.t.platform]}: ${COPY.lockedMove}`, 409, 'locked');
          out.push({ row, was: p.r.existing?.status === 'scheduled' ? String(p.r.existing.date) : null });
        }
        return out;
      });
      for (const { row, was } of rows) await scheduledEvent(ctx, was ? 'social.rescheduled' : 'social.scheduled', row, was);
      return { scheduled: rows.length };
    },
  }),

  /** Compress images: re-encode every image over 5 MB or in a format the platform doesn't take. */
  'social.compress': action({
    input: z.object({ sid: Sid }),
    run: async (ctx, i) => {
      await requireSocial(ctx);
      const r = await resolve(ctx.bid, i.sid);
      if (isLocked(r.pub, Date.now())) throw refuse(COPY.lockedEdit, 'locked', 409);
      if (r.existing?.status === 'posted') throw refuse(COPY.alreadyPosted, 'posted');
      let n = 0; const k = r.t.platform;
      if (r.t.src === 'pack') {
        const img = r.t.images[0]; if (!img) return { compressed: 0 };
        const c = await compressIfNeeded(ctx.bid, k, img.url);
        if (c) { n = 1; await updatePack(ctx.bid, r.t.packId!, x => { const cur = x.posts[k]; return cur && cur.imageUrl === img.url ? { ...x, posts: { ...x.posts, [k]: { ...cur, imageUrl: c.url, imageMeta: c.meta, compressed: true } } } : x; }); }
      } else {
        const done: { i: number; url: string; was: string; meta: any }[] = [];
        for (const img of r.t.images) { const c = await compressIfNeeded(ctx.bid, k, img.url); if (c) done.push({ i: img.i!, url: c.url, was: img.url, meta: c.meta }); }
        if (done.length) await withDay(ctx.bid, r.t.day!, row => {
          const items = row.items as BriefItem[]; const j = items.findIndex(x => x.id === r.t.item!.id); const cur = items[j];
          if (!cur?.img) return null;
          const urls = [...cur.img.urls]; const meta = cur.img.urls.map((_, x) => cur.img!.meta?.[x] ?? null);
          for (const d of done) if (urls[d.i] === d.was) { urls[d.i] = d.url; meta[d.i] = d.meta; n++; }
          const next = [...items]; next[j] = { ...cur, img: { ...cur.img, urls, meta } };
          return { items: next, ret: true };
        });
      }
      return { compressed: n };
    },
  }),
};

/** Dev only (RADAR_DEV_STUBS=1): put a stub account into the expired or lapsing state through the real token paths. */
const dev: ActionMap = {
  'social.devSimulate': action({
    input: z.object({ acctId: AcctId, what: z.enum(['expire', 'lapse']) }),
    run: async (ctx, i) => {
      await requireSocial(ctx);
      const row = await accountRow(ctx.bid, i.acctId);
      const t = row && tokensOf(row);
      if (!row || !t?.stub) throw notFound('Account');
      const next: Tokens = i.what === 'expire' ? { ...t, refreshFails: true, expires_at: Date.now() - 60_000 } : { ...t, refresh_token: null, refresh_expires_at: null, expires_at: Date.now() + 2 * 60_000 };
      await db.update(schema.socialAccounts).set({ ...tokenFields(next), updatedAt: new Date() }).where(eq(schema.socialAccounts.id, row.id));
      if (i.what === 'expire') { try { await ensureToken(row.id); } catch (e) { if (!(e instanceof AccountExpired)) throw e; } }
      return { ok: true };
    },
  }),
};

export const actions: ActionMap = { ...base, ...(env.devStubs ? dev : {}) };
