import { beforeEach, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => ({ job: null as any }));
vi.mock('./jobs/queue', () => ({ getJob: async () => M.job }));
import { entryFromRow } from './workspace';
import { actions } from './actions/core';
import { PUBLISH_FAILURE_MESSAGE } from '@/lib/publishingFailure';
const error = { http: 422, platform: 'GitHub', source: 'radar', message: 'Private status', hint: 'Private source reason', diagnostic: { code: 'plan-empty', reason: 'Private source reason', path: 'src/private.ts' } };
beforeEach(() => { M.job = { id: 'job-1', businessId: 'business-1', kind: 'publish.entry', status: 'done', progress: { attempt: 1 }, result: { status: 'failed', error }, error: null }; });
describe('publishing response boundaries', () => {
  it('projects workspace calendar rows without changing the stored failure', () => {
    const row: any = { id: 'entry-1', mode: 'refresh', status: 'failed', date: '2026-11-10', publishError: error };
    expect(entryFromRow(row).publishError).toEqual({ http: 0, message: PUBLISH_FAILURE_MESSAGE });
    expect(row.publishError).toBe(error); expect(row.publishError.diagnostic.path).toBe('src/private.ts');
  });
  it('returns generic publishing polling results only to the matching business', async () => {
    const result = await actions['job.get'].run({ bid: 'business-1' } as any, { id: 'job-1' });
    expect(JSON.stringify(result)).not.toContain('Private'); expect(JSON.stringify(result)).not.toContain('plan-empty');
    expect(result).toMatchObject({ result: { status: 'failed', error: { message: PUBLISH_FAILURE_MESSAGE } } });
    expect(await actions['job.get'].run({ bid: 'other-business' } as any, { id: 'job-1' })).toBeNull();
    expect(M.job.result.error).toBe(error);
  });
  it('preserves other job result/error contracts', async () => {
    M.job.kind = 'article.draft';
    const result = await actions['job.get'].run({ bid: 'business-1' } as any, { id: 'job-1' });
    expect(result.result).toBe(M.job.result);
  });
});
