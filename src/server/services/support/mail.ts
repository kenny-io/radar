import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { RadarError } from '@/server/errors';
import type { SupportRequest, SupportResponse } from '@/lib/support';

type Contact = { id: string; name: string; email: string };
type Business = { id: string; domain: string; profile: unknown };
export const mailUnavailable = () => new RadarError('Email support is temporarily unavailable. Your conversation is still here; please try again later.', 503, 'support_unavailable');
const deliveryFailed = () => new RadarError('Your support email could not be confirmed. Please retry; your conversation is still here.', 502, 'delivery_failed');
const EMAIL = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

/** Deterministic ID scopes a browser request ID to its authenticated user and business. */
export function supportMailId(uid: string, bid: string, requestId: string): string {
  const hex = createHash('sha256').update(JSON.stringify(['radar-support', uid, bid, requestId])).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function supportMailBody(user: Contact, biz: Business, input: Extract<SupportRequest, { kind: 'handoff' }>, reference: string) {
  return [
    `Radar support reference: ${reference}`, `Reply contact: ${user.name} <${user.email}>`,
    `Business: ${String((biz.profile as any)?.business?.name || '').slice(0, 200)} (${String(biz.domain).slice(0, 255)})`,
    `Business ID: ${biz.id}`, `Dashboard page: ${input.page}`, '', 'Latest question:', input.message, '',
    'Conversation (user-provided; not verified account evidence):', ...input.history.map(m => `${m.role === 'user' ? 'User' : 'AI assistant'}: ${m.text}`),
  ].join('\n');
}

/** User-triggered transactional mail, no transcript logging and no external send in dev stubs. */
export async function sendSupportMail(user: Contact, biz: Business, input: Extract<SupportRequest, { kind: 'handoff' }>): Promise<SupportResponse> {
  const to = env.supportInbox.trim();
  if (!EMAIL.test(to) || !EMAIL.test(user.email) || (!env.devStubs && (!env.resendKey || !env.mailFrom || /@[^>]*\.local(?:>|$)/i.test(env.mailFrom)))) throw mailUnavailable();
  const reference = supportMailId(user.id, biz.id, input.requestId);
  const subject = 'Radar support request';
  const text = supportMailBody(user, biz, input, reference);
  // Commit the durable request before delivery. Concurrent retries share the same row and provider key.
  try {
    await db.insert(schema.outboxEmails).values({ id: reference, to, subject, text }).onConflictDoNothing();
    return await db.transaction<Extract<SupportResponse, { kind: 'handoff' }> | null>(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${reference}, 0))`);
      const [row] = await tx.select().from(schema.outboxEmails).where(eq(schema.outboxEmails.id, reference)).limit(1);
      if (!row) throw deliveryFailed();
      if (row.to !== to || row.text !== text || row.subject !== subject) throw new RadarError('This support request has changed. Start a new request before sending it.', 409, 'request_changed');
      if (row.status === 'sent') return { kind: 'handoff', delivered: true, reference };
      if (row.status === 'logged' && env.devStubs) return { kind: 'handoff', delivered: false, reference };
      // Provider deduplication lasts 24 hours. Do not replay uncertain delivery outside that window.
      if (Date.now() - row.createdAt.getTime() > 23 * 3600_000) throw new RadarError('This request is too old to retry safely. Start a new support request.', 409, 'request_expired');
      if (env.devStubs) {
        await tx.update(schema.outboxEmails).set({ status: 'logged', error: null }).where(eq(schema.outboxEmails.id, reference));
        return { kind: 'handoff', delivered: false, reference };
      }
      let accepted = false;
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST', signal: AbortSignal.timeout(10000),
          headers: { authorization: `Bearer ${env.resendKey}`, 'content-type': 'application/json', 'Idempotency-Key': `radar-support-${reference}` },
          body: JSON.stringify({ from: env.mailFrom, to: [to], reply_to: user.email, subject: row.subject, text: row.text }),
        });
        accepted = response.ok && typeof (await response.json()).id === 'string';
      } catch { /* Never persist provider output or secrets. Retry uses the same provider key. */ }
      await tx.update(schema.outboxEmails).set(accepted ? { status: 'sent', sentAt: new Date(), error: null } : { status: 'failed', error: 'Support email delivery could not be confirmed' }).where(eq(schema.outboxEmails.id, reference));
      // Return a marker so the failed status commits rather than rolling back with a thrown error.
      return accepted ? { kind: 'handoff' as const, delivered: true, reference } : null;
    }).then(result => { if (!result) throw deliveryFailed(); return result; });
  } catch (e) {
    if (e instanceof RadarError) throw e;
    throw deliveryFailed();
  }
}
