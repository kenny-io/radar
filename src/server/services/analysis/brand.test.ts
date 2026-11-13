// Logo and brand colours read from a site that controls every byte it sends. Each file is made here, with the canvas
// library or from bytes; the site is a table of paths (no network) and storage is a recorder (no disk). The decode runs
// for real, in the child process brand.ts starts; starting one is watched, so the checks that must come before any
// decode can be shown to, and so can what the child is given.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ spawn: vi.fn(), start: (..._args: any[]): any => null, hang: false, active: 0, most: 0, ended: [] as { status: number | null; signal: string | null }[], fetchUrl: vi.fn(), putObject: vi.fn() }));
vi.mock('node:child_process', async original => {
  const real = await original<typeof import('node:child_process')>();
  H.start = (command: string, args: string[], options: any) => {
    H.most = Math.max(H.most, ++H.active);
    // `hang`: the child that is started never reads the picture and never answers, like a decoder stuck on a file.
    const child = real.spawn(command, H.hang ? ['-e', 'setInterval(() => {}, 1000)'] : args, options);
    child.on('close', (status, signal) => { H.active--; H.ended.push({ status, signal }); });
    return child;
  };
  H.spawn.mockImplementation(H.start);
  return { ...real, default: { ...real, spawn: H.spawn }, spawn: H.spawn };
});
vi.mock('./crawl', async original => ({ ...(await original<typeof import('./crawl')>()), fetchUrl: H.fetchUrl }));
vi.mock('../storage', async original => ({ ...(await original<typeof import('../storage')>()), putObject: H.putObject, objectKey: (bid: string, kind: string, ext: string) => `${bid}/${kind}/stored.${ext}` }));
import os from 'node:os';
import zlib from 'node:zlib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { detectBrand, normColor, pixelColors, readLogo, svgColors } from './brand';
import { probeImage } from '../untrustedImage';
import { readPicture } from '../realCover/picture';

const ORIGIN = 'https://brand.example';
const realTimeout = setTimeout;
/** A real wait, also while a test has replaced the clock. */
const pause = (ms: number) => new Promise<void>(resolve => { realTimeout(resolve, ms); });
type Served = { type: string; body: Buffer | string; status?: number };
/** The site: what each path answers with. Anything else is a 404 page. */
function serve(files: Record<string, Served>) {
  H.fetchUrl.mockImplementation(async (url: string) => {
    const file = files[new URL(url).pathname];
    return file ? { status: file.status ?? 200, type: file.type, body: Buffer.from(file.body as Buffer), url } : { status: 404, type: 'text/html', body: Buffer.from('<html><body>Not found</body></html>'), url };
  });
}
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  H.spawn.mockReset(); H.spawn.mockImplementation(H.start); H.hang = false; H.active = 0; H.most = 0; H.ended.length = 0;
  H.fetchUrl.mockReset(); H.putObject.mockReset(); H.putObject.mockImplementation(async (key: string) => '/api/files/' + key);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { warn.mockRestore(); });

const CSS_COLOUR = '#E63946';
/** A home page that names its logo candidates in order. `styled`: it also declares one brand colour in CSS. */
const page = (candidates: string[], o: { styled?: boolean; head?: string; body?: string } = {}) => `<!doctype html><html lang="en-GB"><head><title>Brand</title>${o.styled === false ? '' : '<style>:root{--brand-primary:#e63946}</style>'}${candidates.map(href => `<link rel="apple-touch-icon" href="${href}">`).join('')}${o.head ?? ''}</head><body>${o.body ?? '<p>Hello</p>'}</body></html>`;
/** detectBrand on a site whose only logo candidate is this response. */
const withOnly = (file: Served, o: { styled?: boolean } = {}) => { serve({ '/logo': file }); return detectBrand('biz', page(['/logo'], o), ORIGIN); };
const stored = () => H.putObject.mock.calls.map(([key, body, type]) => ({ key, body, type }));

const BLUE = '#1848D8', ORANGE = '#F07818'; // what #1d4ed8 and #f97316 become when each channel is rounded to a multiple of 24
/** A logo with something to find: mostly blue, an orange block, a white and a dark stroke (both neutral), and, where
 *  the format has transparency, a transparent margin and a faint wash that must not be counted. */
function logo(type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif' = 'image/png', w = 256, h = 128): Buffer {
  const canvas = createCanvas(w, h); const g = canvas.getContext('2d');
  if (type === 'image/jpeg') { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); }
  g.fillStyle = '#1d4ed8'; g.fillRect(w * 0.1, h * 0.1, w * 0.55, h * 0.8);
  g.fillStyle = '#f97316'; g.fillRect(w * 0.7, h * 0.1, w * 0.2, h * 0.6);
  g.fillStyle = '#ffffff'; g.fillRect(w * 0.2, h * 0.45, w * 0.35, h * 0.1);
  g.fillStyle = '#17181c'; g.fillRect(w * 0.7, h * 0.75, w * 0.2, h * 0.1);
  if (type !== 'image/jpeg') { g.fillStyle = 'rgba(22,163,74,0.4)'; g.fillRect(0, h * 0.92, w, h * 0.08); }
  return canvas.toBuffer(type as 'image/png');
}
/** A photograph-like picture for a cover, to decode alongside a logo. */
function photo(w: number, h: number): Buffer {
  const canvas = createCanvas(w, h); const g = canvas.getContext('2d'); const fill = g.createLinearGradient(0, 0, w, h); fill.addColorStop(0, '#1f4d3a'); fill.addColorStop(1, '#f2b544');
  g.fillStyle = fill; g.fillRect(0, 0, w, h); g.fillStyle = '#17181c'; g.fillRect(w * 0.4, h * 0.2, w * 0.2, h * 0.8);
  return canvas.toBuffer('image/png');
}

