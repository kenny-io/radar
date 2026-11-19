import { beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ biz: {} as any, pack: {} as any, access: true, authorized: true, schedule: vi.fn(), enqueue: vi.fn() }));
vi.mock('@/server/workspace', () => ({ getBiz: async () => H.biz, bizToday: () => '2026-11-19', socialAutoOf: (b: any) => b.socialAuto }));
vi.mock('./generate', () => ({ getPack: async () => H.pack, createPack: vi.fn() }));
vi.mock('./proactive', () => ({ dailyContext: vi.fn() }));
vi.mock('./publish/schedule', () => ({ autoSchedule: H.schedule }));
vi.mock('@/server/jobs/queue', () => ({ enqueue: H.enqueue }));
vi.mock('@/server/billing/access', () => ({ bizAccess: async () => H.access }));
vi.mock('../autopilot/guard', () => ({ canRun: async () => H.authorized }));
import { dailyPackId, mediaReady } from './auto';

const BID = 'business-a'; const ID = dailyPackId(BID, '2026-11-19');
const options = { generateRecommended: true, autoDate: '2026-11-19' };
beforeEach(() => {
  H.schedule.mockReset(); H.enqueue.mockReset(); H.access = true; H.authorized = true;
  H.biz = { id: BID, status: 'active', socialAuto: { on: true, generateMedia: true, post: 'schedule', platforms: ['instagram'], freq: 'daily', days: [], time: '08:00' }, autopilot: {} };
  H.pack = { id: ID, auto: true, posts: { instagram: { text: 'An explanation', mediaGeneration: { status: 'ready' } } } };
});
describe('automatic media completion', () => {
  it('schedules only missing posts on currently selected platforms for the configured automatic marketing strategy', async () => {
    await mediaReady(BID, ID, options);
    expect(H.schedule).toHaveBeenCalledExactlyOnceWith(BID, ID, { onlyMissing: true, platforms: ['instagram'] });
    expect(H.enqueue).not.toHaveBeenCalled();
  });
  it.each(['manual', 'paused', 'deleted', 'unpaid', 'old_date', 'custom_day_removed', 'another_target_running'] as const)('does not schedule after %s', async state => {
    let input = options;
    if (state === 'manual') H.pack.auto = false;
    if (state === 'paused') H.biz.socialAuto.on = false;
    if (state === 'deleted') H.biz.status = 'deleted';
    if (state === 'unpaid') H.access = false;
    if (state === 'old_date') input = { ...options, autoDate: '2026-11-18' };
    if (state === 'custom_day_removed') H.biz.socialAuto = { ...H.biz.socialAuto, freq: 'custom', days: ['Mon'] };
    if (state === 'another_target_running') H.pack.posts.tiktok = { mediaGeneration: { status: 'narrating' } };
    await mediaReady(BID, ID, input);
    expect(H.schedule).not.toHaveBeenCalled(); expect(H.enqueue).not.toHaveBeenCalled();
  });
  it('generates media as part of the strategy without a separate legacy media toggle', async () => {
    delete H.biz.socialAuto.generateMedia;
    await mediaReady(BID, ID, options);
    expect(H.schedule).toHaveBeenCalledExactlyOnceWith(BID, ID, { onlyMissing: true, platforms: ['instagram'] });
  });
  it('resumes the same Autopilot activation instead of creating standalone schedules', async () => {
    H.biz.autopilot = { enabled: true, activationId: 'activation-a' }; H.biz.socialAuto.on = false;
    await mediaReady(BID, ID, { ...options, autoActivationId: 'activation-a' });
    expect(H.schedule).not.toHaveBeenCalled();
    expect(H.enqueue).toHaveBeenCalledExactlyOnceWith('autopilot.run', { activationId: 'activation-a' }, { businessId: BID, singletonKey: `autopilot.run:${BID}`, maxAttempts: 3 });
    H.enqueue.mockReset(); H.authorized = false;
    await mediaReady(BID, ID, { ...options, autoActivationId: 'activation-a' });
    expect(H.enqueue).not.toHaveBeenCalled();
  });
});
