import type { QueryConfig } from 'pg';
import { createHash } from 'node:crypto';
import { renderFailureEmail } from './email';
import { failureAlertsEnabled, sanitizeDiagnostic, type FailureEvent } from './failures';

export const ALERT_JOB_KIND = 'observability.alert';
export const ALERT_MAX_AGE_MS = 23 * 60 * 60_000;
export interface AlertEnvelope { event: FailureEvent; key: string; to: string; from: string; subject: string; text: string; html?: string }
const uuid = (key: string) => { const h = createHash('sha256').update(key).digest('hex').slice(0, 32); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };

export function alertEnvelope(event: FailureEvent, key: string): AlertEnvelope {
  return { event, key, to: process.env.RADAR_FAILURE_ALERT_EMAIL || 'kenny@thally.io', from: process.env.MAIL_FROM || '', ...renderFailureEmail(event) };
}
const validSender = (sender: string) => !!sender.trim() && !/@(?:radar\.local|yourdomain\.com)>?$/i.test(sender.trim());

/** Bind an initially missing/placeholder sender exactly once, before a provider attempt. */
async function prepareSender(envelope: AlertEnvelope): Promise<AlertEnvelope> {
  if (validSender(envelope.from)) return envelope;
  const from = process.env.MAIL_FROM || '';
  if (!validSender(from)) throw new Error('Failure alert email requires RESEND_API_KEY and a verified MAIL_FROM');
  const { pool } = await import('../db');
  const result = await pool.query({
    text: `UPDATE jobs SET payload=CASE WHEN payload->>'from'=$3 THEN jsonb_set(payload,'{from}',to_jsonb($2::text)) ELSE payload END WHERE id=$1 RETURNING payload`,
    values: [uuid(envelope.key), from, envelope.from], query_timeout: 3000,
  } as QueryConfig & { query_timeout: number });
  // No durable row means persistence was unavailable; this is the single direct-delivery fallback.
  return result.rows[0]?.payload || { ...envelope, from };
}

/** Uses an immutable persisted envelope and provider key across both immediate and worker attempts. */
export async function deliverAlert(envelope: AlertEnvelope): Promise<{ providerMessageId?: string }> {
  if (!failureAlertsEnabled()) throw Object.assign(new Error('Failure email delivery is disabled'), { code: 'permanent' });
  if (Date.now() - Date.parse(envelope.event.timestamp) >= ALERT_MAX_AGE_MS) throw Object.assign(new Error('Failure alert expired before delivery; retained for operator review'), { code: 'permanent' });
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Failure alert email requires RESEND_API_KEY and a verified MAIL_FROM');
  envelope = await prepareSender(envelope);
  if (!validSender(envelope.from)) throw new Error('Failure alert email requires RESEND_API_KEY and a verified MAIL_FROM');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'Idempotency-Key': envelope.key },
    signal: AbortSignal.timeout(8000), body: JSON.stringify({ from: envelope.from, to: [envelope.to], subject: envelope.subject, text: envelope.text, ...(envelope.html !== undefined ? { html: envelope.html } : {}) }),
  });
  if (!response.ok) throw new Error(`Failure alert transport rejected the email (HTTP ${response.status})`);
  const receipt = await response.json().catch(() => null);
  return typeof receipt?.id === 'string' ? { providerMessageId: receipt.id } : {};
}

export async function persistAndDeliverAlert(event: FailureEvent, key: string): Promise<void> {
  const envelope = alertEnvelope(event, key);
  const id = uuid(key);
  let persisted = false;
  try {
    const { pool } = await import('../db');
    const inserted = await pool.query({ text: `INSERT INTO jobs (id,kind,payload,max_attempts,run_at) VALUES ($1,$2,$3,100,now()+interval '30 seconds') ON CONFLICT (id) DO NOTHING RETURNING payload`, values: [id, ALERT_JOB_KIND, JSON.stringify(envelope)], query_timeout: 3000 } as QueryConfig & { query_timeout: number });
    if (!inserted.rows.length) {
      // A prior alert with this incident key owns delivery and its immutable payload, even across replicas.
      return;
    }
    persisted = true;
  } catch (error) { console.error('[radar.alert.persistence_failed]', sanitizeDiagnostic((error as any)?.message)); }
  try {
    const receipt = await deliverAlert(envelope);
    if (persisted) {
      const { pool } = await import('../db');
      await pool.query({ text: `UPDATE jobs SET status='done',finished_at=now(),result=$2 WHERE id=$1 AND status='queued'`, values: [id, { accepted: true, ...receipt }], query_timeout: 3000 } as QueryConfig & { query_timeout: number });
    }
  } catch (error) {
    // The queued job remains available to workers. No recursive reportFailure here or in its job catch.
    console.error('[radar.alert.delivery_failed]', sanitizeDiagnostic((error as any)?.message));
    if (persisted) {
      const { pool } = await import('../db');
      await pool.query({ text: `UPDATE jobs SET error=$2 WHERE id=$1 AND status='queued'`, values: [id, sanitizeDiagnostic((error as any)?.message)], query_timeout: 3000 } as QueryConfig & { query_timeout: number }).catch(() => {});
    }
  }
}