// The histogram exactly as brand.ts had it before the decode moved to a child process: loadImage and a 48×48 canvas in
// this process. It is only ever given files made in this test.
const oldToHex = (r: number, g: number, b: number) => '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase();
const channels = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const oldNeutral = (hex: string) => { const [r, g, b] = channels(hex); const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255; const s = mx === 0 ? 0 : (mx - mn) / mx; const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255; return s < 0.12 || l > 0.96 || l < 0.04; };
async function oldPixels(body: Buffer): Promise<Uint8ClampedArray> {
  const img = await loadImage(body); const c = createCanvas(48, 48); const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, 48, 48); return ctx.getImageData(0, 0, 48, 48).data;
}
async function oldLogoColors(body: Buffer): Promise<string[]> {
  const d = await oldPixels(body); const counts = new Map<string, number>();
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 200) continue; const q = oldToHex(Math.round(d[i] / 24) * 24, Math.round(d[i + 1] / 24) * 24, Math.round(d[i + 2] / 24) * 24); if (!oldNeutral(q)) counts.set(q, (counts.get(q) || 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}
const far = (a: string, b: string) => { const x = channels(a), y = channels(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) > 60; };

const u32be = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A PNG chunk with a correct checksum, so a damaged file made from these is damaged only where the test says. */
const pngChunk = (type: string, data: Buffer) => Buffer.concat([u32be(data.length), Buffer.from(type, 'latin1'), data, u32be(zlib.crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])))]);
const ihdr = (w: number, h: number, depth = 8, colour = 6) => pngChunk('IHDR', Buffer.concat([u32be(w), u32be(h), Buffer.from([depth, colour, 0, 0, 0])]));
/** A WebP file with one chunk of the given kind, padded past the size floor. Only the header is real. */
function webpHeader(kind: 'VP8L' | 'VP8X', w: number, h: number, o: { animated?: boolean } = {}): Buffer {
  let payload: Buffer;
  if (kind === 'VP8L') { payload = Buffer.alloc(5); payload[0] = 0x2f; payload.writeUInt32LE((((h - 1) << 14) | (w - 1)) >>> 0, 1); }
  else { payload = Buffer.alloc(10); payload[0] = o.animated ? 0x02 : 0x00; payload.writeUIntLE(w - 1, 4, 3); payload.writeUIntLE(h - 1, 7, 3); }
  const chunk = Buffer.concat([Buffer.from(kind, 'latin1'), u32le(payload.length + 120), payload, Buffer.alloc(120)]);
  return Buffer.concat([Buffer.from('RIFF'), u32le(4 + chunk.length), Buffer.from('WEBP'), chunk]);
}
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#1d4ed8"/><circle cx="50" cy="50" r="20" fill="#1d4ed8"/><path d="M0 0h10" stroke="rgb(249, 115, 22)"/><text fill="#ffffff">Brand</text><image href="https://elsewhere.example/x.png" width="10" height="10"/></svg>`;
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([128, 0, 128, 0, 0x80, 0, 0, 255, 0, 0, 0, 0, 255, 0x2c, 0, 0, 0, 0, 128, 0, 128, 0, 0, 2, 2, 0x44, 1, 0, 0x3b]), Buffer.alloc(80)]);
/** An icon file holding one 128×128 PNG. */
const ico = () => { const inner = logo('image/png', 128, 128); const entry = Buffer.alloc(16); entry.set([128, 128, 0, 0, 1, 0, 32, 0]); entry.writeUInt32LE(inner.length, 8); entry.writeUInt32LE(22, 12); return Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), entry, inner]); };
const bmp = () => { const w = 64, h = 64, row = w * 3, size = 54 + row * h; const b = Buffer.alloc(size, 0x80); b.write('BM'); b.writeUInt32LE(size, 2); b.writeUInt32LE(0, 6); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14); b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(0, 30); b.writeUInt32LE(row * h, 34); b.writeUInt32LE(2835, 38); b.writeUInt32LE(2835, 42); b.writeUInt32LE(0, 46); b.writeUInt32LE(0, 50); return b; };
const resized = (png: Buffer, w: number, h: number) => { const b = Buffer.from(png); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };

// Each of these starts like one of the three formats and has a header the decoder cannot read. Decoded in this
// process, every one that reaches the decoder ends the process with a segmentation fault (@napi-rs/canvas 0.1.100,
// checked on darwin arm64). `children`: how many decoding processes it may cost (none when the bytes alone refuse it).
const CRASHING: [string, () => Buffer, number][] = [
  ['a JPEG that is a start and an end marker, padded to 200 bytes', () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9]), Buffer.alloc(196)]), 0],
  ['a PNG with a header, a text chunk and an end, and no picture data', () => Buffer.concat([PNG_SIG, ihdr(128, 128), pngChunk('tEXt', Buffer.from('Comment\0' + 'x'.repeat(60), 'latin1')), pngChunk('IEND', Buffer.alloc(0))]), 1],
  ['a PNG whose header checksum is wrong', () => { const b = Buffer.from(logo()); b[29] ^= 0xff; return b; }, 1],
  ['a JPEG with its tables and frame header but no scan', () => { const jpeg = logo('image/jpeg'); return Buffer.concat([jpeg.subarray(0, jpeg.indexOf(Buffer.from([0xff, 0xda]))), Buffer.from([0xff, 0xd9])]); }, 1],
  ['a PNG with an impossible bit depth', () => { const b = Buffer.from(logo()); b[24] = 3; return b; }, 1],
  ['a JPEG whose Huffman table is damaged', () => { const b = Buffer.from(logo('image/jpeg')); const table = b.indexOf(Buffer.from([0xff, 0xc4])); b.fill(0xff, table + 5, table + 21); return b; }, 1],
  ['a WebP that is a header and nothing else', () => webpHeader('VP8X', 128, 128), 1],
  ['a WebP whose picture data is noise', () => { const b = Buffer.from(logo('image/webp')); b.fill(0x33, 40); return b; }, 1],
];

