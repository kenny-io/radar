import { beforeEach, describe, expect, it, vi } from 'vitest';

const M = vi.hoisted(() => ({
  connection: null as any,
  properties: vi.fn(), enqueue: vi.fn(), setConn: vi.fn(),
  getConn: vi.fn(), reportFailure: vi.fn(),
}));
vi.mock('../services/gsc/sync', () => ({ getConn: M.getConn, setConn: M.setConn }));
vi.mock('../services/gsc/properties', () => ({ propertiesFor: M.properties }));
vi.mock('../jobs/queue', () => ({ enqueue: M.enqueue }));
vi.mock('../services/gsc/metrics', () => ({ kwMeasured: vi.fn(), summary: vi.fn(), topPages: vi.fn(), topQueries: vi.fn() }));
vi.mock('../services/gsc/suggestions', () => ({ listSuggestions: vi.fn() }));
vi.mock('../services/gsc/refresh', () => ({ acceptSuggestion: vi.fn(), dismissSuggestion: vi.fn() }));
vi.mock('../observability/failures', () => ({ reportFailure: M.reportFailure }));
vi.mock('../services/gsc/client', () => ({
  GscApiError: class extends Error { constructor(message: string, public status: number, public transient: boolean, public reason?: string) { super(message); } },
  loadTokens: vi.fn(), revoke: vi.fn(), saveTokens: vi.fn(),
}));

import { actions } from './performance';
import { GscApiError } from '../services/gsc/client';

const ctx = { bid: 'business-a', biz: { id: 'business-a', domain: 'example.com' }, role: 'Editor' } as any;
const reconnect = () => actions['gsc.reconnect'].run(ctx, {});
beforeEach(() => {
  vi.clearAllMocks();
  M.connection = { businessId: ctx.bid, property: 'https://example.com/', status: 'error', error: 'token refresh failed: invalid_grant', backfillCursor: { done: true }, lastSyncedThrough: '2026-11-16' };
  M.getConn.mockImplementation(async () => M.connection);
  M.properties.mockResolvedValue([{ v: 'https://example.com/' }]);
  M.enqueue.mockResolvedValue('job-a');
  M.setConn.mockResolvedValue(undefined);
});

describe('reconnecting the existing Search Console property', () => {
  it('requires Editor and queues an incremental pull without changing property, dates or cursor', async () => {
    expect(actions['gsc.reconnect'].role).toBe('Editor');
    expect(await reconnect()).toEqual({ ok: true });
    expect(M.properties).toHaveBeenCalledWith(ctx.bid, 'example.com');
    expect(M.setConn).toHaveBeenCalledExactlyOnceWith(ctx.bid, { status: 'connected', error: null });
    expect(M.enqueue).toHaveBeenCalledExactlyOnceWith('gsc.incremental', {}, { businessId: ctx.bid, ref: ctx.bid, singletonKey: 'gsc-inc:' + ctx.bid });
  });
  it('continues the remaining historical import without resetting its saved cursor', async () => {
    M.connection.backfillCursor = { done: false, i: 8 };
    await reconnect();
    expect(M.setConn).toHaveBeenCalledExactlyOnceWith(ctx.bid, { status: 'syncing', error: null });
    expect(M.enqueue.mock.calls[0][0]).toBe('gsc.backfill');
    expect(M.connection.backfillCursor).toEqual({ done: false, i: 8 });
  });
  it('never switches to a different property when Google account access is missing', async () => {
    M.properties.mockResolvedValue([{ v: 'sc-domain:example.com' }]);
    await expect(reconnect()).rejects.toMatchObject({ status: 403, code: 'gsc_property' });
    expect(M.setConn).not.toHaveBeenCalled(); expect(M.enqueue).not.toHaveBeenCalled();
  });
  it.each(['skipped', 'none'])('does not restore a %s connection', async status => {
    M.connection.status = status;
    await expect(reconnect()).rejects.toMatchObject({ code: 'gsc_connection_changed' });
    expect(M.properties).not.toHaveBeenCalled(); expect(M.setConn).not.toHaveBeenCalled();
  });
  it.each([{ status: 'skipped' }, { property: 'sc-domain:elsewhere.com' }])('does not overwrite a connection changed during provider validation: %o', async changed => {
    M.properties.mockImplementation(async () => { M.connection = { ...M.connection, ...changed }; return [{ v: 'https://example.com/' }]; });
    await expect(reconnect()).rejects.toMatchObject({ code: 'gsc_connection_changed' });
    expect(M.setConn).not.toHaveBeenCalled(); expect(M.enqueue).not.toHaveBeenCalled();
  });
  it.each(['connected', 'syncing'])('does not replace a connection already %s during provider validation', async status => {
    M.properties.mockImplementation(async () => { M.connection = { ...M.connection, status }; return [{ v: 'https://example.com/' }]; });
    expect(await reconnect()).toEqual({ ok: true });
    expect(M.setConn).not.toHaveBeenCalled(); expect(M.enqueue).not.toHaveBeenCalled();
  });
  it('retains the paused warning if fresh Google authorization is rejected', async () => {
    M.properties.mockRejectedValue(new GscApiError('token refresh failed: invalid_grant', 400, false, 'invalid_grant'));
    await expect(reconnect()).rejects.toMatchObject({ code: 'gsc_denied' });
    expect(M.setConn).not.toHaveBeenCalled(); expect(M.enqueue).not.toHaveBeenCalled();
    expect(M.reportFailure).toHaveBeenCalledOnce();
  });
  it('retains the warning when Google is temporarily unavailable', async () => {
    M.properties.mockRejectedValue(new GscApiError('Search Console HTTP 503 backendError', 503, true));
    await expect(reconnect()).rejects.toMatchObject({ code: 'gsc_unavailable' });
    expect(M.setConn).not.toHaveBeenCalled();
  });
  it('restores the warning if queuing the resumed sync fails', async () => {
    M.enqueue.mockRejectedValue(new Error('queue unavailable'));
    await expect(reconnect()).rejects.toThrow('queue unavailable');
    expect(M.setConn.mock.calls).toEqual([[ctx.bid, { status: 'connected', error: null }], [ctx.bid, { status: 'error', error: 'token refresh failed: invalid_grant' }]]);
  });
  it('prevents Resume from retrying invalid credentials without new consent', async () => {
    await expect(actions['gsc.resume'].run(ctx, {})).rejects.toMatchObject({ status: 409, code: 'gsc_reconnect_required' });
    expect(M.setConn).not.toHaveBeenCalled(); expect(M.enqueue).not.toHaveBeenCalled();
  });
  it('preserves Resume for a temporary provider outage', async () => {
    M.connection.error = 'Search Console HTTP 503 backendError';
    expect(await actions['gsc.resume'].run(ctx, {})).toEqual({ ok: true });
    expect(M.enqueue.mock.calls[0][0]).toBe('gsc.incremental');
  });
});
