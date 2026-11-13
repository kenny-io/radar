// QA probe: what a fetched picture must be (AC3, D1, D12). The real decoder runs in its real child process; only
// `spawn` is wrapped, to count children and record the options they are started with. Files are made here; none is downloaded.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import zlib from 'node:zlib';
import fs from 'node:fs';
const P = vi.hoisted(() => ({ spawned: [] as { args: string[]; options: any }[], live: 0, maxLive: 0, hang: false, pids: [] as number[] }));
vi.mock('node:child_process', async original => {
  const real = await original<typeof import('node:child_process')>();
  const spawn = (cmd: string, args: string[], options: any) => {
    P.spawned.push({ args, options });
    const child = P.hang ? real.spawn(cmd, ['-e', 'setInterval(() => {}, 1000)'], options) : real.spawn(cmd, args, options);
    P.live++; P.maxLive = Math.max(P.maxLive, P.live); if (child.pid) P.pids.push(child.pid);
    child.on('close', () => { P.live--; });
    return child;
  };
  return { ...real, default: { ...real, spawn }, spawn };
});
import { createCanvas } from '@napi-rs/canvas';
import { SitePictureError } from '@/server/services/realCover/fetch';
import { DECODE_TIMEOUT_MS, probeImage, readPicture } from '@/server/services/realCover/picture';

const EVID = '.factory/real-subject-covers/qa/evidence/picture-outcomes.txt';
const lines: string[] = [];
afterAll(() => { fs.mkdirSync('.factory/real-subject-covers/qa/evidence', { recursive: true }); fs.writeFileSync(EVID, lines.join('\n') + '\n'); });

