import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { enforce, HOUR, DAY } from '@/server/abuse/rateLimit';
import { RadarError, notFound } from '@/server/errors';
import type { ActCtx } from '@/server/actions/define';
import { sanitizeDiagnostic } from '@/server/observability/failures';
import { publishingDiagnosticText } from './http';

export const ISSUE_TO = 'kenny@thally.io';
export const ISSUE_SUBJECT = 'User Reported Issue on Radar';
const EMAIL = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const failed = () => new RadarError('Radar couldn’t send your report. Please try again.', 502, 'report_delivery_failed');
const unavailable = () => new RadarError('Issue reporting is temporarily unavailable. Please try again later.', 503, 'report_unavailable');
const clean = (value: unknown, max = 300) => publishingDiagnosticText(typeof value === 'string' ? value : String(value ?? ''), max);
const safeUrl = (value: unknown) => typeof value === 'string' ? sanitizeDiagnostic(value).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/[?#].*$/, '[redacted]').replace(/\bgh[pousr]_[A-Za-z0-9]+|\bgithub_pat_[A-Za-z0-9_]+/g, '[redacted]').slice(0, 500) : '';
const validSender = (value: string | undefined) => !!value && !/[\r\n]/.test(value) && EMAIL.test(value.match(/<([^<>]+)>$/)?.[1] || value) && !/@[^>]*\.local(?:>|$)/i.test(value);

/** Explicit allowlist: neither unknown error properties nor article/source/credential objects enter the report. */
export function reportDiagnostic(error: any) {
  const reason = (d: any) => d && typeof d === 'object' ? {
    code: clean(d.code, 100), stage: clean(d.stage, 50), reason: clean(d.reason, 1000),
    ...(typeof d.path === 'string' ? { path: clean(d.path, 300) } : {}),
    ...Object.fromEntries(['size', 'limit', 'actual'].flatMap(key => typeof d[key] === 'number' && Number.isFinite(d[key]) ? [[key, d[key]]] : [])),
    ...(Array.isArray(d.issues) ? { issues: d.issues.slice(0, 3).map((issue: unknown) => clean(issue, 300)) } : {}),
  } : undefined;
  return {
    http: typeof error?.http === 'number' && Number.isFinite(error.http) ? error.http : null,
    source: clean(error?.source, 30), platform: clean(error?.platform, 100), message: clean(error?.message, 400), hint: clean(error?.hint, 1200),
    ...(error?.diagnostic ? { diagnostic: { ...reason(error.diagnostic), ...(error.diagnostic.origin ? { origin: reason(error.diagnostic.origin) } : {}) } } : {}),
  };
}
export function reportIncidentId(bid: string, entryId: string, jobId: string | null, attempts: number, diagnostic: unknown): string {
  const hex = createHash('sha256').update(JSON.stringify(['radar-publishing-report', bid, entryId, jobId, attempts, diagnostic])).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Called only by the explicit member action. Snapshot first; release the read transaction before mail/network work. */
export async function reportPublishingIssue(ctx: ActCtx, entryId: string): Promise<{ delivered: boolean; reference: string }> {
  if (ctx.actor?.guest || (ctx.user as any).guest) throw notFound('Article');
  const snapshot = await db.transaction(async tx => {
    const [entry] = await tx.select({ id: schema.calendarEntries.id, title: schema.calendarEntries.title, mode: schema.calendarEntries.mode,
      status: schema.calendarEntries.status, url: schema.calendarEntries.url, dest: schema.calendarEntries.dest,
      publishAttempts: schema.calendarEntries.publishAttempts, publishError: schema.calendarEntries.publishError,
    }).from(schema.calendarEntries).where(and(eq(schema.calendarEntries.id, entryId), eq(schema.calendarEntries.businessId, ctx.bid))).limit(1);
    if (!entry) throw notFound('Article');
    if (entry.status !== 'failed' || !entry.publishError) throw new RadarError('This article is no longer waiting for a publication report.', 409, 'report_not_failed');
    const [job] = await tx.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.businessId, ctx.bid), eq(schema.jobs.ref, entryId), eq(schema.jobs.kind, 'publish.entry'))).orderBy(desc(schema.jobs.createdAt), desc(schema.jobs.id)).limit(1);
    const destinationId = entry.dest || ctx.biz.blog?.defaultId;
    const [destination] = await tx.select({ id: schema.connections.id, type: schema.connections.type, url: schema.connections.url, targetId: schema.connections.targetId }).from(schema.connections)
      .where(and(eq(schema.connections.businessId, ctx.bid), ...(destinationId ? [eq(schema.connections.id, destinationId)] : []))).orderBy(schema.connections.createdAt).limit(1);
    return { entry, jobId: job?.id || null, destination };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  const { entry, jobId, destination } = snapshot;
  const diagnostic = reportDiagnostic(entry.publishError);
  const reference = reportIncidentId(ctx.bid, entry.id, jobId, entry.publishAttempts, diagnostic);
  const text = [
    `User reported a publication issue on Radar. Reference: ${reference}`, `Observed at: ${new Date().toISOString()}`,
    `Contact ID: ${clean(ctx.user.id)}`, `Contact name: ${clean(ctx.user.name)}`, `Contact email: ${clean(ctx.user.email)}`,
    `Business ID: ${clean(ctx.bid)}`, `Business name: ${clean(ctx.biz.profile?.business?.name)}`, `Business domain: ${safeUrl(ctx.biz.domain)}`,
    `Article ID: ${clean(entry.id)}`, `Article title: ${clean(entry.title, 500)}`, `Mode: ${clean(entry.mode, 20)}`, `Status: ${clean(entry.status, 20)}`,
    `Refresh target: ${safeUrl(entry.url)}`, `Destination ID: ${clean(destination?.id)}`, `Destination type: ${clean(destination?.type, 50)}`,
    `Destination URL: ${safeUrl(destination?.url)}`, `Destination reference: ${safeUrl(destination?.targetId)}`,
    `Publish attempts: ${entry.publishAttempts}`, `Publication job: ${clean(jobId)}`, '', 'Sanitized technical diagnostics:', JSON.stringify(diagnostic, null, 2),
  ].join('\n').slice(0, 10_000);
  try {
    const [existing] = await db.select().from(schema.outboxEmails).where(eq(schema.outboxEmails.id, reference)).limit(1);
    if (existing?.status === 'sent' && existing.to === ISSUE_TO && existing.subject === ISSUE_SUBJECT) return { delivered: true, reference };
    // Do not freeze an unusable sender on a new incident. Confirmed duplicates remain safe when config changes.
    if (!existing && !env.devStubs && (!env.resendKey || !validSender(env.mailFrom))) throw unavailable();
    // The first persisted payload wins, including sender/reply identity, across members and reloads.
    await db.insert(schema.outboxEmails).values({ id: reference, to: ISSUE_TO, subject: ISSUE_SUBJECT, text,
      senderMeta: { from: env.mailFrom, ...(EMAIL.test(ctx.user.email) ? { replyTo: ctx.user.email } : {}) },
    }).onConflictDoNothing();
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${reference}, 0))`);
      const [row] = await tx.select().from(schema.outboxEmails).where(eq(schema.outboxEmails.id, reference)).limit(1);
      if (!row || row.to !== ISSUE_TO || row.subject !== ISSUE_SUBJECT) throw failed();
      if (row.status === 'sent') return { delivered: true, reference };
      if (Date.now() - row.createdAt.getTime() > 23 * 3600_000) throw new RadarError('This report could not be confirmed. Please contact support for help.', 409, 'report_expired');
      if (env.devStubs) {
        await tx.update(schema.outboxEmails).set({ status: 'logged', error: null }).where(eq(schema.outboxEmails.id, reference));
        return { delivered: false, reference };
      }
      const sender = row.senderMeta;
      if (!env.resendKey || !sender || !validSender(sender.from)) throw unavailable();
      const limited = () => new RadarError('You’ve sent several issue reports. Please try again later.', 429, 'rate_limited');
      await enforce([
        { key: `support:mail:user:${ctx.user.id}`, limit: 5, windowSec: HOUR, error: limited },
        { key: `support:mail:user:${ctx.user.id}`, limit: 10, windowSec: DAY, error: limited },
        { key: `support:mail:business:${ctx.bid}`, limit: 15, windowSec: HOUR, error: limited },
      ]);
      let accepted = false;
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST', signal: AbortSignal.timeout(10000),
          headers: { authorization: `Bearer ${env.resendKey}`, 'content-type': 'application/json', 'Idempotency-Key': `radar-publishing-report-${reference}` },
          body: JSON.stringify({ from: sender.from, ...(sender.replyTo ? { reply_to: sender.replyTo } : {}), to: [row.to], subject: row.subject, text: row.text }),
        });
        const receipt = response.ok ? await response.json() : null;
        accepted = typeof receipt?.id === 'string' && receipt.id.trim().length > 0;
      } catch { /* Do not log or store provider responses; retries reuse the exact payload and key. */ }
      await tx.update(schema.outboxEmails).set(accepted ? { status: 'sent', sentAt: new Date(), error: null } : { status: 'failed', error: 'Issue report delivery could not be confirmed' }).where(eq(schema.outboxEmails.id, reference));
      return accepted ? { delivered: true, reference } : null;
    });
    if (!result) throw failed();
    return result;
  } catch (error) {
    if (error instanceof RadarError) throw error;
    throw failed();
  }
}
