// The Daily Brief research agent (02-system §9): discover → collect (per platform) → rank → select → draft → save.
import { and, desc, eq, lt } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { briefSettingsOf, bizToday, getBiz } from '@/server/workspace';
import { notify } from '@/server/notify';
import { getJob, type JobCtx } from '@/server/jobs/queue';
import { fmtTime, nowHMIn } from '@/lib/format';
import type { BriefAccount, BriefItem, BriefPlatform, BriefSettings, Profile } from '@/lib/types';
import { DRAFT_SUB, DRAFT_SUB_BOTH, DRAFT_SUB_CO, RANK_SUB, accountsOf, enabledInOrder, platsFor, type BriefScanProgress, type BriefScanResult, type ScanMode, type ScanStep, type ScanStepKey } from '@/features/brief/model';
import { buildPlan, clip, relevance, seenOf, threadKey, uniqueCands, type Candidate } from './plan';
import { sourceFor } from './sources';
import { rankCandidates, selectReplies, type Scored } from './rank';
import { draftCompanyReply, draftPosts, draftReply, feedThemes } from './draft';
import { createDay, getDay, mergeStats, withDay, type CandMark, type DayStats } from './store';
import { fitToCap, slotsLeft } from './cap';
import { newSinceFor } from './rescan';
import './stubs';

export interface ScanPayload {
  mode: ScanMode; date?: string; fromJob?: string;
  /** Automatic rescan (cron `brief.rescan`): quiet progress, a failing platform is skipped, members get the toast. */
  background?: boolean;
  /** Earlier `brief.scan` jobs for this date (query rotation, `queriesFor`). First scans always search round 0. */
  round?: number;
}
const WINDOW_MS = 48 * 3600e3;

/** Candidates kept with a failed job so "Keep this morning’s brief" can use them without re-reading. */
const slim = (c: Candidate): Candidate => ({ ...c, body: clip(c.body, 400), comments: (c.comments || []).slice(0, 3) });

