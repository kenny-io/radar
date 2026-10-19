// Job + cron definitions for "calendar". Imported by src/server/jobs/all.ts.
// calendar.generate (ref = businessId): the 7 research phases of 01-screens.md §5, streamed as { phase, results, keep, gsc }.
import { defaultArticleImageStyle } from '@/server/services/images';
import { keywordProviderIssue } from '../keywords/provider';
import { and, eq, ne } from 'drizzle-orm';
import { db, schema } from '../../db';
import { defineJob } from '../../jobs/queue';
import { notify } from '../../notify';
import { getBiz } from '../../workspace';
import { shortId } from '../../crypto';
import { GENERIC_AI_ERROR } from '../../errors';
import { cadenceLabel } from '@/lib/constants';
import { fmtN, slugify } from '@/lib/format';
import { normKw } from '../gsc/metrics';
import { slotDates } from './schedule';
import { clusterCandidates, difficultyCeiling, existingArticles, gscHasData, gscQueryStats, refreshCandidates, researchCandidates, writeTopics, type Candidate, type Topic } from './research';
import type { CalendarSettings, Profile } from '@/lib/types';

export interface CalGenPayload { settings: CalendarSettings; keep: boolean }
export interface CalGenProgress { phase: number; results: string[]; keep: boolean; gsc: boolean }
/** Leftover researched topics for "Replace topic" (stored on the job result). */
export type PoolItem = Pick<Candidate, 'kw' | 'vol' | 'kd' | 'facts' | 'measured' | 'priority' | 'seed' | 'src' | 'score'>;

const MIN_PHASE_MS = 520; // lets each real phase register visually; never fakes a result

