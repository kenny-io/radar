// What the first-week rows say (FS-2, FS-3): the workspace item overlaid with the live job, in the words each job's own
// screen uses. The component only renders what these return.
import { describe, expect, it } from 'vitest';
import type { FirstRunItem } from '@/lib/types';
import { firstWeekRow, firstWeekSummary, mergeLive, type RowCtx } from './firstWeekRows';

const C: RowCtx = { gsc: true, draftFor: 'founder', name: 'Fieldnote', topics: 0, briefItems: 0 };
const item = (key: FirstRunItem['key'], status: FirstRunItem['status'], o: Partial<FirstRunItem> = {}): FirstRunItem => ({ key, jobId: 'job-' + key, status, progress: null, error: null, ...o });

describe('first-week rows', () => {
  it('each row names its screen and links to it in every state', () => {
    for (const status of ['queued', 'running', 'done', 'failed'] as const) {
      expect(firstWeekRow(item('calendar', status), null, C)).toMatchObject({ title: 'Content calendar', page: 'calendar', open: 'Open the content calendar' });
      expect(firstWeekRow(item('brief', status), null, C)).toMatchObject({ title: 'Daily Brief', page: 'brief', open: 'Open the Daily Brief' });
      expect(firstWeekRow(item('visibility', status), null, C)).toMatchObject({ title: 'AI visibility', page: 'performance', open: 'Open AI visibility' });
    }
  });

  it('status is a word as well as a colour', () => {
    expect(['queued', 'running', 'done', 'failed'].map(s => { const r = firstWeekRow(item('calendar', s as any), null, C); return [r.label, r.tone]; }))
      .toEqual([['Queued', 'mute'], ['Working', 'signal'], ['Done', 'ok'], ['Failed', 'bad']]);
    expect(firstWeekRow(item('brief', 'queued'), null, C)).toMatchObject({ detail: 'Waiting to start.', meta: null, pct: null });
  });

  it('calendar: the research step in the calendar’s own words, with its position', () => {
    const at = (phase: number, c = C, extra: any = {}) => firstWeekRow(item('calendar', 'running', { progress: { phase, results: [], ...extra } }), null, c);
    expect(at(0)).toMatchObject({ detail: 'Reading your Business Profile', meta: 'Step 1 of 7', pct: 0 });
    expect(at(3)).toMatchObject({ detail: 'Pulling Search Console queries', meta: 'Step 4 of 7' });
    expect(at(4).detail).toBe('Researching keywords');
    expect(at(6)).toMatchObject({ detail: 'Scheduling articles', meta: 'Step 7 of 7' });
    expect(at(6).pct).toBeCloseTo(6 / 7);
    // Search Console not connected: that step has nothing to pull. The job's own flag wins over the workspace's.
    expect(at(3, { ...C, gsc: false }).detail).toBe('Researching keywords');
    expect(at(3, { ...C, gsc: false }, { gsc: true }).detail).toBe('Pulling Search Console queries');
    expect(at(3, C, { gsc: false }).detail).toBe('Researching keywords');
    // No progress written yet, or a value out of range: still a sensible line.
    expect(firstWeekRow(item('calendar', 'running'), null, C)).toMatchObject({ detail: 'Reading your Business Profile', meta: 'Step 1 of 7' });
    expect(at(99)).toMatchObject({ detail: 'Scheduling articles', meta: 'Step 7 of 7' });
  });

  it('brief: reading each platform, choosing, drafting for whoever the brief drafts for, with threads read', () => {
    const steps = [{ k: 'reddit', sub: '' }, { k: 'x', sub: '' }, { k: 'hn', sub: '' }, { k: 'rank', sub: '' }, { k: 'draft', sub: '' }];
    const at = (step: string, threadsRead: number, c = C) => firstWeekRow(item('brief', 'running', { progress: { step, threadsRead, steps } }), null, c);
    expect(at('reddit', 0)).toMatchObject({ detail: 'Reading Reddit', meta: null, pct: 0 });
    expect(at('hn', 1240)).toMatchObject({ detail: 'Reading Hacker News', meta: '1,240 threads read' });
    expect(at('hn', 1240).pct).toBeCloseTo(2 / 5);
    expect(at('rank', 1800).detail).toBe('Choosing what’s worth your time');
    expect(at('draft', 1800).detail).toBe('Drafting in your voice');
    expect(at('draft', 1800, { ...C, draftFor: 'both' }).detail).toBe('Drafting for you and Fieldnote');
    expect(at('draft', 1800, { ...C, draftFor: 'company' }).detail).toBe('Drafting for Fieldnote');
    expect(at('done', 1800).pct).toBe(1);
    expect(firstWeekRow(item('brief', 'running'), null, C)).toMatchObject({ detail: 'Reading today’s conversations', meta: null, pct: null });
  });

  it('visibility: prompts first, then responses counted', () => {
    expect(firstWeekRow(item('visibility', 'running'), null, C)).toMatchObject({ detail: 'Building prompts from your target keywords', meta: null, pct: null });
    expect(firstWeekRow(item('visibility', 'running', { progress: { done: 4, total: 20 } }), null, C)).toMatchObject({ detail: 'Collecting responses', meta: '4 of 20', pct: 0.2 });
    expect(firstWeekRow(item('visibility', 'running', { progress: { done: 25, total: 20 } }), null, C).pct).toBe(1);
  });

  it('done rows say what is ready, with counts only when the workspace has them', () => {
    expect(firstWeekRow(item('calendar', 'done'), null, C).detail).toBe('Ready to review.');
    expect(firstWeekRow(item('calendar', 'done'), null, { ...C, topics: 30 }).detail).toBe('30 article topics ready to review.');
    expect(firstWeekRow(item('calendar', 'done'), null, { ...C, topics: 1 }).detail).toBe('1 article topic ready to review.');
    expect(firstWeekRow(item('brief', 'done'), null, { ...C, briefItems: 8 }).detail).toBe('8 drafts ready in today’s brief.');
    expect(firstWeekRow(item('brief', 'done'), null, C).detail).toBe('Today’s brief is ready.');
    expect(firstWeekRow(item('visibility', 'done'), null, C).detail).toBe('Ready to view.');
  });

  it('a failed row says what failed in plain words, adds a specific reason, and never repeats a catch-all', () => {
    const failed = (key: FirstRunItem['key'], error: string | null, o: Partial<FirstRunItem> = {}) => firstWeekRow(item(key, 'failed', { error, ...o }), null, C).detail;
    expect(failed('calendar', 'Radar couldn’t finish this. Try again.')).toBe('Radar couldn’t build your content calendar.');
    expect(failed('visibility', 'Radar couldn’t finish this. Try again.')).toBe('Radar couldn’t check your AI visibility.');
    expect(failed('brief', 'Reddit didn’t respond, so today’s brief isn’t ready.')).toBe('Radar couldn’t finish today’s Daily Brief. Reddit didn’t respond, so today’s brief isn’t ready.');
    expect(failed('calendar', 'Add at least one target keyword first.')).toBe('Radar couldn’t build your content calendar. Add at least one target keyword first.');
    expect(failed('calendar', null)).toBe('Radar couldn’t build your content calendar.');
    // Never queued at all.
    expect(failed('brief', 'Radar couldn’t start this.', { jobId: null })).toBe('Radar couldn’t start today’s Daily Brief.');
    expect(failed('visibility', 'Radar couldn’t start this.', { jobId: null })).toBe('Radar couldn’t start your AI visibility check.');
    for (const key of ['calendar', 'brief', 'visibility'] as const) expect(failed(key, 'Radar couldn’t finish this. Try again.')).not.toMatch(/job|queue|calendar\.generate|brief\.scan|visibility\.run|GPT|Claude|model/i);
  });
});

