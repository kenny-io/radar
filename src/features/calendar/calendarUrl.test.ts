// RL-2: the calendar's view, filter and open entry are the URL.
import { describe, expect, it } from 'vitest';
import { CAL_FILTERS, calendarParams, calendarState, calendarUrl, type CalState } from './calendarUrl';

const fromUrl = (url: string) => calendarState(new URLSearchParams(url.split('?')[1] || ''));

describe('calendar URL state', () => {
  it('a plain /calendar is the default state, and the default state is a plain /calendar', () => {
    expect(fromUrl('/calendar')).toEqual({ view: 'calendar', filter: 'all', open: null });
    expect(calendarUrl({ view: 'calendar', filter: 'all', open: null })).toBe('/calendar');
    expect(calendarUrl({})).toBe('/calendar');
  });
  it('writes only what differs from the defaults, in a fixed order', () => {
    expect(calendarUrl({ view: 'list' })).toBe('/calendar?view=list');
    expect(calendarUrl({ view: 'list', filter: 'review' })).toBe('/calendar?view=list&filter=review');
    expect(calendarUrl({ open: 'e_1', filter: 'review', view: 'list' })).toBe('/calendar?view=list&filter=review&open=e_1');
    expect(calendarUrl({ view: 'calendar', filter: 'all', open: 'e_1' })).toBe('/calendar?open=e_1');
    expect(calendarParams({ view: 'calendar', filter: 'approved', open: null })).toEqual({ filter: 'approved' });
  });
  it('every state survives the round trip through the URL', () => {
    const states: CalState[] = [];
    for (const view of ['calendar', 'list'] as const) for (const filter of CAL_FILTERS) for (const open of [null, 'e_abc', 'e with space&=?']) states.push({ view, filter, open });
    for (const s of states) expect(fromUrl(calendarUrl(s))).toEqual(s);
  });
  it('reads the app’s route params too (the shape `route.params` has)', () => {
    expect(calendarState({ view: 'list', filter: 'review', open: 'e_1' })).toEqual({ view: 'list', filter: 'review', open: 'e_1' });
    expect(calendarState(null)).toEqual({ view: 'calendar', filter: 'all', open: null });
    // `route.params` turns "1" into true; that is not an entry id.
    expect(calendarState({ open: true, setup: true })).toEqual({ view: 'calendar', filter: 'all', open: null });
  });
  it('ignores values it does not know', () => {
    expect(fromUrl('/calendar?view=grid&filter=everything')).toEqual({ view: 'calendar', filter: 'all', open: null });
    expect(fromUrl('/calendar?view=LIST&filter=Review&open=')).toEqual({ view: 'calendar', filter: 'all', open: null });
  });
});
