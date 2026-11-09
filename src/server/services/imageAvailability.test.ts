// All provider responses are mocked. These scenarios reproduce account exhaustion without calling paid APIs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { ImageReq } from './images';
const M = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('./storage', async original => ({ ...(await original<typeof import('./storage')>()), putObject: M.put }));

const req: ImageReq = { bid: 'test-business', style: 'branded', brand: { primary: '#123456', secondary: '#abcdef' }, headline: 'A building', name: 'Example', seed: 11, prompt: 'A building in the evening', modelRequired: true, w: 120, h: 80, kind: 'social' };
const safeError = { code: 'image_unavailable', status: 503, userMessage: 'Image generation is temporarily unavailable. Your previous image is kept. Please contact support.' };
let images: typeof import('./images');
let openrouter: typeof import('../ai/adapters/openrouter');
const accountResponse = (url: string) => {
  if (url.includes('openrouter.ai')) return Response.json({ error: { message: 'Insufficient credits', code: 402, metadata: { limit_source: 'openrouter_credits' } } }, { status: 402 });
  if (url.includes('api.openai.com')) return Response.json({ error: { message: 'You have no credits remaining.', type: 'insufficient_quota', code: 'insufficient_quota' } }, { status: 429 });
  return Response.json({ error: 'Your account has used all credits or reached its monthly spending limit.' }, { status: 403 });
};
const png = () => {
  const canvas = createCanvas(60, 60); const ctx = canvas.getContext('2d'); ctx.fillStyle = '#12ab34'; ctx.fillRect(0, 0, 60, 60);
  return Response.json({ data: [{ b64_json: canvas.toBuffer('image/png').toString('base64'), media_type: 'image/png' }] });
};

beforeEach(async () => {
  // Fresh modules reset image cooldowns as well as shared OpenRouter account/breaker state for each scenario.
  vi.resetModules();
  const { env } = await import('../env');
  Object.assign(env, { devStubs: false, openrouterKey: 'test-or-key', openaiKey: 'test-oa-key', xaiKey: 'test-xa-key' });
  images = await import('./images'); openrouter = await import('../ai/adapters/openrouter');
  vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-09T17:13:50Z'));
  M.put.mockReset(); M.put.mockResolvedValue('/api/files/test-business/social/real.png');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('image provider account availability', () => {
  it('reports safe unavailability for all three real account-error shapes without storing a template', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => accountResponse(String(url)));
    vi.stubGlobal('fetch', fetcher);
    await expect(images.renderImageFile(req)).rejects.toMatchObject(safeError);
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual(['openrouter.ai', 'api.openai.com', 'api.x.ai']);
    expect(openrouter.openrouterDown()).toBe(true);
    expect(M.put).not.toHaveBeenCalled();
  });
  it('keeps the unavailable result during account cooldown without new requests', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => accountResponse(String(url)));
    vi.stubGlobal('fetch', fetcher);
    await expect(images.renderImageFile(req)).rejects.toMatchObject(safeError);
    fetcher.mockClear();
    await expect(images.renderImageFile(req)).rejects.toMatchObject(safeError);
    expect(fetcher).not.toHaveBeenCalled(); expect(M.put).not.toHaveBeenCalled();
  });
  it('recovers after cooldown expiry and stores actual raster output at the required dimensions', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => accountResponse(String(url)));
    vi.stubGlobal('fetch', fetcher);
    await expect(images.renderImageFile(req)).rejects.toMatchObject(safeError);
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    fetcher.mockClear(); fetcher.mockImplementation(async () => png());
    const result = await images.renderImageFile(req);
    expect(result).toMatchObject({ url: '/api/files/test-business/social/real.png', type: 'image/png' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const raster = await loadImage(M.put.mock.calls[0][1]);
    expect([raster.width, raster.height]).toEqual([120, 80]);
    const check = createCanvas(120, 80).getContext('2d'); check.drawImage(raster, 0, 0);
    expect(Array.from(check.getImageData(60, 40, 1, 1).data)).toEqual([18, 171, 52, 255]);
    expect(result.bytes).toBe(M.put.mock.calls[0][1].length);
  });
  it('retains a successful direct fallback after the primary account is exhausted', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('openrouter.ai') ? accountResponse(String(url)) : png());
    vi.stubGlobal('fetch', fetcher);
    await expect(images.renderImageFile(req)).resolves.toMatchObject({ type: 'image/png' });
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual(['openrouter.ai', 'api.openai.com']);
    expect(M.put).toHaveBeenCalledTimes(1);
  });
  it.each([500, 429])('does not misclassify a mixed transient %s and account failure as all-account exhaustion', async status => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('openrouter.ai') ? new Response('Please try again later', { status }) : accountResponse(String(url)));
    vi.stubGlobal('fetch', fetcher);
    await expect(images.renderImageFile(req)).rejects.toMatchObject({ message: expect.stringContaining('xai image 403') });
    await expect(images.renderImageFile(req)).rejects.not.toMatchObject({ code: 'image_unavailable' });
    expect(M.put).not.toHaveBeenCalled();
  });
  it('treats an OpenRouter transient-breaker skip as a transient route, including when the other routes enter cooldown', async () => {
    openrouter.noteOpenrouterOutcome(Object.assign(new Error('timed out'), { timeout: true }));
    const fetcher = vi.fn(async (url: string | URL | Request) => accountResponse(String(url)));
    vi.stubGlobal('fetch', fetcher);
    await expect(images.renderImageFile(req)).rejects.not.toMatchObject({ code: 'image_unavailable' });
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual(['api.openai.com', 'api.x.ai']);
    fetcher.mockClear();
    await expect(images.renderImageFile(req)).rejects.toThrow('no image provider available');
    expect(fetcher).not.toHaveBeenCalled(); expect(M.put).not.toHaveBeenCalled();
  });
  it('recognizes the shared OpenRouter account cooldown established by a text call', async () => {
    openrouter.markOpenrouterDown('account limit');
    const fetcher = vi.fn(async (url: string | URL | Request) => accountResponse(String(url)));
    vi.stubGlobal('fetch', fetcher);
    await expect(images.renderImageFile(req)).rejects.toMatchObject(safeError);
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual(['api.openai.com', 'api.x.ai']);
  });
  it('preserves optional background template fallback when every account is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => accountResponse(String(url))));
    await expect(images.renderImageFile({ ...req, style: 'illustration', modelRequired: false })).resolves.toMatchObject({ type: 'image/png' });
    expect(M.put).toHaveBeenCalledTimes(1);
  });
});
