import { and, eq, gte, inArray, like, sql } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { RadarError } from '@/server/errors';
import { PermanentJobError } from '@/server/jobs/queue';
import { autopilotHandoffEmail } from '../legacyContent';
import { sendMail } from '../mail';
import { canRun } from './guard';
import { authorized, safeZone } from './policy';
import { todayIn } from '@/lib/format';
import { zonedTimeToUtc } from '@/lib/socialPublish';
import { openBusinessUrl } from '@/server/billing/guard';
import { getBiz } from '@/server/workspace';
import type { JobCtx } from '@/server/jobs/queue';

export interface Handoff { key: string; title: string; reason: string; href: string; text?: string; sourceUrl?: string }
export interface HandoffPayload { activationId: string; ownerId: string; name: string; items: Handoff[];
  /** Business-local date this email is the one for. Absent on jobs queued by the per-batch code. */ day?: string }
/** What one run found. `items`: everything that needs the owner now. `clear`: standing keys checked and resolved.
 *  `legacy`: standing key -> the keys the per-day scheme used for the same condition (rollout only). */
export interface HandoffRun { date: string; ready: boolean; items: Handoff[]; clear?: string[]; legacy?: Record<string, string[]> }
/** Business-specific links survive the owner having a different workspace open. */
export const businessHref = (bid: string, path: string) => `${env.appUrl}${openBusinessUrl(bid, path)}`;
const safeSource = (s?: string) => { try { const u = new URL(s || ''); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };

/** One owner email per business-local day. An item is marked only in the commit that puts it in an email, so one found
 *  after the day's email stays unmarked, is found again by later runs while it is true, and goes into the next email.
 *  The day, the item marks and the exact email work commit together or not at all. */
export async function enqueueHandoff(bid: string, activationId: string, run: HandoffRun): Promise<number> {
  if (!(await canRun(bid, activationId))) return 0;
  return db.transaction(async tx => {
    const [b] = await tx.select().from(schema.businesses).where(eq(schema.businesses.id, bid)).for('update');
    if (!b || !authorized(b, activationId)) return 0;
    const P = `autopilot-handoff:${bid}:${activationId}:`;
    const items = run.items.filter((item, i) => run.items.findIndex(x => x.key === item.key) === i);
    // A standing problem that was checked and is resolved may be told again when it comes back.
    const cleared = (run.clear || []).filter(k => !items.some(i => i.key === k));
    if (cleared.length) await tx.delete(schema.cronMarks).where(inArray(schema.cronMarks.key, cleared.map(k => P + k)));
    if (!items.length) return 0;
    const old = Object.fromEntries(items.map(i => [i.key, run.legacy?.[i.key] || []]));
    const found = await tx.select().from(schema.cronMarks).where(inArray(schema.cronMarks.key, items.flatMap(i => [i.key, ...old[i.key]]).map(k => P + k)));
    const told = new Set(found.map(m => m.key.slice(P.length)));
    // Rollout: a standing problem the per-day keys already announced today or yesterday is not announced again. Only a
    // mark older than the business's first day mark counts: this code writes post keys too (a failed publishing check, a
    // hand-published post), always in a commit that holds a day mark, and those say nothing about the account.
    const [first] = await tx.select({ at: sql<Date | null>`min(${schema.cronMarks.createdAt})` }).from(schema.cronMarks).where(like(schema.cronMarks.key, `autopilot-day:${bid}:%`));
    const before = new Set(found.filter(m => !first?.at || m.createdAt < new Date(first.at)).map(m => m.key.slice(P.length)));
    const moved = items.filter(i => !told.has(i.key) && old[i.key].some(k => before.has(k)));
    if (moved.length) await tx.insert(schema.cronMarks).values(moved.map(i => ({ key: P + i.key }))).onConflictDoNothing();
    const fresh = items.filter(i => !told.has(i.key) && !moved.includes(i));
    // A run that crossed local midnight must not send yesterday's email today.
    if (!run.ready || !fresh.length || todayIn(b.timezone, new Date()) !== run.date) return 0;
    const day = await tx.insert(schema.cronMarks).values({ key: `autopilot-day:${bid}:${run.date}` }).onConflictDoNothing().returning({ key: schema.cronMarks.key });
    if (!day.length) return 0;
    // Rollout: a batch the per-batch code queued since local midnight was today's email. The day stays taken.
    const [sent] = await tx.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.kind, 'autopilot.handoff'), eq(schema.jobs.businessId, bid), sql`${schema.jobs.payload}->>'day' IS NULL`, gte(schema.jobs.createdAt, new Date(zonedTimeToUtc(run.date, '00:00', safeZone(b.timezone)))))).limit(1);
    if (sent) return 0;
    await tx.insert(schema.cronMarks).values(fresh.map(i => ({ key: P + i.key })));
    const key = `autopilot-mail:${bid}:${run.date}`;
    await tx.insert(schema.jobs).values({ kind: 'autopilot.handoff', businessId: bid, ref: key, singletonKey: key, maxAttempts: 4, payload: { activationId, ownerId: b.ownerId, name: b.profile?.business?.name || b.domain, items: fresh, day: run.date } satisfies HandoffPayload });
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
