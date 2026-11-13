// What a fetched picture must be before it becomes a cover. Every picture is made here, with the canvas library or
// from bytes. The decode runs for real, in the child process readPicture starts; starting one is watched, so the checks
// that must come before any decode can be shown to, and so can "one at a time".
import { beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ spawn: vi.fn(), active: 0, most: 0 }));
vi.mock('node:child_process', async original => {
  const real = await original<typeof import('node:child_process')>();
  H.spawn.mockImplementation((...args: Parameters<typeof real.spawn>) => {
    H.most = Math.max(H.most, ++H.active);
    const child = real.spawn(...args); child.on('close', () => { H.active--; });
    return child;
  });
  return { ...real, default: { ...real, spawn: H.spawn }, spawn: H.spawn };
});
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { COVER_H, COVER_W, PICTURE_MAX_PIXELS, probeImage, readPicture } from './picture';
import { SitePictureError } from './fetch';

beforeEach(() => { H.spawn.mockClear(); H.active = 0; H.most = 0; });

/** A picture with something in it (a gradient and a block), so a crop and a blur have content. */
function drawn(w: number, h: number, type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif' = 'image/png', transparent = false): Buffer {
  const canvas = createCanvas(w, h); const ctx = canvas.getContext('2d');
  if (!transparent) {
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#1f4d3a'); g.addColorStop(1, '#f2b544');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#17181c'; ctx.fillRect(w * 0.4, h * 0.2, w * 0.2, h * 0.8);
  }
  return canvas.toBuffer(type as 'image/png');
}
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
/** A WebP file with one chunk of the given kind. Only the header is real: enough for the probe, never decoded. */
function webpHeader(kind: 'VP8 ' | 'VP8L' | 'VP8X', w: number, h: number, o: { animated?: boolean; pad?: number } = {}): Buffer {
  let payload: Buffer;
  if (kind === 'VP8 ') { payload = Buffer.alloc(10); payload.set([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a]); payload.writeUInt16LE(w, 6); payload.writeUInt16LE(h, 8); }
  else if (kind === 'VP8L') { payload = Buffer.alloc(5); payload[0] = 0x2f; payload.writeUInt32LE((((h - 1) << 14) | (w - 1)) >>> 0, 1); }
  else { payload = Buffer.alloc(10); payload[0] = o.animated ? 0x02 : 0x00; payload.writeUIntLE(w - 1, 4, 3); payload.writeUIntLE(h - 1, 7, 3); }
  const chunk = Buffer.concat([Buffer.from(kind, 'latin1'), u32le(payload.length), payload, Buffer.alloc(o.pad ?? 0)]);
  return Buffer.concat([Buffer.from('RIFF'), u32le(4 + chunk.length), Buffer.from('WEBP'), chunk]);
}
/** The same JPEG with an EXIF block saying how the camera was held (6: the stored picture must be turned a quarter). */
function withOrientation(jpeg: Buffer, orientation: number): Buffer {
  const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0x00, orientation, 0, 0, 0, 0, 0, 0]);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const length = Buffer.alloc(2); length.writeUInt16BE(exif.length + 2);
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1]), length, exif, jpeg.subarray(2)]);
}
const response = (body: Buffer, type = 'image/png') => ({ url: 'https://lived.ae/a', type, body });
const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { expect(e).toBeInstanceOf(SitePictureError); return (e as SitePictureError).code; } throw new Error('expected a SitePictureError'); };
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#123456"/><image href="https://evil.example/x.png" width="10" height="10"/></svg>');
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([0x40, 0x06, 0x84, 0x03, 0x80, 0, 0, 0, 0, 0, 255, 255, 255, 0x2c, 0, 0, 0, 0, 0x40, 0x06, 0x84, 0x03, 0, 2, 2, 0x44, 1, 0, 0x3b])]);

