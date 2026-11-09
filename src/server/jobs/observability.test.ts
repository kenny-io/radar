import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ job: null as any, updates: [] as any[], deliver: vi.fn(async (..._args: any[]) => {}) }));
vi.mock('../db', () => ({
  schema: { jobs: { id: 'id', lockedBy: 'lockedBy', status: 'status' } }, pool: {},
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => state.job ? [state.job] : [] }) }) }),
    update: () => ({ set: (values: any) => ({ where: async () => { state.updates.push(values); return []; } }) }),
  },
}));
vi.mock('../workspace', () => ({ bump: vi.fn(async (..._args: any[]) => {}) }));
vi.mock('../events', () => ({ JOB_OUTCOME: {}, jobProducedOutcome: () => false, trackSoon: vi.fn() }));
vi.mock('../billing/access', () => ({ bizAccess: vi.fn(async () => true) }));
vi.mock('../flags', () => ({ billingFlag: () => false, billingFlagNeedsEmail: () => false }));
vi.mock('../observability/delivery', () => ({ persistAndDeliverAlert: state.deliver }));
import { defineJob, runJobNow } from './queue';
import { reportFailure } from '../observability/failures';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('RADAR_FAILURE_ALERTS', 'on'); vi.stubEnv('RADAR_DEV_STUBS', '0');
  state.updates.length = 0; state.deliver.mockClear();
  state.job = { id: 'job-id', kind: 'test.observability', businessId: 'biz', ref: 'article-id', attempts: 1, maxAttempts: 3, payload: {} };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('job failure observability', () => {
  it('alerts on the first failed attempt before preserving normal retry scheduling', async () => {
    defineJob({ kind: state.job.kind, run: async () => { throw new Error('provider exhausted credits'); } });
    await runJobNow(state.job.id);
    expect(state.deliver).toHaveBeenCalledTimes(1);
    expect(state.deliver.mock.calls[0][0]).toMatchObject({ rootOperation: state.job.kind, context: { businessId: 'biz', ref: 'article-id', jobId: 'job-id', attempt: 1, maxAttempts: 3, retrying: true } });
    expect(state.updates).toContainEqual(expect.objectContaining({ status: 'queued', runAt: expect.any(Date) }));
  });
  it('reports a terminal attempt and retains client-safe failed state', async () => {
    state.job.attempts = 3;
    defineJob({ kind: state.job.kind, run: async () => { throw new Error('internal provider failure'); } });
    await runJobNow(state.job.id);
    expect(state.deliver.mock.calls[0][0]).toMatchObject({ context: { retrying: false } });
    expect(state.updates).toContainEqual(expect.objectContaining({ status: 'failed', error: 'Radar couldn’t finish this. Try again.' }));
  });
  it('does not recursively page for an alert-delivery job failure', async () => {
    state.job.kind = 'observability.alert'; state.job.businessId = null;
    defineJob({ kind: state.job.kind, run: async () => { throw new Error('Resend down'); } }); await runJobNow(state.job.id);
    expect(state.deliver).not.toHaveBeenCalled(); expect(state.updates).toContainEqual(expect.objectContaining({ status: 'queued' }));
  });
  it('deduplicates nested provider errors without swallowing the original job retry', async () => {
    const error = Object.assign(new Error('Provider down'), { status: 503 });
    defineJob({ kind: state.job.kind, run: async () => { await reportFailure(error, { source: 'ai', operation: 'article.outline', provider: 'openrouter' }); throw error; } });
    await runJobNow(state.job.id); expect(state.deliver).toHaveBeenCalledTimes(1); expect(state.updates).toContainEqual(expect.objectContaining({ status: 'queued' }));
  });
});
