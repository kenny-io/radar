import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { RadarError } from '@/server/errors';
import type { ActCtx } from '@/server/actions/define';
import { autopilotOf } from './policy';

/** State and first durable run commit together; concurrent toggles never merge stale ctx.biz. */
export async function setAutopilot(ctx: ActCtx, enabled: boolean) {
  return db.transaction(async tx => {
    const [b] = await tx.select().from(schema.businesses).where(eq(schema.businesses.id, ctx.bid)).for('update');
    if (!b || ctx.role !== 'Owner' || b.ownerId !== ctx.user.id) throw new RadarError('Only the business owner can change Autopilot.', 403, 'forbidden');
    if (b.status !== 'active') throw new RadarError('Finish setting up this business before enabling Autopilot.', 400, 'not_active');
    const previous = autopilotOf(b);
    const next = { ...previous, enabled, ...(enabled && !previous.enabled ? { activationId: randomUUID(), enabledAt: new Date().toISOString(), enabledBy: ctx.user.id, lastError: null, summary: 'Starting your marketing program.' } : {}) };
    await tx.update(schema.businesses).set({ autopilot: next }).where(eq(schema.businesses.id, ctx.bid));
    if (enabled) {
      // Re-enabling must not join a queued or still-unwinding coordinator from a revoked activation.
      await tx.update(schema.jobs).set({ status: 'done', finishedAt: new Date(), result: { skipped: 'superseded_activation' }, singletonKey: null }).where(and(eq(schema.jobs.businessId, ctx.bid), eq(schema.jobs.kind, 'autopilot.run'), eq(schema.jobs.status, 'queued'), sql`${schema.jobs.payload}->>'activationId' IS DISTINCT FROM ${next.activationId}`));
      await tx.update(schema.jobs).set({ singletonKey: null }).where(and(eq(schema.jobs.businessId, ctx.bid), eq(schema.jobs.kind, 'autopilot.run'), eq(schema.jobs.status, 'running'), sql`${schema.jobs.payload}->>'activationId' IS DISTINCT FROM ${next.activationId}`));
      await tx.insert(schema.jobs).values({ kind: 'autopilot.run', businessId: ctx.bid, payload: { activationId: next.activationId }, singletonKey: `autopilot.run:${ctx.bid}`, maxAttempts: 3 }).onConflictDoNothing();
    } else {
      // Give unsent schedules back as editable drafts. Sending rows are retained for unknown-outcome recovery.
      await tx.delete(schema.socialPubs).where(and(eq(schema.socialPubs.businessId, ctx.bid), eq(schema.socialPubs.status, 'scheduled'), isNotNull(schema.socialPubs.autopilotActivationId)));
      await tx.update(schema.calendarEntries).set({ status: 'review' }).where(and(eq(schema.calendarEntries.businessId, ctx.bid), eq(schema.calendarEntries.status, 'scheduled'), isNotNull(schema.calendarEntries.autopilotActivationId)));
    }
    return { enabled };
  });
}

export async function requestAutopilotRun(ctx: ActCtx) {
  return db.transaction(async tx => {
    const [b] = await tx.select().from(schema.businesses).where(eq(schema.businesses.id, ctx.bid)).for('update');
    if (!b || ctx.role !== 'Owner' || b.ownerId !== ctx.user.id) throw new RadarError('Only the business owner can run Autopilot.', 403, 'forbidden');
    const a = autopilotOf(b);
    if (!a.enabled || !a.activationId) throw new RadarError('Turn on Autopilot before running it.', 400, 'autopilot_off');
    // Keep the original mail job id: the persisted outbox/provider key remains idempotent across an explicit retry.
    await tx.update(schema.jobs).set({ status: 'queued', attempts: 0, runAt: new Date(), finishedAt: null, lockedAt: null, lockedBy: null }).where(and(eq(schema.jobs.businessId, ctx.bid), eq(schema.jobs.kind, 'autopilot.handoff'), eq(schema.jobs.status, 'failed'), sql`${schema.jobs.payload}->>'activationId' = ${a.activationId}`));
    const key = `autopilot.run:${ctx.bid}`;
    const [existing] = await tx.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.singletonKey, key), inArray(schema.jobs.status, ['queued', 'running']))).limit(1);
    if (existing) return { jobId: existing.id };
    const [j] = await tx.insert(schema.jobs).values({ kind: 'autopilot.run', businessId: ctx.bid, payload: { activationId: a.activationId, retry: true }, singletonKey: key, maxAttempts: 3 }).returning({ id: schema.jobs.id });
    return { jobId: j.id };
  });
}