describe('live job over the workspace item', () => {
  it('a working row follows the stream: progress, then done, before the workspace is refetched', () => {
    const it0 = item('calendar', 'queued');
    expect(mergeLive(it0, null)).toEqual({ status: 'queued', progress: null, error: null });
    expect(mergeLive(it0, { status: 'running', progress: { phase: 2 } })).toEqual({ status: 'running', progress: { phase: 2 }, error: null });
    expect(firstWeekRow(it0, { status: 'running', progress: { phase: 2 } }, C)).toMatchObject({ status: 'running', label: 'Working', detail: 'Reviewing existing content' });
    expect(firstWeekRow(it0, { status: 'done', progress: { phase: 6 }, result: { generatedAt: 'x' } }, C)).toMatchObject({ status: 'done', label: 'Done' });
    // Live progress missing (the job was only just claimed): keep what the workspace had.
    expect(mergeLive(item('visibility', 'running', { progress: { done: 3, total: 9 } }), { status: 'running', progress: null }).progress).toEqual({ done: 3, total: 9 });
  });

  it('a job that fails on the stream is a failed row at once, with its message', () => {
    expect(firstWeekRow(item('visibility', 'running'), { status: 'failed', error: 'Radar couldn’t finish this. Try again.' }, C)).toMatchObject({ status: 'failed', label: 'Failed', detail: 'Radar couldn’t check your AI visibility.' });
  });

  it('a brief scan that ends "done" with a failed source is a failed row, unless it was dismissed', () => {
    const live = { status: 'done' as const, progress: { step: 'x' }, result: { mode: 'first', failed: 'x' } };
    expect(firstWeekRow(item('brief', 'running'), live, C)).toMatchObject({ status: 'failed', detail: 'Radar couldn’t finish today’s Daily Brief. X didn’t respond, so today’s brief isn’t ready.' });
    expect(mergeLive(item('brief', 'running'), { ...live, result: { ...live.result, dismissed: true } }).status).toBe('done');
    expect(mergeLive(item('calendar', 'running'), { status: 'done', result: { failed: 'x' } }).status).toBe('done');   // only the brief reports this way
  });

  it('the workspace’s final verdict wins over an older stream entry', () => {
    // The server cleared this failure because a later run succeeded; a stale failed entry for the same id must not bring it back.
    expect(mergeLive(item('calendar', 'done'), { status: 'failed', error: 'old' })).toEqual({ status: 'done', progress: null, error: null });
    expect(mergeLive(item('brief', 'failed', { error: 'Reddit didn’t respond, so today’s brief isn’t ready.' }), { status: 'done', result: {} })).toMatchObject({ status: 'failed' });
  });
});

describe('page state', () => {
  const rows = (...s: FirstRunItem['status'][]) => s.map(status => ({ status }));
  it('counts what is working, done and failed; Dismiss only when nothing is working and something failed', () => {
    expect(firstWeekSummary(rows('queued', 'running', 'done'))).toEqual({ active: 2, failed: 0, done: 1, total: 3, canDismiss: false });
    expect(firstWeekSummary(rows('running', 'failed', 'done'))).toMatchObject({ active: 1, failed: 1, canDismiss: false });
    expect(firstWeekSummary(rows('done', 'failed', 'done'))).toMatchObject({ active: 0, failed: 1, done: 2, canDismiss: true });
    expect(firstWeekSummary(rows('failed', 'failed', 'failed'))).toMatchObject({ canDismiss: true });
    expect(firstWeekSummary(rows('done', 'done', 'done'))).toMatchObject({ active: 0, failed: 0, canDismiss: false });
  });
});
