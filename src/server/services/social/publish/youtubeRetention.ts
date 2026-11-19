// Connected YouTube API data only. No remote video deletion and no cross-tenant provider-ID matching.
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { db, schema as S } from '../../../db';
import { decrypt, encrypt } from '../../../crypto';
import { reportFailure } from '../../../observability/failures';
import { bump } from '../../../workspace';
import type { Tokens } from './api';
import { TokenError } from './api';
import { youtubeAdapter, youtubeMe, refreshYouTube, revokeYouTube, YouTubeConnectionError, YouTubeTokenError } from './youtube';
import { YOUTUBE_APPROVAL, YOUTUBE_CACHE_MS, YOUTUBE_LABEL, YOUTUBE_NO_RESEND, YOUTUBE_REVOKE_MS, youtubeProfileStale, youtubeReceiptStale } from '@/lib/youtubeLifecycle';

export type CleanupReason = 'disconnect' | 'revoked' | 'delete' | 'cache_expired';
export type RetentionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const REVOKE_JOB = 'youtube.revoke';
const A = S.socialAccounts, P = S.socialPubs, J = S.jobs;
const readTokens = (enc: string): Tokens | null => { try { return decrypt<Tokens>(enc); } catch { return null; } };
export const youtubeRetentionHooks = { profile: (token: string) => youtubeMe(token, 8_000), refresh: (t: Tokens) => refreshYouTube(t, 8_000), revoke: (t: Tokens, timeoutMs = 15_000) => revokeYouTube(t, timeoutMs) };

/** Scrub one locked receipt, retaining only owner content and local operational facts. */
async function scrubReceipt(q: RetentionTx, row: typeof P.$inferSelect, reason: CleanupReason, now: Date, detach = false) {
  const p = row.payload;
  const previous = p?.youtubeRetention;
  const noResend = !!previous?.noResend || row.status === 'posted' || !!row.remoteId || !!p?.providerRef || row.errCode === 'unknown' || (row.status === 'sending' && row.stage === 'create');
  const marker = previous || { scrubbedAt: now.getTime(), reason, noResend, needsApproval: !noResend };
  await q.update(P).set({
    status: row.status === 'posted' ? 'posted' : 'failed', ...(detach ? { acctId: null } : {}), acctLabel: YOUTUBE_LABEL,
    remoteId: null, remoteUrl: null, errDetail: null, err: row.status === 'posted' ? null : noResend ? YOUTUBE_NO_RESEND : YOUTUBE_APPROVAL,
    errCode: row.status === 'posted' ? null : noResend ? 'unknown' : 'auth', attemptKey: null, stage: null, retryAt: null, autopilotActivationId: null,
    payload: { ...(p?.text !== undefined ? { text: p.text } : {}), ...(p?.media ? { media: p.media } : {}), ...(p?.video ? { video: p.video } : {}), ...(p?.options ? { options: p.options } : {}), ...(p?.manual !== undefined ? { manual: p.manual } : {}), youtubeRetention: { ...marker, noResend: noResend || marker.noResend } }, updatedAt: now,
  }).where(and(eq(P.id, row.id), eq(P.businessId, row.businessId), eq(P.ch, 'youtube')));
  await q.delete(S.events).where(and(eq(S.events.businessId, row.businessId), eq(S.events.kind, 'social.posted'), eq(S.events.ref, row.sid)));
}

