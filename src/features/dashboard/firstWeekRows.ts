// What each first-week row says (first-five architecture §1, FS-2/FS-3). Pure: FirstWeek.tsx renders it, and the wording
// and state rules are tested without a browser. A row is the workspace's `firstRun` item overlaid with the job's live
// state from the event stream. Step wording matches each job's own screen (ContentCalendar `researchPhases`, BriefScan,
// Performance → AI Visibility); those components don't export their labels, so the strings are repeated here.
import { BPLAT } from '@/lib/constants';
import type { BriefPlatform, FirstRunItem, FirstRunKey } from '@/lib/types';

export type RowStatus = FirstRunItem['status'];
/** The job as the event stream (or the workspace's recent-jobs list) last reported it. */
export interface LiveJob { status: RowStatus; progress?: any; error?: string | null; result?: any }
export interface RowCtx {
  /** Search Console is connected (or syncing), as the calendar research sees it. */
  gsc: boolean;
  /** Whose replies the brief drafts (Brief settings → Draft for) and the business name, for the drafting step. */
  draftFor: 'founder' | 'company' | 'both'; name: string;
  /** Proposed topics already in the calendar and items in today's brief, for the done lines. */
  topics: number; briefItems: number;
}
export interface FirstWeekRow {
  key: FirstRunKey; title: string; page: 'calendar' | 'brief' | 'performance'; open: string;
  status: RowStatus; label: string; tone: 'mute' | 'signal' | 'ok' | 'bad';
  /** One line under the title: the live step, what is ready, or what failed. */
  detail: string;
  /** Short progress note beside the step while working ("Step 3 of 7", "1,240 threads read", "4 of 20"). */
  meta: string | null;
  /** 0–1 while working and measurable, else null. */
  pct: number | null;
}

const META: Record<FirstRunKey, Pick<FirstWeekRow, 'title' | 'page' | 'open'> & { failed: string; start: string }> = {
  calendar: { title: 'Content calendar', page: 'calendar', open: 'Open the content calendar', failed: 'Radar couldn’t build your content calendar.', start: 'Radar couldn’t start your content calendar.' },
  brief: { title: 'Daily Brief', page: 'brief', open: 'Open the Daily Brief', failed: 'Radar couldn’t finish today’s Daily Brief.', start: 'Radar couldn’t start today’s Daily Brief.' },
  visibility: { title: 'AI visibility', page: 'performance', open: 'Open AI visibility', failed: 'Radar couldn’t check your AI visibility.', start: 'Radar couldn’t start your AI visibility check.' },
};
const LABEL: Record<RowStatus, [string, FirstWeekRow['tone']]> = { queued: ['Queued', 'mute'], running: ['Working', 'signal'], done: ['Done', 'ok'], failed: ['Failed', 'bad'] };
/** The queue's catch-all messages: they add nothing to the row's own sentence. */
const GENERIC = /^Radar couldn’t (finish|start) this\./;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The row's current job state: the workspace's verdict once it is final (it also knows a brief scan that ended with a
 *  failed source, and a failure that a later run fixed); otherwise the live job, which is ahead of the last refetch. */
export function mergeLive(item: FirstRunItem, live?: LiveJob | null): { status: RowStatus; progress: any; error: string | null } {
  if (!live || item.status === 'done' || item.status === 'failed') return { status: item.status, progress: item.progress, error: item.error };
  if (live.status === 'failed') return { status: 'failed', progress: live.progress ?? item.progress, error: live.error || null };
  // A brief scan reports a source that didn't respond as `done` with result.failed (the user decides what to do).
  if (item.key === 'brief' && live.status === 'done' && live.result?.failed && !live.result?.dismissed)
    return { status: 'failed', progress: live.progress ?? item.progress, error: `${BPLAT[live.result.failed as BriefPlatform] || 'A source'} didn’t respond, so today’s brief isn’t ready.` };
  return { status: live.status, progress: live.progress ?? item.progress, error: null };
}

