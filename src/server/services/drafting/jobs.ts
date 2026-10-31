// Job + cron definitions for "drafting". Imported by src/server/jobs/all.ts.
//  - article.draft (ref = entryId): research → streamed draft ({ blocks, partial }) → validation → hero image → review|scheduled
//  - cron drafting.due: at blog.time in the business timezone, approved entries with date − 1 ≤ today start drafting.
//    Autopilot (acknowledged, connected) also auto-approves one proposed article per day. Pausing stops publishing, not drafting.
import { and, eq, inArray, lte } from 'drizzle-orm';
import { db, schema } from '../../db';
import { defineJob, once } from '../../jobs/queue';
import { defineCron } from '../../jobs/cron';
import { notify } from '../../notify';
import { getBiz, entryFromRow } from '../../workspace';
import { shortId } from '../../crypto';
import { GENERIC_AI_ERROR } from '../../errors';
import { RadarError } from '../../errors';
import { addDays, nowHMIn, todayIn } from '@/lib/format';
import { draftArticle, entriesStatus, type DraftPayload } from './draft';
import { startDraft } from './start';
import { generateArticleBodyImages, type BodyImagesPayload } from './bodyImages';
import { assertArticleEditable, assertArticleJobOwned, assertNoArticleWork, lockArticle } from './guard';
import type { Article, Profile } from '@/lib/types';

const trunc = (t: string) => (t.length > 40 ? t.slice(0, 40).trimEnd() + '…' : t);

async function publishingReady(bid: string, blog: any) {
  if (blog?.mode !== 'autopilot' || !blog?.autopilotAckAt || blog?.paused) return false;
  const c = await db.select({ id: schema.connections.id }).from(schema.connections).where(eq(schema.connections.businessId, bid)).limit(1);
  return !!c[0];
}

defineJob<DraftPayload>({
  kind: 'article.draft', maxAttempts: 2, timeoutMs: 15 * 60e3,
  run: async (ctx) => {
    const bid = ctx.businessId!; const { entryId, source } = ctx.payload;
    const { row, art } = await db.transaction(async tx => {
      const row = await lockArticle(tx, bid, entryId);
      assertArticleEditable(row.status, row.publishRemote);
      await assertNoArticleWork(tx, bid, entryId, ctx.job.id);
      await assertArticleJobOwned(tx, ctx.job);
      const art = (await tx.select().from(schema.articles).where(and(eq(schema.articles.entryId, entryId), eq(schema.articles.businessId, bid))).limit(1))[0];
      await tx.update(schema.calendarEntries).set({ status: 'drafting' }).where(eq(schema.calendarEntries.id, entryId));
      return { row, art };
    });
    try {
      const biz = await getBiz(bid); const profile = { ...(biz.profile as Profile), domain: biz.domain };
      const g = (await db.select({ status: schema.gscConnections.status }).from(schema.gscConnections).where(eq(schema.gscConnections.businessId, bid)).limit(1))[0];
      const gsc = !!g && ['connected', 'error', 'syncing'].includes(g.status);
      const a = await draftArticle(ctx, entryFromRow(row), (art?.data as Article) || null, profile, gsc, profile.business.name);
      const auto = await publishingReady(bid, biz.blog);
      const final = auto ? 'scheduled' : 'review';
      await db.transaction(async tx => {
        const current = await lockArticle(tx, bid, entryId);
        if (current.status !== 'drafting') throw new RadarError('The article changed while Radar was drafting it. Try again.', 409, 'article_changed');
        await assertArticleJobOwned(tx, ctx.job);
        const latest = (await tx.select().from(schema.articles).where(and(eq(schema.articles.entryId, entryId), eq(schema.articles.businessId, bid))).limit(1))[0];
        if (JSON.stringify(latest?.data) !== JSON.stringify(art?.data)) throw new RadarError('The article changed while Radar was drafting it. Try again.', 409, 'article_changed');
        await tx.insert(schema.articles).values({ entryId, businessId: bid, data: a, updatedAt: new Date() }).onConflictDoUpdate({ target: schema.articles.entryId, set: { data: a, updatedAt: new Date() } });
        await tx.update(schema.calendarEntries).set({ status: final, publishError: null }).where(eq(schema.calendarEntries.id, entryId));
      });
      await ctx.touch();
      const now = (await entriesStatus([entryId]))[0];
      await announce(bid, ctx.payload, now?.title || row.title, now?.status === 'scheduled');
      return { entryId, status: now?.status || final, draftedAt: a.draftedAt };
    } catch (e) {
      if (ctx.attempt >= ctx.job.maxAttempts) {
        // Give the entry back so "Draft now" works; the cron retries tomorrow.
        const cleaned = await db.transaction(async tx => {
          const current = await lockArticle(tx, bid, entryId);
          await assertArticleJobOwned(tx, ctx.job);
          if (current.status !== 'drafting') return false;
          await tx.update(schema.calendarEntries).set({ status: 'approved' }).where(eq(schema.calendarEntries.id, entryId));
          return true;
        }).catch(() => false);
        if (cleaned) {
          await once(`draft-failed:${entryId}:${todayIn((await getBiz(bid)).timezone)}`);
          await notify(bid, GENERIC_AI_ERROR, { tone: 'bad' });
        }
      }
      throw e;
    }
  },
});