describe('a logo file that would end the process if it were decoded here (AC2)', () => {
  it.each(CRASHING)('%s: no logo, colours and language still read, and the process goes on to read a good logo', async (_name, make, children) => {
    const bytes = make();
    expect(bytes.length).toBeGreaterThanOrEqual(80); // past the size floor, so it is the checks and the child that stop it
    if (children) expect(probeImage(bytes)).toMatchObject({ complete: true }); // nothing in the bytes that are read first says it is bad
    else expect(probeImage(bytes)).toBeNull();
    const type = probeImage(bytes)?.type ?? 'image/jpeg';
    expect(await withOnly({ type, body: bytes })).toEqual({ logo: null, primary: CSS_COLOUR, secondary: null, language: 'English (UK)', htmlLang: 'en-GB' });
    expect(H.spawn).toHaveBeenCalledTimes(children);
    expect(H.putObject).not.toHaveBeenCalled();
    // This process is still here, and the next site's logo is read normally.
    expect(await withOnly({ type: 'image/png', body: logo() }, { styled: false })).toMatchObject({ logo: '/api/files/biz/logo/stored.png', primary: BLUE, secondary: ORANGE });
  });
});

describe('a bad candidate does not stop the next one (AC3)', () => {
  it.each([
    ['a file the decoder crashes on', () => CRASHING[2][1](), 'image/png', 2],
    ['a JPEG with no scan', () => CRASHING[3][1](), 'image/jpeg', 2],
    ['a file refused from its bytes', () => GIF, 'image/png', 1],
    ['an error page', () => Buffer.from('<html><body>Image unavailable</body></html>'.padEnd(200)), 'image/png', 1],
  ])('%s, then a good logo: the second is stored and gives the colours', async (_name, bad, type, children) => {
    const good = logo('image/webp');
    serve({ '/first': { type, body: bad() }, '/second': { type: 'image/webp', body: good } });
    const out = await detectBrand('biz', page(['/first', '/second'], { styled: false }), ORIGIN);
    expect(out).toMatchObject({ logo: '/api/files/biz/logo/stored.webp' });
    expect([out.primary, out.secondary]).toEqual([(await oldLogoColors(good))[0], (await oldLogoColors(good)).find(c => far(c, out.primary!))]);
    expect(stored()).toEqual([{ key: 'biz/logo/stored.webp', body: good, type: 'image/webp' }]);
    expect(H.spawn).toHaveBeenCalledTimes(children);
  });
  it('a candidate that cannot be fetched, one that is missing, and one storage will not take are passed over too', async () => {
    const good = logo();
    H.fetchUrl.mockImplementation(async (url: string) => {
      if (url.endsWith('/unreachable')) throw new Error('connect ETIMEDOUT');
      if (url.endsWith('/missing')) return { status: 404, type: 'image/png', body: logo(), url };
      return { status: 200, type: 'image/png', body: good, url };
    });
    H.putObject.mockImplementationOnce(async () => { throw new Error('storage is down'); });
    expect(await detectBrand('biz', page(['/unreachable', '/missing', '/refused-by-storage', '/good'], { styled: false }), ORIGIN)).toMatchObject({ logo: '/api/files/biz/logo/stored.png', primary: BLUE });
    expect(H.putObject).toHaveBeenCalledTimes(2);
  });
  it('only the first six candidates are looked at', async () => {
    serve({ '/7': { type: 'image/png', body: logo() } });
    expect((await detectBrand('biz', page(['/1', '/2', '/3', '/4', '/5', '/6', '/7']), ORIGIN)).logo).toBeNull();
    expect(H.fetchUrl.mock.calls.filter(([, accept]) => accept === 'image/*')).toHaveLength(6);
  });
});