const draw = (w: number, h: number, alpha = false) => { const c = createCanvas(w, h); const g = c.getContext('2d'); if (!alpha) { g.fillStyle = '#2a6f97'; g.fillRect(0, 0, w, h); } g.fillStyle = '#e63946'; g.fillRect(w * 0.2, h * 0.2, w * 0.3, h * 0.5); g.fillStyle = '#f1faee'; g.fillRect(w * 0.6, h * 0.1, w * 0.2, h * 0.3); return c; };
const png = (w: number, h: number) => draw(w, h).toBuffer('image/png');
const jpeg = (w: number, h: number) => draw(w, h).toBuffer('image/jpeg', 85);
const webp = (w: number, h: number) => draw(w, h).toBuffer('image/webp', 85);
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const chunk = (type: string, data: Buffer) => Buffer.concat([u32(data.length), Buffer.from(type, 'latin1'), data, u32(zlib.crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])))]);
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = (w: number, h: number, depth = 8, colour = 6) => chunk('IHDR', Buffer.concat([u32(w), u32(h), Buffer.from([depth, colour, 0, 0, 0])]));
/** A valid PNG of any declared size made without a canvas: one zlib stream of filter-0 rows of zeros (greyscale, 8 bit). */
const flatPng = (w: number, h: number) => Buffer.concat([SIG, ihdr(w, h, 8, 0), chunk('IDAT', zlib.deflateSync(Buffer.alloc((w + 1) * h), { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
const riff = (chunks: Buffer) => { const head = Buffer.alloc(12); head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(chunks.length + 4, 4); head.write('WEBP', 8, 'latin1'); return Buffer.concat([head, chunks]); };
const rchunk = (id: string, data: Buffer) => { const head = Buffer.alloc(8); head.write(id, 0, 'latin1'); head.writeUInt32LE(data.length, 4); return Buffer.concat([head, data, Buffer.alloc(data.length % 2)]); };
const vp8x = (w: number, h: number, flags = 0) => { const d = Buffer.alloc(10); d[0] = flags; d.writeUIntLE(w - 1, 4, 3); d.writeUIntLE(h - 1, 7, 3); return rchunk('VP8X', d); };
/** The image chunk(s) of a WebP file made by the canvas library, without the RIFF header. */
const inner = (file: Buffer) => file.subarray(12);

/** Round 2: a valid greyscale PNG of any declared size that is not one flat colour (decision D18): every row is a left-to-right ramp. */
const rampPng = (w: number, h: number) => { const row = Buffer.alloc(w + 1); for (let x = 0; x < w; x++) row[x + 1] = Math.floor((x * 255) / (w - 1)); const all = Buffer.alloc((w + 1) * h); for (let y = 0; y < h; y++) row.copy(all, y * (w + 1)); return Buffer.concat([SIG, ihdr(w, h, 8, 0), chunk('IDAT', zlib.deflateSync(all, { level: 9 })), chunk('IEND', Buffer.alloc(0))]); };
const res = (body: Buffer, type = 'image/png') => ({ url: 'https://lived.ae/a', type, body });
const outcome = async (name: string, body: Buffer, type = 'image/png') => {
  const before = P.spawned.length; const t = Date.now();
  let out: string;
  try { const r = await readPicture(res(body, type)); const made = probeImage(r.png)!; out = `ok ${r.w}x${r.h} ${r.fit} → ${made.type} ${made.width}x${made.height}`; }
  catch (e: any) { out = e instanceof SitePictureError ? e.code : 'PLAIN ERROR ' + e?.message; }
  lines.push(`${name.padEnd(74)} ${out.padEnd(44)} children: ${P.spawned.length - before}  ${Date.now() - t} ms  probe: ${JSON.stringify(probeImage(body))}`);
  return { out, spawned: P.spawned.length - before };
};

describe('good pictures', () => {
  it.each([['png 1600x900', () => png(1600, 900), 'image/png', 'crop'], ['jpeg 1600x900', () => jpeg(1600, 900), 'image/jpeg', 'crop'], ['webp 1600x900 (lossy)', () => webp(1600, 900), 'image/webp', 'crop'],
    ['png under a jpeg header', () => png(1600, 900), 'image/jpeg', 'crop'], ['jpeg header with parameters and upper case', () => jpeg(1600, 900), 'IMAGE/JPEG; charset=binary', 'crop'],
    ['portrait 800x1200', () => png(800, 1200), 'image/png', 'backdrop'], ['square 900x900', () => png(900, 900), 'image/png', 'backdrop'], ['panorama 4000x700', () => png(4000, 700), 'image/png', 'backdrop'],
    ['exactly the minimum 600x314', () => png(600, 314), 'image/png', 'crop'], ['transparent png', () => draw(1600, 900, true).toBuffer('image/png'), 'image/png', 'crop'],
  ] as const)('%s', async (name, make, type, fit) => {
    const r = await outcome(name, make(), type);
    expect(r.out).toMatch(new RegExp(`^ok .* ${fit} → image/png 1200x628$`));
  });
  it('a transparent source leaves no transparent pixel, and a portrait source leaves no pale band at any edge', async () => {
    const { loadImage } = await import('@napi-rs/canvas');
    const look = async (body: Buffer) => { const r = await readPicture(res(body)); const img = await loadImage(r.png); const c = createCanvas(1200, 628); const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, 1200, 628).data; };
    const t = await look(draw(1600, 900, true).toBuffer('image/png'));
    let transparent = 0; for (let i = 3; i < t.length; i += 4) if (t[i] !== 255) transparent++;
    expect(transparent).toBe(0);
    // Portrait: a dark picture. Any edge pixel much lighter than the picture is the blur reading past the edge.
    const dark = createCanvas(800, 1200); const g = dark.getContext('2d'); g.fillStyle = '#102030'; g.fillRect(0, 0, 800, 1200); g.fillStyle = '#182838'; g.fillRect(250, 300, 300, 600); // round 2: not one flat colour (D18); the block is still darker than the threshold below
    const d = await look(dark.toBuffer('image/png'));
    let worst = 0;
    const at = (x: number, y: number) => { const i = (y * 1200 + x) * 4; worst = Math.max(worst, d[i], d[i + 1], d[i + 2]); };
    for (let x = 0; x < 1200; x++) { at(x, 0); at(x, 1); at(x, 626); at(x, 627); }
    for (let y = 0; y < 628; y++) { at(0, y); at(1, y); at(1198, y); at(1199, y); }
    lines.push(`portrait dark picture (#102030 with a #182838 block): brightest channel value on the outer 2 px of the cover = ${worst} (source at most 24/40/56)`);
    expect(worst).toBeLessThanOrEqual(60);
  });
});

describe('refused by the header or the bytes, with no child process', () => {
  const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><image href="https://169.254.169.254/latest/meta-data/"/><rect width="1600" height="900" fill="red"/></svg>');
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0x40, 0x06, 0x84, 0x03, 0x80, 0, 0, 0, 0, 0, 255, 255, 255]), Buffer.from([0x2c, 0, 0, 0, 0, 0x40, 0x06, 0x84, 0x03, 0, 2, 2, 0x44, 1, 0, 0x3b])]);
  const cases: [string, () => Buffer, string, string][] = [
    ['good png under text/html', () => png(1600, 900), 'text/html', 'not_a_picture'], ['good png under application/octet-stream', () => png(1600, 900), 'application/octet-stream', 'not_a_picture'],
    ['good png under image/svg+xml', () => png(1600, 900), 'image/svg+xml', 'not_a_picture'], ['good png under image/gif', () => png(1600, 900), 'image/gif', 'not_a_picture'], ['good png under image/avif', () => png(1600, 900), 'image/avif', 'not_a_picture'],
    ['good png with no content type', () => png(1600, 900), '', 'not_a_picture'], ['good png under "image/png, text/html"', () => png(1600, 900), 'image/png, text/html', 'not_a_picture'], ['good png under image/*', () => png(1600, 900), 'image/*', 'not_a_picture'],
    ['svg under image/png', () => svg, 'image/png', 'not_a_picture'], ['svg with a png signature glued on', () => Buffer.concat([SIG, svg]), 'image/png', 'not_a_picture'], ['gif under image/png', () => gif, 'image/png', 'not_a_picture'],
    ['html under image/jpeg', () => Buffer.from('<!doctype html><html><body>hello</body></html>'), 'image/jpeg', 'not_a_picture'], ['empty body', () => Buffer.alloc(0), 'image/png', 'not_a_picture'], ['FF D8 FF D9', () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg', 'not_a_picture'],
    ['bmp under image/png', () => Buffer.concat([Buffer.from('BM'), Buffer.alloc(60)]), 'image/png', 'not_a_picture'], ['avif under image/webp', () => Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypavif'), Buffer.alloc(40)]), 'image/webp', 'not_a_picture'],
    ['png cut to 30%', () => { const b = png(1600, 900); return b.subarray(0, Math.floor(b.length * 0.3)); }, 'image/png', 'not_a_picture'], ['png missing its last byte', () => { const b = png(1600, 900); return b.subarray(0, b.length - 1); }, 'image/png', 'not_a_picture'],
    ['jpeg cut to 20%', () => { const b = jpeg(1600, 900); return b.subarray(0, Math.floor(b.length * 0.2)); }, 'image/jpeg', 'not_a_picture'], ['jpeg missing its end marker', () => { const b = jpeg(1600, 900); return b.subarray(0, b.length - 2); }, 'image/jpeg', 'not_a_picture'],
    ['webp cut to 20%', () => { const b = webp(1600, 900); return b.subarray(0, Math.floor(b.length * 0.2)); }, 'image/webp', 'not_a_picture'], ['webp missing its last byte', () => { const b = webp(1600, 900); return b.subarray(0, b.length - 1); }, 'image/webp', 'not_a_picture'],
    ['png header declaring 10000x10000 (97 KB of data)', () => flatPng(10000, 10000), 'image/png', 'too_large'], ['png header declaring 5001x5000 (just over 25 MP)', () => Buffer.concat([SIG, ihdr(5001, 5000), chunk('IEND', Buffer.alloc(0))]), 'image/png', 'too_large'],
    ['png header declaring 10001x100 (one side over)', () => Buffer.concat([SIG, ihdr(10001, 100), chunk('IEND', Buffer.alloc(0))]), 'image/png', 'too_large'], ['png header declaring 4294967295x4294967295', () => Buffer.concat([SIG, ihdr(0xffffffff, 0xffffffff), chunk('IEND', Buffer.alloc(0))]), 'image/png', 'too_large'],
    ['png header declaring 0x0', () => Buffer.concat([SIG, ihdr(0, 0), chunk('IEND', Buffer.alloc(0))]), 'image/png', 'not_a_picture'],
    ['webp VP8X declaring 16384x16384', () => riff(Buffer.concat([vp8x(16384, 16384), inner(webp(700, 400))])), 'image/webp', 'too_large'],
    ['webp with the animation flag', () => riff(Buffer.concat([vp8x(1600, 900, 0x02), inner(webp(1600, 900))])), 'image/webp', 'not_a_picture'],
  ];
  it.each(cases)('%s → %s', async (name, make, type, want) => {
    const r = await outcome(name, make(), type);
    expect(r.out).toBe(want); expect(r.spawned).toBe(0);
  });
});

describe('files that pass the header checks and reach the decoder: always an answer, never a crash of this process', () => {
  const anim = () => { const frame = inner(webp(1600, 900)); const anmf = (d: Buffer) => { const h = Buffer.alloc(16); h.writeUIntLE(1599, 6, 3); h.writeUIntLE(899, 9, 3); h.writeUIntLE(100, 12, 3); return rchunk('ANMF', Buffer.concat([h, d])); }; return Buffer.concat([rchunk('ANIM', Buffer.alloc(6)), anmf(frame), anmf(frame)]); };
  const sof = (w: number, h: number) => Buffer.concat([Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]), Buffer.from([h >> 8, h & 255, w >> 8, w & 255]), Buffer.from([0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])]);
  const cases: [string, () => Buffer, string, RegExp][] = [
    ['png: IHDR and IEND, no IDAT (the reported crash)', () => Buffer.concat([SIG, ihdr(1600, 900), chunk('IEND', Buffer.alloc(0))]), 'image/png', /^not_a_picture$/],
    ['png: IDAT is not a zlib stream', () => Buffer.concat([SIG, ihdr(1600, 900), chunk('IDAT', Buffer.alloc(4000, 0x41)), chunk('IEND', Buffer.alloc(0))]), 'image/png', /^not_a_picture$/],
    ['png: IDAT holds 10 rows of 900', () => Buffer.concat([SIG, ihdr(1600, 900, 8, 0), chunk('IDAT', zlib.deflateSync(Buffer.alloc(1601 * 10))), chunk('IEND', Buffer.alloc(0))]), 'image/png', /^(not_a_picture|ok .*)$/],
    ['png: bad IHDR checksum', () => { const b = png(1600, 900); const c = Buffer.from(b); c[29] ^= 0xff; return c; }, 'image/png', /^(not_a_picture|ok .*)$/],
    ['png: bit depth 3 (invalid)', () => Buffer.concat([SIG, ihdr(1600, 900, 3, 6), chunk('IDAT', zlib.deflateSync(Buffer.alloc(1000))), chunk('IEND', Buffer.alloc(0))]), 'image/png', /^not_a_picture$/],
    ['png: 5000x5000 declared, valid, 25 MP grey ramp (the largest allowed)', () => rampPng(5000, 5000), 'image/png', /^ok 5000x5000 backdrop/],
    ['png: 5000x5000 declared, valid, 25 MP of zeros (one flat colour: refused since D18)', () => flatPng(5000, 5000), 'image/png', /^not_a_picture$/],
    ['png: random bytes between a good header and IEND', () => Buffer.concat([SIG, ihdr(1600, 900), Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 131 + 7) % 256)), chunk('IEND', Buffer.alloc(0))]), 'image/png', /^not_a_picture$/],
    ['jpeg: frame header then the end marker, no scan', () => Buffer.concat([Buffer.from([0xff, 0xd8]), sof(1600, 900), Buffer.from([0xff, 0xd9])]), 'image/jpeg', /^not_a_picture$/],
    ['jpeg: frame header, garbage, end marker', () => Buffer.concat([Buffer.from([0xff, 0xd8]), sof(1600, 900), Buffer.alloc(3000, 0x55), Buffer.from([0xff, 0xd9])]), 'image/jpeg', /^not_a_picture$/],
    ['jpeg: two frame headers (small first, 60000x60000 second)', () => { const b = jpeg(1600, 900); const at = b.indexOf(Buffer.from([0xff, 0xda])); return Buffer.concat([b.subarray(0, at), sof(60000, 60000), b.subarray(at)]); }, 'image/jpeg', /^(not_a_picture|ok 1600x900.*)$/],
    ['jpeg: good file with its scan data zeroed', () => { const b = Buffer.from(jpeg(1600, 900)); const at = b.indexOf(Buffer.from([0xff, 0xda])); b.fill(0, at + 14, b.length - 2); return b; }, 'image/jpeg', /^(not_a_picture|ok .*)$/],
    ['webp: VP8X header and nothing else', () => riff(vp8x(1600, 900)), 'image/webp', /^not_a_picture$/],
    ['webp: VP8L signature then garbage', () => { const d = Buffer.alloc(400, 0x5a); d[0] = 0x2f; d.writeUInt32LE((1599) | (899 << 14), 1); return riff(rchunk('VP8L', d)); }, 'image/webp', /^not_a_picture$/],
    ['webp: VP8 key frame header then garbage', () => { const d = Buffer.alloc(400, 0x5a); d[0] = 0x10; d[3] = 0x9d; d[4] = 0x01; d[5] = 0x2a; d.writeUInt16LE(1600, 6); d.writeUInt16LE(900, 8); return riff(rchunk('VP8 ', d)); }, 'image/webp', /^not_a_picture$/],
    ['webp: VP8X says 1600x900, the picture inside is 700x400', () => riff(Buffer.concat([vp8x(1600, 900), inner(webp(700, 400))])), 'image/webp', /^(not_a_picture|too_small|ok 700x400.*)$/],
    ['webp: animation frames without the animation flag', () => riff(Buffer.concat([vp8x(1600, 900, 0), anim()])), 'image/webp', /^not_a_picture$/],
    ['webp: riff length shorter than the file (bytes after the end)', () => Buffer.concat([webp(1600, 900), Buffer.alloc(5000, 0x41)]), 'image/webp', /^ok 1600x900/],
  ];
  it.each(cases)('%s', async (name, make, type, want) => {
    const r = await outcome(name, make(), type);
    expect(r.out).toMatch(want);
    expect(r.out).not.toMatch(/PLAIN ERROR/);
  });

  it('a file whose header understates its real size cannot get a larger bitmap past the 25 MP check: VP8X says 1000x700, the picture inside is 6000x6000', async () => {
    const big = inner(webp(6000, 6000));
    const r = await outcome('webp: VP8X says 1000x700, picture inside is 6000x6000 (36 MP)', riff(Buffer.concat([vp8x(1000, 700), big])), 'image/webp');
    expect(r.out).not.toMatch(/^ok 6000x6000/);
  });
  it('EXIF orientation: a 400x700 JPEG stored on its side is judged upright (700x400 passes the minimum)', async () => {
    const b = jpeg(400, 700);
    const tiff = Buffer.concat([Buffer.from('MM\0*', 'latin1'), u32(8), Buffer.from([0, 1]), Buffer.from([0x01, 0x12, 0, 3]), u32(1), Buffer.from([0, 6, 0, 0]), u32(0)]);
    const data = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (data.length + 2) >> 8, (data.length + 2) & 255]), data]);
    const r = await outcome('jpeg 400x700 with EXIF orientation 6', Buffer.concat([b.subarray(0, 2), app1, b.subarray(2)]), 'image/jpeg');
    expect(r.out).toMatch(/^ok 700x400 crop/);
  });
});

