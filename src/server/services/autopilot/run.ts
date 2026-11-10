import { reportFailure, type FailureContext } from '@/server/observability/failures';
import { RadarError } from '@/server/errors';
// The program coordinates existing capabilities; publication remains in the guarded, retry-safe publishers.
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db, schema as S } from '@/server/db';
import { enqueue, type JobCtx } from '@/server/jobs/queue';
import { getBiz, calendarSettingsOf, socialAutoOf } from '@/server/workspace';
import { socialOn } from '@/server/flags';
import { addDays, todayIn } from '@/lib/format';
import { briefSid, canPost, packSid } from '@/lib/socialPublish';
import type { Article, BriefItem, Platform } from '@/lib/types';
import { textOf } from '@/features/brief/model';
import { startDraft } from '../drafting/start';
import { dailyPackId, isDue } from '../social/auto';
import { getPack } from '../social/generate';
import { scheduleChecks, resolve, writeScheduled } from '../social/publish/schedule';
import { getDay } from '../brief/store';
import { authorized, autopilotOf, effectiveSocial, socialSlot } from './policy';
import { canRun } from './guard';
import { businessHref, enqueueHandoff, type Handoff } from './handoff';

export interface RunPayload { activationId: string; retry?: boolean }

/** A daily mark and the work it authorizes are inseparable. Failed insert cannot strand the mark. */
async function dailyJob(bid: string, activationId: string, key: string, kind: string, payload: unknown, singletonKey: string, ref: string) {
  if (!(await canRun(bid, activationId))) return false;
  return db.transaction(async tx => {
    const [b] = await tx.select().from(S.businesses).where(eq(S.businesses.id, bid)).for('update');
    if (!b || !authorized(b, activationId)) return false;
    const marks = await tx.insert(S.cronMarks).values({ key }).onConflictDoNothing().returning({ key: S.cronMarks.key });
    if (!marks.length) return false;
    const inserted = await tx.insert(S.jobs).values({ kind, payload, businessId: bid, ref, singletonKey, maxAttempts: kind === 'social.autoRun' ? 3 : 2 }).onConflictDoNothing().returning({ id: S.jobs.id });
    if (!inserted.length) { await tx.delete(S.cronMarks).where(eq(S.cronMarks.key, key)); return false; }
    return true;
  });
}

/** No takeovers: a SID with any publication history remains the user's/publisher's decision. */
async function schedulePost(bid: string, activationId: string, sid: string, now: Date): Promise<'scheduled' | 'existing'> {
  if (!(await canRun(bid, activationId))) return 'existing';
  const b = await getBiz(bid); const r = await resolve(bid, sid);
  if (r.existing) return 'existing';
  const slot = socialSlot(b.timezone, socialAutoOf(b).time || '08:00', now);
  await scheduleChecks(b, r, slot.date, slot.time, now.getTime());
  return db.transaction(async tx => {
    const [latest] = await tx.select().from(S.businesses).where(eq(S.businesses.id, bid)).for('update');
    if (!latest || !authorized(latest, activationId)) return 'existing';
    const [existing] = await tx.select({ id: S.socialPubs.id }).from(S.socialPubs).where(and(eq(S.socialPubs.businessId, bid), eq(S.socialPubs.sid, sid))).limit(1);
    if (existing) return 'existing';
    const volume = await tx.select({ id: S.socialPubs.id }).from(S.socialPubs).where(and(eq(S.socialPubs.businessId, bid), eq(S.socialPubs.platform, r.t.platform), eq(S.socialPubs.date, slot.date), inArray(S.socialPubs.status, ['scheduled', 'sending', 'posted']))).limit(2);
    if (volume.length >= 2) return 'existing';
    const row = await writeScheduled(tx, { biz: latest, r, ...slot, userId: null, auto: true, autopilotActivationId: activationId });
    return row ? 'scheduled' : 'existing';
  });
}

/** A schedule refused for something only the owner can fix (no account connected, an expired one, a post that fails the
 *  platform's checks) goes to the handoff only. Every run meets it again, so reporting it would raise an operator alert
 *  every five minutes. Any other refusal means Radar built a schedule it should not have, and is reported. */
const OWNER_FIXABLE = new Set(['not_connected', 'expired', 'preflight']);
const refused = (e: unknown, context: FailureContext) => e instanceof RadarError && OWNER_FIXABLE.has(e.code) ? Promise.resolve() : reportFailure(e, context);