defineJob<CalGenPayload>({
  kind: 'calendar.generate', maxAttempts: 2, timeoutMs: 10 * 60e3,
  run: async (ctx) => {
    const bid = ctx.businessId!; const { settings, keep } = ctx.payload;
    try {
      const biz = await getBiz(bid); const profile = biz.profile as Profile; profile.domain = biz.domain;
      const g = (await db.select().from(schema.gscConnections).where(eq(schema.gscConnections.businessId, bid)).limit(1))[0];
      // Syncing = partial data; error = data up to lastSyncedThrough is still valid.
      const gsc = !!g && gscHasData(g.status);
      const prog: CalGenProgress = { phase: 0, results: [], keep, gsc };
      const step = async <T>(i: number, fn: () => Promise<{ v: T; label: string }>): Promise<T> => {
        prog.phase = i; await ctx.progress({ ...prog });
        const t0 = Date.now(); const { v, label } = await fn();
        const wait = MIN_PHASE_MS - (Date.now() - t0); if (wait > 0) await new Promise(r => setTimeout(r, wait));
        prog.results[i] = label; await ctx.progress({ ...prog, phase: i + 1 > 6 ? 6 : i + 1 });
        return v;
      };
      const kl = profile.keywords?.list || [];
      await step(0, async () => ({ v: null, label: `${profile.business.name} · ${profile.audience.segments.length} segments` }));
      await step(1, async () => ({ v: null, label: `${kl.length} keywords · ${kl.filter(k => k.priority).length} priorities` }));
      const existing = await step(2, async () => {
        const ex = await existingArticles(bid);
        const n = ex.count ?? biz.site?.articles ?? 0;
        return { v: ex, label: `${n} articles on ${biz.domain}` };
      });
      const refresh = await step(3, async () => {
        if (!gsc) return { v: [] as Candidate[], label: 'Using keyword estimates only' };
        const st = await gscQueryStats(bid);
        const rc = await refreshCandidates(bid);
        return { v: rc, label: `${fmtN(st.queries)} queries · ${st.months} months` };
      });
      const cands = await step(4, async () => {
        const c = await researchCandidates(bid, profile, settings.market, settings.language, gsc);
        const issue = keywordProviderIssue();
        return { v: c, label: `${fmtN(c.length + refresh.length)} candidates in ${settings.market}${issue ? ' · keyword data unavailable' : ''}` };
      });

      // Entries that stay where they are (everything not proposed).
      const keptRows = await db.select().from(schema.calendarEntries).where(and(eq(schema.calendarEntries.businessId, bid), ne(schema.calendarEntries.status, 'proposed')));
      const keptKw = new Set(keptRows.map(r => normKw(r.kw)));
      const slots = slotDates(settings, 30);
      const keptDates = new Set(keptRows.map(r => String(r.date)));
      const open = slots.filter(d => !keptDates.has(d));

      const chosen = await step(5, async () => {
        const ceiling = await difficultyCeiling(bid, profile, settings.market, settings.language, gsc);
        const tooHard = cands.filter(c => c.kd != null && c.kd > ceiling && !(c.measured && c.measured.pos <= 20));
        const ok = cands.filter(c => !tooHard.includes(c) && !keptKw.has(c.kw));
        const { keep: clustered, offTopic } = await clusterCandidates(bid, profile, ok.slice(0, 150), existing.titles.map(t => t.title), keptRows.map(r => r.title));
        const ref = refresh.filter(r => !keptKw.has(normKw(r.kw)) && !keptRows.some(k => k.url && k.url === r.url)).slice(0, Math.min(5, Math.floor(open.length / 5) || (open.length ? 1 : 0)));
        const refKw = new Set(ref.map(r => normKw(r.kw)));
        const fresh = clustered.filter(c => !refKw.has(c.kw));
        const need = Math.max(0, open.length - ref.length);
        return { v: { ref, fresh: fresh.slice(0, need), pool: fresh.slice(need, need + 24) }, label: `Removed ${fmtN(tooHard.length + offTopic)} too-hard or off-topic` };
      });

      const topics = await step(6, async () => {
        // Refreshes go early (fastest wins), spread through the month.
        const order: Candidate[] = [...chosen.fresh];
        chosen.ref.forEach((r, i) => order.splice(Math.min(order.length, 1 + i * 5), 0, r));
        const t = await writeTopics(bid, profile, order.slice(0, open.length), existing.titles.map(x => x.title));
        return { v: t, label: `${keptRows.filter(r => slots.includes(String(r.date))).length + t.length} topics · ${cadenceLabel(settings)}` };
      });

      const generatedAt = new Date();
      await db.transaction(async (tx) => {
        await tx.delete(schema.calendarEntries).where(and(eq(schema.calendarEntries.businessId, bid), eq(schema.calendarEntries.status, 'proposed')));
        const rows = topics.map((t: Topic, i) => ({
          id: shortId('e_'), businessId: bid, title: t.title, kw: t.kw, type: t.type, vol: t.vol, kd: t.kd, date: open[i], mode: t.mode, url: t.url,
          measured: t.measured, audience: t.audience, relevance: t.relevance, status: 'proposed',
        }));
        if (rows.length) {
          await tx.insert(schema.calendarEntries).values(rows);
          await tx.insert(schema.articles).values(rows.map((r, i) => ({
            entryId: r.id, businessId: bid,
            data: { entryId: r.id, generated: false, body: [], brief: { angle: r.relevance, outline: topics[i].outline, words: 1400 }, seo: { title: r.title, meta: '', slug: slugify(r.kw) }, img: { style: defaultArticleImageStyle(), seed: 1, prompt: 'Calm, editorial image about ' + r.kw, alt: '', url: null, urlKey: null }, videos: [], videoMeta: [], sources: [], claims: [], draftedAt: null },
          })));
        }
        await tx.update(schema.businesses).set({ calendarGeneratedAt: generatedAt, calendarSettings: settings }).where(eq(schema.businesses.id, bid));
      });
      await notify(bid, keep ? `Calendar refreshed. ${keptRows.length} approved topics kept in place.` : `${topics.length} topics proposed. Approve the ones you like.`, { tone: 'ok' });
      // Say why the month isn't full, or why volumes are missing, instead of leaving a quietly short calendar.
      const issue = keywordProviderIssue();
      const unverified = topics.filter((t: Topic) => t.src === 'idea').length;
      if (issue || topics.length < open.length) {
        const why = issue === 'credit' ? 'the keyword data provider is out of credit' : issue ? 'keyword data was unavailable' : 'Radar found fewer distinct, winnable topics than open days';
        const parts = [topics.length < open.length ? `${open.length - topics.length} of ${open.length} days are still open because ${why}.` : '', unverified ? `${unverified} ${unverified === 1 ? 'topic comes' : 'topics come'} from your Business Profile without search volume${topics.length < open.length ? '' : ` because ${why}`}.` : ''].filter(Boolean);
        await notify(bid, `${parts.join(' ')}${issue ? ' Regenerate once keyword data is back to use measured keywords.' : ''}`.trim(), { tone: 'warn' });
      }
      const pool: PoolItem[] = chosen.pool.map(c => ({ kw: c.kw, vol: c.vol, kd: c.kd, facts: c.facts, measured: c.measured, priority: c.priority, seed: c.seed, src: c.src, score: c.score }));
      return { generatedAt: generatedAt.toISOString(), pool, count: topics.length };
    } catch (e) {
      if (ctx.attempt >= ctx.job.maxAttempts) await notify(bid, GENERIC_AI_ERROR, { tone: 'bad' });
      throw e;
    }
  },
});
