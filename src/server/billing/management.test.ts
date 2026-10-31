import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  user: null as { id: string; name: string; email: string } | null,
  accountOf: vi.fn(), providerName: vi.fn(), billingEnforced: vi.fn(), getProvider: vi.fn(),
  portal: vi.fn(), enforce: vi.fn(), ownAccess: vi.fn(),
}));
vi.mock('@/server/auth/session', () => ({ currentUser: async () => H.user }));
vi.mock('@/server/billing/access', () => ({ accountOf: H.accountOf, billingEnforced: H.billingEnforced, ownAccess: H.ownAccess }));
vi.mock('@/server/billing/config', () => ({ providerName: H.providerName }));
vi.mock('@/server/billing/provider', () => ({ getProvider: H.getProvider }));
vi.mock('@/server/abuse/rateLimit', () => ({ HOUR: 3600, enforce: H.enforce }));

import { GET } from '@/app/api/billing/overview/route';
import { POST } from '@/app/api/billing/portal/route';
import { env } from '../env';
import { RadarError } from '../errors';

const account = { userId: 'user-a', stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a', comp: false,
  status: 'active', trialEnd: new Date('2026-11-03T12:00:00Z'), currentPeriodEnd: new Date('2026-12-03T12:00:00Z'),
  cancelAtPeriodEnd: false, everSubscribed: true };
const req = (headers: HeadersInit = { origin: 'https://radar.example' }, body?: unknown) => new Request('https://radar.example/api/billing/portal', {
  method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  env.appUrl = 'https://radar.example'; env.stripePortalConfigurationId = 'bpc_radar';
  H.user = { id: 'user-a', email: 'a@example.com', name: 'Ada' };
  H.accountOf.mockImplementation(async (uid: string) => uid === 'user-a' ? { ...account } : null);
  H.providerName.mockReturnValue('stripe'); H.billingEnforced.mockReturnValue(false);
  H.getProvider.mockResolvedValue({ name: 'stripe', createPortalSession: H.portal });
  H.portal.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/test_secret' }); H.enforce.mockResolvedValue(undefined);
  H.ownAccess.mockResolvedValue(true);
});

describe('billing overview and portal routes', () => {
  it('requires a signed-in user for both routes and prevents caching even an auth error', async () => {
    H.user = null;
    for (const r of [await GET(), await POST(req())]) {
      expect(r.status).toBe(401);
      expect(r.headers.get('cache-control')).toBe('private, no-store');
      expect(await r.json()).toMatchObject({ code: 'unauthorized' });
    }
    expect(H.accountOf).not.toHaveBeenCalled(); expect(H.portal).not.toHaveBeenCalled();
  });
  it('reads persisted own status even while billing is off, without exposing identifiers or preview dates', async () => {
    const r = await GET(); const j = await r.json();
    expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(j).toEqual({ provider: 'stripe', enforced: false, status: 'active', priceCents: 5000, currency: 'usd', interval: 'month',
      trialEnd: account.trialEnd.toISOString(), currentPeriodEnd: account.currentPeriodEnd.toISOString(), cancelAtPeriodEnd: false, canManage: true, everSubscribed: true });
    expect(H.accountOf).toHaveBeenCalledWith('user-a');
    expect(JSON.stringify(j)).not.toMatch(/cus_a|sub_a|user-a|secret/);
    H.accountOf.mockResolvedValue(null);
    expect(await (await GET()).json()).toMatchObject({ status: 'none', canManage: false, trialEnd: null, currentPeriodEnd: null });
  });
  it('keeps a complimentary payer manageable and reflects persisted cancellation state', async () => {
    H.accountOf.mockResolvedValue({ ...account, comp: true, cancelAtPeriodEnd: true });
    expect(await (await GET()).json()).toMatchObject({ status: 'comp', canManage: true, cancelAtPeriodEnd: true });
    expect((await POST(req())).status).toBe(200);
  });
  it('ignores foreign customer/business/return URL fields and uses only authenticated own account', async () => {
    H.accountOf.mockResolvedValue({ ...account, status: 'past_due' });
    const r = await POST(req({ origin: 'https://radar.example' }, { customer: 'cus_other', userId: 'other-user', businessId: 'other-business', returnUrl: 'https://evil.example', configuration: 'bpc_evil' }));
    expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(H.portal).toHaveBeenCalledWith({ customer: 'cus_a', returnUrl: 'https://radar.example/settings?section=billing', configuration: 'bpc_radar' }, expect.stringMatching(/^radar:portal:user-a:/));
    expect(H.accountOf).toHaveBeenCalledWith('user-a');
    await POST(req());
    expect(H.portal.mock.calls[0][1]).not.toBe(H.portal.mock.calls[1][1]);
  });
  it('rejects conflicting origins and cross-site requests before opening any session', async () => {
    const attempts: Record<string, string>[] = [{ origin: 'https://evil.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }];
    for (const headers of attempts) {
      expect((await POST(req(headers))).status).toBe(403);
    }
    expect(H.portal).not.toHaveBeenCalled();
  });
  it('returns a lapsed payer directly to restart without depending on selected business access', async () => {
    H.ownAccess.mockResolvedValue(false);
    expect((await POST(req())).status).toBe(200);
    expect(H.portal).toHaveBeenCalledWith(expect.objectContaining({ returnUrl: 'https://radar.example/start-trial' }), expect.any(String));
  });
  it('has no fake portal in stub/unconfigured mode and no session for a user without a customer', async () => {
    for (const p of [null, { name: 'stub', createPortalSession: H.portal }]) {
      H.getProvider.mockResolvedValue(p); expect((await POST(req())).status).toBe(503);
    }
    H.getProvider.mockResolvedValue({ name: 'stripe', createPortalSession: H.portal }); H.accountOf.mockResolvedValue(null);
    expect(await (await POST(req())).json()).toMatchObject({ code: 'no_subscription' });
    expect(H.portal).not.toHaveBeenCalled();
    H.providerName.mockReturnValue('stub');
    expect(await (await GET()).json()).toMatchObject({ canManage: false });
  });
  it('returns safe, retryable errors without logging provider messages or secret URLs', async () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    H.portal.mockRejectedValueOnce(new Error('sk_test_private https://billing.stripe.com/secret=private'));
    const r = await POST(req());
    expect(r.status).toBe(503); expect(await r.text()).not.toContain('private'); expect(logs).not.toHaveBeenCalled();
    expect((await POST(req())).status).toBe(200);
    H.portal.mockResolvedValue({ url: 'https://evil.example/p/session' });
    expect((await POST(req())).status).toBe(503);
    logs.mockRestore();
  });
  it('rate limits portal actions separately from checkout, without making a session after denial', async () => {
    H.enforce.mockRejectedValueOnce(new RadarError('Try again later.', 429, 'rate_limited'));
    expect((await POST(req())).status).toBe(429); expect(H.portal).not.toHaveBeenCalled();
    expect(H.enforce.mock.calls[0][0]).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'billing_portal:user:user-a', limit: 20 })]));
  });
});