defineJob<BodyImagesPayload>({
  kind: 'article.bodyImages', maxAttempts: 2, timeoutMs: 10 * 60e3,
  run: async ctx => {
    const bid = ctx.businessId!; const { entryId } = ctx.payload;
    const snapshot = await db.transaction(async tx => {
      const row = await lockArticle(tx, bid, entryId);
      assertArticleEditable(row.status, row.publishRemote);
      await assertNoArticleWork(tx, bid, entryId, ctx.job.id);
      await assertArticleJobOwned(tx, ctx.job);
      const a = (await tx.select().from(schema.articles).where(and(eq(schema.articles.entryId, entryId), eq(schema.articles.businessId, bid))).limit(1))[0]?.data as Article | undefined;
      if (!a?.generated || !a.body?.length) throw new RadarError('Draft this article before adding body images.', 400, 'not_generated');
      return { row, a };
    });
    const biz = await getBiz(bid); const profile = { ...(biz.profile as Profile), domain: biz.domain };
    const bodyImages = await generateArticleBodyImages(ctx, entryFromRow(snapshot.row), snapshot.a, profile);
    const bodyImagesGeneratedAt = new Date().toISOString();
    await db.transaction(async tx => {
      const row = await lockArticle(tx, bid, entryId);
      assertArticleEditable(row.status, row.publishRemote);
      await assertArticleJobOwned(tx, ctx.job);
      const latest = (await tx.select().from(schema.articles).where(and(eq(schema.articles.entryId, entryId), eq(schema.articles.businessId, bid))).limit(1))[0]?.data as Article | undefined;
      if (!latest || JSON.stringify(latest.body) !== JSON.stringify(snapshot.a.body)) throw new RadarError('The article text changed while Radar was making its images. Try again to match the latest text.', 409, 'article_changed');
      if (latest.img.style !== snapshot.a.img.style || latest.img.prompt !== snapshot.a.img.prompt || latest.img.modelRequired !== snapshot.a.img.modelRequired) throw new RadarError('The image direction changed while Radar was generating. Try again.', 409, 'article_changed');
      await tx.update(schema.articles).set({ data: { ...latest, bodyImages, bodyImagesGeneratedAt }, updatedAt: new Date() }).where(and(eq(schema.articles.entryId, entryId), eq(schema.articles.businessId, bid)));
    });
    await ctx.touch();
    return { entryId, bodyImagesGeneratedAt, count: bodyImages.length };
  },
});

