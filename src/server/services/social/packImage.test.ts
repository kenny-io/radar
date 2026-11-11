// One image-model generation per social pack (IM-1..4). createPack runs for real with its image code (images.ts) and
// the recorder; the writing model, the database, storage and fetch are mocked, so no provider is called. Generations
// are counted as fetch calls to an image endpoint, and sizes are read back from the stored PNG files.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { IMG_SIZES } from '@/lib/constants';
import { packPreflightInput, preflight } from '@/lib/socialPublish';
import type { Platform, Profile } from '@/lib/types';

const H = vi.hoisted(() => ({ rows: [] as any[], packs: [] as any[], stored: [] as { key: string; body: Buffer }[], reports: [] as any[], put: null as null | ((key: string) => void) }));
vi.mock('@/server/db', () => {
  const tx = { insert: () => ({ values: (v: any) => ({ onConflictDoNothing: () => ({ returning: async () => { H.packs.push(v.data); return [{ id: v.id }]; } }) }) }) };
  return { db: { insert: () => ({ values: (row: any) => { H.rows.push(row); return Promise.resolve(); } }), transaction: async (fn: any) => fn(tx) }, schema: { aiCalls: {}, socialPacks: { id: 'id', businessId: 'business_id' } } };
});
vi.mock('@/server/ai', () => ({ ai: { run: async (_task: string, input: any) => ({ json: { text: `Docs drift when nobody owns them. Give each page an owner. (${input.stubContext.platform})` } }) }, profileContext: () => 'BUSINESS PROFILE\nName: Fieldnote' }));
vi.mock('@/server/workspace', () => ({ getBiz: async () => ({ domain: 'fieldnote.test', profile: PROFILE }), bizToday: () => '2026-11-10' }));
vi.mock('@/server/observability/failures', () => ({ reportFailure: async (_e: unknown, context: any) => { H.reports.push(context); } }));
vi.mock('@/server/services/storage', () => ({ objectKey: (bid: string, kind: string, ext: string) => `${bid}/${kind}/${H.stored.length}.${ext}`, putObject: async (key: string, body: Buffer) => { H.put?.(key); H.stored.push({ key, body }); return `mem://${key}`; } }));
vi.mock('@/server/services/lifecycle/engagement', () => ({ recordEngagement: async () => {}, resolveEngagement: async () => {} }));
vi.mock('./source', () => ({ readArticle: async () => { throw new Error('unused'); }, readUrl: async () => { throw new Error('unused'); } }));
vi.mock('./stubs', () => ({}));

const PROFILE = { business: { name: 'Fieldnote', description: 'Documentation tools' }, brand: { voice: 'Clear', language: 'English (US)', primary: '#112233', secondary: '#445566' }, audience: { competitors: ['Docly'] } };
const P = { ...PROFILE, domain: 'fieldnote.test' } as unknown as Profile;
const HEADLINE = 'Keeping docs current';
const OR_KEY = 'sk-or-v1-packimage0123456789';
const VARS = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'OPENROUTER_IMAGE_MODEL', 'OPENAI_IMAGE_MODEL', 'XAI_IMAGE_MODEL', 'RADAR_DEV_STUBS', 'RADAR_SOCIAL_PACK_IMAGE'];
const saved: Record<string, string | undefined> = {};
for (const v of VARS) saved[v] = process.env[v];
async function boot(keys: Record<string, string | undefined> = { OPENROUTER_API_KEY: OR_KEY }) {
  for (const v of VARS) delete process.env[v];
  for (const [k, v] of Object.entries(keys)) if (v !== undefined) process.env[k] = v;
  vi.resetModules();
  return { gen: await import('./generate'), images: await import('../images') };
}

