import { beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ biz: {} as any, capture: vi.fn(), reads: 0 }));
vi.mock('@/server/workspace', () => ({ getBiz: async () => { H.reads++; return H.biz; }, bizToday: () => '2026-11-19', socialAutoOf: (b: any) => b.socialAuto }));
vi.mock('@/server/db', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }) }, schema: { socialPacks: { data: {}, businessId: {}, createdAt: {} } } }));
vi.mock('./generate', () => ({ getPack: async () => null, createPack: async (...args: any[]) => { H.capture(...args); await args[3].beforeSave(); return 'created-pack'; } }));
vi.mock('./proactive', () => ({ dailyContext: async () => ({ source: { kind: 'idea', label: 'One item moves through a review.' }, grounding: { brief: 'A generic teaching example.', link: null } }) }));
vi.mock('./media/config', () => ({ mediaEnabled: async () => true }));
vi.mock('../autopilot/guard', () => ({ canRun: async () => true }));
vi.mock('./publish/schedule', () => ({ autoSchedule: vi.fn() }));
import { autoRun } from './auto';
beforeEach(() => { H.capture.mockReset(); H.reads = 0; H.biz = { id: 'synthetic-business', status: 'active', profile: {}, domain: 'example.test', autopilot: { enabled: false }, socialAuto: { on: true, freq: 'daily', days: [], platforms: ['instagram', 'tiktok', 'youtube'], style: 'branded', time: '08:00', post: 'library', videoStyle: 'paper-cut' } }; });
describe('automatic generated-style snapshot', () => {
  it.each(['standalone', 'master'])('%s captures the current business style in every generated platform choice', async mode => {
    if (mode === 'master') { H.biz.autopilot = { enabled: true, activationId: 'accepted-activation' }; H.biz.socialAuto.on = false; }
    await autoRun('synthetic-business', '2026-11-19', mode === 'master' ? 'accepted-activation' : undefined);
    expect(H.capture).toHaveBeenCalledTimes(1);
    expect(H.capture.mock.calls[0][1].media).toEqual([{ platform: 'instagram', format: 'recommended', videoStyle: 'paper-cut' }, { platform: 'tiktok', format: 'video', videoStyle: 'paper-cut' }, { platform: 'youtube', format: 'video', videoStyle: 'paper-cut' }]);
    expect(H.capture.mock.calls[0][1].auto).toBe(true);
    expect(H.reads).toBeGreaterThanOrEqual(3);
  });
  it('defaults an unconfigured legacy business to Drawn without enabling any program', async () => {
    delete H.biz.socialAuto.videoStyle; await autoRun('synthetic-business'); expect(H.capture.mock.calls[0][1].media.every((choice: any) => choice.videoStyle === 'drawn')).toBe(true); expect(H.biz.autopilot.enabled).toBe(false);
  });
});
