// The calendar's view, filter and open entry live in the URL (first-five RL-2): /calendar?view=list&filter=review&open=<id>.
// React-free. Defaults (calendar view, all, nothing open) are left out, so a plain /calendar is the default state.
export type CalView = 'calendar' | 'list';
export const CAL_FILTERS = ['all', 'proposed', 'review', 'approved'] as const;
export type CalFilter = typeof CAL_FILTERS[number];
export interface CalState { view: CalView; filter: CalFilter; open: string | null }

/** Read the state from route params or a query string. Unknown values fall back to the defaults. */
export function calendarState(params: Record<string, unknown> | URLSearchParams | null | undefined): CalState {
  const get = (k: string): unknown => (params instanceof URLSearchParams ? params.get(k) : params?.[k]);
  const filter = CAL_FILTERS.find(f => f === get('filter')) || 'all'; const open = get('open');
  return { view: get('view') === 'list' ? 'list' : 'calendar', filter, open: typeof open === 'string' && open ? open : null };
}

/** The params that go in the URL for `s`, in a fixed order; defaults are omitted. */
export function calendarParams(s: Partial<CalState>): { view?: 'list'; filter?: CalFilter; open?: string } {
  return { ...(s.view === 'list' ? { view: 'list' as const } : {}), ...(s.filter && s.filter !== 'all' ? { filter: s.filter } : {}), ...(s.open ? { open: s.open } : {}) };
}

export function calendarUrl(s: Partial<CalState>): string {
  const q = new URLSearchParams(calendarParams(s)).toString();
  return '/calendar' + (q ? '?' + q : '');
}