/** Trusted local business/account scope only; caller owns transaction. Locks business -> account -> pubs. */
export async function scrubYouTubeData(q: RetentionTx, o: { bid: string; acctId?: string; reason: CleanupReason; now: Date; expectedTokensEnc?: string; bumpRevision?: boolean }): Promise<{ unscheduled: number; scrubbedPubs: number; revokeJobIds: string[] }> {
  const biz = (await q.select({ id: S.businesses.id }).from(S.businesses).where(eq(S.businesses.id, o.bid)).for('update'))[0];
  if (!biz) return { unscheduled: 0, scrubbedPubs: 0, revokeJobIds: [] };
  const accounts = await q.select().from(A).where(and(eq(A.businessId, o.bid), eq(A.ch, 'youtube'), ...(o.acctId ? [eq(A.id, o.acctId)] : []))).for('update');
  if (o.expectedTokensEnc && (!accounts[0] || accounts[0].tokensEnc !== o.expectedTokensEnc)) return { unscheduled: 0, scrubbedPubs: 0, revokeJobIds: [] };
  const rows = await q.select().from(P).where(and(eq(P.businessId, o.bid), eq(P.ch, 'youtube'), ...(o.acctId ? [or(eq(P.acctId, o.acctId), isNull(P.acctId))!] : []))).orderBy(P.id).for('update');
  for (const row of rows) await scrubReceipt(q, row, o.reason, o.now, true);
  const pending = await q.select({ data: S.oauthStates.data }).from(S.oauthStates).where(and(eq(S.oauthStates.businessId, o.bid), eq(S.oauthStates.provider, 'social-pending:youtube'))).for('update');
  const revokeTokens = accounts.map(a => readTokens(a.tokensEnc)).filter((t): t is Tokens => !!t);
  for (const row of pending) { try { const grant = decrypt<{ tokens: Tokens }>(row.data?.enc); if (grant?.tokens) revokeTokens.push(grant.tokens); } catch {} }
  // Clear all same-business pending grants, including a flow whose picker could otherwise reconnect old data.
  await q.delete(S.oauthStates).where(and(eq(S.oauthStates.businessId, o.bid), inArray(S.oauthStates.provider, ['social-pending:youtube', 'youtube'])));
  await q.delete(S.events).where(and(eq(S.events.businessId, o.bid), eq(S.events.kind, 'social.posted'), sql`(${S.events.props}->>'ch' = 'youtube' OR ${S.events.props}->>'platform' = 'youtube')`));
  await q.execute(sql`UPDATE social_packs SET data = data #- '{posts,youtube,pub}' WHERE business_id = ${o.bid} AND data #> '{posts,youtube,pub}' IS NOT NULL`);
  await q.insert(S.cronMarks).values({ key: `youtube.cleanup:${o.bid}`, createdAt: o.now }).onConflictDoUpdate({ target: S.cronMarks.key, set: { createdAt: o.now } });
  const revokeJobIds: string[] = [];
  const seen = new Set<string>();
  for (const tokens of revokeTokens) {
    if (!tokens.access_token || seen.has(tokens.refresh_token || tokens.access_token)) continue;
    seen.add(tokens.refresh_token || tokens.access_token);
    const minimal: Tokens = { access_token: tokens.access_token, refresh_token: tokens.refresh_token, stub: tokens.stub };
    const [job] = await q.insert(J).values({ kind: REVOKE_JOB, businessId: null, ref: null, payload: { tokenEnc: encrypt(minimal), expiresAt: o.now.getTime() + YOUTUBE_REVOKE_MS }, maxAttempts: 8, runAt: o.now }).returning({ id: J.id });
    revokeJobIds.push(job.id);
  }
  for (const a of accounts) await q.delete(A).where(and(eq(A.id, a.id), eq(A.businessId, o.bid), eq(A.ch, 'youtube')));
  if (o.bumpRevision !== false) await q.update(S.businesses).set({ rev: sql`${S.businesses.rev} + 1` }).where(eq(S.businesses.id, o.bid));
  return { unscheduled: rows.filter(r => r.status === 'scheduled').length, scrubbedPubs: rows.length, revokeJobIds };
}

