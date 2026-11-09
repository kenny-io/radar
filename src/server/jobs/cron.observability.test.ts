import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn(), deliver: vi.fn(async (..._args: any[]) => {}) }));
vi.mock('../db', () => ({ pool: { connect: state.connect } }));
vi.mock('../observability/delivery', () => ({ persistAndDeliverAlert: state.deliver }));
import { defineCron, startScheduler, tick } from './cron';
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('RADAR_FAILURE_ALERTS', 'on'); vi.stubEnv('RADAR_DEV_STUBS', '0');
  state.deliver.mockClear(); state.query.mockReset().mockResolvedValue({ rows: [{ ok: true }] }); state.release.mockClear(); state.connect.mockReset().mockResolvedValue({ query: state.query, release: state.release }); vi.spyOn(console, 'error').mockImplementation(() => {});
  (globalThis as any).__radarCron.length = 0;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('scheduler failure observability', () => {
  it('alerts on a failed hook and continues other hooks while releasing the lock', async () => {
    const healthy = vi.fn(async (..._args: any[]) => {}); defineCron('failed-scan', async () => { throw new Error('scan down'); }); defineCron('healthy', healthy);
    await tick(); expect(healthy).toHaveBeenCalled(); expect(state.deliver.mock.calls[0][0]).toMatchObject({ context: { source: 'cron', operation: 'failed-scan' } });
    expect(state.query.mock.calls.at(-1)?.[0]).toContain('pg_advisory_unlock'); expect(state.release).toHaveBeenCalled();
  });
  it('reports scheduler connection failures from the actual timer boundary', async () => {
    vi.useFakeTimers(); state.connect.mockRejectedValue(new Error('DB unavailable')); const scheduler = startScheduler();
    await vi.advanceTimersByTimeAsync(3001); scheduler.stop();
    expect(state.deliver.mock.calls[0][0]).toMatchObject({ context: { operation: 'scheduler.tick' } });
  });
});
