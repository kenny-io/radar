// Image spend records (LG-2, LG-5): every image-model generation attempt writes one ai_calls row per provider asked;
// brand-template renders and skipped providers write none. fetch is mocked (no provider is called), storage and the db
// are mocked to capture stored files and rows. Modules are booted fresh per test so provider cooldowns never leak.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const H = vi.hoisted(() => ({ inserted: [] as any[], values: (_row: any): any => Promise.resolve(), stored: [] as Buffer[] }));
vi.mock('@/server/db', () => ({ db: { insert: () => ({ values: (row: any) => { H.inserted.push(row); return H.values(row); } }) }, schema: { aiCalls: {} } }));
vi.mock('@/server/observability/failures', () => ({ reportFailure: async () => {} }));
vi.mock('./storage', () => ({ objectKey: (bid: string, kind: string, ext: string) => `${bid}/${kind}/${H.stored.length}.${ext}`, putObject: async (key: string, body: Buffer) => { H.stored.push(body); return `mem://${key}`; } }));

const OR_KEY = 'sk-or-v1-imagerecords0123456789';
const VARS = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'OPENROUTER_IMAGE_MODEL', 'OPENAI_IMAGE_MODEL', 'XAI_IMAGE_MODEL', 'RADAR_DEV_STUBS'];
const saved: Record<string, string | undefined> = {};
for (const v of VARS) saved[v] = process.env[v];
async function boot(keys: Record<string, string | undefined>) {
  for (const v of VARS) delete process.env[v];
  for (const [k, v] of Object.entries(keys)) if (v !== undefined) process.env[k] = v;
  vi.resetModules();
  return import('./images');
}
const ALL = { OPENROUTER_API_KEY: OR_KEY, OPENAI_API_KEY: 'oa-key-0123456789', XAI_API_KEY: 'xa-key-0123456789' };

let urls: string[] = [];
function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  urls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: any) => { urls.push(String(url)); return handler(String(url)); }));
}
const json = (v: any, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const b64 = (() => { const c = createCanvas(96, 64); const x = c.getContext('2d'); x.fillStyle = '#12ab34'; x.fillRect(0, 0, 96, 64); return c.toBuffer('image/png').toString('base64'); })();
const OR = 'https://openrouter.ai/api/v1/images', OA = 'https://api.openai.com/v1/images/generations', XA = 'https://api.x.ai/v1/images/generations';
const SUBJECT = 'A lighthouse above a calm harbour';
const req = (over: Record<string, any> = {}) => ({ bid: 'biz-1', style: 'illustration', brand: { primary: '#112233', secondary: '#445566' }, headline: SUBJECT, name: 'Fieldnote', seed: 3, w: 1200, h: 628, kind: 'hero', ...over });
const ROW = { businessId: 'biz-1', task: 'image', purpose: 'image.hero' };
const caught = (p: Promise<any>) => p.then(() => null, (e: any) => e);

beforeEach(() => {
  H.inserted.length = 0; H.stored.length = 0; H.values = () => Promise.resolve();
  vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const v of VARS) if (saved[v] === undefined) delete process.env[v]; else process.env[v] = saved[v];
});