/** Toasts (exact copy). User-started drafts: "Draft ready…". Scheduled drafts are batched per cron tick. */
async function announce(bid: string, p: DraftPayload, title: string, auto: boolean) {
  if (p.source === 'user') { await notify(bid, auto ? `“${trunc(title)}” is drafted and queued to publish.` : 'Draft ready. Edit anything, then approve.', { tone: 'ok' }); return; }
  const ids = p.batch?.length ? p.batch : [p.entryId];
  const st = await entriesStatus(ids);
  if (st.some(s => s.status === 'drafting')) return; // another draft in this batch is still running; the last one announces
  if (!(await once('draft-notify:' + (p.batchId || p.entryId)))) return;
  const done = st.filter(s => s.status === 'review' || s.status === 'scheduled');
  if (!done.length) return;
  const queued = done.every(s => s.status === 'scheduled');
  if (done.length === 1) {
    const one = done[0];
    await notify(bid, `“${trunc(one.title || title)}” is drafted and ${queued ? 'queued to publish' : 'ready for review'}.`, { tone: 'ok', action: queued ? undefined : { label: 'Open', href: `/article/${one.id}` } });
  } else {
    await notify(bid, queued ? `${done.length} drafts are ready and queued to publish.` : `${done.length} drafts are ready for review.`, { tone: 'ok', action: queued ? undefined : { label: 'Review', href: '/calendar?view=list&filter=review' } });
  }
}

defineCron('drafting.due', async (now) => {
  const bizs = await db.select({ id: schema.businesses.id, tz: schema.businesses.timezone, blog: schema.businesses.blog, status: schema.businesses.status }).from(schema.businesses).where(eq(schema.businesses.status, 'active'));
  for (const b of bizs) {
    const tz = b.tz || 'America/New_York'; const time = (b.blog || {}).time || '09:00';
    if (nowHMIn(tz, now) < time) continue;
    const today = todayIn(tz, now); const tomorrow = addDays(today, 1);
    // Autopilot: one article a day without review (needs the acknowledgment and a connection; pause only holds publishing).
    const bl = b.blog || {};
    if (bl.mode === 'autopilot' && bl.autopilotAckAt) {
      const conn = await db.select({ id: schema.connections.id }).from(schema.connections).where(eq(schema.connections.businessId, b.id)).limit(1);
      if (conn[0]) {
        const forTomorrow = await db.select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.businessId, b.id), eq(schema.calendarEntries.date, tomorrow))).orderBy(schema.calendarEntries.createdAt);
        const prop = forTomorrow.find(e => e.status === 'proposed');
        if (prop && !forTomorrow.some(e => e.status !== 'proposed') && (await once(`autopilot:${b.id}:${today}`)))
          await db.update(schema.calendarEntries).set({ status: 'approved' }).where(and(eq(schema.calendarEntries.id, prop.id), eq(schema.calendarEntries.status, 'proposed')));
      }
    }
    const due = await db.select({ id: schema.calendarEntries.id, date: schema.calendarEntries.date }).from(schema.calendarEntries)
      .where(and(eq(schema.calendarEntries.businessId, b.id), eq(schema.calendarEntries.status, 'approved'), lte(schema.calendarEntries.date, tomorrow)));
    if (!due.length) continue;
    const marks = await db.select({ key: schema.cronMarks.key }).from(schema.cronMarks).where(inArray(schema.cronMarks.key, due.map(d => `draft-failed:${d.id}:${today}`)));
    const failed = new Set(marks.map(m => m.key));
    // "Approved without publishing" articles are already written — never redraft over the user's edits.
    const arts = await db.select({ id: schema.articles.entryId, data: schema.articles.data }).from(schema.articles).where(inArray(schema.articles.entryId, due.map(d => d.id)));
    const written = new Set(arts.filter(a => (a.data as Article)?.generated).map(a => a.id));
    const ids = due.filter(d => !failed.has(`draft-failed:${d.id}:${today}`) && !written.has(d.id)).map(d => d.id);
    if (!ids.length) continue;
    const batch = { id: shortId('b_'), ids };
    for (const id of ids) await startDraft(b.id, id, bl.mode === 'autopilot' ? 'autopilot' : 'cron', batch);
  }
});