describe('probeImage reads type, size and completeness from the bytes alone', () => {
  it.each([
    ['PNG', 'image/png'], ['JPEG', 'image/jpeg'], ['WebP', 'image/webp'],
  ] as const)('%s written by the canvas library', (_name, type) => {
    expect(probeImage(drawn(1600, 900, type))).toMatchObject({ type, width: 1600, height: 900, complete: true });
    expect(probeImage(drawn(641, 317, type))).toMatchObject({ type, width: 641, height: 317, complete: true });
    expect(H.spawn).not.toHaveBeenCalled();
  });
  it.each(['VP8 ', 'VP8L', 'VP8X'] as const)('the WebP %s chunk', kind => {
    expect(probeImage(webpHeader(kind, 740, 1110))).toEqual({ type: 'image/webp', width: 740, height: 1110, complete: true });
    expect(probeImage(webpHeader(kind, 16383, 1))).toMatchObject({ width: 16383, height: 1 });
  });
  it('an animated WebP is marked, and a WebP whose declared length runs past the file is incomplete', () => {
    expect(probeImage(webpHeader('VP8X', 800, 600, { animated: true }))).toMatchObject({ animated: true, complete: true });
    const cut = webpHeader('VP8X', 800, 600, { pad: 500 }).subarray(0, 300);
    expect(probeImage(cut)).toMatchObject({ type: 'image/webp', width: 800, height: 600, complete: false });
  });
  it('a JPEG whose size follows other segments, and one with bytes after its end marker', () => {
    const jpeg = withOrientation(drawn(700, 400, 'image/jpeg'), 1);
    expect(probeImage(jpeg)).toMatchObject({ type: 'image/jpeg', width: 700, height: 400, complete: true });
    expect(probeImage(Buffer.concat([jpeg, Buffer.alloc(200)]))).toMatchObject({ complete: true });
  });
  it.each([
    ['SVG', SVG], ['GIF', GIF], ['AVIF', drawn(64, 64, 'image/avif')], ['HTML', Buffer.from('<!doctype html><html><body><img src="a.png"></body></html>')],
    ['BMP', Buffer.concat([Buffer.from('BM'), Buffer.alloc(60)])], ['ICO', Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0])],
    ['a JSON error body', Buffer.from('{"error":"Image unavailable"}')], ['nothing', Buffer.alloc(0)], ['a PNG signature and nothing else', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['a JPEG start with no frame header', Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0])],
  ])('%s is not one of the three formats', (_name, bytes) => { expect(probeImage(bytes)).toBeNull(); });
  it.each([['JPEG', 'image/jpeg', 0.2], ['PNG', 'image/png', 0.3], ['WebP', 'image/webp', 0.2]] as const)('a %s cut short is recognised and marked incomplete', (_name, type, part) => {
    const whole = drawn(1600, 900, type);
    expect(probeImage(whole.subarray(0, Math.floor(whole.length * part)))).toMatchObject({ type, width: 1600, height: 900, complete: false });
    expect(probeImage(whole.subarray(0, whole.length - 1))).toMatchObject({ complete: false });
  });
});

