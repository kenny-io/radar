// Connected social accounts (architecture.md §7): encrypted tokens, the public projection, pending authorizations, and token
// refresh serialized per account under a Postgres row lock (X refresh tokens are single-use and rotate, so two processes
// refreshing at once must never burn the token or wrongly mark the account expired). Logs carry ids, never tokens.
import { and, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { env } from '../../../env';
import { decrypt, encrypt, randomToken } from '../../../crypto';
import { track } from '../../../events';
import { bump } from '../../../workspace';
import { socialOn } from '../../../flags';
import { once } from '../../../jobs/queue';
import type { SocialAccount, SocialChannel } from '@/lib/types';
import { COPY, acctLabel, chOf, localParts } from '@/lib/socialPublish';
import { notify } from '../../../notify';
import { type Adapter, type Identity, type Tokens, SendError, TokenError } from './api';
import { xAdapter } from './x';
import { liAdapter } from './linkedin';
import { stubAdapter } from './stubs';

export type AcctRow = typeof schema.socialAccounts.$inferSelect;
const A = schema.socialAccounts;
const REFRESH_EARLY_MS = 5 * 60_000;
const WARN_MS = 7 * 24 * 3600e3;

/* ── Adapters ── */
const overrides = new Map<SocialChannel, Adapter>();
/** Tests only: replace a channel's adapter (null restores the default). */
export function setAdapterForTests(ch: SocialChannel, a: Adapter | null) { if (a) overrides.set(ch, a); else overrides.delete(ch); }
export function adapterFor(ch: SocialChannel, t: Pick<Tokens, 'stub'> | null): Adapter {
  const o = overrides.get(ch); if (o) return o;
  if (t?.stub) {
    // Stub tokens only work with dev stubs on; anywhere else the account must be reconnected.
    if (!env.devStubs) throw new TokenError(true, 'stub tokens outside RADAR_DEV_STUBS');
    return stubAdapter(ch);
  }
  return ch === 'x' ? xAdapter : liAdapter(ch === 'li_page' ? 'page' : 'profile');
}

/** Channels this deployment can connect (its OAuth app is configured; all three with dev stubs). No fallback between LinkedIn apps. */
export function channelsAvailable(): SocialChannel[] {
  if (env.devStubs) return ['x', 'li_profile', 'li_page'];
  const out: SocialChannel[] = [];
  if (env.xClientId && env.xClientSecret) out.push('x');
  if (env.linkedinClientId && env.linkedinClientSecret) out.push('li_profile');
  if (env.linkedinPageClientId && env.linkedinPageClientSecret) out.push('li_page');
  return out;
}

/* ── Rows ── */
export const tokensOf = (r: Pick<AcctRow, 'tokensEnc'>): Tokens | null => { try { return decrypt<Tokens>(r.tokensEnc); } catch { return null; } };
export const canRefresh = (t: Tokens | null, now = Date.now()) => !!t?.refresh_token && !(t.refresh_expires_at && t.refresh_expires_at <= now);
/** The client's view. `expiresAt`: LinkedIn profile → the 60-day token's end; page → the refresh token's end; X → null. */
export function acctPublic(r: AcctRow): SocialAccount {
  let expiresAt: string | null = null;
  if (r.ch === 'li_profile') expiresAt = r.expiresAt ? r.expiresAt.toISOString() : null;
  else if (r.ch === 'li_page') { const t = tokensOf(r); expiresAt = t?.refresh_expires_at ? new Date(t.refresh_expires_at).toISOString() : r.expiresAt ? r.expiresAt.toISOString() : null; }
  return { id: r.id, ch: r.ch, name: r.name, handle: r.handle ?? null, expired: r.expired, expiresAt };
}
export async function accountRows(bid: string): Promise<AcctRow[]> { return db.select().from(A).where(eq(A.businessId, bid)).orderBy(A.createdAt); }
export async function accountRow(bid: string, id: string): Promise<AcctRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await db.select().from(A).where(and(eq(A.id, id), eq(A.businessId, bid))).limit(1))[0] || null;
}
export const tokenFields = (t: Tokens) => ({ tokensEnc: encrypt(t), expiresAt: t.expires_at ? new Date(t.expires_at) : null });

/* ── Pending authorizations (OAuth callback → social.connect), 1 hour, pruned by maintenance ── */
export interface Pending { tokens: Tokens; id: Identity }
const PENDING = 'social-pending:';
const PENDING_TTL_MS = 3600e3;
export async function savePendingSocial(bid: string, userId: string | null, ch: SocialChannel, p: Pending): Promise<string> {
  const ref = 'spend_' + randomToken(18);
  await db.insert(schema.oauthStates).values({ state: ref, userId, businessId: bid, provider: PENDING + ch, data: { enc: encrypt(p) } });
  return ref;
}
export async function readPendingSocial(bid: string, userId: string, ref: string | null | undefined, ch: SocialChannel): Promise<Pending | null> {
  if (!ref || !ref.startsWith('spend_')) return null;
  const S = schema.oauthStates;
  const r = (await db.select().from(S).where(and(eq(S.state, ref), eq(S.businessId, bid), gte(S.createdAt, new Date(Date.now() - PENDING_TTL_MS)))).limit(1))[0];
  if (!r || r.provider !== PENDING + ch || (r.userId && r.userId !== userId)) return null;
  try { return decrypt<Pending>(r.data?.enc) || null; } catch { return null; }
}
export async function deletePendingSocial(ref: string) { await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, ref)); }

/* ── Token refresh ── */
/** The account needs a reconnect: refresh failed definitively, or its token ended with no usable refresh token. */
export class AccountExpired extends Error { constructor(public acctId: string) { super('account expired'); } }