/** Post-commit immediate revoke. Only safe count/enum/local-job-ID data can escape this module. */
export async function revokeYouTubeJob(jobId: string, now = new Date(), terminal = false, timeoutMs = 15_000): Promise<'done' | 'retry' | 'expired' | 'failed'> {
  const row = (await db.select().from(J).where(and(eq(J.id, jobId), eq(J.kind, REVOKE_JOB))).limit(1))[0];
  if (!row?.payload?.tokenEnc) return 'done';
  const wipe = async () => { await db.update(J).set({ payload: {}, error: null }).where(and(eq(J.id, row.id), eq(J.kind, REVOKE_JOB))); };
  if (!Number.isFinite(row.payload.expiresAt) || row.payload.expiresAt <= now.getTime()) { await wipe(); return 'expired'; }
  const tokens = readTokens(row.payload.tokenEnc);
  if (!tokens) { await wipe(); return 'failed'; }
  try {
    const { adapterFor } = await import('./accounts');
    if (tokens.stub) await adapterFor('youtube', tokens).revoke(tokens); else await youtubeRetentionHooks.revoke(tokens, timeoutMs);
    await wipe(); await db.update(J).set({ status: 'done', result: { status: 'done' }, finishedAt: now, lockedAt: null }).where(and(eq(J.id, row.id), eq(J.status, 'queued')));
    return 'done';
  } catch (error) {
    if (terminal || error instanceof YouTubeTokenError && error.reason === 'configuration') {
      await wipe(); await reportFailure(new Error('YouTube revoke could not be completed'), { source: 'social', operation: 'youtube.revoke', provider: 'youtube', ref: row.id, code: 'revoke_failed' }); return 'failed';
    }
    return 'retry';
  }
}
export async function attemptYouTubeRevokes(ids: string[], now?: Date, deadline = Date.now() + 35_000) {
  for (const id of ids) {
    const remaining = deadline - Date.now(); if (remaining < 250) break; // remaining intents are already durable/global
    try { await revokeYouTubeJob(id, now, false, Math.min(15_000, remaining)); }
    catch { await reportFailure(new Error('YouTube revoke retry remains queued after local cleanup'), { source: 'social', operation: 'youtube.revoke', ref: id, provider: 'youtube', code: 'retry' }); }
  }
}
export async function cleanupYouTube(o: { bid: string; acctId?: string; reason: CleanupReason; now?: Date; expectedTokensEnc?: string; revokeDeadline?: number }) {
  const result = await db.transaction(q => scrubYouTubeData(q, { ...o, now: o.now || new Date() }));
  await attemptYouTubeRevokes(result.revokeJobIds, o.now, o.revokeDeadline);
  return { unscheduled: result.unscheduled, scrubbedPubs: result.scrubbedPubs };
}

/** Daily forced grant + profile check. Network is outside locks; commits compare the exact encrypted grant generation. */
export async function verifyYouTubeAccount(acctId: string, now = new Date()): Promise<'fresh' | 'gone' | 'revoked' | 'retry'> {
  const deadline = Date.now() + 35_000;
  const row = (await db.select().from(A).where(and(eq(A.id, acctId), eq(A.ch, 'youtube'))).limit(1))[0];
  if (!row) return 'gone';
  const biz = (await db.select({ status: S.businesses.status }).from(S.businesses).where(eq(S.businesses.id, row.businessId)).limit(1))[0];
  const tokens = readTokens(row.tokensEnc);
  if (!biz || biz.status === 'deleted' || !tokens || youtubeProfileStale(row, tokens.youtube, now.getTime())) { await cleanupYouTube({ bid: row.businessId, acctId, reason: biz?.status === 'deleted' ? 'delete' : 'cache_expired', now, expectedTokensEnc: row.tokensEnc, revokeDeadline: deadline }); return 'gone'; }
  try {
    const { adapterFor } = await import('./accounts');
    let next = tokens.stub ? await adapterFor('youtube', tokens).refresh(tokens) : await youtubeRetentionHooks.refresh(tokens);
    let id;
    try { id = tokens.stub ? { remoteId: row.remoteId, name: row.name, handle: row.handle } : await youtubeRetentionHooks.profile(next.access_token); }
    catch (error) {
      if (tokens.stub || !(error instanceof YouTubeTokenError) || error.status !== 401) throw error;
      // A lone API401 is never revocation proof. Refresh once and retry the read, within four 8s requests.
      next = await youtubeRetentionHooks.refresh(next); id = await youtubeRetentionHooks.profile(next.access_token);
    }
    if (id.remoteId !== row.remoteId) throw new YouTubeTokenError('revoked');
    next.youtube = { profileFetchedAt: now.getTime(), authorizationCheckedAt: now.getTime() };
    const [updated] = await db.update(A).set({ name: id.name, handle: id.handle || null, tokensEnc: encrypt(next), expiresAt: next.expires_at ? new Date(next.expires_at) : null, expired: false, expiredAt: null, updatedAt: now }).where(and(eq(A.id, row.id), eq(A.tokensEnc, row.tokensEnc), sql`EXISTS (SELECT 1 FROM businesses b WHERE b.id = ${A.businessId} AND b.status = 'active')`)).returning({ id: A.id });
    if (!updated) return 'retry'; await bump(row.businessId); return 'fresh';
  } catch (error) {
    const revoked = error instanceof YouTubeConnectionError || error instanceof YouTubeTokenError && error.reason === 'revoked' || error instanceof TokenError && error.definitive;
    if (revoked) { await cleanupYouTube({ bid: row.businessId, acctId, reason: 'revoked', now, expectedTokensEnc: row.tokensEnc, revokeDeadline: deadline }); return 'revoked'; }
    if (error instanceof YouTubeTokenError && error.reason === 'configuration') {
      const fallback = row.createdAt.getTime(); const held = { ...tokens, youtube: { profileFetchedAt: tokens.youtube?.profileFetchedAt ?? fallback, authorizationCheckedAt: tokens.youtube?.authorizationCheckedAt ?? fallback, verificationHold: 'configuration' as const } };
      await db.update(A).set({ expired: true, expiredAt: now, tokensEnc: encrypt(held), updatedAt: now }).where(and(eq(A.id, row.id), eq(A.tokensEnc, row.tokensEnc)));
      await bump(row.businessId);
      await reportFailure(new Error('YouTube authorization configuration check failed'), { source: 'social', operation: 'youtube.verify', ref: row.id, provider: 'youtube', code: 'configuration' });
    }
    const lastChecked = tokens.youtube?.authorizationCheckedAt ?? row.createdAt.getTime();
    if (!Number.isFinite(lastChecked) || now.getTime() - lastChecked >= 864e5) await reportFailure(new Error('YouTube daily connection verification is overdue'), { source: 'social', operation: 'youtube.verify', ref: row.id, provider: 'youtube', incidentKey: 'youtube.verify.overdue', code: now.getTime() - lastChecked >= 27 * 864e5 ? 'verification_deadline' : 'verification_overdue' });
    return 'retry';
  }
}

