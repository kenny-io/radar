import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  report: vi.fn(async () => {}),
  source: vi.fn(),
  getDay: vi.fn(),
}));
vi.mock('@/server/observability/failures', () => ({ reportFailure: H.report }));
vi.mock('@/server/workspace', () => ({
  getBiz: async () => ({ id: 'business-1', domain: 'example.test', timezone: 'UTC', profile: {
    business: { name: 'Test', description: 'Example', offerings: [], differentiators: [] },
    audience: { segments: [], needs: [], buyers: [], competitors: [] },
    keywords: { list: [] }, brand: { primary: '#111111', secondary: '#eeeeee', markets: [], language: 'English' },
  } }),
  briefSettingsOf: () => ({ platforms: ['linkedin'], accounts: ['founder'] }),
  bizToday: () => '2026-11-09',
}));
vi.mock('./sources', () => ({ sourceFor: () => H.source }));
vi.mock('./store', () => ({ getDay: H.getDay, createDay: vi.fn(), mergeStats: vi.fn(), withDay: vi.fn() }));
vi.mock('@/server/db', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [] }) }) }) }, schema: { jobs: {} } }));
vi.mock('@/server/jobs/queue', () => ({ getJob: vi.fn() }));
vi.mock('@/server/notify', () => ({ notify: vi.fn() }));
vi.mock('./stubs', () => ({}));
vi.mock('./rank', () => ({ rankCandidates: vi.fn(), selectReplies: vi.fn() }));
vi.mock('./draft', () => ({ draftCompanyReply: vi.fn(), draftPosts: vi.fn(), draftReply: vi.fn(), feedThemes: vi.fn() }));
vi.mock('../autopilot/guard', () => ({ canRun: vi.fn(async () => true) }));

import { runScan } from './scan';

const context = (background = false) => ({
  businessId: 'business-1', payload: { mode: 'first', date: '2026-11-09', background },
  job: { id: 'job-1', createdAt: new Date('2026-11-09T08:00:00Z') }, attempt: 1,
  progress: vi.fn(async () => {}), touch: vi.fn(async () => {}),
} as any);

beforeEach(() => { H.report.mockClear(); H.source.mockReset(); H.getDay.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('handled Daily Brief failures', () => {
  it('reports a source failure before returning the existing manual failure state', async () => {
    const failure = new Error('provider HTTP 402 insufficient credits');
    H.getDay.mockResolvedValue(null); H.source.mockRejectedValue(failure);
    const ctx = context();
    await expect(runScan(ctx)).resolves.toMatchObject({ mode: 'first', failed: 'linkedin', partial: 0 });
    expect(H.report).toHaveBeenCalledWith(failure, { source: 'brief', operation: 'brief.source', businessId: 'business-1', ref: '2026-11-09', provider: 'linkedin', degraded: false });
    expect(ctx.progress).toHaveBeenCalledWith(expect.objectContaining({ failed: 'linkedin' }));
  });

  it('reports a skipped background source even when the parent has no manual failure UI', async () => {
    const failure = new Error('provider downtime');
    H.getDay.mockResolvedValue({ items: [], candidates: [], scannedAt: '06:00' }); H.source.mockRejectedValue(failure);
    const ctx = context(true);
    await expect(runScan(ctx)).rejects.toThrow('Every source failed');
    expect(H.report).toHaveBeenCalledWith(failure, expect.objectContaining({ operation: 'brief.source', degraded: true }));
    expect(ctx.progress.mock.calls.some(([value]: any[]) => value.failed)).toBe(false);
  });
});