describe('one row per provider asked', () => {
  it('OpenRouter answers: its model, its tokens and the cost it reported', async () => {
    const images = await boot(ALL);
    mockFetch(() => json({ data: [{ b64_json: b64, media_type: 'image/png' }], usage: { prompt_tokens: 60, completion_tokens: 1290, cost: 0.039 } }));
    await images.renderImageFile(req());
    expect(urls).toEqual([OR]);
    expect(H.inserted).toEqual([{ ...ROW, model: 'google/gemini-nano-banana-2.1', provider: 'openrouter', latencyMs: expect.any(Number), inputTokens: 60, outputTokens: 1290, costUsd: 0.039, ok: true, error: null }]);
  });
  it('OpenRouter 500, then OpenAI answers: two rows, the failed one with no usage', async () => {
    const images = await boot(ALL);
    mockFetch(u => (u === OR ? json({ error: { message: 'upstream down' } }, 500) : json({ data: [{ b64_json: b64 }], usage: { input_tokens: 40, output_tokens: 4160, total_tokens: 4200 } })));
    await images.renderImageFile(req());
    expect(urls).toEqual([OR, OA]);
    expect(H.inserted).toEqual([
      { ...ROW, model: 'google/gemini-nano-banana-2.1', provider: 'openrouter', latencyMs: expect.any(Number), inputTokens: null, outputTokens: null, costUsd: null, ok: false, error: expect.stringMatching(/^openrouter image 500/) },
      // The default OpenAI image model is priced per token: 40 text input at $5/M plus 4,160 image output at $30/M.
      { ...ROW, model: 'gpt-image-2.5-flare', provider: 'OpenAI', latencyMs: expect.any(Number), inputTokens: 40, outputTokens: 4160, costUsd: 0.125, ok: true, error: null },
    ]);
  });
  it('xAI bills per image: $0.02, and the row names the model asked', async () => {
    const images = await boot({ XAI_API_KEY: ALL.XAI_API_KEY });
    mockFetch(() => json({ data: [{ b64_json: b64 }] }));
    await images.renderImageFile(req({ kind: 'social' }));
    expect(urls).toEqual([XA]);
    expect(H.inserted).toEqual([{ ...ROW, purpose: 'image.social', model: 'grok-imagine-image', provider: 'SpaceX', latencyMs: expect.any(Number), inputTokens: null, outputTokens: null, costUsd: 0.02, ok: true, error: null }]);
  });
  it('an overridden xAI image model has no listed rate, so its cost is null', async () => {
    const images = await boot({ XAI_API_KEY: ALL.XAI_API_KEY, XAI_IMAGE_MODEL: 'grok-imagine-pro' });
    mockFetch(() => json({ data: [{ b64_json: b64 }] }));
    await images.generatePhoto(req({ kind: undefined }));
    expect(H.inserted).toMatchObject([{ purpose: 'image.images', model: 'grok-imagine-pro', provider: 'SpaceX', costUsd: null, ok: true }]);
  });
  it.each([
    ['an SVG image', { data: [{ b64_json: Buffer.from('<svg/>').toString('base64'), media_type: 'image/svg+xml' }] }, /SVG/],
    ['no image', { data: [] }, /empty/],
    ['an error body', { error: { code: 502, message: 'provider error' } }, /provider error/],
  ] as const)('OpenRouter answered with %s: the failed row keeps the usage it reported, then OpenAI is asked', async (_label, body, error) => {
    const images = await boot(ALL);
    mockFetch(u => (u === OR ? json({ ...body, usage: { prompt_tokens: 60, completion_tokens: 12, cost: 0.004 } }) : json({ data: [{ b64_json: b64 }] })));
    await images.generatePhoto(req());
    expect(H.inserted).toMatchObject([
      { provider: 'openrouter', inputTokens: 60, outputTokens: 12, costUsd: 0.004, ok: false, error: expect.stringMatching(error) },
      { provider: 'OpenAI', inputTokens: null, outputTokens: null, costUsd: null, ok: true, error: null },
    ]);
  });
  it('an explicit custom request with every provider failing still throws, and each attempt has its row', async () => {
    const images = await boot(ALL);
    mockFetch(() => json({ error: { message: 'down' } }, 500));
    const e = await caught(images.renderImageFile(req({ modelRequired: true, prompt: SUBJECT })));
    expect(e?.message).toMatch(/^xai image 500/);
    expect(H.stored).toHaveLength(0);
    expect(urls).toEqual([OR, OA, XA]);
    expect(H.inserted.map(r => [r.provider, r.model, r.ok, r.costUsd])).toEqual([['openrouter', 'google/gemini-nano-banana-2.1', false, null], ['OpenAI', 'gpt-image-2.5-flare', false, null], ['SpaceX', 'grok-imagine-image', false, null]]);
  });
  it('a strict article body request with every provider failing: one row per provider asked, under its own purpose, and no template', async () => {
    const images = await boot(ALL);
    mockFetch(() => json({ error: { message: 'down' } }, 500));
    const e = await caught(images.renderImageFile(req({ kind: 'article-body', w: 1200, h: 675, modelRequired: true, literal: true, prompt: SUBJECT })));
    expect(e?.message).toMatch(/^xai image 500/);
    expect(H.stored).toHaveLength(0);
    expect(urls).toEqual([OR, OA, XA]);
    expect(H.inserted.map(r => [r.purpose, r.provider, r.ok])).toEqual([['image.article-body', 'openrouter', false], ['image.article-body', 'OpenAI', false], ['image.article-body', 'SpaceX', false]]);
  });
  it('a model style falling back to the brand template has the failed attempt\'s row and nothing for the template', async () => {
    const images = await boot({ OPENAI_API_KEY: ALL.OPENAI_API_KEY });
    mockFetch(() => json({ error: { message: 'down' } }, 500));
    await images.renderImageFile(req());
    const img = await loadImage(H.stored[0]);
    expect([img.width, img.height]).toEqual([1200, 628]);
    expect(H.inserted.map(r => [r.provider, r.ok])).toEqual([['OpenAI', false]]);
  });
});