/** Bounded, database-only expiry. No provider requests while the cron advisory lock is held. */
export async function expireYouTubeCaches(now = new Date(), cursors: { accountCursor?: string | null; receiptCursor?: string | null } = {}): Promise<{ accounts: number; receipts: number; next?: { accountCursor: string | null; receiptCursor: string | null } }> {
  let accounts = 0, receipts = 0;
  const candidates = cursors.accountCursor === null ? [] : await db.select().from(A).where(and(eq(A.ch, 'youtube'), ...(cursors.accountCursor ? [gt(A.id, cursors.accountCursor)] : []))).orderBy(A.id).limit(100);
  for (const a of candidates) {
    if (accounts >= 100) break;
    if (youtubeProfileStale(a, readTokens(a.tokensEnc)?.youtube, now.getTime())) {
      await db.transaction(q => scrubYouTubeData(q, { bid: a.businessId, acctId: a.id, reason: 'cache_expired', now, expectedTokensEnc: a.tokensEnc })); accounts++;
    }
  }
  const old = cursors.receiptCursor === null ? [] : await db.select().from(P).where(and(eq(P.ch, 'youtube'), ...(cursors.receiptCursor ? [gt(P.id, cursors.receiptCursor)] : []), sql`(${P.remoteId} IS NOT NULL OR ${P.remoteUrl} IS NOT NULL OR ${P.acctLabel} <> ${YOUTUBE_LABEL} OR ${P.errDetail} IS NOT NULL OR ${P.payload} ? 'providerRef')`)).orderBy(P.id).limit(100);
  for (const row of old) {
    if (receipts >= 100) break;
    if (!youtubeReceiptStale(row, now.getTime())) continue;
    await db.transaction(async q => {
      await q.select({ id: S.businesses.id }).from(S.businesses).where(eq(S.businesses.id, row.businessId)).for('update');
      const [current] = await q.select().from(P).where(and(eq(P.id, row.id), eq(P.ch, 'youtube'))).for('update');
      if (current && youtubeReceiptStale(current, now.getTime())) { await scrubReceipt(q, current, 'cache_expired', now); await q.update(S.businesses).set({ rev: sql`${S.businesses.rev} + 1` }).where(eq(S.businesses.id, row.businessId)); }
    }); receipts++;
  }
  const events = await db.select({ id: S.events.id }).from(S.events).where(and(eq(S.events.kind, 'social.posted'), sql`(${S.events.props}->>'ch' = 'youtube' OR ${S.events.props}->>'platform' = 'youtube')`, sql`${S.events.createdAt} <= ${new Date(now.getTime() - YOUTUBE_CACHE_MS).toISOString()}::timestamptz`)).orderBy(S.events.id).limit(100);
  if (events.length) await db.delete(S.events).where(inArray(S.events.id, events.map(e => e.id)));
  const abandoned = await db.select({ id: J.id }).from(J).where(and(eq(J.kind, REVOKE_JOB), sql`payload ? 'tokenEnc'`, sql`(status IN ('done','failed') OR CASE WHEN payload->>'expiresAt' ~ '^[0-9]+$' THEN (payload->>'expiresAt')::numeric <= ${now.getTime()} ELSE true END)`)).orderBy(J.id).limit(100);
  if (abandoned.length) await db.update(J).set({ payload: {}, error: null }).where(inArray(J.id, abandoned.map(j => j.id)));
  const legacy = await db.select({ id: S.socialPacks.id, bid: S.socialPacks.businessId }).from(S.socialPacks).where(sql`data #> '{posts,youtube,pub}' IS NOT NULL`).orderBy(S.socialPacks.id).limit(100);
  if (legacy.length) {
    await db.execute(sql`UPDATE social_packs SET data = data #- '{posts,youtube,pub}' WHERE id IN ${sql`(${sql.join(legacy.map(p => sql`${p.id}`), sql`, `)})`}`);
    await db.update(S.businesses).set({ rev: sql`${S.businesses.rev} + 1` }).where(inArray(S.businesses.id, [...new Set(legacy.map(p => p.bid))]));
  }
  const next = { accountCursor: candidates.length === 100 ? candidates[99].id : null, receiptCursor: old.length === 100 ? old[99].id : null };
  return { accounts, receipts, ...(next.accountCursor || next.receiptCursor || events.length === 100 || abandoned.length === 100 || legacy.length === 100 ? { next } : {}) };
}

