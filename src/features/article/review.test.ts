// RL-1 / RL-2: the review pager's order and position, what "Approve and next" opens, and which `back` URLs are followed.
import { describe, expect, it } from 'vitest';
import { DEFAULT_BACK, REVIEW_LIST_URL, afterApprove, articleUrl, reviewList, reviewPos, safeBack } from './review';
import { calendarState } from '@/features/calendar/calendarUrl';

const E = (id: string, date: string, status: string) => ({ id, date, status }) as any;

describe('reviewList', () => {
  it('is the entries in review, by publish date then id, whatever order the calendar holds them in', () => {
    const entries = [E('e_c', '2026-11-14', 'review'), E('e_x', '2026-11-12', 'approved'), E('e_b', '2026-11-12', 'review'), E('e_a', '2026-11-12', 'review'), E('e_d', '2026-11-10', 'scheduled'), E('e_e', '2026-11-11', 'review'), E('e_f', '2026-11-20', 'draft')];
    expect(reviewList(entries)).toEqual(['e_e', 'e_a', 'e_b', 'e_c']);
    expect(reviewList([])).toEqual([]);
  });
});

describe('reviewPos', () => {
  const ids = ['a', 'b', 'c'];
  it('gives the position and the neighbours', () => {
    expect(reviewPos(ids, 'a')).toEqual({ index: 0, total: 3, prev: null, next: 'b' });
    expect(reviewPos(ids, 'b')).toEqual({ index: 1, total: 3, prev: 'a', next: 'c' });
    expect(reviewPos(ids, 'c')).toEqual({ index: 2, total: 3, prev: 'b', next: null });
  });
  it('is null for an article that is not awaiting review (no pager)', () => { expect(reviewPos(ids, 'z')).toBeNull(); expect(reviewPos([], 'a')).toBeNull(); });
  it('the only one waiting is 1 of 1 with nowhere to go', () => { expect(reviewPos(['a'], 'a')).toEqual({ index: 0, total: 1, prev: null, next: null }); });
});

describe('afterApprove ("Approve and next")', () => {
  it('opens the article after the approved one', () => {
    expect(afterApprove(['a', 'b', 'c'], 'a')).toBe('b');
    expect(afterApprove(['a', 'b', 'c'], 'b')).toBe('c');
  });
  it('from the end of the list goes to the first one still waiting', () => { expect(afterApprove(['a', 'b', 'c'], 'c')).toBe('a'); });
  it('is null after the last one: the loop returns to the review list', () => {
    expect(afterApprove(['a'], 'a')).toBeNull();
    expect(REVIEW_LIST_URL).toBe('/calendar?view=list&filter=review');
    // ...and that URL is the calendar's list filtered to review.
    expect(calendarState(new URLSearchParams(REVIEW_LIST_URL.split('?')[1]))).toEqual({ view: 'list', filter: 'review', open: null });
  });
  it('walks a whole review session: 1 of 3, 1 of 2, 1 of 1, done', () => {
    let ids = ['a', 'b', 'c']; let at: string | null = 'a'; const seen: string[] = [];
    while (at) { seen.push(`${at}:${reviewPos(ids, at)!.index + 1} of ${ids.length}`); const next: string | null = afterApprove(ids, at); ids = ids.filter(x => x !== at); at = next; }
    expect(seen).toEqual(['a:1 of 3', 'b:1 of 2', 'c:1 of 1']);
  });
  it('is null for an article that is not in the list', () => { expect(afterApprove(['a', 'b'], 'z')).toBeNull(); });
});

describe('safeBack', () => {
  it('follows the calendar and the dashboard, with or without a query', () => {
    for (const ok of ['/calendar', '/calendar?view=list&filter=review', '/calendar?', '/dashboard', '/dashboard?x=1']) expect(safeBack(ok)).toBe(ok);
  });
  it('falls back to the calendar for anything else', () => {
    const bad = ['//evil.example', '//evil.example/calendar', 'https://evil.example/calendar', 'http://localhost/calendar', '/calendarx', '/calendar/../settings', '/calendar#x', '/dashboards', '/settings', '/article/e_1', 'calendar', ' /calendar', '/calendar\n//evil.example', '/\\evil.example', 'javascript:alert(1)', '', null, undefined, '/calendar?' + 'x'.repeat(600)];
    for (const b of bad) expect(safeBack(b as any)).toBe(DEFAULT_BACK);
    expect(DEFAULT_BACK).toBe('/calendar');
  });
});

describe('articleUrl', () => {
  it('is the plain article URL unless Back should go somewhere else', () => {
    expect(articleUrl('e_1')).toBe('/article/e_1');
    expect(articleUrl('e_1', '/calendar')).toBe('/article/e_1');
    expect(articleUrl('e_1', null)).toBe('/article/e_1');
  });
  it('carries the back path encoded, and it survives the round trip', () => {
    const url = articleUrl('e_1', '/calendar?view=list&filter=review');
    expect(url).toBe('/article/e_1?back=%2Fcalendar%3Fview%3Dlist%26filter%3Dreview');
    expect(safeBack(new URL(url, 'http://t').searchParams.get('back'))).toBe('/calendar?view=list&filter=review');
  });
});
