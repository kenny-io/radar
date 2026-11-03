import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db, pool, schema } from '@/server/db';
import { env } from '@/server/env';
import { decrypt, encrypt, sha256 } from '@/server/crypto';
import { getProvider } from '@/server/billing/provider';
import { onboardingAllowed } from './preferences';
import { lifecyclePayload, type LifecyclePayload } from './queue';
import { currentWorkSections, optionalDeliveryAfter } from './engagement';
const M = schema.lifecycleEmails;
type Mail = typeof M.$inferSelect;
const MAX_ATTEMPTS = 8;
const RETRY_WINDOW = 23 * 3600e3; // less than provider24h dedupe retention, including scheduling/clock margin
const CLAIM_MS = 2 * 60e3;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Time-sensitive notices are checked against current authoritative application/provider state before delivery. */
export async function lifecycleEligible(row: Mail, payload: LifecyclePayload, now = new Date(), signal?: AbortSignal): Promise<boolean> {
  // Retire previously frozen workspace notices as well as removing new enqueueing.
  if (row.type === 'workspace_ready') return false;
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, row.userId)).limit(1);
  if (!u || u.guest || payload.envelope.to.length !== 1 || payload.envelope.to[0] !== u.email) return false;
  const d = payload.data;
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
      OR (status='sending' AND claimed_at < $3)) AND ($4::uuid[] IS NULL OR user_id = ANY($4::uuid[])) ORDER BY CASE WHEN type='password_reset' THEN 0 WHEN type IN ('payment_failed','trial_ending','cancellation_scheduled','subscription_ended') THEN 1 WHEN type='founder_note' THEN 3 ELSE 2 END, next_attempt_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`, [now, token, new Date(now.getTime() - CLAIM_MS), userIds ?? null]);
  return rows[0] ? (await db.select().from(M).where(eq(M.id, rows[0].id)))[0] : null;
}
const owned = (row: Mail) => and(eq(M.id, row.id), eq(M.claimToken, row.claimToken!), eq(M.status, 'sending'));
async function release(row: Mail) { await db.update(M).set({ status: 'queued', claimedAt: null, claimToken: null }).where(owned(row)); }
async function defer(row: Mail, next: Date) { await db.update(M).set({ status: 'queued', nextAttemptAt: next, claimedAt: null, claimToken: null, lastError: 'optional_frequency_or_quiet_hours' }).where(owned(row)); }
async function terminal(row: Mail, status: 'failed' | 'suppressed', reason: string) {
  await db.update(M).set({ status, lastError: reason, claimedAt: null, claimToken: null, ...(row.type === 'password_reset' ? { payloadEnc: '' } : {}) }).where(owned(row));
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
export interface DispatchOptions { /** Optional operator/test scope; production worker drains all users. */ userIds?: string[]; now?: Date; limit?: number; fetch?: typeof fetch; sleep?: (ms: number) => Promise<unknown>; shouldStop?: () => boolean; signal?: AbortSignal }

/** Only one batch per deployment at once; a conservative8requests/s leaves headroom below the shared provider10/s limit. */
export async function dispatchLifecycleBatch(options: DispatchOptions = {}) {
  const c = await pool.connect();
  let held = false, processed = 0;
  try {
    held = !!(await c.query('SELECT pg_try_advisory_lock(424251) AS ok')).rows[0].ok;
    if (!held) return { processed: 0 };
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
      if (row.expiresAt <= now || (row.firstAttemptAt && now.getTime() - row.firstAttemptAt.getTime() >= RETRY_WINDOW)) {
        await terminal(row, 'failed', 'expired_delivery_window'); continue;
      }
      let payload: LifecyclePayload;
      try {
        const p = decrypt<LifecyclePayload>(row.payloadEnc);
        if (!p?.envelope || !p.data) throw new Error('invalid');
        payload = p;
      } catch { await terminal(row, 'failed', 'unreadable_payload'); continue; }
      try {
        if (!(await eligibleWithinDeadline(row, payload, now, options.signal))) { await terminal(row, 'suppressed', 'no_longer_applicable'); continue; }
      } catch {
        if (options.shouldStop?.() || options.signal?.aborted) { await release(row); break; }
        const [attempted] = await db.update(M).set({ attempts: row.attempts + 1 }).where(owned(row)).returning();
        if (attempted) await retry(attempted, 'eligibility_check_unavailable', now);
        continue;
      }
      if (row.type === 'work_update' || row.type === 'founder_note') {
        const after = await optionalDeliveryAfter(row.userId, now, row.id);
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
      if (options.shouldStop?.() || options.signal?.aborted) { await release(row); break; }
      if (env.devStubs) {
        await db.update(M).set({ status: 'logged', sentAt: null, claimedAt: null, claimToken: null, lastError: null }).where(owned(row));
        console.info('[lifecycle] dev-stub logged', { id: row.id, type: row.type }); continue;
      }
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
          else await db.update(M).set({ status: 'sent', providerId: body.id.slice(0, 200), sentAt: new Date(), claimedAt: null, claimToken: null, lastError: null, ...(row.type === 'password_reset' ? { payloadEnc: '' } : {}) }).where(owned(row));
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