describe('what is refused from the bytes alone: no child process starts (AC4)', () => {
  it.each<[string, () => Buffer | string, string]>([
    ['SVG text under a PNG header', () => SVG, 'image/png'], ['SVG text under a JPEG header', () => SVG, 'image/jpeg'], ['SVG text under a WebP header', () => SVG, 'image/webp'],
    ['a GIF under a PNG header', () => GIF, 'image/png'], ['a GIF under its own header', () => GIF, 'image/gif'],
    ['an ICO under a PNG header', ico, 'image/png'], ['an ICO under its own header', ico, 'image/x-icon'], ['an ICO under the registered icon type', ico, 'image/vnd.microsoft.icon'],
    ['a BMP under a PNG header', bmp, 'image/png'], ['a BMP under its own header', bmp, 'image/bmp'],
    ['an AVIF under a PNG header', () => logo('image/avif'), 'image/png'], ['an AVIF under its own header', () => logo('image/avif'), 'image/avif'],
    ['an HTML page under a PNG header', () => '<!doctype html><html><body><img src="a.png">Not found</body></html>'.padEnd(300), 'image/png'],
    ['a PNG cut short', () => { const b = logo(); return b.subarray(0, b.length >> 1); }, 'image/png'],
    ['a PNG missing its last byte', () => { const b = logo(); return b.subarray(0, b.length - 1); }, 'image/png'],
    ['a JPEG cut short', () => { const b = logo('image/jpeg'); return b.subarray(0, b.length >> 1); }, 'image/jpeg'],
    ['a WebP cut short', () => { const b = logo('image/webp'); return b.subarray(0, b.length >> 1); }, 'image/webp'],
    ['an animated WebP', () => webpHeader('VP8X', 256, 256, { animated: true }), 'image/webp'],
    ['a PNG that declares one side over the limit', () => resized(logo(), 10_001, 400), 'image/png'],
    ['a PNG that declares too many pixels', () => resized(logo(), 5001, 5000), 'image/png'],
    ['a WebP that declares too many pixels', () => webpHeader('VP8L', 16000, 16000), 'image/webp'],
    ['a PNG that declares no width', () => resized(logo(), 0, 128), 'image/png'],
    ['a PNG 47 px high', () => logo('image/png', 300, 47), 'image/png'], ['a PNG 47 px wide', () => logo('image/png', 47, 300), 'image/png'],
    ['a JPEG 40 px square', () => logo('image/jpeg', 40, 40), 'image/jpeg'], ['a WebP 32 px square', () => logo('image/webp', 32, 32), 'image/webp'],
  ])('%s is skipped', async (_name, make, type) => {
    const body = make();
    expect(Buffer.byteLength(body)).toBeGreaterThanOrEqual(80);
    expect(await withOnly({ type, body })).toMatchObject({ logo: null, primary: CSS_COLOUR, language: 'English (UK)' });
    expect(H.spawn).not.toHaveBeenCalled();
    expect(H.putObject).not.toHaveBeenCalled();
  });
  it.each([['48 px square', 48, 48], ['48 px high and wide', 400, 48], ['48 px wide and tall', 48, 400]])('a logo of exactly the smallest size (%s) is decoded and kept', async (_name, w, h) => {
    expect((await withOnly({ type: 'image/png', body: logo('image/png', w, h) })).logo).toBe('/api/files/biz/logo/stored.png');
    expect(H.spawn).toHaveBeenCalledTimes(1);
  });
  it('a response that is not an image by its header, is an error, or is outside the size bounds is never read at all', async () => {
    for (const file of [{ type: 'text/html', body: logo() }, { type: 'application/octet-stream', body: logo() }, { type: 'image/png', body: logo(), status: 500 }, { type: 'image/png', body: logo().subarray(0, 79) }, { type: 'image/svg+xml', body: SVG.padEnd(3 * 1024 * 1024 + 1) }]) {
      expect((await withOnly(file)).logo).toBeNull();
    }
    expect(H.spawn).not.toHaveBeenCalled(); expect(H.putObject).not.toHaveBeenCalled();
  });
});

describe('a good raster logo (AC5)', () => {
  it.each([['PNG', 'image/png', 'png'], ['JPEG', 'image/jpeg', 'jpg'], ['WebP', 'image/webp', 'webp']] as const)('a %s is stored as what its bytes are, and its colours are the ones the in-process histogram gave', async (_name, type, ext) => {
    for (const [w, h] of [[256, 128], [600, 600], [90, 300]]) {
      const body = logo(type, w, h); const old = await oldLogoColors(body);
      expect(old.slice(0, 2)).toEqual([BLUE, ORANGE]); // the test picture is what it is meant to be
      expect(await readLogo(body, type)).toEqual({ type, ext, colors: old });
      H.putObject.mockClear();
      const out = await withOnly({ type, body }, { styled: false });
      expect(out).toEqual({ logo: `/api/files/biz/logo/stored.${ext}`, primary: old[0], secondary: old.find(c => far(c, old[0])), language: 'English (UK)', htmlLang: 'en-GB' });
      expect(stored()).toEqual([{ key: `biz/logo/stored.${ext}`, body, type }]); // the bytes as they came
    }
  });
  it.each([
    ['WebP bytes under a PNG header', 'image/webp', 'image/png', 'webp'], ['PNG bytes under a JPEG header', 'image/png', 'image/jpeg', 'png'], ['JPEG bytes under a WebP header', 'image/jpeg', 'image/webp', 'jpg'],
    ['PNG bytes under an icon header', 'image/png', 'image/x-icon', 'png'], ['JPEG bytes under a header with parameters', 'image/jpeg', 'image/jpg; charset=binary', 'jpg'], ['PNG bytes under a GIF header', 'image/png', 'image/gif', 'png'],
  ] as const)('%s: the bytes decide the stored type and extension', async (_name, bytes, header, ext) => {
    const body = logo(bytes);
    expect((await withOnly({ type: header, body })).logo).toBe(`/api/files/biz/logo/stored.${ext}`);
    expect(stored()).toEqual([{ key: `biz/logo/stored.${ext}`, body, type: bytes }]);
  });
  it('the histogram rule on its own: faint pixels are left out, channels are rounded to multiples of 24, neutrals are dropped, most frequent first', async () => {
    const px = (r: number, g: number, b: number, a: number, n: number) => Array.from({ length: n }, () => [r, g, b, a]).flat();
    const data = Uint8ClampedArray.from([
      ...px(29, 78, 216, 255, 5), ...px(30, 80, 210, 200, 2), // one bucket: 7
      ...px(249, 115, 22, 255, 6),
      ...px(22, 163, 74, 199, 50), // too faint to count, however many
      ...px(255, 255, 255, 255, 40), ...px(0, 0, 0, 255, 40), ...px(128, 128, 128, 255, 40), // white, black, grey
      ...px(220, 38, 38, 255, 1),
    ]);
    expect(pixelColors(data)).toEqual(['#1848D8', '#F07818', '#D83030']);
    expect(pixelColors(new Uint8ClampedArray(0))).toEqual([]);
    expect(pixelColors(Buffer.from([29, 78, 216, 255, 29, 78]))).toEqual(['#1848D8']); // a ragged end is not read past
    for (const type of ['image/png', 'image/jpeg', 'image/webp'] as const) { const body = logo(type, 320, 200); expect(pixelColors(await oldPixels(body))).toEqual(await oldLogoColors(body)); }
  });
  it('a logo with no colour in it is kept, and the colours come from the page', async () => {
    const canvas = createCanvas(200, 80); const g = canvas.getContext('2d'); g.fillStyle = '#17181c'; g.fillRect(20, 20, 160, 40);
    expect(await withOnly({ type: 'image/png', body: canvas.toBuffer('image/png') })).toMatchObject({ logo: '/api/files/biz/logo/stored.png', primary: CSS_COLOUR, secondary: null });
  });
  it('the page’s own primary colour comes first, and the logo gives the secondary', async () => {
    expect(await withOnly({ type: 'image/png', body: logo() })).toMatchObject({ primary: CSS_COLOUR, secondary: BLUE });
  });
});

