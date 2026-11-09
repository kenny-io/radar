import { isRetiredLifecycle, RETIRED_LIFECYCLE_TYPES } from './retired';
import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { db, pool, schema } from '@/server/db';
import { env } from '@/server/env';
import { decrypt, encrypt, sha256 } from '@/server/crypto';
import { getProvider } from '@/server/billing/provider';
import { onboardingAllowed } from './preferences';
import { lifecyclePayload, type LifecyclePayload } from './queue';
import { prepareGuide, acknowledgeGuide, finishGuide } from './guides';
import { prepareEducation, acknowledgeEducation, blockEducation } from './education';
import { currentWorkSections, optionalDeliveryAfter } from './engagement';
const M = schema.lifecycleEmails;
type Mail = typeof M.$inferSelect;
const MAX_ATTEMPTS = 8;
const RETRY_WINDOW = 23 * 3600e3; // less than provider24h dedupe retention, including scheduling/clock margin
const CLAIM_MS = 2 * 60e3;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Time-sensitive notices are checked against current authoritative application/provider state before delivery. */
export async function lifecycleEligible(row: Mail, payload: LifecyclePayload, now = new Date(), signal?: AbortSignal): Promise<boolean> {
  if (isRetiredLifecycle(row.type)) return false;
  // Retire previously frozen workspace notices as well as removing new enqueueing.
  if (row.type === 'workspace_ready') return false;
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, row.userId)).limit(1);
  if (!u || u.guest || payload.envelope.to.length !== 1 || payload.envelope.to[0] !== u.email) return false;
  const d = payload.data;
  if (['welcome', 'founder_note', 'work_update'].includes(row.type) && !u.emailVerifiedAt) return false;
  if (row.type === 'lifecycle_guide') return (await prepareGuide(row, payload, now)).kind === 'send';
  if (row.type === 'weekly_education') return (await prepareEducation(row, payload, now)).kind === 'send';
  if (row.type === 'work_update') {
    const current = await currentWorkSections(row, payload, now);
    return row.firstAttemptAt ? current.length > 0 && current.length === d.workSections?.length : current.length > 0;
  }
  if (row.type === 'founder_note') return onboardingAllowed(u.id);
  if (row.type === 'password_reset') {
    if (!u.passwordHash) return false;
    let raw: string | null = null;
    try { const url = new URL(d.resetUrl || ''); raw = new URLSearchParams(url.hash.slice(1)).get('token'); } catch { return false; }
    if (!raw) return false;
    return !!(await db.select({ hash: schema.passwordResetTokens.tokenHash }).from(schema.passwordResetTokens).where(and(
      eq(schema.passwordResetTokens.tokenHash, sha256(raw)), eq(schema.passwordResetTokens.userId, u.id), isNull(schema.passwordResetTokens.usedAt), gt(schema.passwordResetTokens.expiresAt, now),
    )).limit(1))[0];
  }
  if (!['trial_started', 'trial_ending', 'payment_failed', 'cancellation_scheduled', 'subscription_ended'].includes(row.type)) return true;
  const [a] = await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId, u.id)).limit(1);
  if (!a || a.comp || !d.subscriptionId || a.stripeSubscriptionId !== d.subscriptionId) return false;
  if (row.type === 'trial_started' || row.type === 'trial_ending') {
    return a.status === 'trialing' && !!a.trialEnd && a.trialEnd > now && a.trialEnd.toISOString() === d.trialEnd && !a.cancelAtPeriodEnd;
  }
  if (row.type === 'cancellation_scheduled') {
    const end = a.currentPeriodEnd || a.trialEnd;
    return a.cancelAtPeriodEnd && ['trialing', 'active'].includes(a.status) && !!end && end > now && end.toISOString() === d.periodEnd;
  }
  if (row.type === 'subscription_ended') return ['canceled', 'incomplete_expired'].includes(a.status) && (!d.status || a.status === d.status);
  if (!['past_due', 'unpaid', 'incomplete'].includes(a.status) || !d.invoiceId) return false;
  const provider = await getProvider();
  if (!provider) throw new Error('Billing provider unavailable during lifecycle check');
  const sub = await provider.getSubscription(d.subscriptionId);
  if (signal?.aborted) throw new Error('Lifecycle check stopped');
  if (sub.customer !== a.stripeCustomerId || sub.latest_invoice !== d.invoiceId) return false;
  return (await provider.getInvoice(d.invoiceId)).status === 'open';
}

