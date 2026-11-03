import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { encrypt } from '@/server/crypto';
import type { Q } from '@/server/billing/draft';
import { renderLifecycle, type LifecycleData, type LifecycleType } from './templates';
import { preferenceToken } from './preferences';
export type { LifecycleType, LifecycleData } from './templates';
export interface LifecycleEnvelope { from: string; to: string[]; subject: string; text: string; html: string; reply_to: string }
export interface LifecyclePayload { data: LifecycleData; envelope: LifecycleEnvelope }
/** Persist in the caller's transaction. Event key dedupes across workers, webhook replays and request races. */
export async function queueLifecycle(q: Q, o: { type: LifecycleType; userId: string; eventKey: string; data: LifecycleData; sendAt?: Date; businessId?: string }): Promise<void> {
  if (!o.eventKey || o.eventKey.length > 240) throw new Error('Invalid lifecycle event key');
  const [u] = await q.select({ email: schema.users.email, name: schema.users.name, guest: schema.users.guest }).from(schema.users).where(eq(schema.users.id, o.userId)).limit(1);
  if (!u || u.guest || u.email.endsWith('@guest.radar.invalid')) return;
  const data = { ...o.data, name: o.data.name ?? u.name };
  const unsubscribeUrl = `${env.appUrl}/email-preferences?token=${encodeURIComponent(preferenceToken(o.userId))}`;
  const rendered = renderLifecycle(o.type, data, { appUrl: env.appUrl, unsubscribeUrl });
  const now = new Date(), sendAt = o.sendAt || now;
  // A fresh send can start for up to 3 days; after its first request we never retry outside Resend's24h dedupe window.
  const ttl = o.type === 'password_reset' ? 3600e3 : 3 * 864e5;
  const senderEmail = env.mailFrom.match(/<([^<>]+)>/)?.[1] || env.mailFrom;
  const from = o.type === 'founder_note' ? `Ekene at Radar <${senderEmail}>` : env.mailFrom;
  const payload: LifecyclePayload = { data, envelope: { from, to: [u.email], subject: rendered.subject, text: rendered.text, html: rendered.html, reply_to: rendered.replyTo } };
  await q.insert(schema.lifecycleEmails).values({ id: randomUUID(), userId: o.userId, businessId: o.businessId || data.businessId || null, type: o.type,
    eventKey: o.eventKey, payloadEnc: encrypt(payload), nextAttemptAt: sendAt, expiresAt: new Date(Math.min(sendAt.getTime() + ttl, now.getTime() + 4 * 864e5)) }).onConflictDoNothing({ target: schema.lifecycleEmails.eventKey });
}