export async function runScan(ctx: JobCtx<ScanPayload>): Promise<BriefScanResult> {
  const bid = ctx.businessId!;
  const b = await getBiz(bid);
  const profile = { ...(b.profile as Profile), domain: b.domain };
  const settings = briefSettingsOf(b) as BriefSettings;
  const date = ctx.payload.date || bizToday(b);
  const background = !!ctx.payload.background;
  const existing = await getDay(bid, date);
  // A background rescan only adds to today's brief: it never creates a day quietly (that is the morning scan's job, with
  // its +15/+30 retries), and once the day has ended it does nothing.
  if (background && (!existing || date !== bizToday(b))) return { mode: 'again', added: 0, addedIds: [], since: existing?.scannedAt ?? null, skipped: existing ? 'past' : 'no_day' };
  let mode: ScanMode = ctx.payload.mode || 'first';
  if (mode === 'first' && existing) mode = 'again';
  if (mode === 'again' && !existing) mode = 'first';
  const since = existing?.scannedAt ?? null;
  const round = mode === 'first' ? 0 : ctx.payload.round ?? 0;
  const accts = accountsOf(settings);
  const both = accts.length > 1;
  // Read only where some account drafts (the company alone never reads Reddit, Hacker News or Quora).
  const plats = enabledInOrder([...new Set(accts.flatMap(a => platsFor(a, settings.platforms)))]);
  const plan = buildPlan(profile);
  const draftSub = both ? DRAFT_SUB_BOTH : accts[0] === 'company' ? DRAFT_SUB_CO : DRAFT_SUB;

  let steps: ScanStep[] = [...plats.map(k => ({ k, sub: plan.subs[k] })), { k: 'rank', sub: RANK_SUB }, { k: 'draft', sub: draftSub }];
  let step: ScanStepKey = plats[0] || 'rank';
  let threadsRead = 0;
  const stats: DayStats = {};
  const quiet = mode === 'keep' || background;
  const push = (extra: Partial<BriefScanProgress> = {}) => ctx.progress({ step, threadsRead, steps, mode, ...(quiet ? { quiet } : {}), ...extra } satisfies BriefScanProgress);
  await push();

  // ── Collect ──
  // Threads the day has seen, by id and by thread key: the same post found again under another id is not new.
  const seen = seenOf((existing?.candidates || []) as CandMark[], (existing?.items || []) as BriefItem[]);
  let cands: Candidate[] = [];
  const skippedPlats: BriefPlatform[] = [];
  // Background rescans: real-time sources (the X API) read only threads posted since the previous scan that read them.
  const earlier = background ? await db.select({ createdAt: schema.jobs.createdAt, status: schema.jobs.status, payload: schema.jobs.payload, result: schema.jobs.result }).from(schema.jobs)
    .where(and(eq(schema.jobs.businessId, bid), eq(schema.jobs.kind, 'brief.scan'), eq(schema.jobs.ref, date), lt(schema.jobs.createdAt, ctx.job.createdAt))).orderBy(desc(schema.jobs.createdAt)) : [];
  if (mode === 'keep') {
    const from = ctx.payload.fromJob ? await getJob(ctx.payload.fromJob) : null;
    cands = ((from?.result as any)?.partialCands || []) as Candidate[];
  } else {
    for (const p of plats) {
      step = p; stats[p] = stats[p] || { read: 0 }; await push();
      try {
        const got = await sourceFor(p)({
          plan, profile, bid, mode, round, sinceMs: Date.now() - WINDOW_MS, newSinceMs: background ? newSinceFor(earlier, p) : undefined,
          onRead: n => { threadsRead += n; stats[p] = { read: (stats[p]?.read || 0) + n }; push().catch(() => {}); },
          setSub: s => { steps = steps.map(x => (x.k === p ? { ...x, sub: s } : x)); push().catch(() => {}); },
        });
        cands.push(...got);
      } catch (e: any) {
        console.error(`[brief.scan] ${p} source failed${background ? ' (background rescan, skipped)' : ''}:`, e?.message || e);
        // A background rescan skips the platform and carries on with the others: no failure UI, today's brief stays.
        if (background) { skippedPlats.push(p); delete stats[p]; continue; }
        await push({ failed: p });
        // Partial results are kept only if the user chooses "Keep this morning’s brief" (only offered when a brief exists).
        const partialCands = existing ? uniqueCands(cands, seen).map(c => ({ c, r: relevance(c.title + ' ' + c.body, plan) })).sort((a, b2) => b2.r - a.r).slice(0, 40).map(x => slim(x.c)) : [];
        return { mode, failed: p, since, partial: partialCands.length, ...({ partialCands } as any) };
      }
    }
  }
  // Every platform failed: nothing was read, so the day (and its "Found at") is left alone; the next rescan tries again.
  if (background && plats.length && skippedPlats.length === plats.length) throw new Error('Every source failed (background rescan)');
  const fresh = uniqueCands(cands, seen).filter(c => plats.includes(c.plat));

  // ── Rank ──
  step = 'rank'; await push();
  const scored: Scored[] = fresh.length ? await rankCandidates(profile, plan, fresh, bid) : [];

  // ── Select: per platform per account, 2 on the first scan and up to 4 for the day on later scans (cap.ts, DBR-8),
  // counting what the day already has. Threads already in the day (either account) are never drafted twice.
  const dayItems = (existing?.items || []) as BriefItem[];
  const capFor = (a: BriefAccount, ps: BriefPlatform[]) => slotsLeft(dayItems, a, ps, mode);
  const fPlats = accts.includes('founder') ? platsFor('founder', plats) : [];
  const cPlats = accts.includes('company') ? platsFor('company', plats) : [];
  // Direct requests for a tool are the company's to answer first (UPDATE-2026-10-20b §2); the founder takes the best of
  // the rest; the company then fills its remaining slots with claims it can speak to. A thread is never drafted twice.
  const cAsks = selectReplies(scored.filter(s => s.asks), cPlats, capFor('company', cPlats), { brand: true });
  const fPicked = selectReplies(scored, fPlats, capFor('founder', fPlats), { skip: new Set(cAsks.map(s => s.id)) });
  const cLeft = Object.fromEntries(cPlats.map(k => [k, (capFor('company', cPlats)[k] ?? 0) - cAsks.filter(s => s.plat === k).length])) as Partial<Record<BriefPlatform, number>>;
  const cPicked = [...cAsks, ...selectReplies(scored, cPlats, cLeft, { brand: true, skip: new Set([...cAsks, ...fPicked].map(s => s.id)) })];

  // ── Draft ──
  step = 'draft'; await push();
  const isAdd = mode !== 'first';
  const fail = (s: Scored) => (e: any) => { console.error('[brief.scan] draft failed', s.id, e?.message); return null; };
  const drafted = await Promise.all([
    ...fPicked.map(s => draftReply(profile, s, settings, bid, isAdd).catch(fail(s))),
    ...cPicked.map(s => draftCompanyReply(profile, s, bid, isAdd).catch(fail(s))),
  ]);
  const replies = drafted.filter(Boolean) as BriefItem[];
  if (fPicked.length + cPicked.length && !replies.length) throw new Error('Drafting failed for every reply');
  const themes = mode === 'first' ? feedThemes(scored) : [];
  const postFail = (e: any) => { console.error('[brief.scan] posts failed', e?.message); return [] as BriefItem[]; };
  const posts = mode === 'first' ? (await Promise.all([
    accts.includes('founder') ? draftPosts(profile, themes, fPlats, bid, date, 'founder').catch(postFail) : [],
    accts.includes('company') && cPlats.length ? draftPosts(profile, themes, cPlats, bid, date, 'company').catch(postFail) : [],
  ])).flat() : [];

  // ── Save ──
  const scannedAt = nowHMIn(b.timezone || 'America/New_York');
  const at = new Date().toISOString();
  const tk = (c: Candidate) => { const k = threadKey(c); return k ? { tk: k } : {}; };
  const marks: CandMark[] = scored.map(s => ({ id: s.id, plat: s.plat, ...tk(s), score: s.score, theme: s.theme, reject: s.reject, at }));
  // Candidates that never reached ranking (pre-filtered) are still "seen" for Scan again.
  for (const c of fresh) if (!marks.find(m => m.id === c.id)) marks.push({ id: c.id, plat: c.plat, ...tk(c), at });
  let addedIds: string[] = [];
  if (mode === 'first') {
    await createDay(bid, date, [...replies, ...posts], marks, scannedAt, stats);
    addedIds = [...replies, ...posts].map(i => i.id);
    await db.update(schema.businesses).set({ briefSetup: true }).where(eq(schema.businesses.id, bid));
  } else {
    addedIds = (await withDay(bid, date, row => {
      const items = row.items as BriefItem[];
      // Re-check the cap under the lock (items may have changed while drafting).
      const add = fitToCap(items, replies, mode);
      return { items: [...add, ...items], candidates: [...((row.candidates || []) as CandMark[]), ...marks], scannedAt: mode === 'keep' ? undefined : scannedAt, stats: mergeStats(row.stats as DayStats, stats), ret: add.map(a => a.id) };
    })) || [];
  }
  step = 'done'; await push();
  // Nobody is watching a background run, so every member gets the toast (silent when nothing was added). `notified` tells
  // a Scan again click that joined the job not to toast a second time.
  const notified = (mode === 'keep' || background) && addedIds.length > 0;
  if (notified) await notify(bid, `${addedIds.length} new ${addedIds.length === 1 ? 'conversation' : 'conversations'} since ${fmtTime(since)}`, { tone: 'signal' });
  return { mode, added: addedIds.length, addedIds, since, ...(notified ? { notified } : {}), ...({ threadsRead, replies: replies.length, posts: posts.length, perPlat: stats, ...(background ? { background, round, skippedPlats } : {}) } as object) };
}