describe('no generation, no row', () => {
  it.each(['branded', 'infographic'])('a %s template render', async style => {
    const images = await boot(ALL); mockFetch(() => json({}));
    await images.renderImageFile(req({ style }));
    expect(urls).toHaveLength(0); expect(H.stored).toHaveLength(1); expect(H.inserted).toHaveLength(0);
  });
  it('a model style with no image model configured (template), and with dev stubs on', async () => {
    for (const keys of [{}, { ...ALL, RADAR_DEV_STUBS: '1' }]) {
      const images = await boot(keys); mockFetch(() => json({}));
      await images.renderImageFile(req());
      expect(urls).toHaveLength(0); expect(H.inserted).toHaveLength(0);
    }
    expect(H.stored).toHaveLength(2);
  });
  it('a file cut from an image the caller already has, or its template, asks no model', async () => {
    const images = await boot(ALL); mockFetch(() => json({}));
    await images.renderImageFile(req({ kind: 'social' }), { raw: Buffer.from(b64, 'base64') });
    await images.renderImageFile(req({ kind: 'social' }), 'template');
    expect(urls).toHaveLength(0); expect(H.stored).toHaveLength(2); expect(H.inserted).toHaveLength(0);
  });
  it('a provider skipped during its account cooldown is not asked again and writes no second row', async () => {
    const images = await boot({ OPENAI_API_KEY: ALL.OPENAI_API_KEY, XAI_API_KEY: ALL.XAI_API_KEY });
    mockFetch(u => (u === OA ? json({ error: { message: 'billing hard limit' } }, 402) : json({ data: [{ b64_json: b64 }] })));
    await images.generatePhoto(req()); await images.generatePhoto(req());
    expect(urls).toEqual([OA, XA, XA]);
    expect(H.inserted.map(r => [r.provider, r.ok])).toEqual([['OpenAI', false], ['SpaceX', true], ['SpaceX', true]]);
  });
});

describe('recording never reaches the work, and rows hold no content', () => {
  it('an insert that rejects, and one that throws, do not fail the image', async () => {
    const images = await boot(ALL);
    mockFetch(() => json({ data: [{ b64_json: b64 }], usage: { cost: 0.04 } }));
    H.values = () => Promise.reject(new Error('db down'));
    expect((await images.renderImageFile(req())).type).toBe('image/png');
    H.values = () => { throw new Error('db exploded'); };
    mockFetch(u => (u === OR ? json({ error: { message: 'down' } }, 500) : json({ data: [{ b64_json: b64 }] })));
    expect((await images.renderImageFile(req())).type).toBe('image/png');
    await new Promise(r => setTimeout(r, 0)); // a swallowed rejection would surface here as an unhandled rejection
    expect(H.stored).toHaveLength(2); expect(H.inserted).toHaveLength(3);
  });
  it('no prompt text and no key in a row, even when a provider echoes the key back', async () => {
    const images = await boot(ALL);
    mockFetch(u => (u === OR ? json({ error: { message: `No auth for ${OR_KEY}` } }, 500) : json({ data: [{ b64_json: b64 }] })));
    await images.generatePhoto(req());
    const blob = JSON.stringify(H.inserted);
    expect(H.inserted).toHaveLength(2);
    expect(blob).not.toContain(OR_KEY); expect(blob).toContain('[redacted]'); expect(blob).not.toContain(SUBJECT);
    for (const r of H.inserted) expect(Object.keys(r).sort()).toEqual(['businessId', 'costUsd', 'error', 'inputTokens', 'latencyMs', 'model', 'ok', 'outputTokens', 'provider', 'purpose', 'task']);
  });
});
