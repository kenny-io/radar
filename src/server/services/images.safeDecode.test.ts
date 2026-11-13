// A picture from an image provider is never decoded in this process (safe-provider-image-decode, AC2 to AC6).
// images.ts runs for real, and so does the child process it decodes in; starting a child is watched, so "no child was
// started" and "one at a time" can be shown. fetch is mocked (no provider is called); storage, the database and the
// failure reports are captured. Every picture is made here, with the canvas library or from bytes.
// The crashing files end a process that decodes them with a segmentation fault (@napi-rs/canvas 0.1.100, measured on
// darwin arm64). If one of them were decoded here, this file would not fail a test: the test run would die.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({
  spawn: vi.fn(), start: null as null | ((...args: any[]) => any), active: 0, most: 0, ended: [] as { status: number | null; signal: string | null }[],
  rows: [] as any[], packs: [] as any[], stored: [] as { key: string; body: Buffer }[], reports: [] as any[],
}));
vi.mock('node:child_process', async original => {
  const real = await original<typeof import('node:child_process')>();
  H.start = (...args: any[]) => {
    H.most = Math.max(H.most, ++H.active);
    const child = (real.spawn as any)(...args); child.on('close', (status: number | null, signal: string | null) => { H.active--; H.ended.push({ status, signal }); });
    return child;
  };
  H.spawn.mockImplementation(H.start);
  return { ...real, default: { ...real, spawn: H.spawn }, spawn: H.spawn };
});
vi.mock('@/server/db', () => {
  const tx = { insert: () => ({ values: (v: any) => ({ onConflictDoNothing: () => ({ returning: async () => { H.packs.push(v.data); return [{ id: v.id }]; } }) }) }) };
  return { db: { insert: () => ({ values: (row: any) => { H.rows.push(row); return Promise.resolve(); } }), transaction: async (fn: any) => fn(tx) }, schema: { aiCalls: {}, socialPacks: { id: 'id', businessId: 'business_id' } } };
});
vi.mock('@/server/ai', () => ({ ai: { run: async (_task: string, input: any) => ({ json: { text: `Docs drift when nobody owns them. (${input.stubContext.platform})` } }) }, profileContext: () => 'BUSINESS PROFILE\nName: Fieldnote' }));
vi.mock('@/server/workspace', () => ({ getBiz: async () => ({ domain: 'fieldnote.test', profile: PROFILE }), bizToday: () => '2026-11-14' }));
vi.mock('@/server/observability/failures', () => ({ reportFailure: async (_e: unknown, context: any) => { H.reports.push(context); } }));
vi.mock('@/server/services/storage', () => ({ objectKey: (bid: string, kind: string, ext: string) => `${bid}/${kind}/${H.stored.length}.${ext}`, putObject: async (key: string, body: Buffer) => { H.stored.push({ key, body }); return `mem://${key}`; } }));
vi.mock('@/server/services/lifecycle/engagement', () => ({ recordEngagement: async () => {}, resolveEngagement: async () => {} }));
vi.mock('./social/source', () => ({ readArticle: async () => { throw new Error('unused'); }, readUrl: async () => { throw new Error('unused'); } }));
vi.mock('./social/stubs', () => ({}));
import os from 'node:os';
import zlib from 'node:zlib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { IMG_SIZES } from '@/lib/constants';
import { probeImage } from './untrustedImage';

const BRAND = { primary: '#112233', secondary: '#445566' };
const PROFILE = { business: { name: 'Fieldnote', description: 'Documentation tools' }, brand: { voice: 'Clear', language: 'English (US)', ...BRAND }, audience: { competitors: ['Docly'] } };
const HEADLINE = 'Keeping docs current';
const OPENROUTER = { OPENROUTER_API_KEY: 'sk-or-v1-safedecode0123456789' }, OPENAI = { OPENAI_API_KEY: 'oa-key-0123456789' }, XAI = { XAI_API_KEY: 'xa-key-0123456789' };
const VARS = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'OPENROUTER_IMAGE_MODEL', 'OPENAI_IMAGE_MODEL', 'XAI_IMAGE_MODEL', 'RADAR_DEV_STUBS', 'RADAR_SOCIAL_PACK_IMAGE'];
const saved: Record<string, string | undefined> = {};
for (const v of VARS) saved[v] = process.env[v];
/** images.ts booted fresh (so no provider cooldown leaks between tests), with the error class of that same boot. */
async function boot(keys: Record<string, string> = OPENROUTER) {
  for (const v of VARS) delete process.env[v];
  for (const [k, v] of Object.entries(keys)) process.env[k] = v;
  vi.resetModules();
  const images = await import('./images');
  return { images, RadarError: (await import('../errors')).RadarError };
}

