// QA corpus for safe-provider-image-decode: good pictures (AC2), good-but-unusual files (D3), malformed files (AC3-AC5).
// Everything is derived here: from the canvas library, from command-line encoders when they are installed (magick,
// cwebp, gif2webp, jpegtran, cjpeg, sips, ffmpeg; a missing tool skips its files and is listed), and from byte edits.
// Deterministic: the "random" edits use a fixed-seed generator.
//   node .factory/safe-provider-image-decode/qa/make-corpus.mjs <out dir>
// Writes <out dir>/<group>/<name> and <out dir>/manifest.json ([{ group, name, file, bytes, note }]).
// Nothing here decodes a malformed file: the files are only written.
import { createCanvas } from '@napi-rs/canvas';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = path.resolve(process.argv[2] || 'corpus');
fs.rmSync(out, { recursive: true, force: true });
const manifest = []; const skipped = [];
function put(group, name, buf, note = '') {
  const dir = path.join(out, group); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name); fs.writeFileSync(file, buf);
  manifest.push({ group, name, file, bytes: buf.length, note });
  return file;
}
const tmp = path.join(out, '_tmp'); fs.mkdirSync(tmp, { recursive: true });
/** Run an encoder; null (and a note) when it is missing or fails. */
function tool(label, cmd, args, outFile) {
  try { execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'ignore'], timeout: 60_000 }); return fs.readFileSync(outFile); }
  catch (e) { skipped.push(`${label}: ${cmd} ${e.code === 'ENOENT' ? 'not installed' : 'failed'}`); return null; }
}

// ── pictures ──
/** Several colours, nothing symmetric: a crop from the wrong place, a flip or a turn gives other bytes. */
function scene(w, h, type = 'image/png', o = {}) {
  const c = createCanvas(w, h); const x = c.getContext('2d');
  if (!o.transparent) { const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#0b3954'); g.addColorStop(0.45, '#ffd166'); g.addColorStop(1, '#8338ec'); x.fillStyle = g; x.fillRect(0, 0, w, h); }
  x.fillStyle = '#ef476f'; x.fillRect(w * 0.06, h * 0.08, w * 0.3, h * 0.22);
  x.fillStyle = '#06d6a0'; x.beginPath(); x.arc(w * 0.72, h * 0.62, Math.max(1, Math.min(w, h) * 0.2), 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(17,138,178,0.55)'; x.fillRect(w * 0.5, h * 0.05, w * 0.12, h * 0.9);
  x.strokeStyle = '#f8f9fa'; x.lineWidth = Math.max(1, w / 180); x.beginPath(); x.moveTo(0, h * 0.9); x.lineTo(w, h * 0.15); x.stroke();
  return o.quality != null ? c.toBuffer(type, o.quality) : c.toBuffer(type);
}
/** Noise that does not compress: a large file for a small picture. */
function noisy(w, h, type = 'image/png') {
  const c = createCanvas(w, h); const x = c.getContext('2d'); const d = x.createImageData(w, h); let s = 12345;
  for (let i = 0; i < d.data.length; i++) { s = (s * 1103515245 + 12345) >>> 0; d.data[i] = i % 4 === 3 ? 255 : s >>> 24; }
  x.putImageData(d, 0, 0); return c.toBuffer(type);
}

// ── bytes ──
const u32be = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u32le = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u16be = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
let seed = 0x5eed1234;
const rnd = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngChunk = (type, data, crc) => Buffer.concat([u32be(data.length), Buffer.from(type, 'latin1'), data, u32be(crc ?? zlib.crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])))]);
function pngChunks(b) { const list = []; for (let i = 8; i + 12 <= b.length;) { const len = b.readUInt32BE(i); list.push({ type: b.toString('latin1', i + 4, i + 8), data: b.subarray(i + 8, i + 8 + len), at: i, len }); i += 12 + len; } return list; }
const pngFrom = chunks => Buffer.concat([PNG_SIG, ...chunks.map(c => c.raw || pngChunk(c.type, c.data, c.crc))]);
const IEND = pngChunk('IEND', Buffer.alloc(0));
const ihdr = (w, h, depth = 8, colour = 6, comp = 0, filter = 0, interlace = 0) => Buffer.concat([u32be(w), u32be(h), Buffer.from([depth, colour, comp, filter, interlace])]);
function jpegSegments(b) { // [{ marker, at, length }] up to and including SOS
  const list = [];
  for (let i = 2; i + 4 <= b.length;) { if (b[i] !== 0xff) break; const m = b[i + 1]; if (m === 0xff) { i++; continue; } if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { list.push({ m, at: i, length: 0 }); i += 2; continue; } const length = b.readUInt16BE(i + 2); list.push({ m, at: i, length }); if (m === 0xda) break; i += 2 + length; }
  return list;
}
const jpegSeg = (marker, data) => Buffer.concat([Buffer.from([0xff, marker]), u16be(data.length + 2), data]);
const insertAfterSoi = (jpeg, ...segs) => Buffer.concat([jpeg.subarray(0, 2), ...segs, jpeg.subarray(2)]);
const EOI = Buffer.from([0xff, 0xd9]);
const riff = chunks => { const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]); return Buffer.concat([Buffer.from('RIFF'), u32le(body.length), body]); };
const riffChunk = (fourcc, data) => Buffer.concat([Buffer.from(fourcc, 'latin1'), u32le(data.length), data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
function riffChunks(b) { const list = []; for (let i = 12; i + 8 <= b.length;) { const len = b.readUInt32LE(i + 4); list.push({ fourcc: b.toString('latin1', i, i + 4), data: b.subarray(i + 8, i + 8 + len) }); i += 8 + len + (len % 2); } return list; }
const fixRiff = b => { const c = Buffer.from(b); c.writeUInt32LE(c.length - 8, 4); return c; };
function exif(orientation) {
  const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0x00, orientation, 0, 0, 0, 0, 0, 0]);
  return jpegSeg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]));
}

