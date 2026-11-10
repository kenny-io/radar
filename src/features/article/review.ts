// The review loop (first-five RL-1, RL-2), React-free: which articles are waiting for review and in what order, where one
// of them sits, what opens after an approval, and which `back` URLs the article screen will follow.
import type { CalendarEntry } from '@/lib/types';

/** Where the loop ends: the calendar's list of articles ready for review. */
export const REVIEW_LIST_URL = '/calendar?view=list&filter=review';
export const DEFAULT_BACK = '/calendar';

/** Ids of the articles awaiting review, by publish date, then id (a stable order when two share a date). */
export function reviewList(entries: Pick<CalendarEntry, 'id' | 'date' | 'status'>[]): string[] {
  return entries.filter(e => e.status === 'review').sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(e => e.id);
}

export interface ReviewPos { index: number; total: number; prev: string | null; next: string | null }
/** Where `id` sits in the review list ("2 of 5" is `index + 1` of `total`); null when it is not awaiting review. */
export function reviewPos(ids: string[], id: string): ReviewPos | null {
  const i = ids.indexOf(id);
  return i < 0 ? null : { index: i, total: ids.length, prev: ids[i - 1] ?? null, next: ids[i + 1] ?? null };
}

/** What opens once `id` is approved: the article after it, or, from the end of the list, the first one still waiting
 *  (the reviewer stepped past some). Null when `id` was the last one waiting: the loop returns to the review list. */
export function afterApprove(ids: string[], id: string): string | null {
  const i = ids.indexOf(id); if (i < 0) return null;
  const rest = ids.filter(x => x !== id);
  return rest.length ? rest[i] ?? rest[0] : null;
}

/** `/article/{id}`, plus `?back=<encoded path>` when Back should return somewhere other than the plain calendar. */
export function articleUrl(id: string, back?: string | null): string {
  return `/article/${encodeURIComponent(id)}` + (back && back !== DEFAULT_BACK ? '?back=' + encodeURIComponent(back) : '');
}

const BACK_OK = /^\/(calendar|dashboard)(\?|$)/;
/** The article screen's Back target from `?back=`. Only the app's own calendar and dashboard paths are followed; anything
 *  else (another origin, `//host`, a look-alike path, nothing at all) falls back to the calendar. */
export function safeBack(raw: string | null | undefined): string {
  return typeof raw === 'string' && raw.length <= 512 && BACK_OK.test(raw) ? raw : DEFAULT_BACK;
}