let asked: string[] = [];
function mockFetch(handler: (url: string) => Response) {
  asked = [];
  vi.stubGlobal('fetch', vi.fn(async (url: any) => { asked.push(String(url)); return handler(String(url)); }));
}
const json = (v: any, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
/** The provider answers with `file` as its image. OpenRouter also labels it; the label here always says PNG, whatever the bytes are. */
const provider = (file: Buffer) => () => json({ data: [{ b64_json: file.toString('base64'), media_type: 'image/png' }], usage: { prompt_tokens: 60, completion_tokens: 1290, cost: 0.039 } });
const req = (over: Record<string, any> = {}) => ({ bid: 'biz-1', style: 'illustration', brand: BRAND, headline: HEADLINE, name: 'Fieldnote', seed: 3, w: 1200, h: 628, kind: 'hero', ...over });
const caught = (p: Promise<any>) => p.then(v => { throw new Error('expected a rejection, got ' + typeof v); }, (e: any) => e);

type Type = 'image/png' | 'image/jpeg' | 'image/webp';
/** A picture with several colours and nothing symmetric in it, so a crop taken from the wrong place gives other bytes. */
function scene(w: number, h: number, type: Type | 'image/avif' = 'image/png', transparent = false): Buffer {
  const c = createCanvas(w, h); const x = c.getContext('2d');
  if (!transparent) { const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#1f4d3a'); g.addColorStop(0.5, '#f2b544'); g.addColorStop(1, '#7b2cbf'); x.fillStyle = g; x.fillRect(0, 0, w, h); }
  x.fillStyle = '#e63946'; x.fillRect(w * 0.08, h * 0.1, w * 0.25, h * 0.2);
  x.fillStyle = '#1d4ed8'; x.beginPath(); x.arc(w * 0.7, h * 0.65, Math.min(w, h) * 0.18, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#f1faee'; x.lineWidth = Math.max(2, w / 200); x.beginPath(); x.moveTo(0, h); x.lineTo(w, 0); x.stroke();
  return c.toBuffer(type as 'image/png');
}
/** Red, a blue block in the middle, a green band down each side and a white band along the top and the bottom: which
 *  bands survive says which edges a crop removed. */
function banded(w: number, h: number): Buffer {
  const c = createCanvas(w, h); const x = c.getContext('2d');
  x.fillStyle = '#ff0000'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#00ff00'; x.fillRect(0, 0, w * 0.05, h); x.fillRect(w * 0.95, 0, w * 0.05, h);
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h * 0.05); x.fillRect(0, h * 0.95, w, h * 0.05);
  x.fillStyle = '#0000ff'; x.fillRect(w * 0.4, h * 0.4, w * 0.2, h * 0.2);
  return c.toBuffer('image/png');
}
const RED = [255, 0, 0, 255], GREEN = [0, 255, 0, 255], BLUE = [0, 0, 255, 255], WHITE = [255, 255, 255, 255];
/** What coverCrop did before this change, in this process. Only ever given a good file, or Radar's own output. */
async function reference(file: Buffer, w: number, h: number): Promise<Buffer> {
  const img = await loadImage(file);
  const c = createCanvas(w, h); const ctx = c.getContext('2d');
  const s = Math.max(w / img.width, h / img.height); const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return c.toBuffer('image/png');
}
/** Pixels of a PNG that Radar made (a crop that was accepted, or a template). */
async function pixelsOf(png: Buffer) {
  const img = await loadImage(png); const ctx = createCanvas(img.width, img.height).getContext('2d'); ctx.drawImage(img, 0, 0);
  return { size: [img.width, img.height], at: (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data) };
}
/** The same JPEG with an EXIF block saying how the camera was held (6: the stored picture must be turned a quarter). */
function withOrientation(jpeg: Buffer, orientation: number): Buffer {
  const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0x00, orientation, 0, 0, 0, 0, 0, 0]);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const length = Buffer.alloc(2); length.writeUInt16BE(exif.length + 2);
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1]), length, exif, jpeg.subarray(2)]);
}
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u32be = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
/** The same PNG carrying `text` in a text chunk after its header: a good picture with a recognisable string in its bytes. */
function withPngText(png: Buffer, text: string): Buffer {
  const type = Buffer.from('tEXt', 'latin1'), data = Buffer.from('Comment\0' + text, 'latin1');
  return Buffer.concat([png.subarray(0, 33), u32be(data.length), type, data, u32be(zlib.crc32(Buffer.concat([type, data]))), png.subarray(33)]);
}
/** The same JPEG carrying `text` in a comment segment after its start. */
function withJpegComment(jpeg: Buffer, text: string): Buffer {
  const data = Buffer.from(text, 'latin1'); const length = Buffer.alloc(2); length.writeUInt16BE(data.length + 2);
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xfe]), length, data, jpeg.subarray(2)]);
}
/** A WebP file with one chunk of the given kind. Only the header is real. */
function webpHeader(kind: 'VP8L' | 'VP8X', w: number, h: number, o: { animated?: boolean } = {}): Buffer {
  let payload: Buffer;
  if (kind === 'VP8L') { payload = Buffer.alloc(5); payload[0] = 0x2f; payload.writeUInt32LE((((h - 1) << 14) | (w - 1)) >>> 0, 1); }
  else { payload = Buffer.alloc(10); payload[0] = o.animated ? 0x02 : 0x00; payload.writeUIntLE(w - 1, 4, 3); payload.writeUIntLE(h - 1, 7, 3); }
  const chunk = Buffer.concat([Buffer.from(kind, 'latin1'), u32le(payload.length), payload]);
  return Buffer.concat([Buffer.from('RIFF'), u32le(4 + chunk.length), Buffer.from('WEBP'), chunk]);
}
/** A PNG whose header says another size than the picture in it. */
const declaring = (w: number, h: number) => { const png = Buffer.from(scene(64, 64)); png.writeUInt32BE(w, 16); png.writeUInt32BE(h, 20); return png; };