// ═════════ good: what a provider is expected to answer with ═════════
const SIZES = [[1536, 1024], [1024, 1536], [1024, 1024], [1792, 1024], [1344, 768], [2048, 2048], [301, 199], [64, 48], [3, 2], [1, 1], [4000, 250], [250, 4000]];
for (const [w, h] of SIZES) {
  put('good', `canvas-${w}x${h}.png`, scene(w, h));
  put('good', `canvas-${w}x${h}.jpg`, scene(w, h, 'image/jpeg'));
  put('good', `canvas-${w}x${h}.webp`, scene(w, h, 'image/webp'));
}
put('good', 'transparent-900x700.png', scene(900, 700, 'image/png', { transparent: true }), 'RGBA with clear areas');
put('good', 'transparent-900x700.webp', scene(900, 700, 'image/webp', { transparent: true }), 'lossy WebP with alpha (VP8X + ALPH)');
put('good', 'jpeg-q30-1536x1024.jpg', scene(1536, 1024, 'image/jpeg', { quality: 30 }));
put('good', 'jpeg-q100-1536x1024.jpg', scene(1536, 1024, 'image/jpeg', { quality: 100 }));
put('good', 'noise-1024x1024.png', noisy(1024, 1024), 'incompressible: a 4 MB PNG');
const src = path.join(tmp, 'src.png'); fs.writeFileSync(src, scene(1536, 1024));
const srcA = path.join(tmp, 'srcA.png'); fs.writeFileSync(srcA, scene(900, 700, 'image/png', { transparent: true }));
const srcJ = path.join(tmp, 'src.jpg'); fs.writeFileSync(srcJ, scene(1536, 1024, 'image/jpeg'));
const T = (group, name, label, cmd, args, note) => { const f = path.join(tmp, name); const b = tool(label, cmd, args.map(a => a.replace('@out', f)), f); if (b) put(group, name, b, note); return b; };
T('good', 'png16-1536x1024.png', 'PNG 16-bit', 'magick', [src, '-depth', '16', '-define', 'png:bit-depth=16', '-define', 'png:color-type=2', '@out'], '16 bits per channel, RGB');
T('good', 'png16a-900x700.png', 'PNG 16-bit alpha', 'magick', [srcA, '-depth', '16', '-define', 'png:bit-depth=16', '-define', 'png:color-type=6', '@out'], '16 bits per channel, RGBA');
T('good', 'png-palette-1536x1024.png', 'PNG palette', 'magick', [src, '-colors', '64', '-define', 'png:color-type=3', '@out'], 'palette (colour type 3)');
T('good', 'png-palette-trns-900x700.png', 'PNG palette tRNS', 'magick', [srcA, '-colors', '32', 'PNG8:@out'], 'palette with tRNS');
T('good', 'png-gray-1536x1024.png', 'PNG gray', 'magick', [src, '-colorspace', 'Gray', '-define', 'png:color-type=0', '@out'], 'greyscale');
T('good', 'png-gray1bit-1536x1024.png', 'PNG 1-bit', 'magick', [src, '-monochrome', '-define', 'png:bit-depth=1', '-define', 'png:color-type=0', '@out'], '1 bit greyscale');
T('good', 'png-grayalpha-900x700.png', 'PNG gray alpha', 'magick', [srcA, '-colorspace', 'Gray', '-define', 'png:color-type=4', '@out'], 'greyscale with alpha');
T('good', 'png-interlaced-1536x1024.png', 'PNG Adam7', 'magick', [src, '-interlace', 'PNG', '@out'], 'Adam7 interlaced');
T('good', 'png-icc-gamma-1536x1024.png', 'PNG with profile', 'magick', [src, '-set', 'gamma', '0.45455', '-set', 'comment', 'made by a model', '@out'], 'gAMA and tEXt chunks');
T('good', 'jpeg-progressive-1536x1024.jpg', 'JPEG progressive', 'jpegtran', ['-progressive', '-outfile', '@out', srcJ], 'progressive (SOF2)');
T('good', 'jpeg-optimized-1536x1024.jpg', 'JPEG optimised', 'jpegtran', ['-optimize', '-outfile', '@out', srcJ], 'optimised Huffman tables');
T('good', 'jpeg-restart-1536x1024.jpg', 'JPEG restart', 'jpegtran', ['-restart', '4', '-outfile', '@out', srcJ], 'restart markers');
T('good', 'jpeg-gray-1536x1024.jpg', 'JPEG gray', 'jpegtran', ['-grayscale', '-outfile', '@out', srcJ], 'one component');
T('good', 'jpeg-444-1536x1024.jpg', 'JPEG 4:4:4', 'magick', [src, '-sampling-factor', '4:4:4', '-quality', '92', '@out'], 'no chroma subsampling');
T('good', 'jpeg-cmyk-1536x1024.jpg', 'JPEG CMYK', 'magick', [src, '-colorspace', 'CMYK', '@out'], 'four components (CMYK)');
T('good', 'jpeg-arithmetic-1536x1024.jpg', 'JPEG arithmetic', 'jpegtran', ['-arithmetic', '-outfile', '@out', srcJ], 'arithmetic coding (SOF9): a legal JPEG few decoders read');
T('good', 'webp-lossless-1536x1024.webp', 'WebP lossless', 'cwebp', ['-quiet', '-lossless', src, '-o', '@out'], 'VP8L');
T('good', 'webp-lossless-alpha-900x700.webp', 'WebP lossless alpha', 'cwebp', ['-quiet', '-lossless', '-exact', srcA, '-o', '@out'], 'VP8L with alpha');
T('good', 'webp-lossy-q80-1536x1024.webp', 'WebP lossy', 'cwebp', ['-quiet', '-q', '80', src, '-o', '@out'], 'VP8 (simple container)');
T('good', 'webp-lossy-alpha-900x700.webp', 'WebP lossy alpha', 'cwebp', ['-quiet', '-q', '80', srcA, '-o', '@out'], 'VP8X + ALPH + VP8');
T('good', 'webp-icc-exif-1536x1024.webp', 'WebP metadata', 'cwebp', ['-quiet', '-q', '80', '-metadata', 'all', srcJ, '-o', '@out'], 'from a JPEG, metadata kept');
// EXIF orientation 1 to 8 on an upright 600×900 JPEG (5 to 8 mean the stored picture lies on its side).
const upright = scene(600, 900, 'image/jpeg');
for (let o = 1; o <= 8; o++) put('good', `jpeg-exif-orientation-${o}-600x900.jpg`, insertAfterSoi(upright, exif(o)), `EXIF orientation ${o}`);
// Metadata a provider is known to attach: content credentials (C2PA) live in APP11 segments of a JPEG, in a caBX chunk of a PNG.
const good = { png: scene(1536, 1024), jpg: scene(1536, 1024, 'image/jpeg'), webp: scene(1536, 1024, 'image/webp') };
put('good', 'jpeg-app11-c2pa-like.jpg', insertAfterSoi(good.jpg, ...Array.from({ length: 4 }, (_, i) => jpegSeg(0xeb, Buffer.concat([Buffer.from('JP\0\0'), u32be(i + 1), Buffer.alloc(65000, 0x41 + i)])))), '4 APP11 segments of 65 KB before the picture');
put('good', 'jpeg-com-and-fill-bytes.jpg', (() => { const j = insertAfterSoi(good.jpg, jpegSeg(0xfe, Buffer.from('made by a model'))); return Buffer.concat([j.subarray(0, 2), Buffer.from([0xff, 0xff, 0xff]), j.subarray(2)]); })(), 'a comment segment and fill bytes before the first marker');
put('good', 'png-cabx-c2pa-like.png', (() => { const c = pngChunks(good.png); c.splice(1, 0, { type: 'caBX', data: Buffer.alloc(200_000, 0x42) }); return pngFrom(c); })(), 'a 200 KB caBX chunk after IHDR');
put('good', 'png-text-after-idat.png', (() => { const c = pngChunks(good.png); c.splice(c.length - 1, 0, { type: 'tEXt', data: Buffer.from('Software\0model') }); return pngFrom(c); })(), 'a tEXt chunk between IDAT and IEND');
put('good', 'png-many-small-idat.png', (() => { const c = pngChunks(good.png); const all = Buffer.concat(c.filter(x => x.type === 'IDAT').map(x => x.data)); const parts = []; for (let i = 0; i < all.length; i += 4096) parts.push({ type: 'IDAT', data: all.subarray(i, i + 4096) }); return pngFrom([c[0], ...parts, { type: 'IEND', data: Buffer.alloc(0) }]); })(), 'the same data in 4 KB IDAT chunks');
put('good', 'webp-vp8x-unknown-chunk.webp', (() => { const lossyA = scene(900, 700, 'image/webp', { transparent: true }); return riff([...riffChunks(lossyA).map(c => riffChunk(c.fourcc, c.data)), riffChunk('C2PA', Buffer.alloc(5000, 0x43))]); })(), 'an unknown chunk at the end, RIFF size correct');
put('good', 'jpeg-two-pictures-mpo-like.jpg', Buffer.concat([good.jpg, scene(320, 200, 'image/jpeg')]), 'a second JPEG after the first (as a multi-picture file has)');

