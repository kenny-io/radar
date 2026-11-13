// QA fixtures for safe logo reading. Good files come from fx/good (made by gen-good.sh with ImageMagick, cwebp,
// img2webp and jpegtran, not with the canvas library under test). Malformed files are derived here, from bytes.
// Nothing here decodes anything.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const QA_DIR = path.resolve(process.cwd(), '.factory/safe-logo-decode/qa');
export const good = (name: string) => fs.readFileSync(path.join(QA_DIR, 'fx/good', name));

export const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon', bmp: 'image/bmp', avif: 'image/avif', tiff: 'image/tiff', svg: 'image/svg+xml' };
export const goodFiles = () => fs.readdirSync(path.join(QA_DIR, 'fx/good')).sort().map(name => ({ name, type: MIME[name.split('.').pop()!], body: good(name) }));

const u32be = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u16be = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
export const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const pngChunk = (type: string, data: Buffer, crc?: number) => Buffer.concat([u32be(data.length), Buffer.from(type, 'latin1'), data, u32be(crc ?? zlib.crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])))]);
export const ihdr = (w: number, h: number, depth = 8, colour = 6, interlace = 0) => pngChunk('IHDR', Buffer.concat([u32be(w), u32be(h), Buffer.from([depth, colour, 0, 0, interlace])]));
export const IEND = pngChunk('IEND', Buffer.alloc(0));
export function pngChunks(b: Buffer): { type: string; data: Buffer }[] {
  const out: { type: string; data: Buffer }[] = [];
  for (let i = 8; i + 12 <= b.length;) { const len = b.readUInt32BE(i); out.push({ type: b.toString('latin1', i + 4, i + 8), data: b.subarray(i + 8, i + 8 + len) }); i += 12 + len; }
  return out;
}
export const pngFrom = (chunks: { type: string; data: Buffer }[]) => Buffer.concat([PNG_SIG, ...chunks.map(c => pngChunk(c.type, c.data))]);
/** A valid 8-bit PNG made from bytes: every pixel the same colour. colour type 6 (RGBA) or 2 (RGB). */
export function flatPng(w: number, h: number, rgba: [number, number, number, number], o: { level?: number } = {}): Buffer {
  const row = Buffer.alloc(1 + w * 4); for (let x = 0; x < w; x++) row.set(rgba, 1 + x * 4);
  const raw = Buffer.alloc(row.length * h); for (let y = 0; y < h; y++) row.copy(raw, y * row.length);
  return Buffer.concat([PNG_SIG, ihdr(w, h), pngChunk('IDAT', zlib.deflateSync(raw, { level: o.level ?? 6 })), IEND]);
}
const withIhdr = (png: Buffer, edit: (d: Buffer) => void, fixCrc = true) => {
  const cs = pngChunks(png); const d = Buffer.from(cs[0].data); edit(d);
  return Buffer.concat([PNG_SIG, fixCrc ? pngChunk('IHDR', d) : pngChunk('IHDR', d, zlib.crc32(Buffer.concat([Buffer.from('IHDR'), cs[0].data]))), ...cs.slice(1).map(c => pngChunk(c.type, c.data))]);
};
const cut = (b: Buffer, fraction: number) => b.subarray(0, Math.max(1, Math.floor(b.length * fraction)));
/** Brings a small file over the 80-byte floor detectBrand has. A PNG that ends with its end chunk gets a text chunk before
 *  that chunk (bytes after the end chunk would make it a different, incomplete file); anything else gets zero bytes after it. */
const pad = (b: Buffer, to = 200) => {
  if (b.length >= to) return b;
  if (b.subarray(0, 8).equals(PNG_SIG) && b.length >= 20 && b.subarray(b.length - 12).equals(IEND)) return Buffer.concat([b.subarray(0, b.length - 12), pngChunk('tEXt', Buffer.from('Comment\0' + 'q'.repeat(Math.max(1, to - b.length)), 'latin1')), IEND]);
  return Buffer.concat([b, Buffer.alloc(to - b.length)]);
};
/** Deterministic noise. */
export function noise(n: number, seed = 1): Buffer { const b = Buffer.alloc(n); let s = seed >>> 0; for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; b[i] = s >>> 24; } return b; }

