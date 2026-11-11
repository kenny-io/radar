import { afterEach, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('./storage', async original => ({ ...(await original<typeof import('./storage')>()), putObject: M.put }));
import { env } from '@/server/env';
import { renderImage, renderImageFile } from './images';
import { createCanvas, loadImage } from '@napi-rs/canvas';

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

const customReq = { bid: 'bid', style: 'branded', brand: { primary: '#123456', secondary: '#abcdef' }, headline: 'A building', name: 'Lived', seed: 17, prompt: 'Sobha Sapphire in Dubai at sunset', modelRequired: true, w: 1200, h: 628, kind: 'hero' };
describe('explicit custom image requests', () => {
  it('routes a template style to the image model, forwards the subject, crops to exact dimensions and stores metadata', async () => {
    Object.assign(env, { devStubs: false, openrouterKey: '', openaiKey: 'test-key', xaiKey: '' });
    const source = createCanvas(100, 100); source.getContext('2d').fillRect(0, 0, 100, 100);
    const fetcher = vi.fn(async () => Response.json({ data: [{ b64_json: source.toBuffer('image/png').toString('base64') }] }));
    vi.stubGlobal('fetch', fetcher); M.put.mockResolvedValue('/api/files/bid/hero/custom.png');
    const result = await renderImageFile(customReq);
    expect(result).toMatchObject({ url: '/api/files/bid/hero/custom.png', type: 'image/png' });
    expect(JSON.parse((fetcher.mock.calls[0] as any)[1].body).prompt).toContain(customReq.prompt);
    const stored = M.put.mock.calls[0][1]; const image = await loadImage(stored);
    expect([image.width, image.height]).toEqual([1200, 628]);
    expect(result.bytes).toBe(stored.length);
  });
  it('does not store a template when generation is unavailable, disabled in stubs, or fails', async () => {
    const fetcher = vi.fn(async () => new Response('provider down', { status: 503 })); vi.stubGlobal('fetch', fetcher);
    Object.assign(env, { devStubs: false, openrouterKey: '', openaiKey: '', xaiKey: '' });
    await expect(renderImageFile(customReq)).rejects.toMatchObject({ code: 'image_unavailable', status: 503 });
    Object.assign(env, { devStubs: true, openaiKey: 'test-key' });
    await expect(renderImageFile(customReq)).rejects.toMatchObject({ code: 'image_unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
    Object.assign(env, { devStubs: false });
    await expect(renderImageFile(customReq)).rejects.toThrow('openai image 503');
    expect(M.put).not.toHaveBeenCalled();
  });
  it('propagates custom-image storage failure without a fallback write', async () => {
    Object.assign(env, { devStubs: false, openrouterKey: '', openaiKey: 'test-key', xaiKey: '' });
    const source = createCanvas(10, 10);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: source.toBuffer('image/png').toString('base64') }] })));
    M.put.mockRejectedValue(new Error('storage unavailable'));
    await expect(renderImageFile(customReq)).rejects.toThrow('storage unavailable');
    expect(M.put).toHaveBeenCalledTimes(1);
  });
});
