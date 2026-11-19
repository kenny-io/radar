import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ attach: vi.fn(), role: vi.fn(), gate: vi.fn() }));
vi.mock('@/server/access', () => ({ requireActor: async () => ({ id: 'owner', guest: false }), requireRole: H.role, gateBusiness: H.gate }));
vi.mock('@/server/flags', () => ({ socialOn: async () => true }));
vi.mock('@/server/services/social/publish/video', async original => ({ ...(await original<typeof import('@/server/services/social/publish/video')>()), attachVideo: H.attach }));
import { env } from '@/server/env';
import { POST } from './route';

const previousUrl = env.appUrl;
const context = { params: Promise.resolve({ bid: 'business-a' }) };
const refusedHeaders: Record<string, string>[] = [
  { origin: 'https://evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' },
  { origin: 'http://0.0.0.0:3000' },
  { origin: 'null' },
  { origin: 'https://radar.example.test', 'sec-fetch-site': 'cross-site' },
  { 'sec-fetch-site': 'cross-site' },
];
function request(headers: Record<string, string> = {}) {
  const data = new FormData(); data.set('packId', 'pack-a'); data.set('platform', 'youtube');
  data.set('file', new Blob(['video-body'], { type: 'video/mp4' }), 'clip.mp4');
  // Railway terminates HTTPS before Next receives this internal HTTP request URL.
  return new Request('http://0.0.0.0:3000/api/b/business-a/social-video', { method: 'POST', headers, body: data });
}
beforeEach(() => {
  env.appUrl = 'https://radar.example.test'; H.attach.mockReset(); H.role.mockReset(); H.gate.mockReset();
  H.gate.mockResolvedValue({ id: 'business-a', ownerId: 'owner' });
  H.attach.mockResolvedValue({ url: 'https://media.example.test/business-a/social-video/clip.mp4', meta: { bytes: 10, type: 'video/mp4' } });
});
afterEach(() => { env.appUrl = previousUrl; });

describe('social video upload origin behind a reverse proxy', () => {
  it('accepts the configured public origin despite the internal HTTP request URL', async () => {
    const response = await POST(request({ origin: 'https://radar.example.test', 'sec-fetch-site': 'same-origin' }), context);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, video: { meta: { type: 'video/mp4' } } });
    expect(H.role).toHaveBeenCalledWith('business-a', 'owner', 'Editor');
    expect(H.attach).toHaveBeenCalledExactlyOnceWith({ id: 'business-a', ownerId: 'owner' }, 'pack-a', 'youtube', Buffer.from('video-body'));
  });
  it.each(refusedHeaders)('refuses a foreign/opaque origin or cross-site fetch before any upload: %j', async headers => {
    const response = await POST(request(headers), context);
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ ok: false, code: 'forbidden' });
    expect(H.attach).not.toHaveBeenCalled(); expect(H.gate).not.toHaveBeenCalled();
  });
  it('retains authenticated API-client uploads without Origin', async () => {
    expect((await POST(request(), context)).status).toBe(200);
    expect(H.role).toHaveBeenCalledWith('business-a', 'owner', 'Editor');
  });
});