const OR = 'https://openrouter.ai/api/v1/images';
const IMAGE_HOSTS = /openrouter\.ai\/api\/v1\/images|\/v1\/images\/generations/;
let calls: { url: string; body: any }[] = [];
function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => { calls.push({ url: String(url), body: typeof init.body === 'string' ? JSON.parse(init.body) : null }); return handler(String(url)); }));
}
const generations = () => calls.filter(c => IMAGE_HOSTS.test(c.url));
const json = (v: any, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
/** What the "model" returns: a 3:2 picture, red with a blue block in the middle, so a centred crop is recognisable. */
const MODEL_PNG = (() => { const c = createCanvas(1536, 1024); const x = c.getContext('2d'); x.fillStyle = '#ff0000'; x.fillRect(0, 0, 1536, 1024); x.fillStyle = '#0000ff'; x.fillRect(618, 362, 300, 300); return c.toBuffer('image/png').toString('base64'); })();
const answers = () => json({ data: [{ b64_json: MODEL_PNG, media_type: 'image/png' }], usage: { prompt_tokens: 60, completion_tokens: 1290, cost: 0.039 } });
const down = () => json({ error: { message: 'image model down' } }, 500);
const CROP_SAFE = 'Keep the main subject in the centre with background to spare on every side, so the image can be cropped.';

const input = (platforms: Platform[], over: Record<string, any> = {}) => ({ source: { kind: 'idea' as const, label: HEADLINE }, platforms, style: 'illustration' as const, ...over });
async function decoded(i: number) {
  const img = await loadImage(H.stored[i].body);
  const ctx = createCanvas(img.width, img.height).getContext('2d'); ctx.drawImage(img, 0, 0);
  const px = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
  return { size: [img.width, img.height], centre: px(Math.floor(img.width / 2), Math.floor(img.height / 2)), corner: px(4, 4), png: H.stored[i].body.subarray(0, 4).toString('hex') === '89504e47' };
}
const BLUE = [0, 0, 255, 255], RED = [255, 0, 0, 255];
const lastPack = () => H.packs[H.packs.length - 1];

beforeEach(() => {
  H.rows.length = 0; H.packs.length = 0; H.stored.length = 0; H.reports.length = 0; H.put = null;
  vi.spyOn(Math, 'random').mockReturnValue(0.5); // seed0 = 25, so the posts' seeds are 175, 176, 177
  vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const v of VARS) if (saved[v] === undefined) delete process.env[v]; else process.env[v] = saved[v];
});

describe('packAspect', () => {
  it('is the geometric mean of the widest and tallest platform, and a single size keeps its own ratio', async () => {
    const { gen } = await boot();
    expect(gen.packAspect(['linkedin', 'x', 'facebook', 'reddit', 'quora'])).toBeCloseTo(Math.sqrt((1200 / 628) * (1200 / 900)), 10); // 1.60
    expect(gen.packAspect(['linkedin', 'x', 'facebook', 'quora'])).toBeCloseTo(Math.sqrt((1200 / 628) * (1200 / 675)), 10); // 1.84
    expect(gen.packAspect(['reddit'])).toBeCloseTo(1200 / 900, 10);
    expect(gen.packAspect(['linkedin', 'facebook', 'quora'])).toBeCloseTo(1200 / 628, 10);
  });
});

describe('a new pack whose style goes to the image model', () => {
  it('three platforms: one generation, three files cut to each platform\'s own size', async () => {
    const { gen } = await boot(); mockFetch(answers);
    const progress: number[] = [];
    await gen.createPack('biz-1', input(['linkedin', 'x', 'reddit']), n => { progress.push(n); });
    expect(generations()).toHaveLength(1);
    expect(generations()[0].url).toBe(OR);
    expect(generations()[0].body.aspect_ratio).toBe('3:2');
    expect(generations()[0].body.prompt).toContain(`Subject: ${HEADLINE}.`);
    expect(generations()[0].body.prompt).toContain(`Variation 175. ${CROP_SAFE} No words`);
    expect(progress).toEqual([1, 2, 3]);

    expect(H.stored).toHaveLength(3);
    const files = await Promise.all([0, 1, 2].map(decoded));
    expect(files.map(f => f.size)).toEqual([[1200, 628], [1200, 675], [1200, 900]]);
    for (const f of files) { expect(f.png).toBe(true); expect(f.centre).toEqual(BLUE); expect(f.corner).toEqual(RED); } // a centred crop of the one image

    const posts = lastPack().posts;
    expect(Object.keys(posts)).toEqual(['linkedin', 'x', 'reddit']);
    (['linkedin', 'x', 'reddit'] as const).forEach((k, i) => {
      expect(posts[k]).toEqual({ text: expect.any(String), style: 'illustration', seed: 175 + i, imageUrl: `mem://${H.stored[i].key}`, photo: true, imageMeta: { bytes: H.stored[i].body.length, type: 'image/png' }, copiedAt: null, v: 0 });
      if (k !== 'reddit') expect(preflight(k, packPreflightInput(posts[k]))).toEqual([]); // the posting size and type checks (Radar posts to X and LinkedIn)
    });
    expect(new Set(Object.values(posts).map((x: any) => x.imageUrl)).size).toBe(3);
    // One generation is one ai_calls row for the pack.
    expect(H.rows).toMatchObject([{ businessId: 'biz-1', task: 'image', purpose: 'image.social', model: 'google/gemini-nano-banana-2.1', provider: 'openrouter', costUsd: 0.039, ok: true }]);
    expect(H.reports).toEqual([]);
  });
  it('asks for 3:2 with Reddit in the pack and 16:9 without it', async () => {
    const { gen } = await boot(); mockFetch(answers);
    await gen.createPack('biz-1', input(['linkedin', 'x', 'facebook', 'reddit', 'quora']));
    await gen.createPack('biz-1', input(['x', 'reddit']));
    await gen.createPack('biz-1', input(['linkedin', 'x', 'facebook', 'quora']));
    expect(generations().map(c => c.body.aspect_ratio)).toEqual(['3:2', '3:2', '16:9']);
    expect((await Promise.all(H.stored.map((_f, i) => decoded(i)))).map(f => f.size)).toEqual([...['linkedin', 'x', 'facebook', 'reddit', 'quora'], ...['x', 'reddit'], ...['linkedin', 'x', 'facebook', 'quora']].map(k => IMG_SIZES[k]));
  });
  it('platforms that share one size need no crop margin: one generation at that size, with today\'s prompt', async () => {
    const { gen } = await boot(); mockFetch(answers);
    await gen.createPack('biz-1', input(['linkedin', 'facebook', 'quora']));
    expect(generations()).toHaveLength(1);
    expect(generations()[0].body.aspect_ratio).toBe('16:9');
    expect(generations()[0].body.prompt).not.toContain('cropped');
    expect(H.stored).toHaveLength(3);
  });
  it('one platform: one generation, the same request a single post makes on its own', async () => {
    const { gen } = await boot(); mockFetch(answers);
    await gen.createPack('biz-1', input(['reddit']));
    await gen.renderPostImage('biz-1', P, 'reddit', { style: 'illustration', seed: 175 }, HEADLINE);
    expect(generations()).toHaveLength(2);
    expect(generations()[0].body).toEqual(generations()[1].body);
    expect(generations()[0].body.aspect_ratio).toBe('4:3');
    expect((await decoded(0)).size).toEqual([1200, 900]);
  });
  it('a pack\'s custom direction is the subject of its one generation', async () => {
    const { gen } = await boot(); mockFetch(answers);
    await gen.createPack('biz-1', input(['linkedin', 'reddit'], { style: 'custom', custom: 'Soft watercolour of a desk' }));
    expect(generations()).toHaveLength(1);
    expect(generations()[0].body.prompt).toContain(`Subject: Soft watercolour of a desk. Topic: ${HEADLINE}.`);
    expect(lastPack().posts.linkedin).toMatchObject({ style: 'illustration', photo: true });
  });
});

