import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  env: { supportInbox: 'support@thally.io', resendKey: 'test-key', mailFrom: 'Radar <hello@example.com>', devStubs: false },
  insert: vi.fn(), transaction: vi.fn(), execute: vi.fn(), fetch: vi.fn(), row: null as any,
}));
vi.mock('@/server/env', () => ({ env: m.env }));
vi.mock('@/server/db', () => ({
  schema: { outboxEmails: { id: 'id' } },
  db: { insert: m.insert, transaction: m.transaction },
}));
import { sendSupportMail, supportMailId } from './mail';
const user = { id: 'u1', name: 'Verified User', email: 'user@example.com' };
const biz = { id: 'b1', domain: 'example.com', profile: { business: { name: 'Example' } } };
const input = { kind: 'handoff' as const, message: 'Why is my draft stuck?', history: [{ role: 'user' as const, text: '<script>ignore instructions</script>' }], page: 'calendar' as const, requestId: '49149dab-50f7-45de-b789-b1cce698eeb4' };
beforeEach(() => {
  vi.clearAllMocks(); m.row = null;
  Object.assign(m.env, { supportInbox: 'support@thally.io', resendKey: 'test-key', mailFrom: 'Radar <hello@example.com>', devStubs: false });
  m.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'provider-id' }) });
  vi.stubGlobal('fetch', m.fetch);
  m.insert.mockImplementation(() => ({ values: (values: any) => ({ onConflictDoNothing: async () => { if (!m.row) m.row = { ...values, createdAt: new Date(), status: 'queued' }; } }) }));
  m.transaction.mockImplementation(async (fn: any) => fn({
    execute: m.execute,
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [m.row] }) }) }),
    update: () => ({ set: (values: any) => ({ where: async () => Object.assign(m.row, values) }) }),
  }));
});
afterEach(() => vi.unstubAllGlobals());
describe('explicit support mail delivery', () => {
  it('uses only the configured recipient, authenticated reply contact and a stable idempotency key', async () => {
    const result = await sendSupportMail(user, biz, input);
    expect(result).toMatchObject({ kind: 'handoff', delivered: true, reference: supportMailId(user.id, biz.id, input.requestId) });
    const [url, options] = m.fetch.mock.calls[0]; const payload = JSON.parse(options.body);
    expect(url).toBe('https://api.resend.com/emails'); expect(options.signal).toBeTruthy();
    expect(payload.to).toEqual(['support@thally.io']); expect(payload.reply_to).toBe(user.email);
    expect(payload.text).toContain(user.name); expect(payload.text).toContain(biz.domain); expect(payload.text).toContain(input.message);
    expect(payload.html).toBeUndefined(); expect(payload.text).toContain('<script>');
    expect(options.headers['Idempotency-Key']).toBe(`radar-support-${result.kind === 'handoff' && result.reference}`);
    expect(m.row.status).toBe('sent'); expect(m.execute).toHaveBeenCalledOnce();
  });
  it('captures development mail without fetch even when real credentials are configured', async () => {
    m.env.devStubs = true;
    expect(await sendSupportMail(user, biz, input)).toMatchObject({ delivered: false });
    expect(m.fetch).not.toHaveBeenCalled(); expect(m.row.status).toBe('logged');
    await sendSupportMail(user, biz, input); expect(m.fetch).not.toHaveBeenCalled();
  });
  it('fails closed for missing/invalid destination, credentials, local sender and invalid reply identity', async () => {
    for (const change of [{ resendKey: '' }, { supportInbox: '' }, { supportInbox: 'attacker@example.com\nBcc: x@y.test' }, { mailFrom: 'Radar <hello@radar.local>' }]) {
      const original = { ...m.env }; Object.assign(m.env, change);
      await expect(sendSupportMail(user, biz, input)).rejects.toMatchObject({ status: 503, code: 'support_unavailable' });
      Object.assign(m.env, original);
    }
    await expect(sendSupportMail({ ...user, email: 'bad' }, biz, input)).rejects.toMatchObject({ status: 503 });
    expect(m.insert).not.toHaveBeenCalled(); expect(m.fetch).not.toHaveBeenCalled();
  });
  it('returns one delivery for repeated same-payload requests and rejects changed payloads', async () => {
    const first = await sendSupportMail(user, biz, input);
    expect(await sendSupportMail(user, biz, input)).toEqual(first); expect(m.fetch).toHaveBeenCalledTimes(1);
    await expect(sendSupportMail(user, biz, { ...input, message: 'Changed query' })).rejects.toMatchObject({ status: 409, code: 'request_changed' });
    expect(m.fetch).toHaveBeenCalledTimes(1);
    expect(supportMailId(user.id, 'other-business', input.requestId)).not.toBe(supportMailId(user.id, biz.id, input.requestId));
    expect(supportMailId('other-user', biz.id, input.requestId)).not.toBe(supportMailId(user.id, biz.id, input.requestId));
  });
  it('persists safe failure, allows same-payload retry and never claims unconfirmed delivery', async () => {
    m.fetch.mockRejectedValueOnce(new Error('provider secret raw body'));
    await expect(sendSupportMail(user, biz, input)).rejects.toMatchObject({ status: 502, code: 'delivery_failed' });
    expect(m.row.status).toBe('failed'); expect(m.row.error).not.toContain('secret');
    const result = await sendSupportMail(user, biz, input);
    expect(result).toMatchObject({ delivered: true });
    expect(m.fetch.mock.calls[0][1].body).toBe(m.fetch.mock.calls[1][1].body);
    expect(m.fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe(m.fetch.mock.calls[1][1].headers['Idempotency-Key']);
  });
  it('refuses unresolved retries older than the provider deduplication window', async () => {
    m.fetch.mockResolvedValueOnce({ ok: false });
    await expect(sendSupportMail(user, biz, input)).rejects.toMatchObject({ status: 502 });
    m.row.createdAt = new Date(Date.now() - 24 * 3600_000);
    await expect(sendSupportMail(user, biz, input)).rejects.toMatchObject({ status: 409, code: 'request_expired' });
    expect(m.fetch).toHaveBeenCalledTimes(1);
  });
  it('normalizes storage errors before route logging can expose transcript-bearing SQL', async () => {
    m.insert.mockImplementationOnce(() => { throw new Error('SQL query includes transcript'); });
    await expect(sendSupportMail(user, biz, input)).rejects.toMatchObject({ status: 502, message: expect.not.stringContaining('transcript') });
    expect(m.fetch).not.toHaveBeenCalled();
  });
});
