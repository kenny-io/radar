// visibility.addPrompt (VW-2): a prompt the user adds is collected at once, by a run scoped to that prompt. Scheduled
// collection is weekly, so without this a new prompt would show no data for up to two weeks. The database is not needed
// here; visibility.db.test.ts drives the same action through the real route and job.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ calls: [] as string[], enqueued: [] as any[][], enqueueFails: false }));
vi.mock('../db', () => ({ db: {}, schema: {} }));
vi.mock('@/server/observability/failures', () => ({ reportFailure: async () => {} }));
vi.mock('../jobs/queue', () => ({ enqueue: async (...a: any[]) => { H.calls.push('enqueue'); if (H.enqueueFails) throw new Error('enqueue failed'); H.enqueued.push(a); return 'job-1'; } }));
vi.mock('../services/visibility/collect', () => ({
  addPrompt: async (bid: string, prompt: string) => { H.calls.push(`addPrompt ${bid} ${prompt}`); return 'prompt-9'; },
  ensurePrompts: async () => [],
  listVisibility: async (bid: string) => { H.calls.push(`list ${bid}`); return { prompts: [{ id: 'prompt-9', prompt: 'Best invoicing tool for studios?', source: 'user' }], results: [], lastCollected: null }; },
}));

import { actions } from './visibility';

const def = actions['visibility.addPrompt'];
const ctx = { bid: 'biz-1', role: 'Editor' } as any;
beforeEach(() => { H.calls.length = 0; H.enqueued.length = 0; H.enqueueFails = false; });

describe('visibility.addPrompt', () => {
  it('queues one run for the new prompt alone, after saving it and before reading the grid', async () => {
    const out = await def.run(ctx, { prompt: 'Best invoicing tool for studios?' });
    expect(H.calls).toEqual(['addPrompt biz-1 Best invoicing tool for studios?', 'enqueue', 'list biz-1']);
    expect(H.enqueued).toEqual([['visibility.run', { promptIds: ['prompt-9'] }, { businessId: 'biz-1', ref: 'biz-1', singletonKey: 'vis-prompt:prompt-9' }]]);
    // The response keeps its shape: the new id and the grid.
    expect(Object.keys(out).sort()).toEqual(['id', 'lastCollected', 'prompts', 'results']);
    expect(out.id).toBe('prompt-9');
  });

  it('does not report success when the collection could not be queued', async () => {
    H.enqueueFails = true;
    await expect(def.run(ctx, { prompt: 'Best invoicing tool for studios?' })).rejects.toThrow('enqueue failed');
  });

  it('still takes a trimmed prompt of 6 to 300 characters', () => {
    expect(def.input!.parse({ prompt: '  Which tool?  ' })).toEqual({ prompt: 'Which tool?' });
    expect(def.input!.safeParse({ prompt: ' tool ' }).success).toBe(false);
    expect(def.input!.safeParse({ prompt: 'x'.repeat(301) }).success).toBe(false);
  });
});
