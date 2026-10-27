import { afterEach, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('./storage', async original => ({ ...(await original<typeof import('./storage')>()), putObject: M.put }));
import { env } from '@/server/env';
import { renderImage } from './images';

const original = { devStubs: env.devStubs, openrouterKey: env.openrouterKey, openaiKey: env.openaiKey, xaiKey: env.xaiKey };
afterEach(() => { Object.assign(env, original); vi.unstubAllGlobals(); M.put.mockReset(); });
describe('article body image provider fallback', () => {
  it('stores a real template PNG when the image provider fails; storage failure still propagates', async () => {
    Object.assign(env, { devStubs: false, openrouterKey: '', openaiKey: 'test-key', xaiKey: '' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('provider down', { status: 503 })));
    M.put.mockResolvedValue('/api/files/bid/article-body/fallback.png');
    const req = { bid: 'bid', style: 'illustration', brand: { primary: '#123456', secondary: '#abcdef' }, headline: 'Review changes', name: 'Radar', seed: 11, prompt: 'A review workflow', w: 1200, h: 675, kind: 'article-body' };
    expect(await renderImage(req)).toBe('/api/files/bid/article-body/fallback.png');
    const [key, bytes, type] = M.put.mock.calls[0];
    expect(key).toMatch(/^bid\/article-body\/.+\.png$/);
    expect(type).toBe('image/png');
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(bytes.length).toBeGreaterThan(1000);
    M.put.mockRejectedValue(new Error('storage unavailable'));
    await expect(renderImage(req)).rejects.toThrow('storage unavailable');
  });
});
