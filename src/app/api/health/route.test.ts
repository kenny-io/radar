import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/server/db', () => ({ pool: { query } }));
beforeEach(() => { vi.resetModules(); query.mockReset(); });
afterEach(() => vi.useRealTimers());
describe('readiness', () => {
  it('checks the database and coalesces simultaneous probes', async () => {
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const { GET } = await import('./route');
    const results = await Promise.all(Array.from({ length: 25 }, () => GET()));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({ text: 'SELECT 1', query_timeout: 2000 });
    expect(results.every(r => r.status === 200)).toBe(true);
    expect(await results[0].json()).toEqual({ ok: true });
    expect(results[0].headers.get('cache-control')).toBe('no-store');
  });
  it('returns sanitized 503 and recovers after a failed probe expires', async () => {
    vi.useFakeTimers();
    query.mockRejectedValueOnce(new Error('postgres://secret@private/db')).mockResolvedValueOnce({ rows: [] });
    const { GET } = await import('./route');
    const failed = await GET();
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ ok: false });
    vi.advanceTimersByTime(1001);
    expect((await GET()).status).toBe(200);
  });
});
