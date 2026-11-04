import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { encrypt } from '@/server/crypto';
import type { Q } from '@/server/billing/draft';
import { renderLifecycle, type LifecycleData, type LifecycleType } from './templates';
import { preferenceToken, workPreferenceToken } from './preferences';
export type { LifecycleType, LifecycleData } from './templates';
export interface LifecycleEnvelope { from: string; to: string[]; subject: string; text: string; html: string; reply_to: string; headers?: Record<string, string> }
export interface LifecyclePayload { data: LifecycleData; envelope: LifecycleEnvelope }
export function lifecyclePayload(type: LifecycleType, user: { id: string; email: string; name: string }, input: LifecycleData): LifecyclePayload {
  const data = { ...input, name: input.name ?? user.name };
  const token = type === 'work_update' ? workPreferenceToken(user.id) : preferenceToken(user.id);
  const unsubscribeUrl = `${env.appUrl}/email-preferences?token=${encodeURIComponent(token)}`;
  const rendered = renderLifecycle(type, data, { appUrl: env.appUrl, unsubscribeUrl });
  const senderEmail = env.mailFrom.match(/<([^<>]+)>/)?.[1] || env.mailFrom;
  const from = type === 'founder_note' ? `Ekene at Radar <${senderEmail}>` : env.mailFrom;
  return { data, envelope: { from, to: [user.email], subject: rendered.subject, text: rendered.text, html: rendered.html, reply_to: rendered.replyTo,
    ...(type === 'work_update' ? { headers: { 'List-Unsubscribe': `<${env.appUrl}/api/email-preferences?token=${encodeURIComponent(token)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
  } };
}
/** Persist in the caller's transaction. Event key dedupes across workers, webhook replays and request races. */
export async function queueLifecycle(q: Q, o: { type: LifecycleType; userId: string; eventKey: string; data: LifecycleData; sendAt?: Date; businessId?: string }): Promise<void> {
  if (!o.eventKey || o.eventKey.length > 240) throw new Error('Invalid lifecycle event key');
  const [u] = await q.select({ email: schema.users.email, name: schema.users.name, guest: schema.users.guest }).from(schema.users).where(eq(schema.users.id, o.userId)).limit(1);
  if (!u || u.guest || u.email.endsWith('@guest.radar.invalid')) return;
  const payload = lifecyclePayload(o.type, { ...u, id: o.userId }, o.data);
  const now = new Date(), sendAt = o.sendAt || now;
  // A fresh send can start for up to 3 days; after its first request we never retry outside Resend's24h dedupe window.
  const ttl = o.type === 'password_reset' ? 3600e3 : 3 * 864e5;
  await q.insert(schema.lifecycleEmails).values({ id: randomUUID(), userId: o.userId, businessId: o.businessId || payload.data.businessId || null, type: o.type,
    eventKey: o.eventKey, payloadEnc: encrypt(payload), nextAttemptAt: sendAt, expiresAt: new Date(Math.min(sendAt.getTime() + ttl, now.getTime() + 4 * 864e5)) }).onConflictDoNothing({ target: schema.lifecycleEmails.eventKey });
}
