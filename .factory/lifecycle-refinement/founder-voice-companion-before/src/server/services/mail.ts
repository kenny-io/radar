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