describe('round 2, D18: a picture that decodes blank is refused; a real picture is not', () => {
  const solid = (w: number, h: number, fill: string, alpha = false) => { const c = createCanvas(w, h); const g = c.getContext('2d'); if (!alpha) { g.fillStyle = fill; g.fillRect(0, 0, w, h); } return { c, g }; };
  const out = (m: { c: any }, type: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png') => (type === 'image/png' ? m.c.toBuffer('image/png') : m.c.toBuffer(type, 90));
  const blank: [string, () => Buffer, string][] = [
    ['one flat colour, PNG (#336699)', () => out(solid(1600, 900, '#336699')), 'image/png'],
    ['one flat colour, JPEG (white)', () => out(solid(1600, 900, '#ffffff'), 'image/jpeg'), 'image/jpeg'],
    ['one flat colour, WebP (black)', () => out(solid(1600, 900, '#000000'), 'image/webp'), 'image/webp'],
    ['fully transparent PNG', () => out(solid(1600, 900, '', true)), 'image/png'],
    ['a grey lazy-load stand-in, 1600x900 (#eeeeee)', () => out(solid(1600, 900, '#eeeeee')), 'image/png'],
    ['two colours 7 apart (#808080 and #878787), halves', () => { const m = solid(1600, 900, '#808080'); m.g.fillStyle = '#878787'; m.g.fillRect(800, 0, 800, 900); return out(m); }, 'image/png'],
  ];
  it.each(blank)('refused: %s', async (name, make, type) => { const r = await outcome('D18 blank: ' + name, make(), type); expect(r.out).toBe('not_a_picture'); });

  // Real pictures that are mostly one colour. Each is something a business would have on its site.
  const real: [string, () => Buffer][] = [
    ['two colours 9 apart, halves (just over the threshold)', () => { const m = solid(1600, 900, '#808080'); m.g.fillStyle = '#898989'; m.g.fillRect(800, 0, 800, 900); return out(m); }],
    ['a transparent cut-out: one product shape on a transparent background', () => { const m = solid(1600, 900, '', true); m.g.fillStyle = '#b5651d'; m.g.fillRect(600, 250, 400, 400); m.g.fillStyle = '#7a3b2e'; m.g.fillRect(700, 350, 200, 200); return out(m); }],
    ['a small product (120x120) in the middle of a white studio background', () => { const m = solid(1600, 900, '#ffffff'); m.g.fillStyle = '#c0392b'; m.g.fillRect(740, 390, 120, 120); return out(m); }],
    ['a very small product (36x36) on white', () => { const m = solid(1600, 900, '#ffffff'); m.g.fillStyle = '#c0392b'; m.g.fillRect(782, 432, 36, 36); return out(m); }],
    ['a pen: one dark 900x10 bar on white', () => { const m = solid(1600, 900, '#ffffff'); m.g.fillStyle = '#1b1b1b'; m.g.fillRect(350, 443, 900, 10); return out(m); }],
    ['a necklace: a thin 3 px dark circle outline on white', () => { const m = solid(1600, 900, '#ffffff'); m.g.strokeStyle = '#333333'; m.g.lineWidth = 3; m.g.beginPath(); m.g.arc(800, 450, 300, 0, Math.PI * 2); m.g.stroke(); return out(m); }],
    ['a floor plan: 2 px black lines every 100 px on white', () => { const m = solid(1600, 900, '#ffffff'); m.g.fillStyle = '#000000'; for (let x = 100; x < 1600; x += 100) m.g.fillRect(x, 0, 2, 900); for (let y = 100; y < 900; y += 100) m.g.fillRect(0, y, 1600, 2); return out(m); }],
    ['a line sketch: twelve 2 px strokes on off-white', () => { const m = solid(1600, 900, '#fbf8f1'); m.g.strokeStyle = '#2b2b2b'; m.g.lineWidth = 2; for (let i = 0; i < 12; i++) { m.g.beginPath(); m.g.moveTo(100 + i * 110, 120 + (i % 3) * 40); m.g.lineTo(240 + i * 105, 780 - (i % 4) * 60); m.g.stroke(); } return out(m); }],
    ['a page of small text: 10 px dark text lines on white', () => { const m = solid(1600, 900, '#ffffff'); m.g.fillStyle = '#222222'; m.g.font = '10px sans-serif'; for (let y = 40; y < 880; y += 22) m.g.fillText('Harbour House is a short walk from the station and trains run every ten minutes all day long.', 60, y); return out(m); }],
    ['a paint swatch with a fine weave: alternate pixels 12 apart', () => { const m = solid(1600, 900, '#7fa8a0'); const d = m.g.getImageData(0, 0, 1600, 900); for (let y = 0; y < 900; y++) for (let x = 0; x < 1600; x++) if ((x + y) % 2) { const i = (y * 1600 + x) * 4; d.data[i] += 12; d.data[i + 1] += 12; d.data[i + 2] += 12; } m.g.putImageData(d, 0, 0); return out(m); }],
    ['fog: a smooth vertical gradient only 10 levels deep', () => { const m = solid(1600, 900, '#c8c8c8'); const grad = m.g.createLinearGradient(0, 0, 0, 900); grad.addColorStop(0, '#c8c8c8'); grad.addColorStop(1, '#d2d2d2'); m.g.fillStyle = grad; m.g.fillRect(0, 0, 1600, 900); return out(m); }],
    ['night sky: black with forty 2 px stars', () => { const m = solid(1600, 900, '#000000'); m.g.fillStyle = '#ffffff'; let n = 7; for (let i = 0; i < 40; i++) { n = (n * 137 + 187) % 9973; const x = n % 1600; n = (n * 137 + 187) % 9973; m.g.fillRect(x, n % 900, 2, 2); } return out(m); }],
  ];
  it.each(real)('recorded: %s', async (name, make) => {
    const r = await outcome('D18 real picture: ' + name, make());
    lines[lines.length - 1] += r.out.startsWith('ok') ? '' : '   <-- a real picture refused as blank';
    expect.soft(r.out, name).toMatch(/^ok /);
  });
});

describe('the child process', () => {
  it('gets PATH and NODE_ENV only, no stderr or inherited handles, and none of this process’s secrets', async () => {
    process.env.QA_FAKE_SECRET = 'do-not-leak'; process.env.DATABASE_URL ||= 'postgres://qa-placeholder'; process.env.NODE_OPTIONS_QA = 'x';
    P.spawned.length = 0;
    await readPicture(res(png(1600, 900)));
    expect(P.spawned.length).toBe(1);
    const { options, args } = P.spawned[0];
    expect(Object.keys(options.env).sort()).toEqual(['NODE_ENV', 'PATH']);
    expect(options.stdio).toEqual(['pipe', 'pipe', 'ignore']);
    expect(options.shell).toBeFalsy(); expect(options.detached).toBeFalsy();
    expect(args[0]).toBe('-e');
    expect(JSON.stringify(args)).not.toContain('do-not-leak');
    lines.push(`child options: env keys ${JSON.stringify(Object.keys(options.env))}, stdio ${JSON.stringify(options.stdio)}, cwd is the process cwd: ${options.cwd === process.cwd()}`);
  });
  it('a picture just under the 8 MB limit (noise, so it does not compress) goes through the child and comes back as a cover', async () => {
    // 1700x1500 RGB noise is about 7.7 MB as a PNG.
    const w = 1700, h = 1500; const raw = (await import('node:crypto')).randomBytes((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
    const file = Buffer.concat([SIG, ihdr(w, h, 8, 2), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
    const t = Date.now(); const r = await readPicture(res(file));
    lines.push(`large noise picture: source ${file.length} bytes ${w}x${h}; cover ${r.png.length} bytes; ${Date.now() - t} ms`);
    expect(file.length).toBeGreaterThan(7 * 1024 * 1024); expect(file.length).toBeLessThan(8 * 1024 * 1024);
    expect(probeImage(r.png)).toMatchObject({ width: 1200, height: 628, complete: true });
  });
  it('ten pictures asked for at once are decoded one at a time, good and bad mixed, each with its own answer', async () => {
    P.maxLive = 0;
    const crash = Buffer.concat([SIG, ihdr(1600, 900), chunk('IEND', Buffer.alloc(0))]);
    const jobs = Array.from({ length: 10 }, (_, i) => (i % 3 === 1 ? crash : i % 3 === 2 ? png(300, 200) : png(1600, 900)));
    const t = Date.now();
    const out = await Promise.all(jobs.map(b => readPicture(res(b)).then(r => 'ok ' + r.fit, e => (e instanceof SitePictureError ? e.code : 'PLAIN ' + e.message))));
    expect(out).toEqual(['ok crop', 'not_a_picture', 'too_small', 'ok crop', 'not_a_picture', 'too_small', 'ok crop', 'not_a_picture', 'too_small', 'ok crop']);
    expect(P.maxLive).toBe(1);
    lines.push(`ten concurrent pictures: ${Date.now() - t} ms in all, most children alive at once: ${P.maxLive}`);
  });
  it('a child that hangs is killed at the time limit, answers not_a_picture, and the next picture is then decoded', async () => {
    P.hang = true; P.pids.length = 0;
    const t = Date.now();
    const hung = readPicture(res(png(1600, 900))).then(() => 'ok', e => (e instanceof SitePictureError ? e.code : 'PLAIN ' + e.message));
    await new Promise(r => setTimeout(r, 200)); P.hang = false;
    const next = readPicture(res(png(1600, 900))).then(r => 'ok ' + r.fit, e => 'failed ' + e.message);
    expect(await hung).toBe('not_a_picture');
    const waited = Date.now() - t;
    expect(waited).toBeGreaterThanOrEqual(DECODE_TIMEOUT_MS - 500); expect(waited).toBeLessThan(DECODE_TIMEOUT_MS + 5000);
    expect(await next).toBe('ok crop');
    const pid = P.pids[0]; let alive = true; try { process.kill(pid, 0); } catch { alive = false; }
    expect(alive).toBe(false);
    lines.push(`hung child: refused after ${waited} ms, child process gone: ${!alive}; the picture queued behind it waited ${Date.now() - t} ms in all`);
  });
});