describe('RADAR_SOCIAL_PACK_IMAGE=per_platform', () => {
  it('restores one generation per platform, each at its own size with today\'s prompt, and is read at call time', async () => {
    const { gen } = await boot(); mockFetch(answers);
    process.env.RADAR_SOCIAL_PACK_IMAGE = 'per_platform';
    await gen.createPack('biz-1', input(['linkedin', 'x', 'reddit']));
    expect(generations().map(c => c.body.aspect_ratio)).toEqual(['16:9', '16:9', '4:3']);
    expect(generations().map(c => /Variation (\d+)\./.exec(c.body.prompt)![1])).toEqual(['175', '176', '177']);
    expect(generations().some(c => c.body.prompt.includes('cropped'))).toBe(false);
    expect((await Promise.all([0, 1, 2].map(decoded))).map(f => f.size)).toEqual([[1200, 628], [1200, 675], [1200, 900]]);
    expect(H.rows.filter(r => r.task === 'image')).toHaveLength(3);
    // Same process, no restart: unsetting it goes back to one generation for the pack.
    delete process.env.RADAR_SOCIAL_PACK_IMAGE; calls.length = 0;
    await gen.createPack('biz-1', input(['linkedin', 'x', 'reddit']));
    expect(generations()).toHaveLength(1);
  });
});

