// Transactional email (invites, partner notices, feature requests). Resend when RESEND_API_KEY is set; otherwise logged to the outbox table + console.
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { env } from '../env';

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