describe('an SVG logo is read as text and never decoded (AC6)', () => {
  it.each([
    ['plain', SVG, 'image/svg+xml'],
    ['with a byte-order mark, an XML declaration, a doctype and a comment first', '﻿<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<!-- Generator: a drawing program -->\n' + SVG, 'image/svg+xml; charset=utf-8'],
    ['with an upper-case tag and leading blank lines', '\n\n  ' + SVG.replace('<svg', '<SVG'), 'image/svg+xml'],
  ])('%s: stored as SVG as it came, colours from its declared fills', async (_name, text, type) => {
    const out = await withOnly({ type, body: text }, { styled: false });
    expect(out).toMatchObject({ logo: '/api/files/biz/logo/stored.svg', primary: '#1D4ED8', secondary: '#F97316' });
    expect(stored()).toEqual([{ key: 'biz/logo/stored.svg', body: Buffer.from(text), type: 'image/svg+xml' }]);
    expect(H.spawn).not.toHaveBeenCalled();
  });
  it.each<[string, () => Buffer | string]>([
    ['a good PNG', () => logo()], ['a JPEG', () => logo('image/jpeg')], ['a GIF', () => GIF], ['an HTML page', () => '<!doctype html><html><body>Not found</body></html>'.padEnd(300)],
    ['plain text that mentions <svg> later on', () => 'The file you asked for, <svg width="1">, is not here.'.padEnd(300)], ['a JSON error', () => '{"error":"not found","hint":"<svg "}'.padEnd(300)],
    ['an SVG tag that only comes after the first kilobytes', () => '<!--' + ' '.repeat(20_000) + '-->' + SVG],
  ])('an SVG header over %s is skipped', async (_name, make) => {
    expect((await withOnly({ type: 'image/svg+xml', body: make() })).logo).toBeNull();
    expect(H.spawn).not.toHaveBeenCalled(); expect(H.putObject).not.toHaveBeenCalled();
  });
  it('the SVG inside the page’s header is still the last resort, when no candidate works', async () => {
    serve({ '/logo': { type: 'image/png', body: CRASHING[1][1]() } });
    const html = page(['/logo'], { styled: false, body: '<header><a href="/"><svg viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="#16a34a"/></svg></a></header>' });
    expect(await detectBrand('biz', html, ORIGIN)).toMatchObject({ logo: '/api/files/biz/logo/stored.svg', primary: '#16A34A' });
    expect(stored()).toHaveLength(1);
    expect(stored()[0].type).toBe('image/svg+xml'); expect(stored()[0].body.toString()).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  });
});