describe('when the one generation fails', () => {
  it('every platform gets its brand template at its own size, with no further generation', async () => {
    const { gen, images } = await boot(); mockFetch(down);
    await gen.createPack('biz-1', input(['linkedin', 'x', 'reddit']));
    expect(generations()).toHaveLength(1);
    expect(H.stored).toHaveLength(3);
    const posts = lastPack().posts;
    for (const [i, k] of (['linkedin', 'x', 'reddit'] as const).entries()) {
      const [w, h] = IMG_SIZES[k];
      expect((await decoded(i)).size).toEqual([w, h]);
      expect(H.stored[i].body.equals(images.renderTemplatePng({ style: 'illustration', brand: P.brand, headline: HEADLINE, name: 'Fieldnote', seed: 175 + i, w, h }))).toBe(true);
      expect(posts[k]).toMatchObject({ seed: 175 + i, imageUrl: `mem://${H.stored[i].key}`, imageMeta: { bytes: H.stored[i].body.length, type: 'image/png' } });
    }
    // The provider attempt is reported (and recorded) once, and the pack's fallback once: not once per platform.
    expect(H.reports.filter(r => r.operation === 'image.generate' && !r.provider)).toEqual([{ source: 'image', operation: 'image.generate', businessId: 'biz-1', degraded: true }]);
    expect(H.rows.map(r => [r.task, r.provider, r.ok])).toEqual([['image', 'openrouter', false]]);
  });
  it('each configured provider is asked once for the pack, not once per platform', async () => {
    const { gen } = await boot({ OPENROUTER_API_KEY: OR_KEY, OPENAI_API_KEY: 'oa-key-0123456789', XAI_API_KEY: 'xa-key-0123456789' }); mockFetch(down);
    await gen.createPack('biz-1', input(['linkedin', 'x', 'reddit']));
    expect(generations().map(c => new URL(c.url).hostname)).toEqual(['openrouter.ai', 'api.openai.com', 'api.x.ai']);
    expect(H.stored).toHaveLength(3);
  });
  it('an image that cannot be decoded gives each platform its template, still with one generation', async () => {
    const { gen } = await boot(); mockFetch(() => json({ data: [{ b64_json: Buffer.from('not an image').toString('base64') }] }));
    await gen.createPack('biz-1', input(['linkedin', 'reddit']));
    expect(generations()).toHaveLength(1);
    expect((await Promise.all([0, 1].map(decoded))).map(f => f.size)).toEqual([[1200, 628], [1200, 900]]);
  });
  it('a storage error on one platform leaves that post without a file and the others intact, as before', async () => {
    const { gen } = await boot(); mockFetch(answers);
    let n = 0; H.put = () => { if (++n === 2) throw new Error('bucket unavailable'); };
    await gen.createPack('biz-1', input(['linkedin', 'x', 'reddit']));
    expect(generations()).toHaveLength(1);
    const posts = lastPack().posts;
    expect([posts.linkedin.imageUrl, posts.x.imageUrl, posts.reddit.imageUrl].map(u => !!u)).toEqual([true, false, true]); // publish-time rendering fills the gap
    expect(posts.x.imageMeta).toBeUndefined();
  });
});

describe('unchanged paths', () => {
  it('template styles and dev stubs ask no image model', async () => {
    const a = await boot(); mockFetch(answers);
    await a.gen.createPack('biz-1', input(['linkedin', 'x', 'reddit'], { style: 'branded' }));
    const b = await boot({ OPENROUTER_API_KEY: OR_KEY, RADAR_DEV_STUBS: '1' });
    await b.gen.createPack('biz-1', input(['linkedin', 'x', 'reddit']));
    expect(generations()).toHaveLength(0);
    expect(H.rows).toHaveLength(0);
    expect((await Promise.all(H.stored.map((_f, i) => decoded(i)))).map(f => f.size)).toEqual([[1200, 628], [1200, 675], [1200, 900], [1200, 628], [1200, 675], [1200, 900]]);
    expect(H.packs[0].posts.x.photo).toBe(false);
  });
  it('regenerating one platform (and publish-time rendering) makes its own generation at that platform\'s size with today\'s prompt', async () => {
    const { gen } = await boot(); mockFetch(answers);
    const r = await gen.renderPostImage('biz-1', P, 'x', { style: 'illustration', seed: 186 }, HEADLINE);
    expect(generations()).toHaveLength(1);
    expect(generations()[0].body).toEqual({ model: 'google/gemini-nano-banana-2.1', aspect_ratio: '16:9', n: 1, prompt: 'Modern flat editorial illustration, clean geometric shapes, generous negative space, calm and professional. Subject: Keeping docs current. Made for Fieldnote\'s social media post. Color palette built around the brand colors #112233 and #445566, with neutral tones. Variation 186. No words, letters, numbers, logos or watermarks anywhere in the image.' });
    expect((await decoded(0)).size).toEqual([1200, 675]);
    expect(r).toEqual({ url: `mem://${H.stored[0].key}`, photo: true, meta: { bytes: H.stored[0].body.length, type: 'image/png' } });
  });
  it('a post\'s own image prompt always generates on its own and never falls back to a template', async () => {
    const { gen } = await boot(); mockFetch(answers);
    const post = { style: 'branded' as const, seed: 9, imagePrompt: 'A red bicycle against a white wall' };
    // Even handed a pack's shared source, an explicit request is its own generation.
    await gen.renderPostImage('biz-1', P, 'linkedin', post, HEADLINE, undefined, 'template');
    expect(generations()).toHaveLength(1);
    expect(generations()[0].body.prompt).toContain('Subject: A red bicycle against a white wall.');
    expect((await decoded(0)).centre).toEqual(BLUE);
    mockFetch(down);
    await expect(gen.renderPostImage('biz-1', P, 'linkedin', post, HEADLINE)).rejects.toThrow(/openrouter image 500/);
    expect(generations()).toHaveLength(1);
    expect(H.stored).toHaveLength(1); // nothing stored for the failed request
  });
});
