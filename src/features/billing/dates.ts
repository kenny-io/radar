// Trial dates (architecture §9 "Dates", B12). Every date shown on /start-trial comes from the server's ISO instant
// (`trial_end`, or `current_period_end` for a restart), formatted in the browser's time zone. Format after mount only
// (see `DateText` in TrialPage): the server doesn't know the visitor's zone, so formatting during SSR would mismatch.
// `timeZone` is for tests; the page always uses the browser default.

/** "Oct 28" */
export function fmtD(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone }).format(new Date(iso));
}
/** "Wed, Oct 28" */
export function fmtDW(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(new Date(iso));
}
/** Same-width stand-ins rendered invisibly before mount, so the layout doesn't jump when the real date appears. */
export const D_PLACEHOLDER = 'Oct 28';
export const DW_PLACEHOLDER = 'Wed, Oct 28';

/** One calendar month after `from`. Only for the undesigned restart preview row, when the server has no future
 *  period end yet (a canceled subscription restarts today and renews a month later). */
export function addMonthIso(from: Date): string {
  const d = new Date(from.getTime()); const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + 1);
  if (d.getUTCDate() !== day) d.setUTCDate(0); // Jan 31 → Feb 28/29, as Stripe does for monthly billing anchors
  return d.toISOString();
}