const GOOD = scene(1536, 1024);
/** Text that would be recognised if any of a refused file reached an error message. */
const MARKER = 'marker-7f3a91c2';

// The four files of AC3. `children`: how many child processes one crop of it starts. The first is stopped by the
// check of the bytes (it has no frame header, so it is not a JPEG to read at all); the other three start like a
// picture and end like one, pass that check, and crash the decoder in the child.
const CRASHING: [string, () => Buffer, 0 | 1][] = [
  ['FF D8 FF D9 (a JPEG start and end with nothing between)', () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 0],
  ['a PNG with IHDR and IEND and no IDAT', () => { const png = scene(800, 600); return Buffer.concat([png.subarray(0, 33), png.subarray(png.length - 12)]); }, 1],
  ['a PNG whose IHDR checksum is wrong', () => { const png = Buffer.from(scene(800, 600)); png[29] ^= 0xff; return png; }, 1],
  ['a JPEG with a frame header and no scan', () => { const jpeg = scene(800, 600, 'image/jpeg'); return Buffer.concat([jpeg.subarray(0, jpeg.indexOf(Buffer.from([0xff, 0xda]))), Buffer.from([0xff, 0xd9])]); }, 1],
];

function notARadarError(e: any, RadarError: any) {
  expect(e).toBeInstanceOf(Error); expect(e).not.toBeInstanceOf(RadarError);
  expect(e.code).toBeUndefined(); expect(e.status).toBeUndefined(); expect(e.userMessage).toBeUndefined();
  expect(e.message).not.toContain(MARKER); expect(e.message.length).toBeLessThan(160);
}
const template = (images: any, r: Record<string, any>) => images.renderTemplatePng(r) as Buffer;
/** A child that ignores the decoder and runs `program` instead, with `arg` as its one argument: what a decoder gone
 *  wrong could do. It is started and watched like the real one. */
const standIn = (program: string, arg: unknown = {}) => (command: string, _args: string[], options: any) => H.start!(command, ['-e', program, JSON.stringify(arg)], options);
/** Real time, also while a test has replaced setTimeout. */
const realSetTimeout = globalThis.setTimeout;
const pause = (ms: number) => new Promise<void>(resolve => { realSetTimeout(resolve, ms); });
const SECRET_VAR = 'SAFE_DECODE_TEST_SECRET';

beforeEach(() => {
  H.spawn.mockReset(); if (H.start) H.spawn.mockImplementation(H.start); H.active = 0; H.most = 0; H.ended.length = 0;
  H.rows.length = 0; H.packs.length = 0; H.stored.length = 0; H.reports.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env[SECRET_VAR];
  for (const v of VARS) if (saved[v] === undefined) delete process.env[v]; else process.env[v] = saved[v];
});

