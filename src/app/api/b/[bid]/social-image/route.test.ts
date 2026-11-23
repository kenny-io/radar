import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ attach: vi.fn(), role: vi.fn(), gate: vi.fn(), order: [] as string[] }));
vi.mock('@/server/access', () => ({
  requireActor: async () => { H.order.push('actor'); return { id: 'editor', guest: false }; },
  requireRole: async (...a: unknown[]) => { H.order.push('role'); return H.role(...a); },
  gateBusiness: async (...a: unknown[]) => { H.order.push('gate'); return H.gate(...a); },
}));
// Image upload is not behind the publishing flag (decision D2): with publishing off it still works.
vi.mock('@/server/flags', () => ({ socialOn: async () => false }));
vi.mock('@/server/services/social/publish/upload', async original => ({ ...(await original<typeof import('@/server/services/social/publish/upload')>()), attachImage: H.attach }));
import { env } from '@/server/env';
import { RadarError } from '@/server/errors';
import { POST } from './route';

const previousUrl = env.appUrl;
const context = { params: Promise.resolve({ bid: 'business-a' }) };
function request(headers: Record<string, string> = {}, o: { platform?: string; file?: Blob | null } = {}) {
  const data = new FormData(); data.set('packId', 'cpack'); data.set('platform', o.platform ?? 'x');
  if (o.file !== null) data.set('file', o.file ?? new Blob(['image-body'], { type: 'image/png' }), 'photo.png');
  return new Request('http://0.0.0.0:3000/api/b/business-a/social-image', { method: 'POST', headers, body: data });
}
const ok = { origin: 'https://radar.example.test', 'sec-fetch-site': 'same-origin' };
beforeEach(() => {
  env.appUrl = 'https://radar.example.test'; H.attach.mockReset(); H.role.mockReset(); H.gate.mockReset(); H.order.length = 0;
  H.gate.mockResolvedValue({ id: 'business-a', ownerId: 'owner' });
  H.attach.mockResolvedValue({ url: '/api/files/business-a/social-upload/1-a.png', meta: { bytes: 10, type: 'image/png' }, width: 4, height: 3 });
});
afterEach(() => { env.appUrl = previousUrl; });

describe('POST /api/b/[bid]/social-image', () => {
  it('checks origin, actor, Editor role and the business gate, in that order, then attaches the bytes', async () => {
    const response = await POST(request(ok), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, image: { url: '/api/files/business-a/social-upload/1-a.png', meta: { bytes: 10, type: 'image/png' }, width: 4, height: 3 } });
    expect(H.order).toEqual(['actor', 'role', 'gate']);
    expect(H.role).toHaveBeenCalledWith('business-a', 'editor', 'Editor');
    expect(H.attach).toHaveBeenCalledExactlyOnceWith({ id: 'business-a', ownerId: 'owner' }, 'cpack', 'x', Buffer.from('image-body'), 'editor');
  });
  it.each<Record<string, string>>([
    { origin: 'https://evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' },
    { origin: 'null' },
    { origin: 'https://radar.example.test', 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'cross-site' },
  ])('refuses a foreign origin or cross-site fetch before any read: %j', async headers => {
    const response = await POST(request(headers), context);
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ ok: false, code: 'forbidden' });
    expect(H.order).toEqual([]); expect(H.attach).not.toHaveBeenCalled();
  });
  it('refuses a Viewer (403) and a deleted business (404) before reading the body', async () => {
    H.role.mockRejectedValueOnce(new RadarError('You don’t have permission to do that.', 403, 'forbidden'));
    expect((await POST(request(ok), context)).status).toBe(403);
    H.gate.mockRejectedValueOnce(new RadarError('Business wasn’t found.', 404, 'not_found'));
    expect((await POST(request(ok), context)).status).toBe(404);
    expect(H.attach).not.toHaveBeenCalled();
  });
  it('refuses YouTube, a missing file and an oversized body with user copy', async () => {
    const yt = await POST(request(ok, { platform: 'youtube' }), context);
    expect(yt.status).toBe(400); expect(await yt.json()).toMatchObject({ ok: false, error: 'YouTube posts use a video.', code: 'invalid_image' });
    const none = await POST(request(ok, { file: null }), context);
    expect(none.status).toBe(400); expect(await none.json()).toMatchObject({ error: 'Choose an image to upload.' });
    const big = await POST(request({ ...ok, 'content-length': String(6 * 1024 * 1024) }), context);
    expect(big.status).toBe(413); expect(await big.json()).toMatchObject({ ok: false, error: 'Choose an image smaller than 5 MB.', code: 'too_large' });
    expect(H.attach).not.toHaveBeenCalled();
  });
});
