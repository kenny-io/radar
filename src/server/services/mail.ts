import { reportFailure } from '@/server/observability/failures';
// Transactional email (invites, partner notices, feature requests). Resend when RESEND_API_KEY is set; otherwise logged to the outbox table + console.
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { env } from '../env';
import { sha256 } from '../crypto';

export async function sendMail(to: string, subject: string, text: string, html?: string, opts: { idempotencyKey?: string } = {}) {
  try {
    return await prepareAndSendMail(to, subject, text, html, opts);
  } catch (error) {
    await reportFailure(error, { source: 'system', operation: 'mail.send', provider: 'Resend' });
    throw error;
  }
}

async function prepareAndSendMail(to: string, subject: string, text: string, html?: string, opts: { idempotencyKey?: string } = {}) {
  const hash = opts.idempotencyKey ? sha256(opts.idempotencyKey).slice(0, 32) : null;
  const id = hash ? `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}` : undefined;
  const [inserted] = await db.insert(schema.outboxEmails).values({ ...(id ? { id } : {}), to, subject, text, html: html || null }).onConflictDoNothing().returning();
  const row = inserted || (id ? (await db.select().from(schema.outboxEmails).where(eq(schema.outboxEmails.id, id)).limit(1))[0] : null);
  if (!row) throw new Error('Could not prepare email');
  if (row.status === 'sent' || row.status === 'logged') return;
  // A retry always sends the persisted payload with the same provider key.
  to = row.to; subject = row.subject; text = row.text; html = row.html || undefined;
  if (!env.resendKey) {
    if (env.isProd) await reportFailure(new Error('Transactional email is log-only because RESEND_API_KEY is missing'), { source: 'system', operation: 'mail.send', provider: 'Resend', code: 'mail_unconfigured', degraded: true });
    console.log(`[mail:log] to=${to} subject=${subject}\n${text}`);
    await db.update(schema.outboxEmails).set({ status: 'logged' }).where(eq(schema.outboxEmails.id, row.id));
    return;
  }
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${env.resendKey}`, 'content-type': 'application/json', ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}) }, signal: AbortSignal.timeout(20_000), body: JSON.stringify({ from: env.mailFrom, to: [to], subject, text, html }) });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
    await db.update(schema.outboxEmails).set({ status: 'sent', sentAt: new Date() }).where(eq(schema.outboxEmails.id, row.id));
  } catch (e: any) {
    await db.update(schema.outboxEmails).set({ status: 'failed', error: String(e.message).slice(0, 500) }).where(eq(schema.outboxEmails.id, row.id));
    throw e;
  }
}

/** Security mail never persists bearer links in plaintext or logs provider responses.
 * Development stubs retain an encrypted capture solely for local verification/browser QA. */
export async function sendAuthMail(to: string, text: string) {
  try { return await prepareAndSendAuthMail(to, text); }
  catch (error) {
    // Security email diagnostics never include recipient, bearer links or provider response bodies.
    await reportFailure(new Error('Security email delivery unavailable'), { source: 'system', operation: 'mail.auth', provider: 'Resend' });
    throw error;
  }
}

async function prepareAndSendAuthMail(to: string, text: string) {
  const { encrypt } = await import('../crypto');
  const subject = 'Confirm your email for Radar';
  const [row] = await db.insert(schema.outboxEmails).values({ to, subject,
    text: env.devStubs ? 'encrypted-auth:' + encrypt({ text }) : '[Security email content redacted]', html: null,
  }).returning({ id: schema.outboxEmails.id });
  if (env.devStubs) {
    await db.update(schema.outboxEmails).set({ status: 'logged' }).where(eq(schema.outboxEmails.id, row.id));
    return;
  }
  try {
    if (!env.resendKey) throw new Error('unavailable');
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: `Bearer ${env.resendKey}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(10000), body: JSON.stringify({ from: env.mailFrom, to: [to], subject, text }),
    });
    if (!r.ok) throw new Error('unavailable');
    await db.update(schema.outboxEmails).set({ status: 'sent', sentAt: new Date() }).where(eq(schema.outboxEmails.id, row.id));
  } catch {
    await db.update(schema.outboxEmails).set({ status: 'failed', error: 'Security email delivery unavailable' }).where(eq(schema.outboxEmails.id, row.id));
    throw new Error('Security email delivery unavailable');
  }
}