describe('a good picture is cropped to the same PNG as before, in a child process (AC2)', () => {
  // Each source has another shape than its target, so each crop removes something: top and bottom, the sides, or
  // (the small one) nothing but is enlarged.
  const CROPS: [number, number, number, number][] = [[1536, 1024, 1200, 628], [1024, 1536, 1200, 900], [1536, 1024, 400, 900], [301, 199, 1200, 675]];
  it.each([['PNG', 'image/png'], ['JPEG', 'image/jpeg'], ['WebP', 'image/webp']] as const)('a %s: exactly w×h, and byte for byte what decoding in this process gave', async (_name, type) => {
    const { images } = await boot({});
    for (const [sw, sh, w, h] of CROPS) {
      const file = scene(sw, sh, type);
      expect(probeImage(file)).toMatchObject({ type, width: sw, height: sh, complete: true });
      const out = await images.coverCrop(file, w, h);
      expect(probeImage(out)).toEqual({ type: 'image/png', width: w, height: h, complete: true });
      expect(out.equals(await reference(file, w, h))).toBe(true);
    }
    expect(H.spawn).toHaveBeenCalledTimes(CROPS.length); // every one of them was decoded in a child
  }, 60_000);
  it('the crop is centred and fills the size: the edges that do not fit are cut off equally, the middle stays in the middle', async () => {
    const { images } = await boot({});
    // 3:2 into 1200×628: the top and the bottom go (the white bands), the sides stay (the green bands).
    const wide = await pixelsOf(await images.coverCrop(banded(1536, 1024), 1200, 628));
    expect(wide.size).toEqual([1200, 628]);
    expect([wide.at(600, 314), wide.at(4, 314), wide.at(1195, 314), wide.at(600, 4), wide.at(600, 623)]).toEqual([BLUE, GREEN, GREEN, RED, RED]);
    // 3:2 into 400×900: the sides go, the top and the bottom stay.
    const tall = await pixelsOf(await images.coverCrop(banded(1536, 1024), 400, 900));
    expect(tall.size).toEqual([400, 900]);
    expect([tall.at(200, 450), tall.at(4, 450), tall.at(395, 450), tall.at(200, 4), tall.at(200, 895)]).toEqual([BLUE, RED, RED, WHITE, WHITE]);
  });
  it('a PNG with transparent areas, and a camera JPEG stored on its side, are also the same bytes as before', async () => {
    const { images } = await boot({});
    const cutOut = scene(900, 700, 'image/png', true);
    expect((await images.coverCrop(cutOut, 1200, 628)).equals(await reference(cutOut, 1200, 628))).toBe(true);
    const onItsSide = withOrientation(scene(600, 900, 'image/jpeg'), 6);
    expect(probeImage(onItsSide)).toMatchObject({ width: 600, height: 900 }); // as stored
    expect((await images.coverCrop(onItsSide, 1200, 900)).equals(await reference(onItsSide, 1200, 900))).toBe(true);
  });
  it.each([
    ['OpenRouter', OPENROUTER, 'https://openrouter.ai/api/v1/images'], ['OpenAI', OPENAI, 'https://api.openai.com/v1/images/generations'], ['xAI', XAI, 'https://api.x.ai/v1/images/generations'],
  ] as const)('%s answers with a good picture: the stored file is that crop, for a cover, a strict request and a pack’s shared image', async (_name, keys, url) => {
    const { images } = await boot(keys); mockFetch(provider(GOOD));
    const cover = await images.renderImageFile(req());
    const strict = await images.renderImageFile(req({ w: 1200, h: 675, kind: 'article-body', modelRequired: true, prompt: HEADLINE }));
    const shared = await images.renderImageFile(req({ w: 1200, h: 900, kind: 'social' }), { raw: GOOD });
    expect(asked).toEqual([url, url]); // the shared image asks no model
    expect(H.stored).toHaveLength(3);
    expect(H.stored[0].body.equals(await reference(GOOD, 1200, 628))).toBe(true);
    expect(H.stored[1].body.equals(await reference(GOOD, 1200, 675))).toBe(true);
    expect(H.stored[2].body.equals(await reference(GOOD, 1200, 900))).toBe(true);
    for (const [i, r] of [cover, strict, shared].entries()) expect(r).toEqual({ url: `mem://${H.stored[i].key}`, bytes: H.stored[i].body.length, type: 'image/png' }); // no placeholder mark
    expect(H.spawn).toHaveBeenCalledTimes(3); expect(H.reports).toEqual([]);
  });
});