// ═════════ unusual: a picture a decoder or a browser shows, in a form the bytes check may refuse (D3) ═════════
put('unusual', 'png-1-byte-after-iend.png', Buffer.concat([good.png, Buffer.from([0x0a])]), 'a newline after IEND');
put('unusual', 'png-4kb-after-iend.png', Buffer.concat([good.png, Buffer.alloc(4096)]), '4 KB of zeros after IEND');
put('unusual', 'png-text-after-iend.png', Buffer.concat([good.png, Buffer.from('\n<!-- generated -->\n')]), 'text after IEND');
put('unusual', 'png-iend-then-iend.png', Buffer.concat([good.png, Buffer.from('trailer'), IEND]), 'bytes after IEND that themselves end in an IEND chunk');
put('unusual', 'jpeg-1-byte-after-eoi.jpg', Buffer.concat([good.jpg, Buffer.from([0x0a])]), 'a newline after the end marker');
put('unusual', 'jpeg-4000-bytes-after-eoi.jpg', Buffer.concat([good.jpg, Buffer.alloc(4000)]), '4,000 zero bytes after the end marker (inside the 4,096 window)');
put('unusual', 'jpeg-4095-bytes-after-eoi.jpg', Buffer.concat([good.jpg, Buffer.alloc(4094)]), '4,094 zero bytes after the end marker (the marker is the first 2 bytes of the window)');
put('unusual', 'jpeg-4096-bytes-after-eoi.jpg', Buffer.concat([good.jpg, Buffer.alloc(4095)]), '4,095 zero bytes after: the marker straddles the window edge');
put('unusual', 'jpeg-8kb-after-eoi.jpg', Buffer.concat([good.jpg, Buffer.alloc(8192)]), '8 KB of zeros after the end marker');
put('unusual', 'jpeg-200kb-after-eoi.jpg', Buffer.concat([good.jpg, Buffer.alloc(200_000, 0x20)]), '200 KB after the end marker (a gain map or depth data without its own end marker)');
put('unusual', 'jpeg-no-eoi.jpg', good.jpg.subarray(0, good.jpg.length - 2), 'the end marker alone is missing; all picture data is there');
put('unusual', 'jpeg-no-eoi-ffd9-in-data.jpg', (() => { const j = Buffer.from(good.jpg.subarray(0, good.jpg.length - 2)); return j; })(), 'as above (duplicate, kept for the count)');
put('unusual', 'webp-bytes-after-riff.webp', Buffer.concat([good.webp, Buffer.alloc(100)]), '100 bytes after the RIFF chunk');
put('unusual', 'webp-riff-size-1-short.webp', (() => { const b = Buffer.from(good.webp); b.writeUInt32LE(b.readUInt32LE(4) + 2, 4); return b; })(), 'RIFF size says 2 bytes more than the file has (seen from encoders that pad)');
put('unusual', 'webp-riff-size-odd-padded.webp', (() => { const b = Buffer.concat([good.webp, Buffer.alloc(1)]); return b; })(), 'one padding byte after the RIFF chunk');
put('unusual', 'avif-640x400.avif', (() => { try { return scene(640, 400, 'image/avif'); } catch { skipped.push('AVIF: canvas cannot encode it'); return Buffer.alloc(0); } })(), 'AVIF');
T('unusual', 'gif-640x400.gif', 'GIF', 'magick', [src, '-resize', '640x400!', '@out'], 'GIF, one frame');
T('unusual', 'gif-animated.gif', 'GIF animated', 'magick', ['-delay', '20', src, srcJ, '-resize', '320x200!', '-loop', '0', '@out'], 'GIF, two frames');
T('unusual', 'bmp-640x400.bmp', 'BMP', 'magick', [src, '-resize', '640x400!', 'BMP3:@out'], 'BMP');
T('unusual', 'tiff-640x400.tiff', 'TIFF', 'magick', [src, '-resize', '640x400!', '-compress', 'LZW', '@out'], 'an ordinary TIFF (LZW)');
T('unusual', 'tiff-sips-640x400.tiff', 'TIFF sips', 'sips', ['-s', 'format', 'tiff', '-z', '400', '640', src, '--out', '@out'], 'an ordinary TIFF from macOS sips');
T('unusual', 'ico-64.ico', 'ICO', 'magick', [src, '-resize', '64x64!', '@out'], 'ICO');
T('unusual', 'ico-png-256.ico', 'ICO PNG', 'magick', [src, '-resize', '256x256!', '-define', 'icon:auto-resize=256', '@out'], 'ICO with a PNG inside');
T('unusual', 'heic-640x400.heic', 'HEIC', 'sips', ['-s', 'format', 'heic', '-z', '400', '640', src, '--out', '@out'], 'HEIC');
T('unusual', 'jp2-640x400.jp2', 'JPEG 2000', 'magick', [src, '-resize', '640x400!', '@out'], 'JPEG 2000');
T('unusual', 'jxl-640x400.jxl', 'JPEG XL', 'magick', [src, '-resize', '640x400!', '@out'], 'JPEG XL');
T('unusual', 'apng-2-frames.png', 'APNG', 'ffmpeg', ['-v', 'quiet', '-y', '-loop', '1', '-t', '0.2', '-r', '10', '-i', src, '-vf', 'scale=640:400', '-plays', '0', '-f', 'apng', '@out'], 'APNG (acTL, fcTL, fdAT): a PNG by its signature, animated');
T('unusual', 'webp-animated.webp', 'WebP animated', 'gif2webp', ['-quiet', path.join(out, 'unusual', 'gif-animated.gif'), '-o', '@out'], 'animated WebP');
put('unusual', 'svg-plain.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="#335577"/><circle cx="700" cy="500" r="300" fill="#ffd166"/></svg>'), 'SVG');
put('unusual', 'svg-xml-prolog.svg', Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="red"/></svg>'), 'SVG with an XML prolog');
put('unusual', 'png-as-base64-text.txt', Buffer.from(scene(64, 48).toString('base64')), 'a PNG still base64-encoded (a provider that encodes twice)');
put('unusual', 'png-as-data-url.txt', Buffer.from('data:image/png;base64,' + scene(64, 48).toString('base64')), 'a data: URL as the bytes');
put('unusual', 'jpeg-leading-whitespace.jpg', Buffer.concat([Buffer.from('\n'), good.jpg]), 'a newline before the JPEG');
put('unusual', 'png-bom-first.png', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), good.png]), 'a UTF-8 byte order mark before the PNG');