async function emitExpired(row: AcctRow) {
  const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM social_pubs WHERE acct_id = ${row.id} AND status = 'scheduled'`)).rows as any[];
  console.warn(`[social.tokens] account ${row.id} (${row.ch}) expired; ${n} scheduled post(s) held`);
  await track('social.expired', { bid: row.businessId, ref: row.id, props: { ch: row.ch, acct: row.id, held: n } });
  // §21 P10: tell members, with the count on hold.
  if (n > 0) await notify(row.businessId, `${COPY.expired(row.ch)} ${n === 1 ? '1 scheduled post is' : `${n} scheduled posts are`} on hold.`, { tone: 'warn', action: { label: 'Reconnect', href: '/settings?section=social' } }).catch(() => {});
  await bump(row.businessId).catch(() => {});
}

/**
 * A usable access token. Refreshes when it ends within 5 minutes (`force`: always; `stale`: the token that just got a 401 —
 * refresh unless another process already replaced it). One transaction holds `SELECT … FOR UPDATE` across the refresh and
 * writes the new access + refresh token pair before releasing it.
 * Throws AccountExpired (definitive) or SendError transient/unavailable (5xx, network: the account is not marked).
 */
export async function ensureToken(acctId: string, o: { force?: boolean; stale?: string } = {}): Promise<{ row: AcctRow; t: Tokens }> {
  type R = { k: 'ok'; row: AcctRow; t: Tokens } | { k: 'expired'; row: AcctRow | null; newly: boolean } | { k: 'transient'; detail: string };
  const r: R = await db.transaction(async tx => {
    const row = (await tx.select().from(A).where(eq(A.id, acctId)).for('update').limit(1))[0];
    if (!row) return { k: 'expired', row: null, newly: false };
    if (row.expired) return { k: 'expired', row, newly: false };
    const t = tokensOf(row); const now = Date.now();
    const expire = async (): Promise<R> => { await tx.update(A).set({ expired: true, expiredAt: new Date(), updatedAt: new Date() }).where(eq(A.id, row.id)); return { k: 'expired', row, newly: true }; };
    if (!t) return expire();
    const fresh = !t.expires_at || t.expires_at - REFRESH_EARLY_MS > now;
    if (o.stale ? t.access_token !== o.stale : !o.force && fresh) return { k: 'ok', row, t };
    if (!canRefresh(t, now)) {
      if (!o.stale && (!t.expires_at || t.expires_at > now)) return { k: 'ok', row, t }; // still valid; can't be renewed in the background
      return expire();
    }
    let nt: Tokens;
    try { nt = await adapterFor(row.ch, t).refresh(t); }
    catch (e: any) {
      if (e instanceof TokenError && e.definitive) { console.warn(`[social.tokens] refresh refused for ${row.id}: ${e.detail.slice(0, 200)}`); return expire(); }
      return { k: 'transient', detail: String(e?.detail || e?.message || e).slice(0, 300) };
    }
    const next = { ...nt, stub: t.stub || undefined };
    const [upd] = await tx.update(A).set({ ...tokenFields(next), updatedAt: new Date() }).where(eq(A.id, row.id)).returning();
    return { k: 'ok', row: upd, t: next };
  });
  if (r.k === 'ok') return { row: r.row, t: r.t };
  if (r.k === 'transient') throw new SendError('transient', 'unavailable', `token refresh: ${r.detail}`);
  if (r.newly && r.row) await emitExpired(r.row);
  throw new AccountExpired(acctId);
}

/** Cron social.tokens (every minute). DB-only: accounts whose token has ended with no usable refresh token (LinkedIn
 *  profiles after 60 days, pages after 365) become expired — no refresh call. Once per account per day, accounts that can
 *  refresh do (keeps X refresh tokens alive and finds revoked apps before send time). Unflagged businesses are skipped. */
export async function tokensTick(now: Date) {
  const rows = await db.select({ a: A, ownerId: schema.businesses.ownerId }).from(A).innerJoin(schema.businesses, eq(schema.businesses.id, A.businessId)).where(eq(A.expired, false));
  const flag = new Map<string, boolean>();
  const day = now.toISOString().slice(0, 10);
  for (const { a, ownerId } of rows) {
    if (!flag.has(a.businessId)) flag.set(a.businessId, await socialOn({ id: a.businessId, ownerId }));
    if (!flag.get(a.businessId)) continue;
    const t = tokensOf(a);
    // §21 P10: about 7 days before a LinkedIn profile's 60-day access ends, say so once.
    if (a.ch === 'li_profile' && a.expiresAt && a.expiresAt.getTime() > now.getTime() && a.expiresAt.getTime() - now.getTime() <= WARN_MS && (await once(`social.expiring:${a.id}:${a.expiresAt.toISOString().slice(0, 10)}`))) {
      const tz = (await db.select({ tz: schema.businesses.timezone }).from(schema.businesses).where(eq(schema.businesses.id, a.businessId)).limit(1))[0]?.tz || 'America/New_York';
      const d = new Date(localParts(a.expiresAt.getTime(), tz).date + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      await notify(a.businessId, `${chOf(a.ch).l} access for ${acctLabel(acctPublic(a))} ends ${d}. Reconnect it to keep posting.`, { tone: 'warn', action: { label: 'Reconnect', href: '/settings?section=social' } }).catch(() => {});
    }
    try {
      if (!canRefresh(t, now.getTime())) { if (!t || (a.expiresAt && a.expiresAt <= now)) await ensureToken(a.id); continue; }
      if (await once(`social.tokens:${a.id}:${day}`)) await ensureToken(a.id, { force: true });
    } catch (e: any) {
      if (!(e instanceof AccountExpired)) console.warn(`[social.tokens] ${a.id}: ${String(e?.message || e).slice(0, 200)}`);
    }
  }
}
