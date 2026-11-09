import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  report: vi.fn(async () => {}),
  env: { devStubs: false, isProd: false, dataforseoLogin: 'configured-login', dataforseoPassword: 'configured-password', openPageRankKey: 'configured-key', resendKey: 'configured-mail-key', mailFrom: 'Radar <radar@example.com>', crawlerUserAgent: 'RadarTest' },
  insert: vi.fn(), update: vi.fn(),
}));
vi.mock('@/server/observability/failures', () => ({ reportFailure: state.report }));
vi.mock('@/server/env', () => ({ env: state.env }));
vi.mock('@/server/db', () => ({ db: { insert: state.insert, update: state.update }, schema: { outboxEmails: { id: 'id' } } }));
vi.mock('@/server/services/backlinks/network', () => ({ absUrl: (v: string) => v, displayUrl: (v: string) => v, metaOf: vi.fn(), patchMeta: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  state.env.isProd = false;
  state.env.resendKey = 'configured-mail-key';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

// These providers intentionally return partial results. Assertions verify observability
// without changing the user's fallback, and ensure raw operation inputs aren't added to alerts.
describe('operational integrations that degrade instead of throwing', () => {
  it('alerts on keyword-provider credit failure while related keywords still return an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status_code: 40200, status_message: 'Payment Required' }, { status: 402 })));
    const { related } = await import('./keywords/provider');
    expect(await related('private customer keyword', 'United States', 'English')).toEqual([]);
    expect(state.report).toHaveBeenCalledWith(expect.objectContaining({ status: 402, code: 40200 }), expect.objectContaining({ operation: 'keywords.provider', provider: 'DataForSEO', degraded: true }));
    expect(JSON.stringify(state.report.mock.calls)).not.toContain('private customer keyword');
  });

  it('reports the original mail transport error without including the email body or recipient', async () => {
    const row = { id: 'mail-id', to: 'private@example.com', subject: 'Private subject', text: 'Private body', html: null, status: 'queued' };
    state.insert.mockReturnValue({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [row] }) }) });
    state.update.mockReturnValue({ set: () => ({ where: async () => [] }) });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })));
    const { sendMail } = await import('./mail');
    await expect(sendMail(row.to, row.subject, row.text)).rejects.toThrow('Resend 503');
    expect(state.report).toHaveBeenCalledWith(expect.any(Error), { source: 'system', operation: 'mail.send', provider: 'Resend' });
    expect(JSON.stringify(state.report.mock.calls)).not.toMatch(/private@example|Private body|Private subject/);
  });

  it('reports hardened security-mail transport failures without recording recipient or bearer link', async () => {
    state.insert.mockReturnValue({ values: (values: any) => { expect(values.text).toBe('[Security email content redacted]'); return { returning: async () => [{ id: 'auth-mail-id' }] }; } });
    state.update.mockReturnValue({ set: () => ({ where: async () => [] }) });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('PRIVATE provider response', { status: 503 })));
    const { sendAuthMail } = await import('./mail');
    await expect(sendAuthMail('PRIVATE@example.com', 'Confirm https://radar.test/confirm?token=PRIVATE')).rejects.toThrow('Security email delivery unavailable');
    expect(state.report).toHaveBeenCalledWith(expect.any(Error), { source: 'system', operation: 'mail.auth', provider: 'Resend' });
    expect(JSON.stringify(state.report.mock.calls)).not.toContain('PRIVATE');
  });
  it('records production log-only transactional email as degraded rather than silent success', async () => {
    state.env.isProd = true; state.env.resendKey = '';
    state.insert.mockReturnValue({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ id: 'mail-id', to: 'private@example.com', subject: 'Private', text: 'Private', html: null, status: 'queued' }] }) }) });
    state.update.mockReturnValue({ set: () => ({ where: async () => [] }) });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { sendMail } = await import('./mail');
    await sendMail('private@example.com', 'Private', 'Private');
    expect(state.report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: 'mail_unconfigured', degraded: true }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('alerts on an authority-provider outage and keeps the absent metric fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })));
    const { fetchAuthority } = await import('./backlinks/authority');
    expect(await fetchAuthority('customer.example')).toBeNull();
    expect(state.report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: 'backlinks.authority', status: 503 }));
  });

  it('distinguishes a missing measured backlink page from a failed verification request', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    const { checkLink } = await import('./backlinks/linkcheck');
    expect((await checkLink('https://customer.example/from', 'https://target.example', 'Editorial', 'present')).reachable).toBe(true);
    expect(state.report).not.toHaveBeenCalled();
    expect((await checkLink('https://customer.example/from', 'https://target.example', 'Editorial', 'present')).reachable).toBe(false);
    expect(state.report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: 'backlinks.linkcheck', status: 503 }));
  });
});