const CAL_STEPS = ['Reading your Business Profile', 'Starting from your target keywords', 'Reviewing existing content', 'Pulling Search Console queries', 'Researching keywords', 'Clustering and checking competition', 'Scheduling articles'];
function working(key: FirstRunKey, p: any, c: RowCtx): Pick<FirstWeekRow, 'detail' | 'meta' | 'pct'> {
  if (key === 'calendar') {
    const i = Math.max(0, Math.min(CAL_STEPS.length - 1, Math.floor(n(p?.phase))));
    // Without Search Console that step has nothing to pull; the research moves straight on.
    const label = i === 3 && !(p?.gsc ?? c.gsc) ? CAL_STEPS[4] : CAL_STEPS[i];
    return { detail: label, meta: `Step ${i + 1} of ${CAL_STEPS.length}`, pct: clamp(i / CAL_STEPS.length) };
  }
  if (key === 'brief') {
    const steps: { k: string }[] = Array.isArray(p?.steps) ? p.steps : [];
    const k: string | undefined = p?.step;
    const i = k === 'done' ? steps.length : Math.max(0, steps.findIndex(s => s.k === k));
    const detail = !k ? 'Reading today’s conversations'
      : BPLAT[k as BriefPlatform] ? `Reading ${BPLAT[k as BriefPlatform]}`
      : k === 'rank' ? 'Choosing what’s worth your time'
      : c.draftFor === 'both' ? `Drafting for you and ${c.name}` : c.draftFor === 'company' ? `Drafting for ${c.name}` : 'Drafting in your voice';
    const read = n(p?.threadsRead);
    return { detail, meta: read ? `${read.toLocaleString('en-US')} threads read` : null, pct: steps.length ? clamp(i / steps.length) : null };
  }
  const total = n(p?.total), done = n(p?.done);
  return total ? { detail: 'Collecting responses', meta: `${done} of ${total}`, pct: clamp(done / total) } : { detail: 'Building prompts from your target keywords', meta: null, pct: null };
}

function ready(key: FirstRunKey, c: RowCtx): string {
  if (key === 'calendar') return c.topics ? `${c.topics} article ${c.topics === 1 ? 'topic' : 'topics'} ready to review.` : 'Ready to review.';
  if (key === 'brief') return c.briefItems ? `${c.briefItems} ${c.briefItems === 1 ? 'draft' : 'drafts'} ready in today’s brief.` : 'Today’s brief is ready.';
  return 'Ready to view.';
}

export function firstWeekRow(item: FirstRunItem, live: LiveJob | null | undefined, c: RowCtx): FirstWeekRow {
  const m = META[item.key]; const s = mergeLive(item, live);
  const [label, tone] = LABEL[s.status];
  const base = { key: item.key, title: m.title, page: m.page, open: m.open, status: s.status, label, tone };
  if (s.status === 'running') return { ...base, ...working(item.key, s.progress, c) };
  if (s.status === 'queued') return { ...base, detail: 'Waiting to start.', meta: null, pct: null };
  if (s.status === 'done') return { ...base, detail: ready(item.key, c), meta: null, pct: null };
  // What failed, in the row's own words, then the reason when the job gave a specific one.
  const never = !item.jobId;
  const why = s.error && !GENERIC.test(s.error) ? ' ' + s.error : '';
  return { ...base, detail: (never ? m.start : m.failed) + why, meta: null, pct: null };
}

/** The page's state from its rows: still working, or stopped with something to retry. */
export function firstWeekSummary(rows: Pick<FirstWeekRow, 'status'>[]) {
  const count = (s: RowStatus) => rows.filter(r => r.status === s).length;
  const active = count('queued') + count('running'), failed = count('failed'), done = count('done');
  return { active, failed, done, total: rows.length, canDismiss: !active && failed > 0 };
}
