import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { sha256 } from '@/server/crypto';
import { env } from '@/server/env';
import { RadarError } from '@/server/errors';
import { PermanentJobError } from '@/server/jobs/queue';
import { autopilotHandoffEmail } from '../legacyContent';
import { sendMail } from '../mail';
import { canRun } from './guard';
import { authorized } from './policy';
import { openBusinessUrl } from '@/server/billing/guard';
import { getBiz } from '@/server/workspace';
import type { JobCtx } from '@/server/jobs/queue';

export interface Handoff { key: string; title: string; reason: string; href: string; text?: string; sourceUrl?: string }
export interface HandoffPayload { activationId: string; ownerId: string; name: string; items: Handoff[] }
/** Business-specific links survive the owner having a different workspace open. */
export const businessHref = (bid: string, path: string) => `${env.appUrl}${openBusinessUrl(bid, path)}`;
const safeSource = (s?: string) => { try { const u = new URL(s || ''); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };

/** Claim digest membership and persist the exact email work atomically. Later brief arrivals get a separate batch. */
export async function enqueueHandoff(bid: string, activationId: string, items: Handoff[]): Promise<number> {
  if (!items.length || !(await canRun(bid, activationId))) return 0;
  return db.transaction(async tx => {
    const [b] = await tx.select().from(schema.businesses).where(eq(schema.businesses.id, bid)).for('update');
    if (!b || !authorized(b, activationId)) return 0;
    const fresh: Handoff[] = [];
    for (const item of items) {
      const key = `autopilot-handoff:${bid}:${activationId}:${item.key}`;
      const mark = await tx.insert(schema.cronMarks).values({ key }).onConflictDoNothing().returning({ key: schema.cronMarks.key });
      if (mark.length) fresh.push(item);
    }
    if (!fresh.length) return 0;
    const key = 'autopilot-mail:' + sha256(`${bid}:${activationId}:${fresh.map(i => i.key).sort().join('|')}`);
    await tx.insert(schema.jobs).values({ kind: 'autopilot.handoff', businessId: bid, ref: key, singletonKey: key, maxAttempts: 4, payload: { activationId, ownerId: b.ownerId, name: b.profile?.business?.name || b.domain, items: fresh } satisfies HandoffPayload });
    return fresh.length;
  });
}

export async function deliverHandoff(ctx: JobCtx<HandoffPayload>) {
  const bid = ctx.businessId!; const p = ctx.payload;
  if (!(await canRun(bid, p.activationId))) return { skipped: 'autopilot_off' };
  const b = await getBiz(bid);
  if (b.ownerId !== p.ownerId) return { skipped: 'owner_changed' };
  const [owner] = await db.select({ email: schema.users.email, guest: schema.users.guest, verified: schema.users.emailVerifiedAt }).from(schema.users).where(eq(schema.users.id, b.ownerId));
  if (!owner || owner.guest) return { skipped: 'no_owner' };
  if (!owner.verified) return { skipped: 'unverified_owner' };
  const email = autopilotHandoffEmail({ appUrl: env.appUrl, businessName: p.name, items: p.items.map(it => ({ ...it, sourceUrl: safeSource(it.sourceUrl) || undefined })), manageUrl: businessHref(bid, '/settings?section=autopilot') });
  try {
    await sendMail(owner.email, email.subject, email.text, undefined, { idempotencyKey: `autopilot-handoff:${ctx.job.id}` });
    return { count: p.items.length };
  } catch (e) {
    const recipientChanged = e instanceof RadarError && e.code === 'mail_recipient_changed';
    const retryExpired = e instanceof RadarError && e.code === 'mail_retry_expired';
    const message = retryExpired ? 'The owner email retry window expired. Contact support before retrying delivery.' : recipientChanged ? 'The owner email was held because the account email address changed. Contact support before retrying delivery.' : ctx.attempt >= ctx.job.maxAttempts ? 'The owner email could not be delivered after retrying. Run Autopilot again to retry delivery.' : 'The owner email could not be delivered. Radar will retry automatically.';
    await db.update(schema.businesses).set({ autopilot: sql`${schema.businesses.autopilot} || ${JSON.stringify({ lastError: message })}::jsonb` }).where(and(eq(schema.businesses.id, bid), sql`${schema.businesses.autopilot}->>'activationId' = ${p.activationId}`));
    if (recipientChanged || retryExpired) throw new PermanentJobError(message);
    throw e;
  }
}