export async function runAutopilot(ctx: JobCtx<RunPayload>) {
  const bid = ctx.businessId!; const activationId = ctx.payload.activationId;
  if (!(await canRun(bid, activationId))) return { skipped: 'autopilot_off_or_no_access' };
  const b = await getBiz(bid); const now = new Date(); const date = todayIn(b.timezone, now);
  const link = (path: string) => businessHref(bid, path);
  const handoffs: Handoff[] = []; const summary: string[] = []; const failures: string[] = [];
  const issue = (key: string, title: string, reason: string, href: string, text?: string, sourceUrl?: string) => handoffs.push({ key, title, reason, href: link(href), ...(text ? { text } : {}), ...(sourceUrl ? { sourceUrl } : {}) });
  const stage = async (name: string, fn: () => Promise<void>) => {
    if (!(await canRun(bid, activationId))) return;
    try { await ctx.progress({ stage: name }); await fn(); }
    catch (e) { await reportFailure(e, { source: 'autopilot', operation: `autopilot.${name}`, businessId: bid, ref: date, degraded: true }); console.error(`[autopilot] ${name} failed for ${bid}`, e instanceof Error ? e.message : 'failed'); failures.push(name); issue(`stage:${name}:${date}`, `${name} needs attention`, 'Radar could not finish this step. Review the saved work and run Autopilot again.', '/settings?section=autopilot'); }
  };
  const retry = ctx.payload.retry ? `:retry:${ctx.job.id}` : '';

  await stage('Content calendar', async () => {
    const upcoming = await db.select({ id: S.calendarEntries.id }).from(S.calendarEntries).where(and(eq(S.calendarEntries.businessId, bid), gte(S.calendarEntries.date, date))).limit(7);
    if (upcoming.length >= 7) return;
    const settings = { ...calendarSettingsOf(b), start: addDays(date, 1) };
    if (await dailyJob(bid, activationId, `autopilot-calendar:${bid}:${activationId}:${date}${retry}`, 'calendar.generate', { settings, keep: true, autopilotActivationId: activationId }, `cal-gen:${bid}`, bid)) summary.push('Calendar research queued');
  });

  await stage('Articles', async () => {
    const tomorrow = addDays(date, 1);
    const entries = await db.select().from(S.calendarEntries).where(and(eq(S.calendarEntries.businessId, bid), gte(S.calendarEntries.date, date), lte(S.calendarEntries.date, tomorrow))).orderBy(asc(S.calendarEntries.date), asc(S.calendarEntries.createdAt));
    const conn = await db.select().from(S.connections).where(eq(S.connections.businessId, bid));
    const usable = conn.some(c => c.status === 'ok');
    if (!usable) issue(`blog:${date}`, 'Connect your publishing destination', conn.length ? 'Your blog connection needs attention before Radar can publish articles.' : 'Radar can prepare articles. Connect a blog so Autopilot can publish them.', '/settings?section=publishing');
    if (b.blog?.paused) { issue(`blog-paused:${date}`, 'Article publishing is paused', 'Resume publishing in Settings when you want Autopilot to publish articles.', '/settings?section=publishing'); return; }
    const candidate = entries.find(e => ['proposed', 'approved'].includes(e.status) && (e.status === 'proposed' || !e.autopilotActivationId || e.autopilotActivationId === activationId) && !entries.some(other => other.id !== e.id && other.date === e.date && other.status !== 'proposed'));
    if (!candidate) return;
    const art = (await db.select().from(S.articles).where(and(eq(S.articles.businessId, bid), eq(S.articles.entryId, candidate.id))).limit(1))[0]?.data as Article | undefined;
    // Existing generated/reviewed material belongs to the user; never rewrite or implicitly approve it.
    if (art?.generated) return;
    const failed = await db.select({ id: S.jobs.id }).from(S.jobs).where(and(eq(S.jobs.businessId, bid), eq(S.jobs.kind, 'article.draft'), eq(S.jobs.ref, candidate.id), eq(S.jobs.status, 'failed'))).limit(1);
    if (failed.length && !ctx.payload.retry) return;
    await startDraft(bid, candidate.id, 'autopilot', undefined, activationId); summary.push('Article draft queued');
  });

  await stage('Social posts', async () => {
    const auto = effectiveSocial(socialAutoOf(b));
    const { due } = isDue(auto, b.timezone, now);
    if (!due) return;
    // Generation uses one stable daily ID shared with the existing proactive drafts, including saved user edits.
    const packId = dailyPackId(bid, date);
    const pack = await getPack(bid, packId);
    if (!pack) {
      if (await dailyJob(bid, activationId, `autopilot-social:${bid}:${activationId}:${date}${retry}`, 'social.autoRun', { date, autopilotActivationId: activationId }, `social.auto:${bid}:${date}`, date)) summary.push('Daily social generation queued');
      return;
    }
    const publishing = await socialOn(b);
    let scheduled = 0;
    for (const [platform, post] of Object.entries(pack.posts)) {
      if (!post || !auto.platforms.includes(platform as Platform)) continue;
      if (!canPost(platform) || !publishing) { issue(`pack:${pack.id}:${platform}`, `Publish your ${platform} post`, !publishing && canPost(platform) ? 'Direct social publishing is not available for this workspace. Copy the prepared draft to your account.' : 'This platform requires you to publish the prepared draft yourself.', `/social?pack=${encodeURIComponent(pack.id)}&plat=${platform}`, post.text); continue; }
      try { if (await schedulePost(bid, activationId, packSid(pack.id, platform), now) === 'scheduled') scheduled++; }
      catch (e) { await refused(e, { source: 'autopilot', operation: 'autopilot.scheduleSocial', businessId: bid, ref: pack.id, provider: platform, degraded: true }); issue(`pack:${pack.id}:${platform}`, `Your ${platform} post needs attention`, 'Connect or reconnect the account, or resolve the publishing check in Radar. Your draft is saved.', `/social?pack=${encodeURIComponent(pack.id)}&plat=${platform}`, post.text); }
    }
    summary.push(scheduled ? `${scheduled} social ${scheduled === 1 ? 'post' : 'posts'} scheduled` : 'Daily social drafts ready');
  });

  await stage('Daily Brief', async () => {
    const day = await getDay(bid, date);
    if (!day) {
      if (await dailyJob(bid, activationId, `autopilot-brief:${bid}:${activationId}:${date}${retry}`, 'brief.scan', { mode: 'first', date, autopilotActivationId: activationId }, `brief-scan:${bid}:${date}`, date)) summary.push('Daily Brief scan queued');
      return;
    }
    const publishing = await socialOn(b);
    const pubs = await db.select().from(S.socialPubs).where(and(eq(S.socialPubs.businessId, bid), eq(S.socialPubs.date, socialSlot(b.timezone, socialAutoOf(b).time || '08:00', now).date), inArray(S.socialPubs.status, ['scheduled', 'sending', 'posted'])));
    const used = new Map<string, number>(); for (const p of pubs) used.set(p.platform, (used.get(p.platform) || 0) + 1);
    for (const item of day.items as BriefItem[]) {
      if (!['open', 'copied'].includes(item.st)) continue;
      const platform = item.kind === 'post' ? item.pl || item.plats?.[0] : item.plat;
      const key = `brief:${date}:${item.id}`;
      if (item.kind === 'reply' || !canPost(platform) || !publishing) { issue(key, `${platform || 'Community'}: ${item.title}`, item.kind === 'reply' ? 'Radar cannot post this comment. Open the conversation and send the prepared reply from your account.' : 'This post needs to be published from your account.', `/brief?date=${date}`, textOf(item), item.url); continue; }
      const sid = briefSid(date, item.id);
      if (pubs.some(p => p.sid === sid)) continue;
      // At most two feed posts per platform/day, including the generated daily pack and manual schedules.
      if ((used.get(platform) || 0) >= 2) continue;
      try { if (await schedulePost(bid, activationId, sid, now) === 'scheduled') used.set(platform, (used.get(platform) || 0) + 1); }
      catch (e) { await refused(e, { source: 'autopilot', operation: 'autopilot.scheduleBrief', businessId: bid, ref: item.id, provider: platform, degraded: true }); issue(key, `${platform}: ${item.title}`, 'Reconnect the account or resolve the publishing check in Radar. The prepared post is saved.', `/brief?date=${date}`, textOf(item)); }
    }
  });

  await stage('Publishing follow-up', async () => {
    const [posts, entries, jobs] = await Promise.all([
      db.select().from(S.socialPubs).where(and(eq(S.socialPubs.businessId, bid), eq(S.socialPubs.autopilotActivationId, activationId), eq(S.socialPubs.status, 'failed'))),
      db.select().from(S.calendarEntries).where(and(eq(S.calendarEntries.businessId, bid), eq(S.calendarEntries.autopilotActivationId, activationId), eq(S.calendarEntries.status, 'failed'))),
      db.select().from(S.jobs).where(and(eq(S.jobs.businessId, bid), inArray(S.jobs.kind, ['calendar.generate', 'article.draft', 'brief.scan', 'social.autoRun']), eq(S.jobs.status, 'failed'))).orderBy(desc(S.jobs.createdAt)).limit(30),
    ]);
    const held = await db.select({ p: S.socialPubs, expired: S.socialAccounts.expired, accountId: S.socialAccounts.id }).from(S.socialPubs).leftJoin(S.socialAccounts, eq(S.socialAccounts.id, S.socialPubs.acctId)).where(and(eq(S.socialPubs.businessId, bid), eq(S.socialPubs.autopilotActivationId, activationId), eq(S.socialPubs.status, 'scheduled')));
    for (const { p, expired, accountId } of held) if (expired || !accountId) issue(`held-post:${p.id}`, `Reconnect your ${p.platform} account`, 'This scheduled post is on hold because its account needs reconnecting. Reconnect it in Social accounts so Radar can continue.', '/settings?section=social');
    for (const p of posts) issue(`failed-post:${p.id}`, `A ${p.platform} post needs attention`, p.errCode === 'unknown' ? 'The provider did not confirm publication. Check your account before trying again to avoid a duplicate.' : 'Radar could not publish this post. Review the saved draft and reconnect the account if needed.', '/social');
    for (const e of entries) issue(`failed-article:${e.id}`, e.title, 'Radar could not publish this article. Review the publishing connection and retry from the article.', `/article/${e.id}`);
    for (const j of jobs) if ((j.payload as { autopilotActivationId?: string })?.autopilotActivationId === activationId) issue(`failed-job:${j.id}`, `${j.kind === 'calendar.generate' ? 'Calendar research' : j.kind === 'article.draft' ? 'Article drafting' : j.kind === 'social.autoRun' ? 'Social generation' : 'Daily Brief scan'} needs attention`, 'Radar could not finish this step after retrying. Run Autopilot again or open the saved work.', '/settings?section=autopilot');
    const failedMail = await db.select({ id: S.jobs.id }).from(S.jobs).where(and(eq(S.jobs.businessId, bid), eq(S.jobs.kind, 'autopilot.handoff'), inArray(S.jobs.status, ['failed', 'queued', 'running']), sql`(${S.jobs.error} IS NOT NULL OR ${S.jobs.status} = 'failed')`, sql`${S.jobs.payload}->>'activationId' = ${activationId}`)).limit(1);
    if (failedMail.length) failures.push('Owner email delivery');
    const [scan] = await db.select().from(S.jobs).where(and(eq(S.jobs.businessId, bid), eq(S.jobs.kind, 'brief.scan'), eq(S.jobs.ref, date), eq(S.jobs.status, 'done'))).orderBy(desc(S.jobs.createdAt)).limit(1);
    if ((scan?.result as { failed?: string })?.failed) issue(`brief-source:${date}`, 'A Daily Brief source is unavailable', 'Radar could not read one of the conversation sources. Open Daily Brief to try again.', '/brief');
  });

  const count = await enqueueHandoff(bid, activationId, handoffs);
  if (count) summary.push(`${count} owner ${count === 1 ? 'action' : 'actions'} queued for email`);
  const message = summary.join(' · ') || 'Marketing program checked. No new actions needed.';
  await db.update(S.businesses).set({ autopilot: sql`${S.businesses.autopilot} || ${JSON.stringify({ lastRunAt: new Date().toISOString(), lastError: failures.length ? `${failures.join(', ')} needs attention. Saved work is available in Radar.` : null, summary: message })}::jsonb` }).where(and(eq(S.businesses.id, bid), sql`${S.businesses.autopilot}->>'activationId' = ${activationId}`, sql`${S.businesses.autopilot}->>'enabled' = 'true'`));
  await ctx.touch();
  return { summary: message, handoffs: count, failures };
}

export async function autopilotTick(now = new Date()) {
  const rows = await db.select().from(S.businesses).where(and(eq(S.businesses.status, 'active'), sql`${S.businesses.autopilot}->>'enabled' = 'true'`));
  for (const b of rows) {
    const a = autopilotOf(b); if (!a.activationId) continue;
    if (a.lastRunAt && now.getTime() - new Date(a.lastRunAt).getTime() < 5 * 60_000) continue;
    if (!(await canRun(b.id, a.activationId))) continue;
    await enqueue('autopilot.run', { activationId: a.activationId }, { businessId: b.id, singletonKey: `autopilot.run:${b.id}`, maxAttempts: 3 });
  }
}