describe('readPicture refuses', () => {
  it.each(['text/html; charset=utf-8', 'image/svg+xml', 'image/gif', 'image/avif', 'image/bmp', 'application/octet-stream', ''])('a response whose header says %s, even with a good PNG behind it', async type => {
    expect(await code(readPicture(response(drawn(1600, 900), type)))).toBe('not_a_picture');
    expect(H.spawn).not.toHaveBeenCalled();
  });
  it.each([
    ['SVG', SVG], ['GIF', GIF], ['AVIF', drawn(1600, 900, 'image/avif')], ['HTML', Buffer.from('<html><body>Image unavailable</body></html>')],
    ['an animated WebP', webpHeader('VP8X', 1600, 900, { animated: true })],
  ])('%s bytes under an image/png header, without decoding them', async (_name, bytes) => {
    expect(await code(readPicture(response(bytes)))).toBe('not_a_picture');
    expect(H.spawn).not.toHaveBeenCalled();
  });
  it.each([['JPEG', 'image/jpeg'], ['PNG', 'image/png'], ['WebP', 'image/webp']] as const)('a %s cut short, which the decoder alone would accept', async (_name, type) => {
    const whole = drawn(1600, 900, type);
    expect(await code(readPicture(response(whole.subarray(0, Math.floor(whole.length / 3)), type)))).toBe('not_a_picture');
    expect(H.spawn).not.toHaveBeenCalled();
  });
  it('a small file that declares a huge picture, before the decoder is ever called', async () => {
    const bomb = Buffer.from(drawn(64, 64)); bomb.writeUInt32BE(10_000, 16); bomb.writeUInt32BE(10_000, 20);
    expect(probeImage(bomb)).toMatchObject({ width: 10_000, height: 10_000, complete: true });
    expect(await code(readPicture(response(bomb)))).toBe('too_large');
    const wide = Buffer.from(drawn(64, 64)); wide.writeUInt32BE(10_001, 16); wide.writeUInt32BE(400, 20);
    expect(await code(readPicture(response(wide)))).toBe('too_large'); // one side over the limit, though few pixels
    const over = Buffer.from(drawn(64, 64)); over.writeUInt32BE(5001, 16); over.writeUInt32BE(5000, 20);
    expect(5001 * 5000).toBeGreaterThan(PICTURE_MAX_PIXELS);
    expect(await code(readPicture(response(over)))).toBe('too_large');
    expect(await code(readPicture(response(webpHeader('VP8L', 16000, 16000), 'image/webp')))).toBe('too_large');
    expect(H.spawn).not.toHaveBeenCalled();
  });
  it('a picture too small for a cover', async () => {
    expect(await code(readPicture(response(drawn(300, 200))))).toBe('too_small');
    expect(await code(readPicture(response(drawn(599, 900))))).toBe('too_small');
    expect(await code(readPicture(response(drawn(1600, 313))))).toBe('too_small');
    expect(await code(readPicture(response(drawn(400, 700, 'image/jpeg'), 'image/jpeg')))).toBe('too_small');
  });
  // Each of these starts like one of the three formats, is complete by its end marker, and has a header the decoder
  // cannot read. Decoded in this process, every one of them ends the process with a segmentation fault
  // (@napi-rs/canvas 0.1.100, checked on darwin arm64); none may do more than be refused.
  it.each([
    ['a PNG with no picture data', () => { const png = drawn(800, 600); return Buffer.concat([png.subarray(0, 33), png.subarray(png.length - 12)]); }],
    ['a PNG whose header checksum is wrong', () => { const png = Buffer.from(drawn(800, 600)); png[29] ^= 0xff; return png; }],
    ['a PNG with an impossible bit depth', () => { const png = Buffer.from(drawn(800, 600)); png[24] = 3; return png; }],
    ['a JPEG with its tables and frame header but no scan', () => { const jpeg = drawn(800, 600, 'image/jpeg'); return Buffer.concat([jpeg.subarray(0, jpeg.indexOf(Buffer.from([0xff, 0xda]))), Buffer.from([0xff, 0xd9])]); }],
    ['a JPEG whose Huffman table is damaged', () => { const jpeg = Buffer.from(drawn(800, 600, 'image/jpeg')); const table = jpeg.indexOf(Buffer.from([0xff, 0xc4])); jpeg.fill(0xff, table + 5, table + 21); return jpeg; }],
    ['a WebP that is a header and nothing else', () => webpHeader('VP8X', 800, 600)],
    ['a WebP whose picture data is noise', () => { const webp = Buffer.from(drawn(800, 600, 'image/webp')); webp.fill(0x33, 40); return webp; }],
  ])('%s is refused, and the process that refused it is still here', async (_name, make) => {
    const bytes = make();
    expect(probeImage(bytes)).toMatchObject({ width: 800, height: 600, complete: true });
    expect(await code(readPicture(response(bytes)))).toBe('not_a_picture');
    expect(H.spawn).toHaveBeenCalledTimes(1);
    // The next picture is read normally.
    expect(await readPicture(response(drawn(1600, 900)))).toMatchObject({ w: 1600, h: 900, fit: 'crop' });
  });
  it('the decoding process is given the picture and nothing else: no arguments from the picture, and none of this process’s environment', async () => {
    await readPicture(response(drawn(1600, 900)));
    const [command, args, options] = H.spawn.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args).toHaveLength(3); expect(args[0]).toBe('-e'); expect(JSON.parse(args[2])).toEqual({ W: 1200, H: 628, minW: 600, minH: 314, keeps: 0.6 });
    expect(Object.keys(options.env).sort()).toEqual(['NODE_ENV', 'PATH']); // nothing a decoder gone wrong could leak
    expect(options.stdio).toEqual(['pipe', 'pipe', 'ignore']);
  });
});