// ═════════ limits ═════════
const flat = (w, h, type = 'image/png') => { const c = createCanvas(w, h); const x = c.getContext('2d'); x.fillStyle = '#336699'; x.fillRect(0, 0, w, h); x.fillStyle = '#ffcc00'; x.fillRect(w * 0.4, h * 0.4, w * 0.2, h * 0.2); return c.toBuffer(type); };
put('limits', 'real-5000x5000.png', flat(5000, 5000), 'exactly 25,000,000 pixels: on the limit, really that big');
put('limits', 'real-5000x5000.jpg', flat(5000, 5000, 'image/jpeg'), 'on the limit, JPEG');
put('limits', 'real-10000x2500.png', flat(10000, 2500), 'the longest side allowed');
put('limits', 'real-5001x5000.png', flat(5001, 5000), 'one column over the pixel limit, a real picture');
put('limits', 'real-10001x100.png', flat(10001, 100), 'one side too long, a real picture');
const tiny = scene(64, 48);
const redeclare = (png, w, h, fix) => { const c = pngChunks(png); const d = Buffer.from(c[0].data); d.writeUInt32BE(w, 0); d.writeUInt32BE(h, 4); const first = fix ? { type: 'IHDR', data: d } : { type: 'IHDR', data: d, crc: png.readUInt32BE(29) }; return pngFrom([first, ...c.slice(1)]); };
for (const [w, h] of [[5000, 5000], [10000, 2500], [1, 10000], [10000, 1], [100000, 100000], [0x7fffffff, 0x7fffffff], [0xffffffff, 1], [0, 0], [0, 48], [64, 0], [5001, 5000], [10001, 1]]) {
  put('limits', `png-declares-${w}x${h}-crc-ok.png`, redeclare(tiny, w, h, true), `a 64×48 PNG whose IHDR says ${w}×${h}, checksum corrected`);
  put('limits', `png-declares-${w}x${h}-crc-stale.png`, redeclare(tiny, w, h, false), `the same, checksum left stale`);
}
const tinyJ = scene(64, 48, 'image/jpeg');
const jpegRedeclare = (j, w, h) => { const b = Buffer.from(j); const sof = jpegSegments(b).find(s => s.m >= 0xc0 && s.m <= 0xcf && s.m !== 0xc4 && s.m !== 0xc8 && s.m !== 0xcc); b.writeUInt16BE(h, sof.at + 5); b.writeUInt16BE(w, sof.at + 7); return b; };
for (const [w, h] of [[5000, 5000], [10000, 2500], [65535, 65535], [0, 48], [64, 0], [0, 0], [65, 48], [64, 49], [8, 8]]) put('limits', `jpeg-declares-${w}x${h}.jpg`, jpegRedeclare(tinyJ, w, h), `a 64×48 JPEG whose frame header says ${w}×${h}`);
const vp8l = (w, h, rest = Buffer.alloc(0)) => { const p = Buffer.alloc(5); p[0] = 0x2f; p.writeUInt32LE((((h - 1) << 14) | (w - 1)) >>> 0, 1); return riff([riffChunk('VP8L', Buffer.concat([p, rest]))]); };
const vp8x = (w, h, flags, chunks = []) => { const p = Buffer.alloc(10); p[0] = flags; p.writeUIntLE(w - 1, 4, 3); p.writeUIntLE(h - 1, 7, 3); return riff([riffChunk('VP8X', p), ...chunks]); };
put('limits', 'webp-vp8l-declares-16384x16384.webp', vp8l(16384, 16384), 'VP8L header only');
put('limits', 'webp-vp8l-declares-5000x5000-noise.webp', vp8l(5000, 5000, Buffer.alloc(400, 0x5a)), 'VP8L header declaring the limit, then noise');
put('limits', 'webp-vp8x-declares-16777216x16777216.webp', vp8x(16777216, 16777216, 0), 'VP8X canvas at its 24-bit maximum');
const lossy64 = riffChunks(scene(64, 48, 'image/webp'));
const inner = lossy64.find(c => c.fourcc === 'VP8 ' || c.fourcc === 'VP8L');
if (inner) {
  put('limits', 'webp-vp8x-canvas-64x48-inner-real.webp', vp8x(64, 48, 0, [riffChunk(inner.fourcc, inner.data)]), 'control: VP8X canvas equal to the picture inside');
  put('limits', 'webp-vp8x-canvas-5000x5000-inner-64x48.webp', vp8x(5000, 5000, 0, [riffChunk(inner.fourcc, inner.data)]), 'the canvas says 5000×5000, the picture inside is 64×48');
  put('limits', 'webp-vp8x-canvas-8x8-inner-64x48.webp', vp8x(8, 8, 0, [riffChunk(inner.fourcc, inner.data)]), 'the canvas says 8×8, the picture inside is 64×48');
  const big = riffChunks(flat(5000, 5000, 'image/webp')).find(c => c.fourcc === 'VP8 ' || c.fourcc === 'VP8L');
  if (big) put('limits', 'webp-vp8x-canvas-8x8-inner-5000x5000.webp', vp8x(8, 8, 0, [riffChunk(big.fourcc, big.data)]), 'the canvas says 8×8, the picture inside is really 5000×5000');
  const huge = (() => { try { return riffChunks(flat(12000, 9000, 'image/webp')).find(c => c.fourcc === 'VP8 ' || c.fourcc === 'VP8L'); } catch { return null; } })();
  if (huge) put('limits', 'webp-vp8x-canvas-8x8-inner-12000x9000.webp', vp8x(8, 8, 0, [riffChunk(huge.fourcc, huge.data)]), 'the canvas says 8×8, the picture inside is really 12000×9000 (108 million pixels): the header the check reads is not the one the decoder obeys');
  // The animation flag is in the VP8X header; the frames are ANIM/ANMF chunks. One without the other:
  const anmf = Buffer.concat([Buffer.alloc(3), Buffer.alloc(3), (() => { const b = Buffer.alloc(3); b.writeUIntLE(63, 0, 3); return b; })(), (() => { const b = Buffer.alloc(3); b.writeUIntLE(47, 0, 3); return b; })(), (() => { const b = Buffer.alloc(3); b.writeUIntLE(100, 0, 3); return b; })(), Buffer.from([0]), riffChunk(inner.fourcc, inner.data)]);
  put('limits', 'webp-animated-frames-flag-clear.webp', vp8x(64, 48, 0x00, [riffChunk('ANIM', Buffer.alloc(6)), riffChunk('ANMF', anmf), riffChunk('ANMF', anmf)]), 'two animation frames, but the animation flag is not set');
  put('limits', 'webp-animated-flag-set-still-picture.webp', vp8x(64, 48, 0x02, [riffChunk(inner.fourcc, inner.data)]), 'the animation flag is set on a still picture');
}

// ═════════ bad: malformed files ═════════
// The small bases every edit starts from.
const B = { png: scene(160, 120), jpg: scene(160, 120, 'image/jpeg'), webp: scene(160, 120, 'image/webp') };
{ const f = path.join(tmp, 'b.png'); fs.writeFileSync(f, B.png); const l = tool('WebP lossless base', 'cwebp', ['-quiet', '-lossless', f, '-o', path.join(tmp, 'b-ll.webp')], path.join(tmp, 'b-ll.webp')); if (l) B.webpll = l; const p = tool('progressive base', 'jpegtran', ['-progressive', '-outfile', path.join(tmp, 'b-prog.jpg'), (fs.writeFileSync(path.join(tmp, 'b.jpg'), B.jpg), path.join(tmp, 'b.jpg'))], path.join(tmp, 'b-prog.jpg')); if (p) B.jpgprog = p; }
const EXT = { png: 'png', jpg: 'jpg', webp: 'webp', webpll: 'webp', jpgprog: 'jpg' };
put('bad', 'base-control.png', B.png, 'control: the unedited base'); put('bad', 'base-control.jpg', B.jpg, 'control'); put('bad', 'base-control.webp', B.webp, 'control');