describe('a crashing file as the provider’s image: one refused picture, never a dead process (AC3)', () => {
  it.each(CRASHING)('%s: the cover gets the brand template marked failed, a strict request fails, a pack’s shared image gets the template; then a good image works', async (_name, make, children) => {
    const file = make();
    const { images, RadarError } = await boot(); mockFetch(provider(file));
    // (a) Not strict: an article cover.
    const cover = await images.renderImageFile(req());
    expect(cover).toEqual({ url: `mem://${H.stored[0].key}`, bytes: H.stored[0].body.length, type: 'image/png', placeholder: 'failed' });
    expect(H.stored[0].body.equals(template(images, req()))).toBe(true);
    expect(H.reports).toEqual([{ source: 'image', operation: 'image.generate', businessId: 'biz-1', degraded: true }]);
    // The provider answered and billed: its ai_calls row says so, whatever became of the picture (D6).
    expect(H.rows).toMatchObject([{ businessId: 'biz-1', task: 'image', purpose: 'image.hero', provider: 'openrouter', costUsd: 0.039, ok: true, error: null }]);
    // (b) Strict: no template, the error reaches the caller.
    H.reports.length = 0;
    const strict = req({ w: 1200, h: 675, kind: 'article-body', modelRequired: true, literal: true, prompt: HEADLINE });
    notARadarError(await caught(images.renderImageFile(strict)), RadarError);
    expect(H.stored).toHaveLength(1);
    expect(H.reports).toEqual([{ source: 'image', operation: 'image.generate', businessId: 'biz-1' }]);
    // (c) A pack's shared image, cut for one platform.
    const post = req({ w: 1200, h: 900, kind: 'social' });
    const shared = await images.renderImageFile(post, { raw: file });
    expect(shared).toEqual({ url: `mem://${H.stored[1].key}`, bytes: H.stored[1].body.length, type: 'image/png' });
    expect(H.stored[1].body.equals(template(images, post))).toBe(true);
    expect(asked).toHaveLength(2); // (a) and (b); the shared image asks no model
    expect(H.spawn).toHaveBeenCalledTimes(3 * children);
    // Still here, and the next picture is not held up behind the refused ones.
    mockFetch(provider(GOOD));
    expect(await images.renderImageFile(req())).toEqual({ url: `mem://${H.stored[2].key}`, bytes: H.stored[2].body.length, type: 'image/png' });
    expect(H.stored[2].body.equals(await reference(GOOD, 1200, 628))).toBe(true);
    expect(H.spawn).toHaveBeenCalledTimes(3 * children + 1); expect(H.active).toBe(0);
  }, 30_000);

  it.each(CRASHING)('%s as a new social pack’s one image: every post gets its own template, and the next pack gets real crops', async (_name, make) => {
    const file = make();
    const { images } = await boot(); const gen = await import('./social/generate'); // the same boot: generate.ts uses that images.ts
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // seed0 = 25, so the posts' seeds are 175, 176, 177
    mockFetch(provider(file));
    const platforms = ['linkedin', 'x', 'reddit'] as const;
    await gen.createPack('biz-1', { source: { kind: 'idea', label: HEADLINE }, platforms: [...platforms], style: 'illustration' });
    expect(asked).toHaveLength(1); // one generation for the pack, and no second try
    expect(H.stored).toHaveLength(3);
    const posts = H.packs[0].posts;
    for (const [i, k] of platforms.entries()) {
      const [w, h] = IMG_SIZES[k];
      expect(H.stored[i].body.equals(images.renderTemplatePng({ style: 'illustration', brand: BRAND, headline: HEADLINE, name: 'Fieldnote', seed: 175 + i, w, h }))).toBe(true);
      expect(posts[k]).toMatchObject({ seed: 175 + i, imageUrl: `mem://${H.stored[i].key}`, imageMeta: { bytes: H.stored[i].body.length, type: 'image/png' } });
    }
    expect(H.rows.filter(r => r.task === 'image')).toMatchObject([{ provider: 'openrouter', ok: true }]);
    mockFetch(provider(banded(1536, 1024)));
    await gen.createPack('biz-1', { source: { kind: 'idea', label: HEADLINE }, platforms: [...platforms], style: 'illustration' });
    const files = await Promise.all([3, 4, 5].map(i => pixelsOf(H.stored[i].body)));
    expect(files.map(f => f.size)).toEqual(platforms.map(k => IMG_SIZES[k]));
    for (const f of files) expect(f.at(Math.floor(f.size[0] / 2), Math.floor(f.size[1] / 2))).toEqual(BLUE); // a centred crop of the one image
  }, 30_000);
});