/** JPEG segments up to and including SOS header; `rest` is the entropy-coded data and what follows. */
export function jpegSegments(b: Buffer): { segs: { marker: number; data: Buffer }[]; rest: Buffer } {
  const segs: { marker: number; data: Buffer }[] = []; let i = 2;
  for (; i + 4 <= b.length;) { const m = b[i + 1]; const len = b.readUInt16BE(i + 2); segs.push({ marker: m, data: b.subarray(i + 4, i + 2 + len) }); i += 2 + len; if (m === 0xda) break; }
  return { segs, rest: b.subarray(i) };
}
export const jpegFrom = (segs: { marker: number; data: Buffer }[], rest: Buffer) => Buffer.concat([Buffer.from([0xff, 0xd8]), ...segs.map(s => Buffer.concat([Buffer.from([0xff, s.marker]), u16be(s.data.length + 2), s.data])), rest]);
/** An EXIF segment that holds only an orientation. */
export const exifOrientation = (n: number) => ({ marker: 0xe1, data: Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from('MM\0*', 'latin1'), u32be(8), u16be(1), u16be(0x0112), u16be(3), u32be(1), u16be(n), u16be(0), u32be(0)]) });
const withExif = (jpeg: Buffer, seg: { marker: number; data: Buffer }) => { const { segs, rest } = jpegSegments(jpeg); const at = segs[0]?.marker === 0xe0 ? 1 : 0; return jpegFrom([...segs.slice(0, at), seg, ...segs.slice(at)], rest); };
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
const editSof = (jpeg: Buffer, edit: (s: { marker: number; data: Buffer }) => void) => { const { segs, rest } = jpegSegments(jpeg); const out = segs.map(s => ({ marker: s.marker, data: Buffer.from(s.data) })); edit(out.find(s => isSof(s.marker))!); return jpegFrom(out, rest); };

