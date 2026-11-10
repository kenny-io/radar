// OPT-F0 stub, filled by E3 (billing + first session): the first-week run. .factory/first-five-optimizations/architecture.md §1.
import type { BizRow } from '../workspace';
import type { Workspace } from '@/lib/types';

/** Enqueue the calendar, brief and visibility jobs for a business that was just committed, then store their ids. Call after the commit's transaction. */
export async function startFirstRun(bid: string): Promise<void> {}
/** The first-week rows for the Dashboard, or undefined once nothing is queued, running or failed (also when dismissed or older than 7 days). */
export async function firstRunOf(biz: Pick<BizRow, 'id' | 'onboarding'>): Promise<Workspace['firstRun']> {
  return undefined;
}
