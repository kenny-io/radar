import { afterEach, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('./storage', async original => ({ ...(await original<typeof import('./storage')>()), putObject: M.put }));
import { env } from '@/server/env';
import { imagePrompt, renderImage, renderImageFile } from './images';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const original = { devStubs: env.devStubs, openrouterKey: env.openrouterKey, openaiKey: env.openaiKey, xaiKey: env.xaiKey };
afterEach(() => { Object.assign(env, original); vi.unstubAllGlobals(); M.put.mockReset(); });
const png = () => { const source = createCanvas(100, 100); source.getContext('2d').fillRect(0, 0, 100, 100); return Response.json({ data: [{ b64_json: source.toBuffer('image/png').toString('base64') }] }); };
describe('cover provider fallback (a request that is not strict)', () => {
  it('stores a real template PNG when the image provider fails, and says it is a placeholder; storage failure still propagates', async () => {
    Object.assign(env, { devStubs: false, openrouterKey: '', openaiKey: 'test-key', xaiKey: '' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('provider down', { status: 503 })));
    M.put.mockResolvedValue('/api/files/bid/article-body/fallback.png');
    const req = { bid: 'bid', style: 'illustration', brand: { primary: '#123456', secondary: '#abcdef' }, headline: 'Review changes', name: 'Radar', seed: 11, prompt: 'A review workflow', w: 1200, h: 675, kind: 'article-body' };
    expect(await renderImage(req)).toBe('/api/files/bid/article-body/fallback.png');
    expect(await renderImageFile(req)).toEqual({ url: '/api/files/bid/article-body/fallback.png', bytes: M.put.mock.calls[1][1].length, type: 'image/png', placeholder: 'failed' });
    const [key, bytes, type] = M.put.mock.calls[0];
    expect(key).toMatch(/^bid\/article-body\/.+\.png$/);
    expect(type).toBe('image/png');
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(bytes.length).toBeGreaterThan(1000);
    M.put.mockRejectedValue(new Error('storage unavailable'));
    await expect(renderImage(req)).rejects.toThrow('storage unavailable');
  });
  it('a model image is not a placeholder, and neither is a template the owner chose', async () => {
    Object.assign(env, { devStubs: false, openrouterKey: '', openaiKey: 'test-key', xaiKey: '' });
    const fetcher = vi.fn(async () => png()); vi.stubGlobal('fetch', fetcher);
    M.put.mockResolvedValue('/api/files/bid/hero/cover.png');
    const real = await renderImageFile({ ...coverReq, style: 'illustration' });
    expect(real).toEqual({ url: '/api/files/bid/hero/cover.png', bytes: expect.any(Number), type: 'image/png' });
    expect('placeholder' in real).toBe(false);
    for (const style of ['branded', 'infographic']) expect('placeholder' in await renderImageFile({ ...coverReq, style })).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('a model style with no image model to ask stores the template as an unavailable placeholder, with dev stubs too', async () => {
    const fetcher = vi.fn(async () => png()); vi.stubGlobal('fetch', fetcher);
    M.put.mockResolvedValue('/api/files/bid/hero/cover.png');
    Object.assign(env, { devStubs: false, openrouterKey: '', openaiKey: '', xaiKey: '' });
    expect(await renderImageFile({ ...coverReq, style: 'photography' })).toMatchObject({ url: '/api/files/bid/hero/cover.png', placeholder: 'unavailable' });
    Object.assign(env, { devStubs: true, openaiKey: 'test-key' });
    expect(await renderImageFile({ ...coverReq, style: 'illustration' })).toMatchObject({ placeholder: 'unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('a picture the caller supplies, or its template, carries no placeholder mark', async () => {
    Object.assign(env, { devStubs: false, openrouterKey: '', openaiKey: '', xaiKey: '' });
    M.put.mockResolvedValue('/api/files/bid/social/pack.png');
    expect('placeholder' in await renderImageFile({ ...coverReq, style: 'illustration', kind: 'social' }, 'template')).toBe(false);
    expect('placeholder' in await renderImageFile({ ...coverReq, style: 'illustration', kind: 'social' }, { raw: createCanvas(40, 40).toBuffer('image/png') })).toBe(false);
  });
});

describe('article body images are never a template', () => {
  const bodyReq = { bid: 'bid', style: 'illustration', brand: { primary: '#123456', secondary: '#abcdef' }, headline: 'Getting to work', name: 'Lived', seed: 12, prompt: 'A staff bus waiting at the main entrance of a residential community.', literal: true, modelRequired: true, w: 1200, h: 675, kind: 'article-body' };
  it('a failing provider stores nothing and throws', async () => {
    Object.assign(env, { devStubs: false, openrouterKey: '', openaiKey: 'test-key', xaiKey: '' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('provider down', { status: 503 })));
    await expect(renderImageFile(bodyReq)).rejects.toThrow('openai image 503');
    expect(M.put).not.toHaveBeenCalled();
  });
  it('no image model, and dev stubs, store nothing and report image_unavailable', async () => {
    Object.assign(env, { devStubs: false, openrouterKey: '', openaiKey: '', xaiKey: '' });
    await expect(renderImageFile(bodyReq)).rejects.toMatchObject({ code: 'image_unavailable' });
    Object.assign(env, { devStubs: true, openaiKey: 'test-key' });
    await expect(renderImageFile({ ...bodyReq, style: 'branded' })).rejects.toMatchObject({ code: 'image_unavailable' });
    expect(M.put).not.toHaveBeenCalled();
  });
  it('sends the literal scene prompt to the model, for a template style too', async () => {
    Object.assign(env, { devStubs: false, openrouterKey: '', openaiKey: 'test-key', xaiKey: '' });
    const fetcher = vi.fn(async () => png()); vi.stubGlobal('fetch', fetcher); M.put.mockResolvedValue('/api/files/bid/article-body/1.png');
    await renderImageFile({ ...bodyReq, style: 'branded' });
    const sent = JSON.parse((fetcher.mock.calls[0] as any)[1].body).prompt;
    expect(sent).toBe(imagePrompt({ ...bodyReq, style: 'branded' }));
    expect(sent).toContain('Show exactly this scene: A staff bus waiting at the main entrance of a residential community.');
  });
});

const coverReq = { bid: 'bid', style: 'illustration', brand: { primary: '#123456', secondary: '#abcdef' }, headline: 'Wasl 611 Reviews', name: 'Lived', seed: 3, prompt: 'The exterior of Wasl 611 seen from outside the entrance gate', w: 1200, h: 628, kind: 'hero' };
describe('the image prompt', () => {
  const END = ' No words, letters, numbers, logos or watermarks anywhere in the image.';
  it('without `literal` is the prompt every caller got before, to the character', () => {
    expect(imagePrompt(coverReq)).toBe("Modern flat editorial illustration, clean geometric shapes, generous negative space, calm and professional. Subject: The exterior of Wasl 611 seen from outside the entrance gate. Made for Lived's blog. Color palette built around the brand colors #123456 and #abcdef, with neutral tones. Variation 3. No words, letters, numbers, logos or watermarks anywhere in the image.");
    expect(imagePrompt({ ...coverReq, literal: false })).toBe(imagePrompt(coverReq));
    expect(imagePrompt({ ...coverReq, style: 'editorial', kind: 'social', cropSafe: true, prompt: undefined })).toBe("Conceptual editorial illustration built around one clear visual metaphor, textured shapes, magazine-cover quality, calm and professional. Subject: Wasl 611 Reviews. Made for Lived's social media post. Color palette built around the brand colors #123456 and #abcdef, with neutral tones. Variation 3. Keep the main subject in the centre with background to spare on every side, so the image can be cropped. No words, letters, numbers, logos or watermarks anywhere in the image.");
  });
  it('with `literal` shows the scene itself, forbids a metaphor, and ends with the same no-text sentence', () => {
    const p = imagePrompt({ ...coverReq, literal: true });
    expect(p).toBe("Modern flat editorial illustration, clean geometric shapes, generous negative space, calm and professional. Show exactly this scene: The exterior of Wasl 611 seen from outside the entrance gate. Draw the real thing described, literally and recognisably, in its setting. Do not replace it with a visual metaphor, symbols, icons or abstract shapes. Made for Lived's blog. Use the brand colors #123456 and #abcdef as accents where they fit naturally, with realistic, neutral tones elsewhere. Variation 3. Any signs, screens or documents in the scene are blank. No words, letters, numbers, logos or watermarks anywhere in the image.");
    expect(p.endsWith(END)).toBe(true); expect(imagePrompt(coverReq).endsWith(END)).toBe(true);
  });
  it('a literal scene keeps its own final punctuation, loses stray whitespace, and falls back to the headline', () => {
    expect(imagePrompt({ ...coverReq, literal: true, prompt: '  A shared kitchen,\n seen from the doorway!  ' })).toContain('Show exactly this scene: A shared kitchen, seen from the doorway! Draw the real thing');
    expect(imagePrompt({ ...coverReq, literal: true, prompt: '' })).toContain('Show exactly this scene: Wasl 611 Reviews. Draw the real thing');
  });
  it('styles whose standard text asks for a metaphor or abstract objects have a literal wording; the others keep theirs', () => {
    expect(imagePrompt({ ...coverReq, literal: true, style: 'editorial' })).toMatch(/^Editorial illustration with textured shapes, magazine-cover quality, calm and professional\. Show exactly/);
    expect(imagePrompt({ ...coverReq, literal: true, style: 'render3d' })).toMatch(/^3D render with real depth, soft studio lighting and gentle shadows, with glossy glass, soft clay or brushed metal finishes\. Show exactly/);
    expect(imagePrompt({ ...coverReq, literal: true, style: 'photography' })).toMatch(/^Editorial photograph, natural light, realistic, shallow depth of field\. Show exactly/);
    for (const style of ['branded', 'infographic', 'unknown']) expect(imagePrompt({ ...coverReq, literal: true, style })).toMatch(/^Modern flat editorial illustration/);
    for (const style of ['editorial', 'render3d']) expect(imagePrompt({ ...coverReq, literal: true, style }).split('. Show exactly')[0]).not.toMatch(/metaphor|objects/);
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