const riff = (chunks: Buffer[], size?: number) => { const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]); return Buffer.concat([Buffer.from('RIFF'), u32le(size ?? body.length), body]); };
const riffChunk = (id: string, data: Buffer) => Buffer.concat([Buffer.from(id, 'latin1'), u32le(data.length), data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
const vp8x = (w: number, h: number, flags = 0) => { const d = Buffer.alloc(10); d[0] = flags; d.writeUIntLE(w - 1, 4, 3); d.writeUIntLE(h - 1, 7, 3); return riffChunk('VP8X', d); };
const vp8lHeader = (w: number, h: number) => { const d = Buffer.alloc(5); d[0] = 0x2f; d.writeUInt32LE((((h - 1) << 14) | (w - 1)) >>> 0, 1); return d; };
const vp8Header = (w: number, h: number) => { const d = Buffer.alloc(10); d.set([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a]); d.writeUInt16LE(w, 6); d.writeUInt16LE(h, 8); return d; };
const fixRiff = (b: Buffer) => { const c = Buffer.from(b); c.writeUInt32LE(c.length - 8, 4); return c; };

export const SVG_PLAIN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80"><rect width="240" height="80" rx="12" fill="#0F766E"/><circle cx="40" cy="40" r="22" fill="#0f766e"/><path d="M80 40h120" stroke="rgb(192, 38, 211)" stroke-width="8"/><text x="90" y="30" fill="#FFFFFF">Acme</text></svg>`;

export interface Bad { body: Buffer; type: string; /** 'none': the bytes alone must refuse it, so no child process may start. 'any': it may reach the child. */ child: 'none' | 'any'; /** What must be stored when it is expected to be kept. undefined: no expectation, either is acceptable. null: must not be kept. */ kept?: string | null; note?: string }

/** Files a hostile or broken site could serve as its logo. */
export function badFiles(): Record<string, Bad> {
  const P = good('png-rgba.png'), J = good('jpg-baseline.jpg'), WL = good('webp-lossy.webp'), WLL = good('webp-lossless.webp'), WA = good('webp-lossy-alpha.webp'), WAN = good('webp-animated.webp');
  const pc = pngChunks(P); const idat = pc.filter(c => c.type === 'IDAT'); const beforeIdat = pc.slice(0, pc.findIndex(c => c.type === 'IDAT'));
  const out: Record<string, Bad> = {};
  const add = (name: string, body: Buffer, child: Bad['child'], o: Partial<Bad> = {}) => { out[name] = { body: pad(body, 96), type: o.type ?? (name.startsWith('jpg') ? 'image/jpeg' : name.startsWith('webp') ? 'image/webp' : 'image/png'), child, ...o }; };

  // ── PNG: cut short (no end chunk where one must be)
  for (const f of [0.1, 0.5, 0.9]) out[`png-cut-${f * 100}pct`] = { body: cut(P, f), type: 'image/png', child: 'none', kept: null };
  out['png-cut-last-1'] = { body: P.subarray(0, P.length - 1), type: 'image/png', child: 'none', kept: null };
  out['png-cut-last-8'] = { body: P.subarray(0, P.length - 8), type: 'image/png', child: 'none', kept: null };
  out['png-cut-no-iend'] = { body: P.subarray(0, P.length - 12), type: 'image/png', child: 'none', kept: null };
  out['png-trailing-bytes'] = { body: Buffer.concat([P, Buffer.from('\n\n')]), type: 'image/png', child: 'none', kept: null, note: 'a whole PNG with two bytes after its end chunk: the base accepted it' };
  // ── PNG: says it is whole, and is not
  add('png-cut-then-iend', Buffer.concat([cut(P, 0.6), IEND]), 'any');
  add('png-no-idat', Buffer.concat([PNG_SIG, ihdr(128, 128), IEND]), 'any', { kept: null });
  add('png-no-idat-text', Buffer.concat([PNG_SIG, ihdr(128, 128), pngChunk('tEXt', Buffer.from('Software\0QA', 'latin1')), IEND]), 'any', { kept: null });
  add('png-no-idat-64x64-rgb', Buffer.concat([PNG_SIG, ihdr(64, 64, 8, 2), pngChunk('gAMA', u32be(45455)), IEND]), 'any', { kept: null });
  add('png-ihdr-crc-wrong', withIhdr(P, () => {}, true).fill(0xab, 29, 33), 'any');
  add('png-ihdr-length-0', (() => { const b = Buffer.from(P); b.writeUInt32BE(0, 8); return b; })(), 'any');
  add('png-ihdr-length-huge', (() => { const b = Buffer.from(P); b.writeUInt32BE(0x7fffffff, 8); return b; })(), 'any');
  add('png-ihdr-length-12', (() => { const b = Buffer.from(P); b.writeUInt32BE(12, 8); return b; })(), 'any');
  add('png-bit-depth-3', withIhdr(P, d => { d[8] = 3; }), 'any');
  add('png-bit-depth-0', withIhdr(P, d => { d[8] = 0; }), 'any');
  add('png-colour-type-7', withIhdr(P, d => { d[9] = 7; }), 'any');
  add('png-colour-type-3-no-palette', withIhdr(P, d => { d[9] = 3; }), 'any');
  add('png-compression-1', withIhdr(P, d => { d[10] = 1; }), 'any');
  add('png-filter-method-1', withIhdr(P, d => { d[11] = 1; }), 'any');
  add('png-interlace-9', withIhdr(P, d => { d[12] = 9; }), 'any');
  add('png-interlace-flag-on-plain-data', withIhdr(P, d => { d[12] = 1; }), 'any');
  add('png-depth-16-on-8-bit-data', withIhdr(P, d => { d[8] = 16; }), 'any');
  add('png-width-0', withIhdr(P, d => { d.writeUInt32BE(0, 0); }), 'none', { kept: null });
  add('png-height-0', withIhdr(P, d => { d.writeUInt32BE(0, 4); }), 'none', { kept: null });
  add('png-idat-noise', pngFrom([...beforeIdat, { type: 'IDAT', data: noise(900, 7) }, { type: 'IEND', data: Buffer.alloc(0) }]), 'any');
  add('png-idat-empty', pngFrom([...beforeIdat, { type: 'IDAT', data: Buffer.alloc(0) }, { type: 'IEND', data: Buffer.alloc(0) }]), 'any');
  add('png-idat-crc-wrong', (() => { const b = Buffer.from(P); const at = b.indexOf('IDAT'); const len = b.readUInt32BE(at - 4); b[at + 4 + len] ^= 0xff; return b; })(), 'any');
  add('png-idat-half-the-rows', pngFrom([...beforeIdat, { type: 'IDAT', data: zlib.deflateSync(zlib.inflateSync(Buffer.concat(idat.map(c => c.data))).subarray(0, 40 * (1 + 256 * 4))) }, { type: 'IEND', data: Buffer.alloc(0) }]), 'any');
  add('png-idat-zlib-cut', pngFrom([...beforeIdat, { type: 'IDAT', data: cut(Buffer.concat(idat.map(c => c.data)), 0.5) }, { type: 'IEND', data: Buffer.alloc(0) }]), 'any');
  add('png-idat-bad-filter-bytes', pngFrom([...beforeIdat, { type: 'IDAT', data: zlib.deflateSync(Buffer.alloc(128 * (1 + 256 * 4), 9)) }, { type: 'IEND', data: Buffer.alloc(0) }]), 'any');
  add('png-ihdr-twice', pngFrom([pc[0], pc[0], ...pc.slice(1)]), 'any');
  add('png-idat-before-ihdr', Buffer.concat([PNG_SIG, pngChunk('IDAT', idat[0].data), ihdr(256, 128), IEND]), 'none', { kept: null });
  add('png-cgbi-first', Buffer.concat([PNG_SIG, pngChunk('CgBI', Buffer.from([0x50, 0, 0x20, 2])), ...pc.map(c => pngChunk(c.type, c.data))]), 'none', { kept: null });
  add('png-unknown-critical-chunk', pngFrom([pc[0], { type: 'QAQA', data: noise(40) }, ...pc.slice(1)]), 'any');
  add('png-palette-index-out-of-range', Buffer.concat([PNG_SIG, ihdr(64, 64, 8, 3), pngChunk('PLTE', Buffer.from([15, 118, 110])), pngChunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: 64 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 200)]))))), IEND]), 'any');
  add('png-palette-bad-length', Buffer.concat([PNG_SIG, ihdr(64, 64, 8, 3), pngChunk('PLTE', Buffer.from([15, 118, 110, 9])), pngChunk('IDAT', zlib.deflateSync(Buffer.alloc(64 * 65))), IEND]), 'any');
  add('png-trns-too-long', Buffer.concat([PNG_SIG, ihdr(64, 64, 8, 3), pngChunk('PLTE', Buffer.from([15, 118, 110])), pngChunk('tRNS', Buffer.alloc(300, 255)), pngChunk('IDAT', zlib.deflateSync(Buffer.alloc(64 * 65))), IEND]), 'any');
  // An animated PNG: the first frame is the ordinary picture, a second frame follows.
  add('png-apng-two-frames', (() => {
    const fctl = (seq: number) => pngChunk('fcTL', Buffer.concat([u32be(seq), u32be(256), u32be(128), u32be(0), u32be(0), u16be(1), u16be(5), Buffer.from([0, 0])]));
    return Buffer.concat([PNG_SIG, pngChunk('IHDR', pc[0].data), pngChunk('acTL', Buffer.concat([u32be(2), u32be(0)])), fctl(0), ...idat.map(c => pngChunk('IDAT', c.data)), fctl(1), pngChunk('fdAT', Buffer.concat([u32be(2), Buffer.concat(idat.map(c => c.data))])), IEND]);
  })(), 'any', { kept: 'image/png', note: 'animated PNG: nothing in the probe looks for it' });
  // ── PNG: declared size
  add('png-declares-10000x2500', withIhdr(P, d => { d.writeUInt32BE(10000, 0); d.writeUInt32BE(2500, 4); }), 'any', { note: 'on the limit: 25,000,000 px declared over picture data for 256×128' });
  add('png-declares-5000x5000-crc-wrong', withIhdr(P, d => { d.writeUInt32BE(5000, 0); d.writeUInt32BE(5000, 4); }, false), 'any');
  add('png-declares-10000x2501', withIhdr(P, d => { d.writeUInt32BE(10000, 0); d.writeUInt32BE(2501, 4); }), 'none', { kept: null });
  add('png-declares-10001x48', withIhdr(P, d => { d.writeUInt32BE(10001, 0); d.writeUInt32BE(48, 4); }), 'none', { kept: null });
  add('png-declares-48x10001', withIhdr(P, d => { d.writeUInt32BE(48, 0); d.writeUInt32BE(10001, 4); }), 'none', { kept: null });
  add('png-declares-2147483647-square', withIhdr(P, d => { d.writeUInt32BE(0x7fffffff, 0); d.writeUInt32BE(0x7fffffff, 4); }), 'none', { kept: null });
  add('png-declares-4294967295x1', withIhdr(P, d => { d.writeUInt32BE(0xffffffff, 0); d.writeUInt32BE(1, 4); }), 'none', { kept: null });
  add('png-declares-65536x65536', withIhdr(P, d => { d.writeUInt32BE(65536, 0); d.writeUInt32BE(65536, 4); }), 'none', { kept: null });
  add('png-declares-47x47-over-256x128-data', withIhdr(P, d => { d.writeUInt32BE(47, 0); d.writeUInt32BE(47, 4); }), 'none', { kept: null });
  // ── PNG polyglots
  add('polyglot-png-signature-then-svg', Buffer.concat([PNG_SIG, Buffer.from(SVG_PLAIN)]), 'none', { kept: null });
  add('polyglot-png-signature-then-svg-as-svg', Buffer.concat([PNG_SIG, Buffer.from(SVG_PLAIN)]), 'none', { kept: null, type: 'image/svg+xml' });
  add('polyglot-png-header-then-svg-then-end', Buffer.concat([PNG_SIG, ihdr(128, 128), Buffer.from(SVG_PLAIN), IEND]), 'any', { kept: null });
  add('polyglot-png-header-then-html-then-end', Buffer.concat([PNG_SIG, ihdr(128, 128), Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>'), IEND]), 'any', { kept: null });
  add('polyglot-whole-png-then-html', Buffer.concat([P, Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>')]), 'none', { kept: null });
  add('polyglot-whole-png-with-svg-in-text-chunk', pngFrom([pc[0], { type: 'tEXt', data: Buffer.from('Comment\0' + SVG_PLAIN, 'latin1') }, ...pc.slice(1)]), 'any', { kept: null, note: 'a whole, valid PNG: the decoder takes any file containing the bytes <svg for SVG and refuses it (the base did the same); see svg-sniff.ts' });
  add('polyglot-whole-png-with-svg-in-text-chunk-as-svg', pngFrom([pc[0], { type: 'tEXt', data: Buffer.from('Comment\0' + SVG_PLAIN, 'latin1') }, ...pc.slice(1)]), 'none', { kept: null, type: 'image/svg+xml' });
  add('polyglot-whole-png-as-svg', P, 'none', { kept: null, type: 'image/svg+xml' });
  add('polyglot-svg-as-png', Buffer.from(SVG_PLAIN), 'none', { kept: null });
  add('polyglot-svg-as-jpeg', Buffer.from(SVG_PLAIN), 'none', { kept: null, type: 'image/jpeg' });
  add('polyglot-svg-as-webp', Buffer.from(SVG_PLAIN), 'none', { kept: null, type: 'image/webp' });
  add('polyglot-svg-as-plain-image', Buffer.from(SVG_PLAIN), 'none', { kept: null, type: 'image/x-unknown' });
  add('polyglot-html-as-png', Buffer.from('<!doctype html><html><head><title>Not found</title></head><body><h1>404</h1><p>Nothing here.</p></body></html>'), 'none', { kept: null });
  add('polyglot-html-as-svg', Buffer.from('<!doctype html><html><head><title>Not found</title></head><body><h1>404</h1><p>Nothing here, and no vector element either.</p></body></html>'), 'none', { kept: null, type: 'image/svg+xml' });
  add('polyglot-jpeg-as-svg', J, 'none', { kept: null, type: 'image/svg+xml' });
  add('polyglot-gif-as-svg', good('gif-still.gif'), 'none', { kept: null, type: 'image/svg+xml' });

  // ── JPEG
  const js = jpegSegments(J);
  add('jpg-start-and-end-only', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'none', { kept: null });
  add('jpg-start-and-end-padded-4k', pad(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 4096), 'none', { kept: null });
  for (const f of [0.1, 0.5, 0.9]) out[`jpg-cut-${f * 100}pct`] = { body: cut(J, f), type: 'image/jpeg', child: 'none', kept: null };
  out['jpg-cut-no-end-marker'] = { body: J.subarray(0, J.length - 2), type: 'image/jpeg', child: 'none', kept: null };
  add('jpg-cut-then-end-marker', Buffer.concat([cut(J, 0.6), Buffer.from([0xff, 0xd9])]), 'any');
  add('jpg-no-scan', Buffer.concat([J.subarray(0, J.indexOf(Buffer.from([0xff, 0xda]))), Buffer.from([0xff, 0xd9])]), 'any', { kept: null });
  add('jpg-frame-header-only', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0]), u16be(17), Buffer.from([8]), u16be(128), u16be(128), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), Buffer.from([0xff, 0xd9])]), 'any', { kept: null });
  add('jpg-frame-header-no-components', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0]), u16be(8), Buffer.from([8]), u16be(128), u16be(128), Buffer.from([0]), Buffer.from([0xff, 0xd9])]), 'any', { kept: null });
  add('jpg-frame-header-255-components', editSof(J, s => { s.data[5] = 255; }), 'any');
  add('jpg-frame-header-precision-12', editSof(J, s => { s.data[0] = 12; }), 'any');
  add('jpg-frame-header-sampling-0', editSof(J, s => { s.data[7] = 0; }), 'any');
  add('jpg-width-0', editSof(J, s => { s.data.writeUInt16BE(0, 3); }), 'none', { kept: null });
  add('jpg-height-0', editSof(J, s => { s.data.writeUInt16BE(0, 1); }), 'none', { kept: null });
  add('jpg-declares-65535x65535', editSof(J, s => { s.data.writeUInt16BE(65535, 1); s.data.writeUInt16BE(65535, 3); }), 'none', { kept: null });
  add('jpg-declares-10000x2500', editSof(J, s => { s.data.writeUInt16BE(2500, 1); s.data.writeUInt16BE(10000, 3); }), 'any', { note: 'on the limit' });
  add('jpg-declares-5000x5000', editSof(J, s => { s.data.writeUInt16BE(5000, 1); s.data.writeUInt16BE(5000, 3); }), 'any');
  add('jpg-declares-64x64-over-256x128-data', editSof(J, s => { s.data.writeUInt16BE(64, 1); s.data.writeUInt16BE(64, 3); }), 'any');
  add('jpg-huffman-table-noise', jpegFrom(js.segs.map(s => (s.marker === 0xc4 ? { marker: s.marker, data: noise(s.data.length, 3) } : s)), js.rest), 'any');
  add('jpg-no-huffman-tables', jpegFrom(js.segs.filter(s => s.marker !== 0xc4), js.rest), 'any', { note: 'decoders may fall back to the standard tables' });
  add('jpg-no-quantisation-tables', jpegFrom(js.segs.filter(s => s.marker !== 0xdb), js.rest), 'any');
  add('jpg-quantisation-table-zeros', jpegFrom(js.segs.map(s => (s.marker === 0xdb ? { marker: s.marker, data: Buffer.alloc(s.data.length) } : s)), js.rest), 'any');
  add('jpg-scan-noise', Buffer.concat([jpegFrom(js.segs, Buffer.alloc(0)), noise(js.rest.length - 2, 5).map(x => (x === 0xff ? 0xfe : x)), Buffer.from([0xff, 0xd9])]), 'any');
  add('jpg-scan-header-wrong-component', jpegFrom(js.segs.map(s => (s.marker === 0xda ? { marker: s.marker, data: (() => { const d = Buffer.from(s.data); d[1] = 99; return d; })() } : s)), js.rest), 'any');
  add('jpg-lossless-frame-marker', editSof(J, s => { s.marker = 0xc3; }), 'any');
  add('jpg-arithmetic-frame-marker-on-huffman-data', editSof(J, s => { s.marker = 0xc9; }), 'any');
  add('jpg-progressive-frame-marker-on-baseline-data', editSof(J, s => { s.marker = 0xc2; }), 'any');
  add('jpg-two-frame-headers', (() => { const i = js.segs.findIndex(s => isSof(s.marker)); return jpegFrom([...js.segs.slice(0, i + 1), js.segs[i], ...js.segs.slice(i + 1)], js.rest); })(), 'any');
  add('jpg-segment-length-1', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]), J.subarray(4)]), 'none', { kept: null });
  add('jpg-fill-bytes-before-frame', Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(300, 0xff), J.subarray(2)]), 'any');
  add('jpg-exif-pointing-outside', withExif(J, { marker: 0xe1, data: Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from('MM\0*', 'latin1'), u32be(0x7ffffff0), noise(40, 2)]) }), 'any');
  add('jpg-exif-directory-points-at-itself', withExif(J, { marker: 0xe1, data: Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from('MM\0*', 'latin1'), u32be(8), u16be(1), u16be(0x0112), u16be(3), u32be(1), u16be(6), u16be(0), u32be(8)]) }), 'any');
  add('jpg-exif-orientation-9', withExif(J, exifOrientation(9)), 'any', { kept: 'image/jpeg' });
  add('jpg-exif-65535-entries', withExif(J, { marker: 0xe1, data: Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), Buffer.from('II*\0', 'latin1'), u32le(8), Buffer.from([0xff, 0xff]), noise(60, 9)]) }), 'any');
  add('jpg-icc-profile-noise', withExif(J, { marker: 0xe2, data: Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([1, 1]), noise(600, 4)]) }), 'any');
  add('jpg-adobe-marker-says-cmyk', withExif(J, { marker: 0xee, data: Buffer.concat([Buffer.from('Adobe', 'latin1'), Buffer.from([0, 100, 0, 0, 0, 0, 2])]) }), 'any');
  // EXIF rotation by a quarter turn at the size limit: the bytes say 48×100 (shorter side 48), the decoder sees 100×48.
  add('jpg-exif-rotated-48x100', withExif(good('jpg-48x100-plain.jpg'), exifOrientation(6)), 'any', { kept: 'image/jpeg' });
  add('jpg-exif-rotated-47x100', withExif(good('jpg-47x100-plain.jpg'), exifOrientation(6)), 'none', { kept: null });
  add('jpg-exif-mirrored-48x100', withExif(good('jpg-48x100-plain.jpg'), exifOrientation(5)), 'any', { kept: 'image/jpeg' });

  // ── WebP
  for (const [n, b] of [['lossy', WL], ['lossless', WLL], ['alpha', WA]] as const) {
    out[`webp-${n}-cut-50pct`] = { body: cut(b, 0.5), type: 'image/webp', child: 'none', kept: null };
    out[`webp-${n}-cut-last-1`] = { body: b.subarray(0, b.length - 1), type: 'image/webp', child: 'none', kept: null };
    add(`webp-${n}-cut-with-size-corrected`, fixRiff(cut(b, 0.5)), 'any');
  }
  add('webp-animated', WAN, 'none', { kept: null });
  add('webp-animated-flag-cleared', (() => { const b = Buffer.from(WAN); b[20] &= ~0x02; return b; })(), 'any', { note: 'animation chunks without the animation flag' });
  add('webp-still-with-animation-flag', (() => { const b = Buffer.from(WA); b[20] |= 0x02; return b; })(), 'none', { kept: null });
  add('webp-lossy-header-then-noise', riff([riffChunk('VP8 ', Buffer.concat([vp8Header(256, 128), noise(400, 11)]))]), 'any');
  add('webp-lossless-header-then-noise', riff([riffChunk('VP8L', Buffer.concat([vp8lHeader(256, 128), noise(400, 12)]))]), 'any');
  add('webp-lossless-header-then-zeros', riff([riffChunk('VP8L', Buffer.concat([vp8lHeader(256, 128), Buffer.alloc(400)]))]), 'any');
  add('webp-extended-header-and-nothing-else', riff([vp8x(256, 128), riffChunk('QAQA', Buffer.alloc(100))]), 'any', { kept: null });
  add('webp-extended-says-256x128-frame-says-16000x16000', riff([vp8x(256, 128), riffChunk('VP8 ', Buffer.concat([vp8Header(16000, 16000), WL.subarray(30)]))]), 'any', { note: 'the header the probe reads and the frame the decoder reads disagree' });
  add('webp-extended-says-256x128-lossless-frame-says-16384x16384', riff([vp8x(256, 128), riffChunk('VP8L', Buffer.concat([vp8lHeader(16384, 16384), WLL.subarray(25)]))]), 'any');
  add('webp-extended-says-64x64-frame-is-256x128', riff([vp8x(64, 64), WL.subarray(12)]), 'any');
  add('webp-extended-declares-16384x16384', riff([vp8x(16384, 16384), WL.subarray(12)]), 'none', { kept: null });
  add('webp-extended-declares-16777216-square', riff([vp8x(16777216, 16777216), WL.subarray(12)]), 'none', { kept: null });
  add('webp-lossless-declares-16384x16384', riff([riffChunk('VP8L', Buffer.concat([vp8lHeader(16384, 16384), noise(200, 13)]))]), 'none', { kept: null });
  add('webp-lossless-declares-10000x2500', riff([riffChunk('VP8L', Buffer.concat([vp8lHeader(10000, 2500), WLL.subarray(25)]))]), 'any', { note: 'on the limit' });
  add('webp-lossy-declares-10000x2500', riff([riffChunk('VP8 ', Buffer.concat([vp8Header(10000, 2500), WL.subarray(30)]))]), 'any', { note: 'on the limit' });
  add('webp-lossy-declares-0x0', riff([riffChunk('VP8 ', Buffer.concat([vp8Header(0, 0), WL.subarray(30)]))]), 'none', { kept: null });
  add('webp-lossy-bad-start-code', (() => { const b = Buffer.from(WL); b[23] = 0; return b; })(), 'none', { kept: null });
  add('webp-lossless-bad-signature', (() => { const b = Buffer.from(WLL); b[20] = 0; return b; })(), 'none', { kept: null });
  add('webp-size-field-0', (() => { const b = Buffer.from(WL); b.writeUInt32LE(0, 4); return b; })(), 'any');
  add('webp-size-field-smaller', (() => { const b = Buffer.from(WL); b.writeUInt32LE(40, 4); return b; })(), 'any');
  add('webp-size-field-4294967295', (() => { const b = Buffer.from(WL); b.writeUInt32LE(0xffffffff, 4); return b; })(), 'none', { kept: null });
  add('webp-chunk-size-4294967295', (() => { const b = Buffer.from(WL); b.writeUInt32LE(0xffffffff, 16); return b; })(), 'any');
  add('webp-alpha-chunk-noise', (() => { const b = Buffer.from(WA); const at = b.indexOf('ALPH'); if (at > 0) noise(b.readUInt32LE(at + 4), 21).copy(b, at + 8); return b; })(), 'any');
  add('webp-riff-of-another-kind', Buffer.concat([Buffer.from('RIFF'), u32le(200), Buffer.from('WAVEfmt '), Buffer.alloc(200)]), 'none', { kept: null });

  // ── Other formats, under their own header and under a raster header
  for (const [n, file, own] of [['gif', 'gif-still.gif', 'image/gif'], ['gif-animated', 'gif-animated.gif', 'image/gif'], ['ico', 'ico-multi.ico', 'image/x-icon'], ['ico-ms', 'ico-multi.ico', 'image/vnd.microsoft.icon'], ['bmp', 'bmp-24.bmp', 'image/bmp'], ['avif', 'avif-still.avif', 'image/avif'], ['tiff', 'tiff-still.tiff', 'image/tiff']] as const) {
    out[`other-${n}`] = { body: good(file), type: own, child: 'none', kept: null };
    out[`other-${n}-as-png`] = { body: good(file), type: 'image/png', child: 'none', kept: null };
  }
  add('other-noise-as-png', noise(4096, 31), 'none', { kept: null });
  add('other-zeros-as-jpeg', Buffer.alloc(4096), 'none', { kept: null, type: 'image/jpeg' });
  add('other-text-as-webp', Buffer.from('RIFF is not what this is. '.repeat(20)), 'none', { kept: null, type: 'image/webp' });
  add('other-png-signature-only', pad(PNG_SIG, 96), 'none', { kept: null });
  add('other-gzip-of-png-as-png', zlib.gzipSync(Buffer.concat([P, noise(200)])), 'none', { kept: null });
  return out;
}