describe('bytes that are not a complete PNG, JPEG or WebP of an allowed size never reach a decoder (AC4)', () => {
  const cut = (type: Type, part: number) => () => { const whole = scene(1536, 1024, type); return whole.subarray(0, Math.floor(whole.length * part)); };
  const REFUSED_BY_ITS_BYTES: [string, () => Buffer][] = [
    ['SVG', () => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="#123456"/><image href="https://evil.example/${MARKER}.png" width="10" height="10"/></svg>`)],
    ['GIF', () => Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([0x40, 0x06, 0x84, 0x03, 0x80, 0, 0, 0, 0, 0, 255, 255, 255, 0x2c, 0, 0, 0, 0, 0x40, 0x06, 0x84, 0x03, 0, 2, 2, 0x44, 1, 0, 0x3b])])],
    ['BMP', () => Buffer.concat([Buffer.from('BM'), Buffer.alloc(60)])],
    ['TIFF', () => Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]), Buffer.alloc(60)])],
    ['AVIF', () => scene(640, 400, 'image/avif')],
    ['an HTML page', () => Buffer.from(`<!doctype html><html><body>Image unavailable ${MARKER}</body></html>`)],
    ['a JSON error body', () => Buffer.from(`{"error":"${MARKER}"}`)],
    ['nothing at all', () => Buffer.alloc(0)],
    ['a PNG cut short', cut('image/png', 0.3)], ['a JPEG cut short', cut('image/jpeg', 0.3)], ['a WebP cut short', cut('image/webp', 0.3)],
    ['a PNG missing its last byte', () => GOOD.subarray(0, GOOD.length - 1)],
    // Whole pictures with something after their end: refused by the same check as a file that was cut short.
    ['a PNG with one byte after its end', () => Buffer.concat([GOOD, Buffer.from([0])])],
    ['a JPEG with 5,000 bytes after its end', () => Buffer.concat([scene(1536, 1024, 'image/jpeg'), Buffer.alloc(5000)])],
    ['a WebP whose declared length is one byte more than the file', () => { const webp = Buffer.from(scene(1536, 1024, 'image/webp')); webp.writeUInt32LE(webp.readUInt32LE(4) + 1, 4); return webp; }],
    ['an animated WebP', () => webpHeader('VP8X', 1536, 1024, { animated: true })],
    ['a PNG declaring 10000×10000 (too many pixels)', () => declaring(10_000, 10_000)],
    ['a PNG declaring 10001×400 (one side too long)', () => declaring(10_001, 400)],
    ['a PNG declaring 5001×5000 (just over the pixel limit)', () => declaring(5001, 5000)],
    ['a WebP declaring 16000×16000', () => webpHeader('VP8L', 16_000, 16_000)],
    ['a PNG declaring no width', () => declaring(0, 600)],
  ];
  it.each(REFUSED_BY_ITS_BYTES)('%s: coverCrop rejects, the cover gets the template marked failed, a strict request fails, and no child process starts', async (_name, make) => {
    const file = make();
    const { images, RadarError } = await boot(); mockFetch(provider(file));
    notARadarError(await caught(images.coverCrop(file, 1200, 628)), RadarError);
    const cover = await images.renderImageFile(req());
    expect(cover).toMatchObject({ type: 'image/png', placeholder: 'failed' });
    expect(H.stored[0].body.equals(template(images, req()))).toBe(true);
    notARadarError(await caught(images.renderImageFile(req({ modelRequired: true, prompt: HEADLINE }))), RadarError);
    const post = req({ w: 1200, h: 900, kind: 'social' });
    expect('placeholder' in await images.renderImageFile(post, { raw: file })).toBe(false);
    expect(H.stored).toHaveLength(2); expect(H.stored[1].body.equals(template(images, post))).toBe(true);
    expect(H.spawn).not.toHaveBeenCalled();
  });
  it('the limit is on what the file declares: a picture on the limit is decoded', async () => {
    const { images } = await boot({});
    const onTheLimit = (() => { const c = createCanvas(10_000, 2500); const x = c.getContext('2d'); x.fillStyle = '#336699'; x.fillRect(0, 0, 10_000, 2500); return c.toBuffer('image/png'); })();
    expect(probeImage(await images.coverCrop(onTheLimit, 1200, 628))).toMatchObject({ width: 1200, height: 628, complete: true });
    expect(H.spawn).toHaveBeenCalledTimes(1);
  }, 30_000);
});

describe('a file that passes the check of its bytes and fails in the child is one refused picture (AC5)', () => {
  // Each starts like one of the three formats, is complete by its end marker, and has a header or data the decoder
  // cannot read. On darwin arm64 every one of them ends the child with a segmentation fault ('crashed'); a decoder
  // that throws instead ('not_loaded') is the same refusal.
  const FAILS_IN_THE_CHILD: [string, () => Buffer][] = [
    ...CRASHING.filter(([, , children]) => children === 1).map(([name, make]) => [name, make] as [string, () => Buffer]),
    ['a PNG with an impossible bit depth', () => { const png = Buffer.from(scene(800, 600)); png[24] = 3; return png; }],
    ['a JPEG whose Huffman table is damaged', () => { const jpeg = Buffer.from(scene(800, 600, 'image/jpeg')); const table = jpeg.indexOf(Buffer.from([0xff, 0xc4])); jpeg.fill(0xff, table + 5, table + 21); return jpeg; }],
    ['a WebP that is a header and nothing else', () => webpHeader('VP8X', 800, 600)],
    ['a WebP whose picture data is noise', () => { const webp = Buffer.from(scene(800, 600, 'image/webp')); webp.fill(0x33, 40); return webp; }],
  ];
  it.each(FAILS_IN_THE_CHILD)('%s: one child, a rejection that blames the picture, and the next crop is right', async (_name, make) => {
    const file = make();
    expect(probeImage(file)).toMatchObject({ width: 800, height: 600, complete: true }); // nothing in its bytes says so
    const { images, RadarError } = await boot({});
    const e = await caught(images.coverCrop(file, 1200, 628));
    notARadarError(e, RadarError);
    expect(e.message).toMatch(/\((crashed|not_loaded)\)$/);
    expect(H.spawn).toHaveBeenCalledTimes(1); expect(H.active).toBe(0);
    expect((await images.coverCrop(GOOD, 1200, 628)).equals(await reference(GOOD, 1200, 628))).toBe(true);
  });
  it('crops asked for together are decoded one at a time, and the refused ones do not hold up the rest', async () => {
    const { images } = await boot({});
    const [, noData] = CRASHING[1], [, noScan] = CRASHING[3];
    const results = await Promise.allSettled([
      images.coverCrop(GOOD, 1200, 628), images.coverCrop(noData(), 1200, 628), images.coverCrop(scene(1024, 1536, 'image/jpeg'), 1200, 675),
      images.coverCrop(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 1200, 628), images.coverCrop(noScan(), 1200, 900), images.coverCrop(scene(640, 400, 'image/webp'), 1200, 900),
    ]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'rejected', 'rejected', 'fulfilled']);
    expect(H.spawn).toHaveBeenCalledTimes(5); // all but the SVG
    expect(H.most).toBe(1);
  }, 30_000);

  describe('the child’s answer is checked too: only a complete PNG of exactly the size asked for is a crop', () => {
    /** A child that ignores the picture and answers with `data`: what a decoder gone wrong could send back. */
    const ANSWER = `const a = JSON.parse(process.argv[1]); const head = Buffer.from(JSON.stringify({ head: {} })); const n = Buffer.alloc(4); n.writeUInt32BE(head.length);
      process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(Buffer.concat([n, head, Buffer.from(a.data, 'base64')]), () => process.exit(0)));`;
    const answering = (data: Buffer) => standIn(ANSWER, { data: data.toString('base64') });
    const small = scene(96, 64);
    it('the crop itself is accepted (so the wrong answers below are refused for what they are)', async () => {
      const { images } = await boot({});
      const right = await reference(small, 64, 40);
      H.spawn.mockImplementationOnce(answering(right));
      expect((await images.coverCrop(small, 64, 40)).equals(right)).toBe(true);
    });
    it.each([
      ['a PNG of another size', async () => reference(small, 40, 64)],
      ['a PNG one pixel too wide', async () => reference(small, 65, 40)],
      ['a JPEG of the right size', async () => createCanvas(64, 40).toBuffer('image/jpeg')],
      ['the right PNG cut short', async () => { const right = await reference(small, 64, 40); return right.subarray(0, right.length - 12); }],
      ['text', async () => Buffer.from(`not a picture ${MARKER}`)],
      ['nothing', async () => Buffer.alloc(0)],
    ])('%s is refused', async (_name, make) => {
      const { images, RadarError } = await boot({});
      H.spawn.mockImplementationOnce(answering(await make()));
      notARadarError(await caught(images.coverCrop(small, 64, 40)), RadarError);
      expect(H.spawn).toHaveBeenCalledTimes(1);
      expect((await images.coverCrop(small, 64, 40)).equals(await reference(small, 64, 40))).toBe(true);
    });
  });

});

describe('one crop has the limits a cover has: 20 seconds and 32 MB of answer (D4)', () => {
  const small = scene(96, 64);
  /** A child that reads the picture and never answers. */
  const SILENT = 'process.stdin.resume(); setInterval(() => {}, 1000);';
  it('a child that never answers is left alone for 19.999 seconds and stopped at 20', async () => {
    const { images, RadarError } = await boot({});
    // Only the clock that the limit runs on is replaced; the child and its pipes are real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let settled: { png?: Buffer; error?: any } | null = null;
    H.spawn.mockImplementationOnce(standIn(SILENT));
    const crop = images.coverCrop(small, 64, 40).then(png => { settled = { png }; }, error => { settled = { error }; });
    try {
      for (let i = 0; i < 200 && !H.spawn.mock.calls.length; i++) await pause(10); // the limit starts when the child does
      expect(H.spawn).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(19_999);
      await pause(250);
      expect(settled).toBeNull(); expect(H.active).toBe(1); expect(H.ended).toEqual([]);
      vi.advanceTimersByTime(1);
      await Promise.race([crop, pause(3000)]);
      expect(settled).not.toBeNull();
      notARadarError(settled!.error, RadarError);
      expect(settled!.error.message).toMatch(/\(timed_out\)$/);
      expect(H.ended).toEqual([{ status: null, signal: 'SIGKILL' }]); expect(H.active).toBe(0);
    } finally {
      vi.advanceTimersByTime(7 * 24 * 3600e3); await Promise.race([crop, pause(3000)]); // whatever the limit is, no child outlives this test
      vi.useRealTimers();
    }
    expect((await images.coverCrop(small, 64, 40)).equals(await reference(small, 64, 40))).toBe(true); // and the next crop is not held up
  }, 30_000);

  /** A child that answers with the crop padded, in a chunk before its end, to exactly `total` bytes of output: a
   *  whole PNG of the right size however large it is, so only the size of the answer can be what refuses it. */
  const PADDED = `const a = JSON.parse(process.argv[1]); const png = Buffer.from(a.png, 'base64'); const head = Buffer.from(JSON.stringify({ head: {} })); const n = Buffer.alloc(4); n.writeUInt32BE(head.length);
    const pad = a.total - 4 - head.length - png.length - 12; const chunk = Buffer.alloc(12 + pad); chunk.writeUInt32BE(pad, 0); chunk.write('zzZz', 4, 'latin1');
    process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(Buffer.concat([n, head, png.subarray(0, png.length - 12), chunk, png.subarray(png.length - 12)]), () => process.exit(0)));`;
  const MB32 = 32 * 1024 * 1024;
  it('an answer of exactly 32 MB is taken, and one byte more is refused', async () => {
    const { images, RadarError } = await boot({});
    const png = (await reference(small, 64, 40)).toString('base64');
    H.spawn.mockImplementationOnce(standIn(PADDED, { png, total: MB32 }));
    const most = await images.coverCrop(small, 64, 40);
    expect(probeImage(most)).toEqual({ type: 'image/png', width: 64, height: 40, complete: true });
    expect(most.length).toBe(MB32 - 4 - Buffer.byteLength(JSON.stringify({ head: {} }))); // the whole answer, less its envelope
    H.spawn.mockImplementationOnce(standIn(PADDED, { png, total: MB32 + 1 }));
    const e = await caught(images.coverCrop(small, 64, 40));
    notARadarError(e, RadarError);
    expect(e.message).toMatch(/\(too_much_output\)$/);
    expect(H.spawn).toHaveBeenCalledTimes(2); expect(H.active).toBe(0);
  }, 30_000);
});

describe('what the child is given', () => {
  it('the picture on its input and nothing else: the same program whatever the picture and the size, the size as its one option, and two environment names', async () => {
    const { images } = await boot(OPENROUTER); // a provider key is set in this process
    process.env[SECRET_VAR] = `secret-${MARKER}`;
    const png = withPngText(scene(900, 700), MARKER), jpeg = withJpegComment(scene(640, 400, 'image/jpeg'), MARKER);
    expect(png.includes(MARKER) && jpeg.includes(MARKER)).toBe(true);
    // Both are good pictures: the text in them changes nothing about the crop.
    expect((await images.coverCrop(png, 1200, 628)).equals(await reference(png, 1200, 628))).toBe(true);
    expect((await images.coverCrop(jpeg, 1200, 628)).equals(await reference(jpeg, 1200, 628))).toBe(true);
    expect((await images.coverCrop(png, 400, 900)).equals(await reference(png, 400, 900))).toBe(true);
    const calls = H.spawn.mock.calls;
    expect(calls).toHaveLength(3);
    for (const [i, [w, h]] of [[1200, 628], [1200, 628], [400, 900]].entries()) {
      const [command, args, options] = calls[i];
      expect(command).toBe(process.execPath);
      expect(args).toHaveLength(3); expect(args[0]).toBe('-e'); expect(typeof args[1]).toBe('string');
      expect(JSON.parse(args[2])).toStrictEqual({ w, h });
      expect(Object.keys(options.env).sort()).toEqual(['NODE_ENV', 'PATH']);
      for (const given of [...args, ...Object.values(options.env)]) {
        expect(String(given)).not.toContain(MARKER); expect(String(given)).not.toContain(OPENROUTER.OPENROUTER_API_KEY);
      }
      expect(options.stdio).toEqual(['pipe', 'pipe', 'ignore']); expect(options.shell).toBeFalsy(); expect(options.detached).toBeFalsy();
    }
    expect(calls[1][1]).toEqual(calls[0][1]); // another picture of another format: the very same arguments
    expect(calls[2][1][1]).toBe(calls[0][1][1]); // another size: the very same program
  }, 30_000);
});

describe('a decoder that cannot run (AC6)', () => {
  it('the child cannot be started: a plain Error, the cover gets the template and never an in-process crop, a strict request fails, and the next call works', async () => {
    const { images, RadarError } = await boot(); mockFetch(provider(GOOD)); // a good picture: only the decoder is at fault
    H.spawn.mockImplementation(() => { throw new Error('spawn EAGAIN'); });
    const e = await caught(images.coverCrop(GOOD, 1200, 628));
    notARadarError(e, RadarError);
    expect(Object.getPrototypeOf(e)).toBe(Error.prototype); // not a subclass of any kind
    expect(e.message).toContain('spawn EAGAIN');
    // Not strict: the template. Had anything decoded the picture here instead, this would be the crop.
    const cover = await images.renderImageFile(req());
    expect(cover).toEqual({ url: `mem://${H.stored[0].key}`, bytes: H.stored[0].body.length, type: 'image/png', placeholder: 'failed' });
    expect(H.stored[0].body.equals(template(images, req()))).toBe(true);
    expect(H.reports).toEqual([{ source: 'image', operation: 'image.generate', businessId: 'biz-1', degraded: true }]);
    // Strict: the error reaches the caller, nothing is stored.
    const strict = await caught(images.renderImageFile(req({ modelRequired: true, prompt: HEADLINE })));
    notARadarError(strict, RadarError); expect(strict.message).toContain('spawn EAGAIN');
    expect(H.stored).toHaveLength(1);
    // A pack's shared image: the template, no mark.
    const post = req({ w: 1200, h: 900, kind: 'social' });
    expect(await images.renderImageFile(post, { raw: GOOD })).toEqual({ url: `mem://${H.stored[1].key}`, bytes: H.stored[1].body.length, type: 'image/png' });
    expect(H.stored[1].body.equals(template(images, post))).toBe(true);
    expect(H.spawn).toHaveBeenCalledTimes(4);
    // The decoder is back: the same request now stores the crop.
    H.spawn.mockImplementation(H.start!);
    expect(await images.renderImageFile(req())).toEqual({ url: `mem://${H.stored[2].key}`, bytes: H.stored[2].body.length, type: 'image/png' });
    expect(H.stored[2].body.equals(await reference(GOOD, 1200, 628))).toBe(true);
  }, 30_000);
  it('the child starts where the canvas library cannot be found: a plain Error, and the next call works', async () => {
    const { images, RadarError } = await boot({});
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(os.tmpdir());
    try {
      const e = await caught(images.coverCrop(GOOD, 1200, 628));
      notARadarError(e, RadarError);
      expect(Object.getPrototypeOf(e)).toBe(Error.prototype);
      expect(e.message).toContain('canvas library');
    } finally { cwd.mockRestore(); }
    expect((await images.coverCrop(GOOD, 1200, 628)).equals(await reference(GOOD, 1200, 628))).toBe(true);
  });
});
