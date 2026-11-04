import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: vi.fn(), role: vi.fn(), biz: vi.fn(), support: vi.fn(), origin: vi.fn() }));
vi.mock('@/server/access', () => ({ requireUser: m.user, requireRole: m.role }));
vi.mock('@/server/workspace', () => ({ getBiz: m.biz }));
vi.mock('@/server/auth/requests', () => ({ assertAuthOrigin: m.origin }));
vi.mock('@/server/services/support', () => ({ supportRequest: m.support }));
import { POST } from './route';
import { RadarError } from '@/server/errors';
const input = { kind: 'ask', message: 'Help me publish', history: [], page: 'dashboard' };
const req = (body = input) => new Request('http://localhost/api/b/biz/support', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const params = { params: Promise.resolve({ bid: 'biz' }) };
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: 'user', email: 'user@example.com', name: 'User' });
  m.role.mockResolvedValue('Viewer'); m.biz.mockResolvedValue({ id: 'biz' });
  m.support.mockResolvedValue({ kind: 'answer', reply: 'Open Settings.', needsHuman: false });
});
describe('support authorization and API behavior', () => {
  it('allows Viewer support independently of billing and returns a private response', async () => {
    const response = await POST(req(), params);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(m.role).toHaveBeenCalledWith('biz', 'user', 'Viewer');
    expect(m.origin).toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: true, data: { kind: 'answer', reply: 'Open Settings.', needsHuman: false } });
  });
  it('blocks unauthenticated users and cross-business access before loading business or calling services', async () => {
    m.user.mockRejectedValueOnce(new RadarError('Sign in', 401, 'unauthorized'));
    expect((await POST(req(), params)).status).toBe(401); expect(m.biz).not.toHaveBeenCalled();
    m.role.mockRejectedValueOnce(new RadarError('Not found', 404, 'not_found'));
    expect((await POST(req(), params)).status).toBe(404); expect(m.support).not.toHaveBeenCalled(); expect(m.biz).not.toHaveBeenCalled();
  });
  it('blocks cross-site and invalid requests before spending AI/mail limits', async () => {
    m.origin.mockImplementationOnce(() => { throw new RadarError('No permission', 403, 'forbidden'); });
    expect((await POST(req(), params)).status).toBe(403); expect(m.user).not.toHaveBeenCalled();
    expect((await POST(req({ ...input, message: '' }), params)).status).toBe(400);
    expect(m.support).not.toHaveBeenCalled();
  });
  it('propagates safe rate limit and unavailable-mail errors', async () => {
    for (const [status, code] of [[429, 'rate_limited'], [503, 'support_unavailable']] as const) {
      m.support.mockRejectedValueOnce(new RadarError('Please retry later.', status, code));
      const response = await POST(req(), params);
      expect(response.status).toBe(status); expect(await response.json()).toMatchObject({ ok: false, code });
    }
  });
});