describe('readPicture makes a 1200×628 cover', () => {
  const pixels = async (png: Buffer) => { const img = await loadImage(png); const c = createCanvas(img.width, img.height); const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); return ctx.getImageData(0, 0, img.width, img.height).data; };
  it.each([['PNG', 'image/png'], ['JPEG', 'image/jpeg'], ['WebP', 'image/webp']] as const)('from a %s, centre-cropped when the shape is close to a cover’s', async (_name, type) => {
    const out = await readPicture(response(drawn(1600, 900, type), type));
    expect(out).toMatchObject({ w: 1600, h: 900, fit: 'crop' });
    expect(probeImage(out.png)).toEqual({ type: 'image/png', width: COVER_W, height: COVER_H, complete: true });
  });
  it('the header and the bytes need not name the same format: the bytes decide', async () => {
    expect(await readPicture(response(drawn(1600, 900, 'image/webp'), 'image/jpeg'))).toMatchObject({ fit: 'crop' });
    expect(await readPicture(response(drawn(1600, 900, 'image/jpeg'), 'IMAGE/JPG; charset=binary'))).toMatchObject({ fit: 'crop' });
  });
  it.each([[800, 1200], [900, 900], [3200, 700]])('a %i×%i picture is shown whole on a blurred copy of itself, with no pale band at the edges', async (w, h) => {
    const out = await readPicture(response(drawn(w, h)));
    expect(out).toMatchObject({ w, h, fit: 'backdrop' });
    expect(probeImage(out.png)).toMatchObject({ width: COVER_W, height: COVER_H });
    const data = await pixels(out.png);
    // The source has no light colour near white; the white the canvas starts with must not show through at any corner or edge.
    for (const [x, y] of [[0, 0], [COVER_W - 1, 0], [0, COVER_H - 1], [COVER_W - 1, COVER_H - 1], [0, COVER_H / 2], [COVER_W / 2, 0]]) {
      const i = (y * COVER_W + x) * 4;
      expect(Math.min(data[i], data[i + 1], data[i + 2])).toBeLessThan(200);
    }
  });
  it.each([[1150, 1000, 'crop'], [1140, 1000, 'backdrop'], [3000, 950, 'crop'], [3200, 940, 'backdrop']] as const)('%i×%i is a %s', async (w, h, fit) => {
    expect((await readPicture(response(drawn(w, h)))).fit).toBe(fit);
  });
  it.each([[1600, 900], [800, 1200]])('a transparent %i×%i picture leaves no transparent pixel', async (w, h) => {
    const data = await pixels((await readPicture(response(drawn(w, h, 'image/png', true)))).png);
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) throw new Error(`transparent pixel at ${(i - 3) / 4}`);
    expect(data.length).toBe(COVER_W * COVER_H * 4);
    expect([data[0], data[1], data[2]]).not.toEqual([0, 0, 0]); // and it is not black either
  });
  it('a camera picture stored on its side is judged and drawn upright', async () => {
    const stored = withOrientation(drawn(400, 700, 'image/jpeg'), 6);
    expect(probeImage(stored)).toMatchObject({ width: 400, height: 700 }); // as stored: too narrow
    const out = await readPicture(response(stored, 'image/jpeg'));
    expect(out).toMatchObject({ w: 700, h: 400, fit: 'crop' });
  });
  it('decodes one picture at a time, and a refused picture does not hold up the next', async () => {
    const results = await Promise.allSettled([
      readPicture(response(drawn(1600, 900))), readPicture(response(drawn(300, 200))), readPicture(response(drawn(800, 1200, 'image/jpeg'), 'image/jpeg')), readPicture(response(drawn(1600, 900, 'image/webp'), 'image/webp')),
    ]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
    expect(H.spawn).toHaveBeenCalledTimes(4);
    expect(H.most).toBe(1);
  });
});
