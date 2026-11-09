import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
vi.mock('../db', () => ({ pool: { query } }));
import { ALERT_MAX_AGE_MS, alertEnvelope, deliverAlert, persistAndDeliverAlert } from './delivery';
import type { FailureEvent } from './failures';
const event = (): FailureEvent => ({ id: 'event', timestamp: new Date().toISOString(), environment: 'test', service: 'worker', rootOperation: 'article.draft', context: { source: 'ai', operation: 'article.outline', provider: 'openrouter', businessId: 'biz' }, error: { name: 'Error', message: 'credits exhausted', status: 402 }, hint: 'Top up credits' });
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('RADAR_FAILURE_ALERTS', 'on'); vi.stubEnv('RADAR_DEV_STUBS', '0'); vi.stubEnv('RESEND_API_KEY', 'test-only'); vi.stubEnv('MAIL_FROM', 'Radar <radar@thally.io>'); vi.stubEnv('RADAR_FAILURE_ALERT_EMAIL', '');
  query.mockReset().mockResolvedValue({ rows: [{ payload: {} }] });
  fetcher = vi.fn(async () => new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetcher); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('immediate and durable failure alert delivery', () => {
  it('persists a tenant-independent retry before immediate delivery to Kenny, then records acceptance', async () => {
    await persistAndDeliverAlert(event(), 'radar-failure/key');
    const insert = query.mock.calls[0][0]; expect(insert.text).toContain('INSERT INTO jobs'); expect(insert.text).not.toContain('business_id');
    expect(insert.values[1]).toBe('observability.alert');
    const body = JSON.parse(fetcher.mock.calls[0][1].body); expect(body.to).toEqual(['kenny@thally.io']); expect(body.text).toContain('HTTP status: 402');
    expect(query.mock.calls[1][0].text).toContain("status='done'");
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(fetcher.mock.invocationCallOrder[0]);
  });
  it('retains the provider message ID for precise operational delivery verification', async () => {
    fetcher.mockResolvedValueOnce(Response.json({ id: 'resend-message-id' }));
    await persistAndDeliverAlert(event(), 'receipt-key');
    expect(query.mock.calls[1][0].values[1]).toEqual({ accepted: true, providerMessageId: 'resend-message-id' });
  });
  it('retains a retry when Resend fails and does not create a recursive alert', async () => {
    fetcher.mockResolvedValue(new Response('sensitive provider response', { status: 503 }));
    await persistAndDeliverAlert(event(), 'radar-failure/key');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0].text).not.toContain("status='done'");
    expect(query.mock.calls[1][0].values[1]).toContain('HTTP 503'); expect(JSON.stringify(query.mock.calls)).not.toContain('sensitive provider response');
  });
  it('does not send again when another process already persisted the incident', async () => {
    query.mockResolvedValueOnce({ rows: [] }); await persistAndDeliverAlert(event(), 'same-key'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('still attempts direct email when the database is unavailable', async () => {
    query.mockRejectedValueOnce(new Error('DB unavailable')); await persistAndDeliverAlert(event(), 'same-key'); expect(fetcher).toHaveBeenCalledTimes(1); expect(query).toHaveBeenCalledTimes(1);
  });
  it('does not count missing mail configuration as successful delivery', async () => {
    vi.stubEnv('RESEND_API_KEY', ''); await persistAndDeliverAlert(event(), 'same-key');
    expect(fetcher).not.toHaveBeenCalled(); expect(query.mock.calls[1][0].text).not.toContain("status='done'");
    expect(query.mock.calls[1][0].values[1]).toContain('requires');
  });
  it('replays the exact persisted payload and idempotency key', async () => {
    const envelope = alertEnvelope(event(), 'stable-key'); await deliverAlert(envelope); vi.stubEnv('MAIL_FROM', 'new@other.test'); await deliverAlert(envelope);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(fetcher.mock.calls[1][1].headers['Idempotency-Key']).toBe('stable-key');
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('refuses expired replays before the provider idempotency window ends', async () => {
    const old = event(); old.timestamp = new Date(Date.now() - ALERT_MAX_AGE_MS - 1).toISOString();
    await expect(deliverAlert(alertEnvelope(old, 'old-key'))).rejects.toMatchObject({ code: 'permanent' }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('recovers an initially missing sender atomically before the first provider attempt', async () => {
    vi.stubEnv('MAIL_FROM', ''); const envelope = alertEnvelope(event(), 'recover-key');
    vi.stubEnv('MAIL_FROM', 'Radar <configured@thally.io>');
    const prepared = { ...envelope, from: 'Radar <configured@thally.io>' };
    query.mockResolvedValueOnce({ rows: [{ payload: prepared }] });
    await deliverAlert(envelope);
    expect(query.mock.calls[0][0].text).toContain("payload->>'from'=$3");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).from).toBe(prepared.from);
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(fetcher.mock.invocationCallOrder[0]);
  });
  it('uses the already-bound persisted sender when a stale concurrent worker has an invalid envelope', async () => {
    const envelope = { ...alertEnvelope(event(), 'recover-key'), from: 'Radar <hello@radar.local>' };
    const winner = { ...envelope, from: 'Radar <first@thally.io>' };
    vi.stubEnv('MAIL_FROM', 'Radar <second@thally.io>'); query.mockResolvedValueOnce({ rows: [{ payload: winner }] });
    await deliverAlert(envelope);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).from).toBe(winner.from);
  });
  it('honors the kill switch on queued deliveries', async () => {
    vi.stubEnv('RADAR_FAILURE_ALERTS', 'off'); await expect(deliverAlert(alertEnvelope(event(), 'key'))).rejects.toMatchObject({ code: 'permanent' }); expect(fetcher).not.toHaveBeenCalled();
  });
});