/** A stopped worker can leave only an idempotent provider request in flight, never an unbounded billing check. */
async function eligibleWithinDeadline(row: Mail, payload: LifecyclePayload, now: Date, outer?: AbortSignal) {
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), 10_000);
  const signal = outer ? AbortSignal.any([outer, deadline.signal]) : deadline.signal;
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([lifecycleEligible(row, payload, now, signal), new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('Lifecycle check stopped'));
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
    })]);
  } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
}

/** Atomic lease: a dead dispatcher may retry with the same frozen body/provider key inside the23h window. */
async function claim(now: Date, userIds?: string[]): Promise<Mail | null> {
  const token = randomUUID();
  const { rows } = await pool.query<{ id: string }>(`UPDATE lifecycle_emails SET status='sending', claimed_at=$1, claim_token=$2
    WHERE id = (SELECT id FROM lifecycle_emails WHERE ((status='queued' AND next_attempt_at <= $1)
      OR (status='sending' AND claimed_at < $3)) AND ($4::uuid[] IS NULL OR user_id = ANY($4::uuid[])) ORDER BY CASE WHEN type='password_reset' THEN 0 WHEN type IN ('payment_failed','trial_ending','cancellation_scheduled','subscription_ended') THEN 1 WHEN type='weekly_education' THEN 3 WHEN type='lifecycle_guide' THEN 4 WHEN type='founder_note' THEN 5 WHEN type='work_update' THEN 6 ELSE 2 END, next_attempt_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`, [now, token, new Date(now.getTime() - CLAIM_MS), userIds ?? null]);
  return rows[0] ? (await db.select().from(M).where(eq(M.id, rows[0].id)))[0] : null;
}
const owned = (row: Mail) => and(eq(M.id, row.id), eq(M.claimToken, row.claimToken!), eq(M.status, 'sending'));
async function release(row: Mail) { await db.update(M).set({ status: 'queued', claimedAt: null, claimToken: null }).where(owned(row)); }
async function defer(row: Mail, next: Date, reason = 'optional_frequency_or_quiet_hours') {
  const expiresAt = ['weekly_education', 'lifecycle_guide'].includes(row.type) && !row.firstAttemptAt && ['education_paused', 'education_opted_out'].includes(reason) ? new Date(next.getTime() + 30 * 864e5) : undefined;
  await db.transaction(async tx => {
    if (row.type === 'lifecycle_guide') await tx.select().from(schema.lifecycleGuideStates).where(and(eq(schema.lifecycleGuideStates.userId, row.userId), eq(schema.lifecycleGuideStates.pendingEmailId, row.id))).for('update');
    const changed = await tx.update(M).set({ status: 'queued', nextAttemptAt: next, claimedAt: null, claimToken: null, lastError: reason, ...(expiresAt ? { expiresAt } : {}) }).where(owned(row)).returning({ id: M.id });
    if (changed.length && expiresAt && row.type === 'lifecycle_guide') await tx.update(schema.lifecycleGuideStates).set({ expiresAt }).where(and(eq(schema.lifecycleGuideStates.userId, row.userId), eq(schema.lifecycleGuideStates.pendingEmailId, row.id)));
  });
}
async function terminal(row: Mail, status: 'failed' | 'suppressed', reason: string) {
  await db.transaction(async tx => {
    if (row.type === 'weekly_education') await tx.select().from(schema.educationEnrollments).where(eq(schema.educationEnrollments.userId, row.userId)).for('update');
    if (row.type === 'lifecycle_guide') await tx.select().from(schema.lifecycleGuideStates).where(and(eq(schema.lifecycleGuideStates.userId, row.userId), eq(schema.lifecycleGuideStates.pendingEmailId, row.id))).for('update');
    const rows = await tx.update(M).set({ status, lastError: reason, claimedAt: null, claimToken: null, ...(row.type === 'password_reset' ? { payloadEnc: '' } : {}) }).where(owned(row)).returning({ id: M.id });
    if (rows.length && row.type === 'weekly_education') await blockEducation(tx, row, reason);
    if (rows.length && row.type === 'lifecycle_guide') await finishGuide(tx, row, reason);
  });
  if (status === 'failed') console.error('[lifecycle] delivery failed', { id: row.id, type: row.type, reason });
}
async function retry(row: Mail, reason: string, now: Date, retryAfterMs = 0) {
  const first = row.firstAttemptAt || now;
  const attempt = row.attempts;
  const backoff = Math.min(3600e3, 30_000 * 2 ** Math.max(0, attempt - 1));
  const next = new Date(now.getTime() + Math.max(backoff, retryAfterMs));
  if (attempt >= MAX_ATTEMPTS || next.getTime() - first.getTime() >= RETRY_WINDOW || next >= row.expiresAt) return terminal(row, 'failed', reason);
  await db.update(M).set({ status: 'queued', nextAttemptAt: next, lastError: reason, claimedAt: null, claimToken: null }).where(owned(row));
}
/** Suppressions are never removed. Only the recognized sending-only key response uses native provider enforcement. */
async function educationSuppression(email: string, fetcher: typeof fetch, sleep: (ms: number) => Promise<unknown>, signal?: AbortSignal): Promise<string> {
  try {
    const response = await fetcher(`https://api.resend.com/suppressions/${encodeURIComponent(email)}`, {
      method: 'GET', headers: { authorization: `Bearer ${env.resendKey}` },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    if (response.status !== 200 && response.status !== 401) {
      await response.body?.cancel().catch(() => {});
      return response.status === 404 ? 'clear' : `suppression_lookup_http_${response.status}`;
    }
    const reader = response.body?.getReader();
    if (!reader) return 'suppression_lookup_invalid';
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 4096) { await reader.cancel(); return 'suppression_lookup_invalid'; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const record = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (response.status === 401) {
      // A valid sending-only key cannot read suppressions. Keep its least privilege and rely on Resend's
      // native delivery suppression; never infer this exception from freeform provider messages.
      return record !== null && typeof record === 'object' && !Array.isArray(record) && Object.hasOwn(record, 'name') && record.name === 'restricted_api_key'
        ? 'native_suppression' : 'suppression_lookup_http_401';
    }
    return typeof record?.email === 'string' && record.email.toLowerCase() === email.toLowerCase() ? 'suppressed' : 'suppression_lookup_invalid';
  } catch { return 'suppression_lookup_unavailable'; }
  finally { await sleep(125); }
}

export interface DispatchOptions { /** Optional operator/test scope; production worker drains all users. */ userIds?: string[]; now?: Date; clock?: () => Date; limit?: number; fetch?: typeof fetch; sleep?: (ms: number) => Promise<unknown>; shouldStop?: () => boolean; signal?: AbortSignal }

/** Only one batch per deployment at once; a conservative8requests/s leaves headroom below the shared provider10/s limit. */
export async function dispatchLifecycleBatch(options: DispatchOptions = {}) {
  const c = await pool.connect();
  let held = false, processed = 0;
  try {
    held = !!(await c.query('SELECT pg_try_advisory_lock(424251) AS ok')).rows[0].ok;
    if (!held) return { processed: 0 };
    // Retire future queued messages as well as due ones, even if delivery credentials are absent.
    // An active provider request cannot be recalled; only a recoverable stale lease is claimed below.
    await db.update(M).set({ status: 'suppressed', lastError: 'retired_type', claimedAt: null, claimToken: null }).where(and(
      inArray(M.type, [...RETIRED_LIFECYCLE_TYPES]), eq(M.status, 'queued'), ...(options.userIds ? [inArray(M.userId, options.userIds)] : []),
    ));
    // Missing credentials are operationally visible and retain the durable queue; no deceptive "logged" production sends.
    if (!env.devStubs && !env.resendKey) { console.error('[lifecycle] RESEND_API_KEY missing; queued mail retained'); return { processed: 0, blocked: 'missing_key' }; }
    const fetcher = options.fetch || globalThis.fetch;
    const sleep = options.sleep || wait;
    for (let i = 0; i < Math.min(50, Math.max(1, options.limit ?? 50)); i++) {
      if (options.shouldStop?.() || options.signal?.aborted) break;
      const now = options.now || new Date();
      const row = await claim(now, options.userIds);
      if (!row) break;
      processed++;
      if (isRetiredLifecycle(row.type)) { await terminal(row, 'suppressed', 'retired_type'); continue; }
      let payload: LifecyclePayload;
      try {
        const p = decrypt<LifecyclePayload>(row.payloadEnc);
        if (!p?.envelope || !p.data) throw new Error('invalid');
        payload = p;
      } catch { await terminal(row, 'failed', 'unreadable_payload'); continue; }
      const prepareOptional = row.type === 'lifecycle_guide' ? prepareGuide : prepareEducation;
      if (row.type === 'weekly_education' || row.type === 'lifecycle_guide') {
        try {
          const prepared = await prepareOptional(row, payload, now);
          if (prepared.kind === 'defer') { await defer(row, prepared.until, prepared.reason); continue; }
          if (prepared.kind === 'suppress') { await terminal(row, 'suppressed', prepared.reason); continue; }
          payload = prepared.payload;
        } catch { await defer(row, new Date(now.getTime() + 3600e3), 'education_preparation_unavailable'); continue; }
      }
      if (row.expiresAt <= now || (row.firstAttemptAt && now.getTime() - row.firstAttemptAt.getTime() >= RETRY_WINDOW)) {
        await terminal(row, 'failed', 'expired_delivery_window'); continue;
      }
      try {
        if (!['weekly_education', 'lifecycle_guide'].includes(row.type) && !(await eligibleWithinDeadline(row, payload, now, options.signal))) { await terminal(row, 'suppressed', 'no_longer_applicable'); continue; }
      } catch {
        if (options.shouldStop?.() || options.signal?.aborted) { await release(row); break; }
        const [attempted] = await db.update(M).set({ attempts: row.attempts + 1 }).where(owned(row)).returning();
        if (attempted) await retry(attempted, 'eligibility_check_unavailable', now);
        continue;
      }
      if (row.type === 'work_update' || row.type === 'founder_note' || row.type === 'weekly_education' || row.type === 'lifecycle_guide') {
        const after = await optionalDeliveryAfter(row.userId, now, row.id, db, row.type);
        if (after) { await defer(row, after); continue; }
      }
      if (row.type === 'work_update' && !row.firstAttemptAt) {
        const sections = await currentWorkSections(row, payload, now);
        if (!sections.length) { await terminal(row, 'suppressed', 'no_longer_applicable'); continue; }
        const [u] = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, row.userId)).limit(1);
        if (!u || payload.envelope.to[0] !== u.email) { await terminal(row, 'suppressed', 'no_longer_applicable'); continue; }
        payload = lifecyclePayload('work_update', u, { ...payload.data, workSections: sections });
        const [frozen] = await db.update(M).set({ payloadEnc: encrypt(payload) }).where(owned(row)).returning({ id: M.id });
        if (!frozen) continue;
      }
      if ((row.type === 'weekly_education' || row.type === 'lifecycle_guide') && !row.firstAttemptAt) {
        const [frozen] = await db.update(M).set({ payloadEnc: encrypt(payload) }).where(owned(row)).returning({ id: M.id });
        if (!frozen) continue;
      }
      if (options.shouldStop?.() || options.signal?.aborted) { await release(row); break; }
      if (env.devStubs) {
        await db.update(M).set({ status: 'logged', sentAt: null, claimedAt: null, claimToken: null, lastError: null }).where(owned(row));
        console.info('[lifecycle] dev-stub logged', { id: row.id, type: row.type }); continue;
      }
      if (row.type === 'weekly_education' || row.type === 'lifecycle_guide') {
        const suppression = await educationSuppression(payload.envelope.to[0], fetcher, sleep, options.signal);
        if (suppression === 'suppressed') { await terminal(row, 'suppressed', 'provider_suppressed'); continue; }
        if (suppression !== 'clear' && suppression !== 'native_suppression') { await defer(row, new Date(now.getTime() + 3600e3), suppression); continue; }
        // A lookup may take seconds; recheck recipient, preference and authorization immediately before POST.
        const checked = await prepareOptional(row, payload, now);
        if (checked.kind === 'defer') { await defer(row, checked.until, checked.reason); continue; }
        if (checked.kind === 'suppress') { await terminal(row, 'suppressed', checked.reason); continue; }
        if (!row.firstAttemptAt && JSON.stringify(checked.payload) !== JSON.stringify(payload)) {
          payload = checked.payload;
          const [frozen] = await db.update(M).set({ payloadEnc: encrypt(payload) }).where(owned(row)).returning({ id: M.id });
          if (!frozen) continue;
        }
      }
      if (options.shouldStop?.() || options.signal?.aborted) { await release(row); break; }
      // Count actual attempts only after eligibility. Persist before the request so a crash preserves the safe retry deadline.
      const started = row.firstAttemptAt || now;
      const [attempted] = await db.update(M).set({ attempts: row.attempts + 1, firstAttemptAt: started }).where(owned(row)).returning();
      if (!attempted) continue;
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetcher('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${env.resendKey}`, 'content-type': 'application/json', 'Idempotency-Key': `radar-lifecycle/${row.id}` }, body: JSON.stringify(payload.envelope), signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal });
        if (!response.ok) {
          const delay = response.headers.get('retry-after');
          const retryAfter = delay ? (Number.isFinite(Number(delay)) ? Number(delay) * 1000 : Math.max(0, Date.parse(delay) - now.getTime())) : 0;
          const concurrent = response.status === 409 && (await response.json().catch(() => null))?.name === 'concurrent_idempotent_requests';
          // Release non-JSON error streams without persisting/logging potentially sensitive provider content.
          await response.body?.cancel().catch(() => {});
          if (response.status === 429 || response.status >= 500 || concurrent) await retry(attempted, `provider_http_${response.status}`, now, Number.isFinite(retryAfter) ? retryAfter : 0);
          else await terminal(attempted, 'failed', `provider_http_${response.status}`);
        } else {
          const body = await response.json().catch(() => null);
          if (!body || typeof body.id !== 'string' || !body.id) await retry(attempted, 'provider_missing_acknowledgment', now);
          else await db.transaction(async tx => {
            if (row.type === 'weekly_education') await tx.select().from(schema.educationEnrollments).where(eq(schema.educationEnrollments.userId, row.userId)).for('update');
            if (row.type === 'lifecycle_guide') await tx.select().from(schema.lifecycleGuideStates).where(and(eq(schema.lifecycleGuideStates.userId, row.userId), eq(schema.lifecycleGuideStates.pendingEmailId, row.id))).for('update');
            const acceptedAt = options.clock?.() || new Date();
            const saved = await tx.update(M).set({ status: 'sent', providerId: body.id.slice(0, 200), sentAt: acceptedAt, claimedAt: null, claimToken: null, lastError: null, ...(row.type === 'password_reset' ? { payloadEnc: '' } : {}) }).where(owned(row)).returning({ id: M.id });
            if (saved.length && row.type === 'weekly_education') await acknowledgeEducation(tx, row, acceptedAt);
            if (saved.length && row.type === 'lifecycle_guide') await acknowledgeGuide(tx, row, acceptedAt);
          });
        }
      } catch { await retry(attempted, 'provider_network_or_timeout', now); }
      finally { clearTimeout(timer); }
      if (options.shouldStop?.() || options.signal?.aborted) break;
      await sleep(125);
    }
    return { processed };
  } finally {
    if (held) await c.query('SELECT pg_advisory_unlock(424251)').catch(() => {});
    c.release();
  }
}