describe('the colour patterns (AC7)', () => {
  // The patterns as they were before their repeats were bounded. Run here only on short, ordinary text.
  const oldSvgColors = (s: string) => {
    const counts = new Map<string, number>();
    for (const m of s.matchAll(/(?:fill|stop-color|stroke|color)\s*[=:]\s*["']?(#[0-9a-f]{3,8}|rgba?\([^)]*\))/gi)) { const c = normColor(m[1]); if (c && !oldNeutral(c)) counts.set(c, (counts.get(c) || 0) + 1); }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  };
  /** What the page's CSS gave before: the first non-neutral primary, then a secondary far enough from it (no logo here). */
  const oldCssPick = (css: string) => {
    const out = { primary: [] as string[], secondary: [] as string[], any: [] as string[] };
    const re = /--([\w-]+)\s*:\s*(#[0-9a-f]{3,8}\b|rgba?\([^)]*\))/gi; let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      const name = m[1].toLowerCase(); const c = normColor(m[2]); if (!c) continue;
      if (/primary|brand|main/.test(name) && !/text|fg|foreground|bg|background|border/.test(name)) out.primary.push(c);
      else if (/secondary|accent|highlight/.test(name) && !/text|fg|foreground|border/.test(name)) out.secondary.push(c);
      else out.any.push(c);
    }
    const cand = [...out.primary, ...out.secondary, ...out.any].filter(c => !oldNeutral(c));
    const primary = out.primary.find(c => !oldNeutral(c)) || cand[0] || null;
    return { primary, secondary: [...out.secondary, ...cand].find(c => !oldNeutral(c) && (!primary || far(c, primary))) || null };
  };
  const fromCss = async (css: string, linked = false) => {
    serve(linked ? { '/site.css': { type: 'text/css', body: css } } : {});
    const out = await detectBrand('biz', page([], { styled: false, head: linked ? '<link rel="stylesheet" href="/site.css">' : `<style>${css}</style>` }), ORIGIN);
    return { primary: out.primary, secondary: out.secondary };
  };

  it.each([
    ['#abc', '#AABBCC'], ['#3b82f6', '#3B82F6'], ['#3B82F6CC', '#3B82F6'], ['rgb(12, 34, 156)', '#0C229C'], ['rgba(200,30,40,0.5)', '#C81E28'], ['rgb(12 34 156 / 50%)', '#0C229C'],
    ['RGBA( 200 , 30 , 40 , .5 )', '#C81E28'], ['rgba(59, 130, 246, var(--tw-bg-opacity))', '#3B82F6'],
  ])('a custom property set to %s is read as %s, in a style element and in a linked stylesheet, however it is spaced', async (value, hex) => {
    for (const css of [`:root{--brand:${value}}`, `:root {\n  --brand: ${value};\n}`, `:root{--brand :\n\t\t${value} ;--x:1}`, `a{color:red}:root{--Brand-Color:${value}}`]) {
      expect(await fromCss(css)).toEqual({ primary: hex, secondary: null });
      expect(await fromCss(css, true)).toEqual({ primary: hex, secondary: null });
      expect(oldCssPick(css)).toEqual({ primary: hex, secondary: null });
    }
  });
  it.each([
    ['a hand-written theme', ':root {\n  --color-primary: #2563eb;\n  --color-primary-text: #ffffff;\n  --color-secondary: #f59e0b;\n  --color-bg: #f8fafc;\n  --radius: 8px;\n  --shadow: 0 1px 2px rgba(0,0,0,.2);\n}\n.btn--primary:hover{color:var(--color-primary)}'],
    ['a minified build', ':root{--bs-blue:#0d6efd;--bs-primary:#0d6efd;--bs-secondary:#6c757d;--bs-primary-rgb:13,110,253;--bs-body-bg:#fff;--bs-link-color:#0d6efd;--bs-accent:rgb(214,51,132)}.a--b{color:#f00}.c{--bs-border-color:#dee2e6}'],
    ['a WordPress preset list', 'body{--wp--preset--color--black: #000000;--wp--preset--color--vivid-red: #cf2e2e;--wp--preset--color--luminous-vivid-amber: #fcb900;--wp--preset--gradient--vivid-cyan-blue-to-vivid-purple: linear-gradient(135deg,rgba(6,147,227,1) 0%,rgb(155,81,224) 100%);--wp--preset--color--accent: #0693e3;}'],
    ['utility-framework variables', '*,::before{--tw-ring-color:rgb(59 130 246 / 0.5);--tw-shadow:0 0 #0000;--tw-ring-offset-color:#fff}.x{--brand-background:#111827;--main-highlight:rgba(236, 72, 153, 1);---odd:#16a34a}'],
    ['no colours at all', 'body{margin:0;--gap:4px;--font:"Inter",sans-serif}'],
    ['only neutral colours', ':root{--primary:#ffffff;--secondary:#111;--accent:rgb(128,128,128)}'],
  ])('%s gives the primary and secondary it gave before', async (_name, css) => {
    const before = oldCssPick(css);
    expect(await fromCss(css)).toEqual(before);
    expect(await fromCss(css, true)).toEqual(before);
  });
  it('the examples above are not all empty: named results for two of them', async () => {
    expect(await fromCss(':root{--color-primary:#2563eb;--color-primary-text:#fff;--color-secondary:#f59e0b}')).toEqual({ primary: '#2563EB', secondary: '#F59E0B' });
    expect(await fromCss(':root{--bs-blue:#0d6efd;--bs-accent:rgb(214,51,132)}')).toEqual({ primary: '#D63384', secondary: '#0D6EFD' });
  });
  it('the meta theme colour is still a primary, and a stylesheet on another origin is still not fetched', async () => {
    serve({});
    const out = await detectBrand('biz', page([], { styled: false, head: '<meta name="theme-color" content="#7c3aed"><link rel="stylesheet" href="https://cdn.elsewhere.example/a.css">' }), ORIGIN);
    expect(out.primary).toBe('#7C3AED');
    expect(H.fetchUrl).not.toHaveBeenCalled();
  });
  it.each([
    ['attributes with either quote, or none', `<svg><rect fill="#1d4ed8"/><rect fill='#1D4ED8'/><rect fill=#f97316 /><path stroke="#16a34a"/></svg>`, ['#1D4ED8', '#F97316', '#16A34A']],
    ['style declarations and gradient stops', `<svg><style>.a{fill:#1d4ed8;stroke: rgb(249, 115, 22)}</style><stop stop-color="rgba(22,163,74,0.5)"/><g style="fill : #1d4ed8; color:#abc"/></svg>`, ['#1D4ED8', '#F97316', '#16A34A', '#AABBCC']],
    ['short, long and eight-digit hex, and the modern rgb() form', `<svg><a fill="#e11"/><a fill="#ee1111"/><a fill="#ee1111cc"/><a fill="rgb(12 34 156 / 50%)"/></svg>`, ['#EE1111', '#0C229C']],
    ['neutrals, keywords and references, which give nothing', `<svg><a fill="#fff"/><a fill="#000000"/><a fill="none"/><a fill="currentColor"/><a fill="url(#g)"/><a stroke="red"/></svg>`, []],
  ])('SVG text with %s gives the colours it gave before', (_name, text, colours) => {
    expect(svgColors(text)).toEqual(colours);
    expect(oldSvgColors(text)).toEqual(colours);
    expect(svgColors(SVG)).toEqual(oldSvgColors(SVG));
  });

  const MB = 1024 * 1024, KB = 1024;
  const fill = (unit: string, bytes: number) => unit.repeat(Math.floor(bytes / unit.length));
  const timed = async <T>(work: () => Promise<T>) => { const started = Date.now(); const value = await work(); return { value, ms: Date.now() - started }; };
  // Before the repeats were bounded: 300 KB of `fill=rgb(` took 15 seconds and 1 MB took 167, with every job in the process waiting.
  it.each([
    ['fill=rgb( over and over', '', 'fill=rgb('], ['fill= and a run of spaces', '', 'fill=' + ' '.repeat(200)], ['one rgb( that never closes', 'fill="rgb(', '1, '], ['stroke:rgba( and digits', '', 'stroke:rgba(' + '9'.repeat(90)],
    ['the word fill and nothing else', '', 'fill'], ['color: and quotes', '', `color:"'`],
  ])('a 3 MB SVG logo of %s is read in under 2 seconds', async (_name, first, unit) => {
    const head = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#1d4ed8"/>' + first;
    const body = Buffer.from(head + fill(unit, 3 * MB - head.length));
    expect(body.length).toBeGreaterThan(3 * MB - 250); expect(body.length).toBeLessThanOrEqual(3 * MB);
    const { value, ms } = await timed(() => withOnly({ type: 'image/svg+xml', body }, { styled: false }));
    expect(ms).toBeLessThan(2000);
    expect(value).toMatchObject({ logo: '/api/files/biz/logo/stored.svg', primary: '#1D4ED8' }); // and the one real fill in it is still found
  });
  // Before: 300 KB of `--a:rgb(` took 16 seconds; a run of `-` was as bad.
  it('300 KB stylesheets of --a:rgb(, of dashes, of --a--a and of a spaced-out name, and as much again inline, are read in under 2 seconds', async () => {
    const hostile = ['--a:rgb(', '-', '--a', '--a' + ' '.repeat(200) + ':' + ' '.repeat(200)].map(unit => fill(unit, 300 * KB));
    serve({ '/1.css': { type: 'text/css', body: hostile[0] }, '/2.css': { type: 'text/css', body: hostile[1] }, '/3.css': { type: 'text/css', body: hostile[2] + ';--accent:#f59e0b' } });
    const html = page([], { styled: false, head: `<style>${hostile.join('\n')}\n:root{--brand:#2563eb}</style><link rel="stylesheet" href="/1.css"><link rel="stylesheet" href="/2.css"><link rel="stylesheet" href="/3.css">` });
    const { value, ms } = await timed(() => detectBrand('biz', html, ORIGIN));
    expect(ms).toBeLessThan(2000);
    expect(value).toMatchObject({ primary: '#2563EB', language: 'English (UK)' }); // the real declaration after the inline flood is still found
  });
});

describe('the page itself cannot make detection fail (D7)', () => {
  it('an icon link with an absurd sizes attribute', async () => {
    serve({ '/icon.png': { type: 'image/png', body: logo() } });
    const html = page([], { head: `<link rel="icon" href="/icon.png" sizes="${'16x16 '.repeat(300_000)}192x192">` });
    expect(await detectBrand('biz', html, ORIGIN)).toMatchObject({ logo: '/api/files/biz/logo/stored.png', primary: CSS_COLOUR });
  });
  it('a header SVG nested too deep to be written out: no logo, and the rest is still read', async () => {
    serve({});
    const html = page([], { body: `<header><svg>${'<g>'.repeat(20_000)}<path fill="#16a34a"/>${'</g>'.repeat(20_000)}</svg></header>` });
    expect(await detectBrand('biz', html, ORIGIN)).toEqual({ logo: null, primary: CSS_COLOUR, secondary: null, language: 'English (UK)', htmlLang: 'en-GB' });
  });
  it('a page with nothing in it', async () => {
    serve({});
    expect(await detectBrand('biz', '', ORIGIN)).toEqual({ logo: null, primary: null, secondary: null, language: null, htmlLang: null });
  });
});

describe('a decoder that cannot run does not cost the site its logo (AC8)', () => {
  it('the child cannot be started: the logo is kept without its colours, one warning is logged, and the next call works', async () => {
    H.spawn.mockImplementationOnce(() => { throw new Error('spawn ENOENT'); });
    expect(await withOnly({ type: 'image/png', body: logo() })).toEqual({ logo: '/api/files/biz/logo/stored.png', primary: CSS_COLOUR, secondary: null, language: 'English (UK)', htmlLang: 'en-GB' });
    expect(warn).toHaveBeenCalledTimes(1); expect(String(warn.mock.calls[0].join(' '))).toContain('spawn ENOENT');
    expect(await withOnly({ type: 'image/png', body: logo() })).toMatchObject({ logo: '/api/files/biz/logo/stored.png', primary: CSS_COLOUR, secondary: BLUE });
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('the canvas library cannot be found by the child: the same, with nothing taken from the logo', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(os.tmpdir());
    try {
      const body = logo('image/jpeg');
      expect(await withOnly({ type: 'image/jpeg', body }, { styled: false })).toEqual({ logo: '/api/files/biz/logo/stored.jpg', primary: null, secondary: null, language: 'English (UK)', htmlLang: 'en-GB' });
      expect(stored()).toEqual([{ key: 'biz/logo/stored.jpg', body, type: 'image/jpeg' }]);
      expect(warn).toHaveBeenCalledTimes(1); expect(String(warn.mock.calls[0].join(' '))).toContain('canvas library');
    } finally { cwd.mockRestore(); }
    expect(await withOnly({ type: 'image/jpeg', body: logo('image/jpeg') }, { styled: false })).toMatchObject({ primary: BLUE, secondary: ORANGE });
  });
  it('one warning for the whole detection, even when more than one candidate meets the fault', async () => {
    H.spawn.mockImplementation(() => { throw new Error('spawn EAGAIN'); });
    H.putObject.mockImplementationOnce(async () => { throw new Error('storage is down'); });
    serve({ '/first': { type: 'image/png', body: logo() }, '/second': { type: 'image/webp', body: logo('image/webp') } });
    expect(await detectBrand('biz', page(['/first', '/second']), ORIGIN)).toMatchObject({ logo: '/api/files/biz/logo/stored.webp', primary: CSS_COLOUR, secondary: null });
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('a file the bytes refuse is still refused while the decoder is down, and an SVG still gives its colours', async () => {
    H.spawn.mockImplementation(() => { throw new Error('spawn EAGAIN'); });
    expect((await withOnly({ type: 'image/png', body: GIF })).logo).toBeNull();
    expect(await withOnly({ type: 'image/svg+xml', body: SVG }, { styled: false })).toMatchObject({ logo: '/api/files/biz/logo/stored.svg', primary: '#1D4ED8' });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the decoding process (AC9)', () => {
  it('is given the picture and nothing else: no arguments from the picture, and none of this process’s environment', async () => {
    await withOnly({ type: 'image/png', body: logo() });
    await withOnly({ type: 'image/jpeg', body: logo('image/jpeg', 400, 90) });
    const [command, args, options] = H.spawn.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args).toHaveLength(3); expect(args[0]).toBe('-e'); expect(JSON.parse(args[2])).toEqual({ side: 48 });
    expect(H.spawn.mock.calls[1][1]).toEqual(args); // another picture, the very same arguments
    expect(Object.keys(options.env).sort()).toEqual(['NODE_ENV', 'PATH']);
    expect(options.stdio).toEqual(['pipe', 'pipe', 'ignore']);
    expect(options.cwd).toBe(process.cwd());
  });
  it('a decode that does not answer is stopped after ten seconds, and the candidate is skipped for the next', async () => {
    serve({ '/stuck': { type: 'image/png', body: logo() }, '/good': { type: 'image/svg+xml', body: SVG } });
    H.hang = true;
    // Only the clock is replaced: the child is real, it really hangs, and it is really killed.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let settled = false;
      const detection = detectBrand('biz', page(['/stuck', '/good'], { styled: false }), ORIGIN).finally(() => { settled = true; });
      await vi.waitFor(() => expect(H.spawn).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(9_500);
      await pause(300);
      expect([settled, H.active, H.ended]).toEqual([false, 1, []]); // still waiting, the child still running
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await Promise.race([detection, pause(3000).then(() => 'still waiting')])).toMatchObject({ logo: '/api/files/biz/logo/stored.svg', primary: '#1D4ED8' });
      expect(H.ended).toEqual([{ status: null, signal: 'SIGKILL' }]);
      expect(H.spawn).toHaveBeenCalledTimes(1);
    } finally { vi.advanceTimersByTime(60_000); vi.useRealTimers(); } // whatever happened above, no child is left running
  });
  it('a logo and a cover asked for together are decoded one after the other', async () => {
    serve({ '/logo': { type: 'image/png', body: logo() } });
    const cover = (w: number, h: number) => readPicture({ url: 'https://lived.ae/a', type: 'image/png', body: photo(w, h) });
    const results = await Promise.all([
      cover(1600, 900), detectBrand('biz', page(['/logo']), ORIGIN), readLogo(logo('image/webp'), 'image/webp'), cover(800, 1200), detectBrand('biz', page(['/logo']), ORIGIN), readLogo(logo('image/jpeg'), 'image/jpeg'),
    ]);
    expect(results[0]).toMatchObject({ w: 1600, h: 900, fit: 'crop' }); expect(results[3]).toMatchObject({ fit: 'backdrop' });
    expect(results[1]).toMatchObject({ logo: '/api/files/biz/logo/stored.png', secondary: BLUE }); expect(results[2]).toMatchObject({ ext: 'webp' });
    expect(H.spawn).toHaveBeenCalledTimes(6);
    expect(H.most).toBe(1);
  });
});
