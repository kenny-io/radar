import { beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ report: vi.fn(async (_error: unknown, _context: unknown) => {}), schedule: vi.fn(), saved: null as string | null, created: vi.fn(), biz: { id: 'business-1', status: 'active', domain: 'example.test', profile: {}, socialAuto: { on: true, platforms: ['x'], freq: 'daily', days: [], style: 'branded', post: 'schedule' } } }));
vi.mock('@/server/observability/failures', () => ({ reportFailure: H.report }));
vi.mock('../../db', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }) }, schema: { socialPacks: {} } }));
vi.mock('../../workspace', () => ({ getBiz: async () => H.biz, socialAutoOf: (b: any) => b.socialAuto, bizToday: () => '2026-11-10' }));
vi.mock('../autopilot/policy', () => ({ autopilotOf: () => ({ enabled: false }), effectiveSocial: (s: any) => s }));
vi.mock('../autopilot/guard', () => ({ canRun: async () => true }));
vi.mock('./publish/schedule', () => ({ autoSchedule: H.schedule }));
vi.mock('./proactive', () => ({ dailyContext: async () => ({ source: { kind: 'suggest', label: 'Topic' }, grounding: { headline: 'Topic', brief: 'Grounding' }, context: 'Context', recent: '' }) }));
vi.mock('./generate', () => ({
  getPack: async () => H.saved ? { id: H.saved } : null,
  createPack: async (_bid: string, _input: unknown, _progress: unknown, opts: any) => { await opts.beforeSave(); H.created(); H.saved = opts.id; return opts.id; },
}));
import { autoRun } from './auto';

beforeEach(() => { H.report.mockClear(); H.schedule.mockReset(); H.created.mockClear(); H.saved = null; });

describe('automatic social scheduling failure', () => {
  it('reports a failed requested schedule while returning and retaining its saved draft', async () => {
    const failure = new Error('schedule database unavailable'); H.schedule.mockRejectedValue(failure);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const saved = await autoRun('business-1', '2026-11-10');
    expect(saved).toBe('auto-business-1-2026-11-10');
    expect(H.report).toHaveBeenCalledExactlyOnceWith(failure, { source: 'social', operation: 'social.autoSchedule', businessId: 'business-1', ref: saved, degraded: true });
    expect(H.saved).toBe(saved);
    await expect(autoRun('business-1', '2026-11-10')).resolves.toBe(saved);
    expect(H.created).toHaveBeenCalledTimes(1); expect(H.schedule).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
