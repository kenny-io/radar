// Transactional email (invites, partner notices, feature requests). Resend when RESEND_API_KEY is set; otherwise logged to the outbox table + console.
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { env } from '../env';
import { CONFIRMATION_SUBJECT } from './legacyContent';

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  const [row] = await db.insert(schema.outboxEmails).values({ to, subject, text, html: html || null }).returning({ id: schema.outboxEmails.id });
  if (!env.resendKey) {
    console.log(`[mail:log] to=${to} subject=${subject}\n${text}`);
    await db.update(schema.outboxEmails).set({ status: 'logged' }).where(eq(schema.outboxEmails.id, row.id));
    return;
  }
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${env.resendKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: env.mailFrom, to: [to], subject, text, html }) });
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
  const { encrypt } = await import('../crypto');
  const subject = CONFIRMATION_SUBJECT;
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
