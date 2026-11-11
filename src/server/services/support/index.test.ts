import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ enforce: vi.fn(), answer: vi.fn(), mail: vi.fn() }));
vi.mock('@/server/abuse/rateLimit', () => ({ enforce: m.enforce, HOUR: 3600, DAY: 86400 }));
vi.mock('./answer', () => ({ answerSupport: m.answer }));
vi.mock('./mail', () => ({ sendSupportMail: m.mail }));
import { supportRequest } from './index';
const user = { id: 'u', name: 'User', email: 'user@example.com' }; const biz = { id: 'b' } as any;
const ask = { kind: 'ask' as const, message: 'Help', history: [], page: 'dashboard' as const };
beforeEach(() => { vi.clearAllMocks(); m.enforce.mockResolvedValue(undefined); });
describe('separate shared support budgets', () => {
  it('asks never send mail and apply user plus business AI budgets', async () => {
    await supportRequest(user, biz, ask);
    expect(m.answer).toHaveBeenCalled(); expect(m.mail).not.toHaveBeenCalled();
    expect(m.enforce.mock.calls[0][0]).toMatchObject([{ key: 'support:ask:user:u', limit: 30 }, { key: 'support:ask:user:u', limit: 100 }, { key: 'support:ask:business:b', limit: 100 }]);
  });
  it('explicit mail uses independent delivery budgets and never calls AI', async () => {
    await supportRequest(user, biz, { ...ask, kind: 'handoff', requestId: '49149dab-50f7-45de-b789-b1cce698eeb4' });
    expect(m.mail).toHaveBeenCalled(); expect(m.answer).not.toHaveBeenCalled();
    expect(m.enforce.mock.calls[0][0]).toMatchObject([{ key: 'support:mail:user:u', limit: 5 }, { key: 'support:mail:user:u', limit: 10 }, { key: 'support:mail:business:b', limit: 15 }]);
  });
  it('a limit rejection prevents any provider work and offers email for exhausted AI budget', async () => {
    m.enforce.mockImplementationOnce(async (limits: any) => { throw limits[0].error(); });
    await expect(supportRequest(user, biz, ask)).rejects.toMatchObject({ status: 429, code: 'rate_limited', message: expect.stringContaining('Email support') });
    expect(m.answer).not.toHaveBeenCalled(); expect(m.mail).not.toHaveBeenCalled();
  });
});