/** Trusted operator aggregate only; tokens/identities never leave this function. Keyset reads keep each query bounded. */
export async function youtubeRetentionReport(now = new Date()) {
  let accounts = 0, unstampedAccounts = 0, heldAccounts = 0, oldestUncheckedHours = 0, cursor: string | undefined;
  for (;;) {
    const batch = await db.select().from(A).where(and(eq(A.ch, 'youtube'), ...(cursor ? [gt(A.id, cursor)] : []))).orderBy(A.id).limit(100);
    for (const row of batch) {
      accounts++; const t = readTokens(row.tokensEnc); if (!t?.youtube) unstampedAccounts++;
      if (t?.youtube?.verificationHold) heldAccounts++;
      const value = t?.youtube?.authorizationCheckedAt ?? row.createdAt.getTime(); const checked = typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= now.getTime() + 60_000 ? value : 0;
      oldestUncheckedHours = Math.max(oldestUncheckedHours, Math.floor((now.getTime() - checked) / 3600e3));
    }
    if (batch.length < 100) break; cursor = batch[99].id;
  }
  const [pubs] = await db.select({ n: sql<number>`count(*)::int` }).from(P).where(and(eq(P.ch, 'youtube'), sql`(remote_id IS NOT NULL OR remote_url IS NOT NULL OR payload ? 'providerRef' OR acct_label <> ${YOUTUBE_LABEL})`));
  const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(S.oauthStates).where(eq(S.oauthStates.provider, 'social-pending:youtube'));
  const [queue] = await db.select({ n: sql<number>`count(*)::int`, at: sql<string | null>`min(created_at)` }).from(J).where(and(inArray(J.kind, ['youtube.verify', 'youtube.expire']), sql`status IN ('queued','running')`));
  const [revoke] = await db.select({ n: sql<number>`count(*)::int` }).from(J).where(and(eq(J.kind, REVOKE_JOB), sql`payload ? 'tokenEnc'`));
  return { accounts, unstampedAccounts, heldAccounts, oldestUncheckedHours, apiReceiptCopies: pubs.n, pendingGrants: pending.n, maintenanceBacklog: queue.n, oldestBacklogHours: queue.at ? Math.floor((now.getTime() - new Date(queue.at).getTime()) / 3600e3) : 0, encryptedRevokeRetries: revoke.n };
}