// The four files of the brief, and variants.
put('bad', 'brief-ffd8ffd9.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'FF D8 FF D9');
put('bad', 'brief-ffd8ffd9-padded-200.jpg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9]), Buffer.alloc(196)]), 'FF D8 FF D9 and 196 zeros');
put('bad', 'brief-png-no-idat.png', pngFrom([pngChunks(B.png)[0], { type: 'IEND', data: Buffer.alloc(0) }]), 'IHDR and IEND only');
put('bad', 'brief-png-no-idat-text.png', pngFrom([pngChunks(B.png)[0], { type: 'tEXt', data: Buffer.from('Comment\0nothing here') }, { type: 'IEND', data: Buffer.alloc(0) }]), 'IHDR, tEXt, IEND');
put('bad', 'brief-png-ihdr-crc.png', (() => { const b = Buffer.from(B.png); b[29] ^= 0xff; return b; })(), 'wrong IHDR checksum');
put('bad', 'brief-jpeg-no-scan.jpg', Buffer.concat([B.jpg.subarray(0, jpegSegments(B.jpg).find(s => s.m === 0xda).at), EOI]), 'tables and frame header, no scan');

// Truncations. (a) plainly cut; (b) cut and given its end marker back, so the end looks right.
function cuts(len) { const set = new Set(); for (let i = 0; i <= Math.min(72, len - 1); i += (i < 40 ? 1 : 4)) set.add(i); for (let i = 1; i <= 24; i++) set.add(Math.floor((len * i) / 25)); for (let i = 1; i <= 16; i++) set.add(len - i); return [...set].filter(n => n >= 0 && n < len).sort((a, b) => a - b); }
for (const k of Object.keys(B)) {
  const b = B[k], ext = EXT[k];
  for (const n of cuts(b.length)) {
    put('bad', `cut-${k}-at-${String(n).padStart(5, '0')}.${ext}`, b.subarray(0, n), `${k} cut to ${n} of ${b.length} bytes`);
    if (n < 12) continue;
    const closed = ext === 'png' ? Buffer.concat([b.subarray(0, n), IEND]) : ext === 'jpg' ? Buffer.concat([b.subarray(0, n), EOI]) : fixRiff(b.subarray(0, n));
    put('bad', `cutclosed-${k}-at-${String(n).padStart(5, '0')}.${ext}`, closed, `${k} cut to ${n} bytes, then ${ext === 'png' ? 'an IEND chunk appended' : ext === 'jpg' ? 'an end marker appended' : 'the RIFF size corrected'}`);
  }
}
// Flipped bytes: in the header and in the data, keeping the file's first bytes so it still claims its type.
for (const k of Object.keys(B)) {
  const b = B[k], ext = EXT[k]; const keep = ext === 'png' ? 8 : ext === 'jpg' ? 3 : 12;
  for (let i = 0; i < 70; i++) {
    const c = Buffer.from(b); const header = i < 40; const at = header ? keep + rnd(Math.min(b.length - keep - 12, ext === 'jpg' ? 620 : 60)) : keep + rnd(b.length - keep - 12); const bit = 1 << rnd(8);
    c[at] ^= bit;
    put('bad', `flip-${k}-${header ? 'header' : 'data'}-${String(i).padStart(2, '0')}-at${at}.${ext}`, c, `${k}: bit ${bit} of byte ${at} flipped`);
  }
  for (let i = 0; i < 12; i++) { const c = Buffer.from(b); const at = keep + rnd(b.length - keep - 80); for (let j = 0; j < 64; j++) c[at + j] = rnd(256); put('bad', `smash-${k}-${String(i).padStart(2, '0')}-at${at}.${ext}`, c, `${k}: 64 bytes from ${at} replaced with noise`); }
}
// PNG structure.
{
  const C = pngChunks(B.png); const idat = Buffer.concat(C.filter(c => c.type === 'IDAT').map(c => c.data)); const head = C[0]; const end = { type: 'IEND', data: Buffer.alloc(0) };
  C.forEach((c, i) => put('bad', `png-crc-wrong-chunk${i}-${c.type}.png`, pngFrom(C.map((x, j) => (j === i ? { ...x, crc: 0xdeadbeef } : x))), `wrong checksum on ${c.type}`));
  put('bad', 'png-idat-empty.png', pngFrom([head, { type: 'IDAT', data: Buffer.alloc(0) }, end]), 'one zero-length IDAT');
  put('bad', 'png-idat-empty-then-real.png', pngFrom([head, { type: 'IDAT', data: Buffer.alloc(0) }, { type: 'IDAT', data: idat }, end]), 'a zero-length IDAT before the real one (legal)');
  put('bad', 'png-ihdr-empty.png', pngFrom([{ type: 'IHDR', data: Buffer.alloc(0) }, { type: 'IDAT', data: idat }, end]), 'zero-length IHDR');
  put('bad', 'png-ihdr-short-12.png', pngFrom([{ type: 'IHDR', data: head.data.subarray(0, 12) }, { type: 'IDAT', data: idat }, end]), 'IHDR of 12 bytes');
  put('bad', 'png-ihdr-long-17.png', pngFrom([{ type: 'IHDR', data: Buffer.concat([head.data, Buffer.alloc(4)]) }, { type: 'IDAT', data: idat }, end]), 'IHDR of 17 bytes');
  put('bad', 'png-two-ihdr.png', pngFrom([head, { type: 'IHDR', data: ihdr(4000, 4000) }, { type: 'IDAT', data: idat }, end]), 'a second IHDR declaring 4000×4000');
  put('bad', 'png-idat-before-ihdr-order.png', pngFrom([head, end, { type: 'IDAT', data: idat }, end]), 'IEND before IDAT, and again at the end');
  put('bad', 'png-idat-garbage.png', pngFrom([head, { type: 'IDAT', data: Buffer.alloc(idat.length, 0xa5) }, end]), 'IDAT is not zlib data');
  put('bad', 'png-idat-half.png', pngFrom([head, { type: 'IDAT', data: idat.subarray(0, idat.length >> 1) }, end]), 'half of the IDAT data, checksums right');
  put('bad', 'png-idat-zlib-of-too-few-rows.png', pngFrom([head, { type: 'IDAT', data: zlib.deflateSync(Buffer.alloc((160 * 4 + 1) * 10)) }, end]), 'valid zlib, 10 rows of 120');
  put('bad', 'png-idat-zlib-of-too-many-rows.png', pngFrom([head, { type: 'IDAT', data: zlib.deflateSync(Buffer.alloc((160 * 4 + 1) * 400)) }, end]), 'valid zlib, 400 rows for 120');
  put('bad', 'png-idat-bad-filter-bytes.png', pngFrom([head, { type: 'IDAT', data: zlib.deflateSync(Buffer.alloc((160 * 4 + 1) * 120, 0x09)) }, end]), 'every row has filter type 9');
  put('bad', 'png-idat-zlib-bomb.png', pngFrom([{ type: 'IHDR', data: ihdr(160, 120) }, { type: 'IDAT', data: zlib.deflateSync(Buffer.alloc(64 * 1024 * 1024), { level: 9 }) }, end]), '64 MB of zeros deflated into a 160×120 PNG');
  put('bad', 'png-chunk-length-ffffffff.png', Buffer.concat([PNG_SIG, pngChunk('IHDR', head.data), Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from('IDAT'), idat, IEND]), 'an IDAT whose length field is 4 GB');
  put('bad', 'png-chunk-length-7fffffff.png', Buffer.concat([PNG_SIG, pngChunk('IHDR', head.data), Buffer.from([0x7f, 0xff, 0xff, 0xff]), Buffer.from('IDAT'), idat, IEND]), 'an IDAT whose length field is 2 GB');
  put('bad', 'png-chunk-length-beyond-file.png', Buffer.concat([PNG_SIG, pngChunk('IHDR', head.data), u32be(idat.length + 5000), Buffer.from('IDAT'), idat, IEND]), 'IDAT length runs past the end');
  put('bad', 'png-palette-without-plte.png', pngFrom([{ type: 'IHDR', data: ihdr(160, 120, 8, 3) }, { type: 'IDAT', data: zlib.deflateSync(Buffer.alloc((160 + 1) * 120, 1)) }, end]), 'colour type 3 and no PLTE');
  put('bad', 'png-plte-empty.png', pngFrom([{ type: 'IHDR', data: ihdr(160, 120, 8, 3) }, { type: 'PLTE', data: Buffer.alloc(0) }, { type: 'IDAT', data: zlib.deflateSync(Buffer.alloc((160 + 1) * 120, 1)) }, end]), 'zero-length PLTE');
  put('bad', 'png-plte-index-out-of-range.png', pngFrom([{ type: 'IHDR', data: ihdr(160, 120, 8, 3) }, { type: 'PLTE', data: Buffer.from([255, 0, 0, 0, 255, 0]) }, { type: 'IDAT', data: zlib.deflateSync(Buffer.alloc((160 + 1) * 120, 200)) }, end]), 'pixels index past a 2-colour palette');
  put('bad', 'png-trns-too-long.png', pngFrom([head, { type: 'tRNS', data: Buffer.alloc(300, 7) }, { type: 'IDAT', data: idat }, end]), 'a 300-byte tRNS on an RGBA picture');
  for (const depth of [0, 1, 2, 3, 4, 5, 7, 8, 16, 32, 255]) for (const colour of [0, 1, 2, 3, 4, 5, 6, 7, 255]) put('bad', `png-ihdr-depth${depth}-colour${colour}.png`, pngFrom([{ type: 'IHDR', data: ihdr(160, 120, depth, colour) }, { type: 'IDAT', data: idat }, end]), `IHDR says bit depth ${depth}, colour type ${colour}; the data is 8-bit RGBA; checksum right`);
  for (const [name, d] of [['compression1', ihdr(160, 120, 8, 6, 1)], ['filter1', ihdr(160, 120, 8, 6, 0, 1)], ['interlace1-data-not', ihdr(160, 120, 8, 6, 0, 0, 1)], ['interlace2', ihdr(160, 120, 8, 6, 0, 0, 2)]]) put('bad', `png-ihdr-${name}.png`, pngFrom([{ type: 'IHDR', data: d }, { type: 'IDAT', data: idat }, end]), `IHDR ${name}`);
  for (const [w, h] of [[161, 120], [160, 121], [159, 120], [320, 60], [1, 1], [2000, 2000]]) put('bad', `png-ihdr-says-${w}x${h}-data-160x120.png`, pngFrom([{ type: 'IHDR', data: ihdr(w, h) }, { type: 'IDAT', data: idat }, end]), 'size in IHDR differs from the data, checksum right');
  put('bad', 'png-apng-actl-only.png', pngFrom([head, { type: 'acTL', data: Buffer.concat([u32be(1000), u32be(0)]) }, { type: 'IDAT', data: idat }, end]), 'acTL claiming 1000 frames, no frame data');
  put('bad', 'png-unknown-critical-chunk.png', pngFrom([head, { type: 'XXXX', data: Buffer.alloc(40) }, { type: 'IDAT', data: idat }, end]), 'an unknown critical chunk');
  put('bad', 'png-iend-with-data.png', pngFrom([head, { type: 'IDAT', data: idat }, { type: 'IEND', data: Buffer.from('surprise') }]), 'IEND carrying data');
  put('bad', 'png-signature-only-plus-iend.png', Buffer.concat([PNG_SIG, Buffer.alloc(20), IEND]), 'signature, zeros, IEND');
  put('bad', 'png-cgbi-apple.png', pngFrom([{ type: 'CgBI', data: Buffer.from([0x50, 0x00, 0x20, 0x02]) }, head, { type: 'IDAT', data: idat }, end]), 'CgBI first (Apple\'s variant): IHDR is not the first chunk');
}
// JPEG structure.
{
  const S = jpegSegments(B.jpg); const seg = m => S.find(s => s.m === m); const sof = S.find(s => s.m >= 0xc0 && s.m <= 0xcf && s.m !== 0xc4 && s.m !== 0xc8 && s.m !== 0xcc); const sos = seg(0xda);
  const edit = (name, note, fn) => { const c = Buffer.from(B.jpg); const r = fn(c); put('bad', `jpeg-${name}.jpg`, r || c, note); };
  edit('sof-zero-components', 'frame header with 0 components', c => { c[sof.at + 9] = 0; });
  edit('sof-255-components', 'frame header claiming 255 components', c => { c[sof.at + 9] = 255; });
  edit('sof-4-components-data-3', 'frame header claiming 4 components', c => { c[sof.at + 9] = 4; });
  edit('sof-precision-12', 'sample precision 12', c => { c[sof.at + 4] = 12; });
  edit('sof-precision-0', 'sample precision 0', c => { c[sof.at + 4] = 0; });
  edit('sof-sampling-00', 'sampling factors 0×0', c => { c[sof.at + 11] = 0x00; });
  edit('sof-sampling-ff', 'sampling factors 15×15', c => { c[sof.at + 11] = 0xff; });
  edit('sof-quant-table-9', 'component uses quantisation table 9', c => { c[sof.at + 12] = 9; });
  edit('sof-length-2', 'frame header of length 2', c => { c.writeUInt16BE(2, sof.at + 2); });
  edit('sof-length-ffff', 'frame header of length 65535', c => { c.writeUInt16BE(0xffff, sof.at + 2); });
  edit('sof-marker-lossless-c3', 'frame header relabelled lossless (SOF3)', c => { c[sof.at + 1] = 0xc3; });
  edit('sof-marker-progressive-c2', 'baseline data relabelled progressive (SOF2)', c => { c[sof.at + 1] = 0xc2; });
  edit('sof-marker-arithmetic-c9', 'Huffman data relabelled arithmetic (SOF9)', c => { c[sof.at + 1] = 0xc9; });
  edit('sof-marker-hierarchical-c5', 'relabelled differential (SOF5)', c => { c[sof.at + 1] = 0xc5; });
  edit('dqt-zeroed', 'quantisation tables all zero', c => { const d = seg(0xdb); c.fill(0, d.at + 5, d.at + 2 + d.length); });
  edit('dqt-length-2', 'zero-length quantisation table segment', c => { const d = seg(0xdb); c.writeUInt16BE(2, d.at + 2); });
  edit('dqt-removed', 'no quantisation tables', c => { const d = seg(0xdb); return Buffer.concat([c.subarray(0, d.at), c.subarray(d.at + 2 + d.length)]); });
  edit('dht-removed', 'no Huffman tables', c => { let o = c; for (const d of S.filter(s => s.m === 0xc4).reverse()) o = Buffer.concat([o.subarray(0, d.at), o.subarray(d.at + 2 + d.length)]); return o; });
  edit('dht-counts-ff', 'Huffman code counts all 255', c => { const d = seg(0xc4); c.fill(0xff, d.at + 5, d.at + 21); });
  edit('dht-length-2', 'zero-length Huffman table segment', c => { const d = seg(0xc4); c.writeUInt16BE(2, d.at + 2); });
  edit('sos-zero-components', 'scan header with 0 components', c => { c[sos.at + 4] = 0; });
  edit('sos-component-id-99', 'scan names a component that does not exist', c => { c[sos.at + 5] = 99; });
  edit('sos-table-ff', 'scan uses Huffman tables 15/15', c => { c[sos.at + 6] = 0xff; });
  edit('sos-then-eoi', 'scan header, no scan data, end marker', c => Buffer.concat([c.subarray(0, sos.at + 2 + sos.length), EOI]));
  edit('sos-data-all-ff', 'scan data replaced with FF bytes', c => { c.fill(0xff, sos.at + 2 + sos.length, c.length - 2); });
  edit('sos-data-all-00', 'scan data replaced with zeros', c => { c.fill(0x00, sos.at + 2 + sos.length, c.length - 2); });
  edit('sos-data-restart-flood', 'scan data replaced with restart markers', c => { for (let i = sos.at + 2 + sos.length; i + 1 < c.length - 2; i += 2) { c[i] = 0xff; c[i + 1] = 0xd0 + ((i >> 1) & 7); } });
  edit('two-sof-second-60000', 'a second frame header declaring 60000×60000 after the first', c => Buffer.concat([c.subarray(0, sof.at + 2 + sof.length), jpegSeg(0xc0, Buffer.concat([Buffer.from([8]), u16be(60000), u16be(60000), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])])), c.subarray(sof.at + 2 + sof.length)]));
  edit('dri-1-no-restarts', 'restart interval 1 declared, no restart markers in the data', c => Buffer.concat([c.subarray(0, sos.at), jpegSeg(0xdd, u16be(1)), c.subarray(sos.at)]));
  edit('soi-soi', 'two start markers', c => Buffer.concat([Buffer.from([0xff, 0xd8]), c]));
  edit('exif-ifd-loop', 'EXIF whose directory points at itself', c => insertAfterSoi(c, jpegSeg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0x00, 0x06, 0, 0, 0, 0, 0, 8])]))));
  edit('exif-offset-beyond', 'EXIF whose directory offset is far past the segment', c => insertAfterSoi(c, jpegSeg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x7f, 0xff, 0xff, 0xf0])]))));
  edit('exif-orientation-99', 'EXIF orientation 99', c => insertAfterSoi(c, exif(99)));
  edit('exif-count-huge', 'EXIF with 65535 directory entries declared', c => insertAfterSoi(c, jpegSeg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0xff, 0xff])]))));
  edit('icc-profile-garbage', 'an ICC profile segment of noise', c => insertAfterSoi(c, jpegSeg(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0\x01\x01', 'latin1'), Buffer.alloc(3000, 0x77)]))));
  edit('adobe-transform-9', 'Adobe segment with colour transform 9', c => insertAfterSoi(c, jpegSeg(0xee, Buffer.concat([Buffer.from('Adobe', 'latin1'), Buffer.from([0, 100, 0, 0, 0, 0, 9])]))));
  if (B.jpgprog) {
    const P = jpegSegments(B.jpgprog); const psos = P.find(s => s.m === 0xda);
    put('bad', 'jpeg-progressive-first-scan-only.jpg', (() => { const b = B.jpgprog; let i = psos.at + 2 + psos.length; while (i + 1 < b.length && !(b[i] === 0xff && b[i + 1] === 0xda)) i++; return Buffer.concat([b.subarray(0, i), EOI]); })(), 'progressive: the first scan only, then the end marker');
    put('bad', 'jpeg-progressive-scan-params-bad.jpg', (() => { const c = Buffer.from(B.jpgprog); c[psos.at + 2 + psos.length - 3] = 63; c[psos.at + 2 + psos.length - 2] = 0; c[psos.at + 2 + psos.length - 1] = 0xff; return c; })(), 'progressive: impossible spectral selection in the first scan');
  }
}
// WebP structure.
{
  const C = riffChunks(B.webp); const v = C.find(c => c.fourcc === 'VP8 ');
  if (v) {
    const edit = (name, note, fn) => { const d = Buffer.from(v.data); const r = fn(d) || d; put('bad', `webp-${name}.webp`, riff([riffChunk('VP8 ', r)]), note); };
    edit('vp8-zero-length', 'a VP8 chunk with nothing in it', () => Buffer.alloc(0));
    edit('vp8-header-only-10', 'the 10-byte frame header and nothing else', d => d.subarray(0, 10));
    edit('vp8-not-keyframe', 'frame tag says it is not a key frame', d => { d[0] |= 0x01; });
    edit('vp8-partition-size-huge', 'first partition size larger than the file', d => { d[1] = 0xff; d[2] = 0xff; });
    edit('vp8-data-noise', 'frame data replaced with noise after the header', d => { for (let i = 10; i < d.length; i++) d[i] = (i * 197 + 13) & 0xff; });
    edit('vp8-data-zeros', 'frame data replaced with zeros', d => { d.fill(0, 10); });
    edit('vp8-data-ff', 'frame data replaced with FF', d => { d.fill(0xff, 10); });
    edit('vp8-scale-bits', 'the upscaling bits set in the size', d => { d[7] |= 0xc0; d[9] |= 0xc0; });
    edit('vp8-size-1x1-data-160x120', 'header says 1×1', d => { d.writeUInt16LE(1, 6); d.writeUInt16LE(1, 8); });
    edit('vp8-size-16383x16383', 'header says 16383×16383', d => { d.writeUInt16LE(16383, 6); d.writeUInt16LE(16383, 8); });
    edit('vp8-size-4000x4000', 'header says 4000×4000, data is 160×120', d => { d.writeUInt16LE(4000, 6); d.writeUInt16LE(4000, 8); });
    put('bad', 'webp-vp8x-alph-garbage.webp', vp8x(160, 120, 0x10, [riffChunk('ALPH', Buffer.alloc(500, 0x99)), riffChunk('VP8 ', v.data)]), 'an alpha chunk of noise');
    put('bad', 'webp-vp8x-alph-empty.webp', vp8x(160, 120, 0x10, [riffChunk('ALPH', Buffer.alloc(0)), riffChunk('VP8 ', v.data)]), 'a zero-length alpha chunk');
    put('bad', 'webp-vp8x-no-picture.webp', vp8x(160, 120, 0x00, [riffChunk('EXIF', Buffer.alloc(40))]), 'VP8X and metadata, no picture chunk');
    put('bad', 'webp-vp8x-iccp-garbage.webp', vp8x(160, 120, 0x20, [riffChunk('ICCP', Buffer.alloc(800, 0x31)), riffChunk('VP8 ', v.data)]), 'a colour profile of noise');
    put('bad', 'webp-vp8x-exif-loop.webp', vp8x(160, 120, 0x08, [riffChunk('VP8 ', v.data), riffChunk('EXIF', Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0x00, 0x06, 0, 0, 0, 0, 0, 8]))]), 'EXIF whose directory points at itself');
    put('bad', 'webp-chunk-size-ffffffff.webp', (() => { const b = Buffer.from(riff([riffChunk('VP8 ', v.data)])); b.writeUInt32LE(0xffffffff, 16); return b; })(), 'VP8 chunk size 4 GB, RIFF size right');
    put('bad', 'webp-riff-size-0.webp', (() => { const b = Buffer.from(B.webp); b.writeUInt32LE(0, 4); return b; })(), 'RIFF size 0');
    put('bad', 'webp-riff-size-4.webp', (() => { const b = Buffer.from(B.webp); b.writeUInt32LE(4, 4); return b; })(), 'RIFF size 4: complete by the check, the picture is outside it');
    put('bad', 'webp-riff-size-ffffffff.webp', (() => { const b = Buffer.from(B.webp); b.writeUInt32LE(0xffffffff, 4); return b; })(), 'RIFF size 4 GB');
  }
  if (B.webpll) {
    const l = riffChunks(B.webpll).find(c => c.fourcc === 'VP8L');
    const edit = (name, note, fn) => { const d = Buffer.from(l.data); const r = fn(d) || d; put('bad', `webp-${name}.webp`, riff([riffChunk('VP8L', r)]), note); };
    edit('vp8l-header-only', 'the 5-byte header only', d => d.subarray(0, 5));
    edit('vp8l-data-noise', 'data replaced with noise', d => { for (let i = 5; i < d.length; i++) d[i] = (i * 151 + 7) & 0xff; });
    edit('vp8l-data-zeros', 'data replaced with zeros', d => { d.fill(0, 5); });
    edit('vp8l-data-ff', 'data replaced with FF', d => { d.fill(0xff, 5); });
    edit('vp8l-version-7', 'version bits 7', d => { d[4] |= 0xe0; });
    edit('vp8l-size-16384x16384-data-160x120', 'header says 16384×16384', d => { d.writeUInt32LE((d.readUInt32LE(1) & 0xf0000000) | 0x0fffffff, 1); });
    edit('vp8l-size-5000x5000-data-160x120', 'header says 5000×5000, data is 160×120', d => { d.writeUInt32LE(((d.readUInt32LE(1) & 0xf0000000) | ((4999 << 14) | 4999)) >>> 0, 1); });
  }
}
// Polyglots: a header of one thing, the body of another.
{
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><image href="https://example.invalid/x.png" width="10" height="10"/><rect width="1536" height="1024" fill="red"/></svg>';
  const html = '<!doctype html><html><body><script>fetch("https://example.invalid/")</script><h1>Image unavailable</h1></body></html>';
  const head = pngChunks(B.png)[0];
  put('bad', 'poly-png-header-then-svg-then-iend.png', Buffer.concat([PNG_SIG, pngChunk('IHDR', head.data), Buffer.from(svg), IEND]), 'PNG signature and IHDR, SVG text, an IEND chunk');
  put('bad', 'poly-png-header-then-html-then-iend.png', Buffer.concat([PNG_SIG, pngChunk('IHDR', head.data), Buffer.from(html), IEND]), 'PNG signature and IHDR, an HTML page, an IEND chunk');
  put('bad', 'poly-png-whole-then-svg-then-iend.png', Buffer.concat([B.png, Buffer.from(svg), IEND]), 'a whole PNG, SVG text, another IEND chunk');
  put('bad', 'poly-png-svg-in-text-chunk.png', (() => { const c = pngChunks(B.png); c.splice(1, 0, { type: 'tEXt', data: Buffer.from('Comment\0' + svg) }); return pngFrom(c); })(), 'a good PNG carrying SVG in a tEXt chunk (harmless)');
  put('bad', 'poly-jpeg-header-then-svg-then-eoi.jpg', Buffer.concat([B.jpg.subarray(0, jpegSegments(B.jpg).find(s => s.m === 0xda).at), Buffer.from(svg), EOI]), 'JPEG tables and frame header, SVG text, an end marker');
  put('bad', 'poly-jpeg-header-then-html-then-eoi.jpg', Buffer.concat([B.jpg.subarray(0, jpegSegments(B.jpg).find(s => s.m === 0xda).at + 14), Buffer.from(html), EOI]), 'JPEG up to the scan header, an HTML page, an end marker');
  put('bad', 'poly-jpeg-whole-then-svg.jpg', Buffer.concat([B.jpg, Buffer.from(svg)]), 'a whole JPEG, then SVG text');
  put('bad', 'poly-jpeg-svg-in-comment.jpg', insertAfterSoi(B.jpg, jpegSeg(0xfe, Buffer.from(svg))), 'a good JPEG carrying SVG in a comment (harmless)');
  put('bad', 'poly-webp-header-then-svg.webp', riff([riffChunk('VP8 ', Buffer.concat([riffChunks(B.webp).find(c => c.fourcc === 'VP8 ')?.data.subarray(0, 10) || Buffer.alloc(10), Buffer.from(svg)]))]), 'a VP8 frame header, then SVG text as the frame data');
  put('bad', 'poly-webp-whole-then-html.webp', Buffer.concat([B.webp, Buffer.from(html)]), 'a whole WebP, then an HTML page');
  put('bad', 'poly-svg-with-png-inside.svg', Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="data:image/png;base64,${B.png.toString('base64')}"/></svg>`), 'SVG with a PNG as a data URL');
  put('bad', 'poly-gif-header-jpeg-body.gif', Buffer.concat([Buffer.from('GIF89a', 'latin1'), B.jpg]), 'GIF signature, then a JPEG');
  put('bad', 'poly-html.html', Buffer.from(html), 'an HTML page');
  put('bad', 'poly-json-error.json', Buffer.from('{"error":{"message":"content policy","code":400}}'), 'a JSON error body');
  put('bad', 'poly-pdf.pdf', Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'), 'a PDF');
  put('bad', 'poly-zip.zip', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60)]), 'a ZIP header');
  put('bad', 'poly-mp4.mp4', Buffer.concat([u32be(24), Buffer.from('ftypisom'), Buffer.alloc(40)]), 'an MP4 header');
}
// Short and empty.
for (const n of [0, 1, 2, 3, 4, 8, 11, 12]) put('bad', `short-${String(n).padStart(2, '0')}-zero-bytes.bin`, Buffer.alloc(n), `${n} zero bytes`);
put('bad', 'short-png-signature-only.png', PNG_SIG, 'the PNG signature alone');
put('bad', 'short-jpeg-soi-only.jpg', Buffer.from([0xff, 0xd8, 0xff]), 'the JPEG start alone');
put('bad', 'short-riff-webp-only.webp', Buffer.concat([Buffer.from('RIFF'), u32le(4), Buffer.from('WEBP')]), 'RIFF WEBP and nothing else');
put('bad', 'zeros-1mb.bin', Buffer.alloc(1024 * 1024), '1 MB of zeros');
put('bad', 'ff-1mb.bin', Buffer.alloc(1024 * 1024, 0xff), '1 MB of FF bytes');

fs.rmSync(tmp, { recursive: true, force: true });
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
const by = {}; for (const m of manifest) by[m.group] = (by[m.group] || 0) + 1;
console.log(`${manifest.length} files in ${out}:`, by);
if (skipped.length) console.log('skipped:\n  ' + skipped.join('\n  '));
