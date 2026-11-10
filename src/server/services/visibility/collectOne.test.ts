// What collectOne reports about one cell (no database: the queries are faked). `collected` is true only when this call
// stored a new measurement. A failure after an earlier success still returns the earlier status, which is what the
// grid shows, but it is not a collection: the run that made it must not be counted as having collected anything.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ selects: [] as any[][], writes: [] as [string, any][], answer: (): any => ({ text: '', cites: [], raw: null }) }));
vi.mock('../../db', async orig => {
  const real = await orig<typeof import('../../db')>();
  /** Any chain of query-builder calls, resolving to `result` when awaited. */
  const chain = (result: any): any => new Proxy(function () {}, { get: (_t, k) => k === 'then' ? (res: any, rej: any) => Promise.resolve(result).then(res, rej) : () => chain(result) });
  const db: any = {
    select: () => chain(H.selects.shift() ?? []),
    update: () => ({ set: (v: any) => { H.writes.push(['update', v]); return chain(undefined); } }),
    insert: () => ({ values: (v: any) => { H.writes.push(['insert', v]); return chain(undefined); } }),
    transaction: async (fn: any) => fn(db),
  };
  return { ...real, db };
});
vi.mock('../../workspace', () => ({ getBiz: async () => ({ id: 'biz-1', domain: 'fieldnote.test', timezone: 'UTC', profile: { business: { name: 'Fieldnote' }, audience: { competitors: ['Tallyhour'] } } }), bizToday: () => '2026-11-15' }));
vi.mock('@/server/events', () => ({ trackSoon: () => {} }));
vi.mock('@/server/observability/failures', () => ({ reportFailure: async () => {} }));
vi.mock('./engines', async orig => ({ ...(await orig<typeof import('./engines')>()), askEngine: async () => H.answer() }));

import { collectOne } from './collect';
import { EngineUnavailable } from './engines';

/** The cell as stored before this call. */
const cell = (status: 'mentioned' | 'not-mentioned' | 'not-collected') => [{ r: { id: 'cell-1', businessId: 'biz-1', promptId: 'prompt-1', engine: 'ChatGPT', status }, prompt: 'Best time tracker for designers?' }];
const run = (before: Parameters<typeof cell>[0]) => { H.selects = [cell(before), []]; return collectOne('cell-1', { manual: false, series: 's' }); };
const statusWritten = () => H.writes.filter(([op, v]) => op === 'update' && 'status' in v).map(([, v]) => v.status);
const observed = () => H.writes.filter(([op]) => op === 'insert').map(([, v]) => v.status);
beforeEach(() => { H.writes = []; vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('collectOne: what counts as collected', () => {
  it('an answer was stored: collected, whether or not the business is in it', async () => {
    H.answer = () => ({ text: 'Popular options include Tallyhour and Billable.', cites: [], raw: null });
    expect(await run('not-collected')).toEqual({ status: 'not-mentioned', collected: true });
    expect([statusWritten(), observed()]).toEqual([['not-mentioned'], ['not-mentioned']]);
    H.writes = [];
    expect(await run('mentioned')).toEqual({ status: 'not-mentioned', collected: true });   // a new measurement replaces the old one
  });

  it('the assistant failed after an earlier success: the earlier status is returned, and nothing was collected', async () => {
    H.answer = () => { throw new Error('insufficient credit'); };
    for (const before of ['mentioned', 'not-mentioned'] as const) {
      H.writes = [];
      expect(await run(before)).toEqual({ status: before, collected: false });
      expect(statusWritten()).toEqual([]);                        // the cell keeps its measurement
      expect(H.writes.filter(([op]) => op === 'update').map(([, v]) => v.error)).toEqual(['insufficient credit']);
      expect(observed()).toEqual(['not-collected']);              // and the history records a failed attempt
    }
  });

  it('nothing was collected: a first failure, an empty answer, an assistant that is not configured, a cell that is gone', async () => {
    H.answer = () => { throw new Error('insufficient credit'); };
    expect(await run('not-collected')).toEqual({ status: 'not-collected', collected: false });
    H.answer = () => ({ text: '   ', cites: [], raw: null });
    expect(await run('not-collected')).toEqual({ status: 'not-collected', collected: false });
    H.answer = () => { throw new EngineUnavailable('ChatGPT'); };
    expect(await run('mentioned')).toEqual({ status: 'mentioned', collected: false });
    H.selects = [[]];
    expect(await collectOne('gone', { manual: false, series: 's' })).toEqual({ status: 'not-collected', collected: false });
  });
});