/** Good files served under a header that names another type: the bytes must decide what is stored (D2). */
export function mislabelled(): Record<string, { body: Buffer; type: string; kept: string | null; ext?: string }> {
  return {
    'png-as-jpeg': { body: good('png-rgba.png'), type: 'image/jpeg', kept: 'image/png', ext: 'png' },
    'png-as-webp': { body: good('png-rgba.png'), type: 'image/webp', kept: 'image/png', ext: 'png' },
    'png-as-x-icon': { body: good('png-rgba.png'), type: 'image/x-icon', kept: 'image/png', ext: 'png' },
    'png-as-gif': { body: good('png-rgba.png'), type: 'image/gif', kept: 'image/png', ext: 'png' },
    'png-as-made-up-image-type': { body: good('png-rgba.png'), type: 'image/x-qa-unknown', kept: 'image/png', ext: 'png' },
    'png-with-charset-parameter': { body: good('png-rgba.png'), type: 'image/png; charset=binary', kept: 'image/png', ext: 'png' },
    'jpeg-as-png': { body: good('jpg-baseline.jpg'), type: 'image/png', kept: 'image/jpeg', ext: 'jpg' },
    'jpeg-as-jpg': { body: good('jpg-baseline.jpg'), type: 'image/jpg', kept: 'image/jpeg', ext: 'jpg' },
    'jpeg-as-pjpeg': { body: good('jpg-progressive.jpg'), type: 'image/pjpeg', kept: 'image/jpeg', ext: 'jpg' },
    'webp-as-png': { body: good('webp-lossy.webp'), type: 'image/png', kept: 'image/webp', ext: 'webp' },
    'webp-as-jpeg': { body: good('webp-lossless.webp'), type: 'image/jpeg', kept: 'image/webp', ext: 'webp' },
    'png-as-octet-stream': { body: good('png-rgba.png'), type: 'application/octet-stream', kept: null },
    'png-as-text-html': { body: good('png-rgba.png'), type: 'text/html', kept: null },
    'png-with-no-type': { body: good('png-rgba.png'), type: '', kept: null },
  };
}

/** A valid PNG of w×h in one flat opaque colour. A large one is a small file that decodes to a large bitmap. */
export const bigFlatPng = (w: number, h: number) => flatPng(w, h, [15, 118, 110, 255], { level: 9 });
