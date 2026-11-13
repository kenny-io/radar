// What a fetched picture must be before it becomes a cover, and how it is drawn at 1200×628.
// The decoder (loadImage in @napi-rs/canvas) cannot be trusted with a file from someone else's server:
//  - it renders SVG, and returns a blank or partial picture for a truncated file without an error, so the type, the
//    pixel size and completeness are read from the bytes first, and nothing is decoded until they pass;
//  - it ends the whole process (a segmentation fault, not an error) for a file that starts like a JPEG, PNG or WebP
//    and has a header it cannot read, so the decode and the draw run in a short-lived child process. A crash there is
//    one refused picture.
import { spawn } from 'node:child_process';
import { SitePictureError, type OwnResponse, type SitePictureCode } from './fetch';

export const PICTURE_MAX_PIXELS = 25_000_000, PICTURE_MAX_SIDE = 10_000, PICTURE_MIN_W = 600, PICTURE_MIN_H = 314;
export const COVER_W = 1200, COVER_H = 628, CROP_KEEPS_AT_LEAST = 0.6;
/** A decoded picture is blank when, drawn `sample` pixels square, nothing in it is visible (alpha under `alpha`
 *  everywhere), or everything visible is one colour (no channel varies by `flat` or more). */
export const BLANK = { sample: 32, alpha: 16, flat: 8 };
/** How long one decode and draw may take before its process is stopped. */
export const DECODE_TIMEOUT_MS = 20_000;

export interface Probe { type: 'image/jpeg' | 'image/png' | 'image/webp'; width: number; height: number; complete: boolean; animated?: boolean }

const ascii = (b: Buffer, at: number, text: string) => b.length >= at + text.length && b.toString('latin1', at, at + text.length) === text;

/** Type, pixel size and completeness read from the bytes alone; nothing is decoded. null: not a JPEG, PNG or WebP. */
export function probeImage(b: Buffer): Probe | null {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) {
    if (b.length < 24 || !ascii(b, 12, 'IHDR')) return null;
    return { type: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20), complete: b.length >= 32 && ascii(b, b.length - 8, 'IEND') };
  }
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) {
    const complete = b.readUInt32LE(4) + 8 <= b.length;
    if (ascii(b, 12, 'VP8X') && b.length >= 30) return { type: 'image/webp', width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1, complete, ...(b[20] & 0x02 ? { animated: true } : {}) };
    if (ascii(b, 12, 'VP8 ') && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { type: 'image/webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, complete };
    if (ascii(b, 12, 'VP8L') && b.length >= 25 && b[20] === 0x2f) { const bits = b.readUInt32LE(21); return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, complete }; }
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    // Walk the segments to the first start-of-frame marker. Some files carry bytes after the end marker, so the end is looked for near the end, not at it.
    for (let i = 2; i + 9 <= b.length;) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; } // fill byte
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; } // markers with no length
      if (m === 0xda || m === 0xd9) return null; // image data or the end before any frame header
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { type: 'image/jpeg', width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5), complete: b.subarray(Math.max(0, b.length - 4096)).includes(Buffer.from([0xff, 0xd9])) };
      }
      const length = b.readUInt16BE(i + 2);
      if (length < 2) return null;
      i += 2 + length;
    }
    return null;
  }
  return null;
}

const HEADER_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/webp']);
/** The response header's type, lower-cased, with parameters removed. */
export const headerType = (type: string) => String(type || '').split(';')[0].trim().toLowerCase();

export interface Cover { png: Buffer; w: number; h: number; fit: 'crop' | 'backdrop' }

// The child process: plain JavaScript run with `node -e`, so it needs no file on disk and no build step. It reads the
// picture from stdin, decodes it, and answers on stdout with a 4-byte length, a JSON head and, on success, the PNG.
// The size is read from the decoded image: the decoder applies EXIF rotation, so a camera file stored on its side is
// judged and drawn upright.
// A blank result is refused: a file whose picture data is damaged can decode, without an error, to nothing at all
// (fully transparent) or to one flat colour. The decoded picture is looked at on a small transparent canvas first.
// Transparent areas alone are fine (a product cut-out). A file damaged part of the way through, which decodes to a
// picture that is partly blank, is not detected.
// The draw rule: white first (a transparent source must not leave transparent or black areas), then a centre crop
// when the crop keeps most of the picture; otherwise the whole picture on a blurred, darkened copy of itself. The
// blurred copy is drawn larger than the canvas: at exactly the canvas size the blur reads past the picture's edge and
// leaves a pale band along two sides.
const CHILD = `
const o = JSON.parse(process.argv[1]);
const chunks = [];
const reply = (head, png) => {
  const json = Buffer.from(JSON.stringify(head)); const length = Buffer.alloc(4); length.writeUInt32BE(json.length);
  process.stdout.write(Buffer.concat(png ? [length, json, png] : [length, json]), () => process.exit(0));
};
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', async () => {
  let createCanvas, loadImage, img;
  try { ({ createCanvas, loadImage } = require('@napi-rs/canvas')); } catch (e) { return reply({ code: 'unavailable' }); }
  try { img = await loadImage(Buffer.concat(chunks)); } catch (e) { return reply({ code: 'not_a_picture' }); }
  const w = img.width, h = img.height;
  if (!(w >= o.minW && h >= o.minH)) return reply({ code: 'too_small' });
  try {
    const small = createCanvas(o.sample, o.sample); const look = small.getContext('2d');
    look.drawImage(img, 0, 0, o.sample, o.sample);
    const px = look.getImageData(0, 0, o.sample, o.sample).data; const lo = [255, 255, 255], hi = [0, 0, 0]; let visible = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < o.alpha) continue;
      visible++;
      for (let c = 0; c < 3; c++) { if (px[i + c] < lo[c]) lo[c] = px[i + c]; if (px[i + c] > hi[c]) hi[c] = px[i + c]; }
    }
    if (!visible || Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) < o.flat) return reply({ code: 'not_a_picture' });
    const canvas = createCanvas(o.W, o.H); const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, o.W, o.H);
    const rs = w / h, rt = o.W / o.H;
    const fit = Math.min(rs, rt) / Math.max(rs, rt) >= o.keeps ? 'crop' : 'backdrop';
    const centred = scale => ctx.drawImage(img, (o.W - w * scale) / 2, (o.H - h * scale) / 2, w * scale, h * scale);
    const cover = Math.max(o.W / w, o.H / h);
    if (fit === 'crop') centred(cover);
    else {
      ctx.filter = 'blur(28px)'; centred(cover * 1.3); ctx.filter = 'none';
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, o.W, o.H);
      centred(Math.min(o.W / w, o.H / h, 1));
    }
    reply({ w, h, fit }, canvas.toBuffer('image/png'));
  } catch (e) { reply({ code: 'not_a_picture' }); }
});
`;
const CHILD_OPTIONS = JSON.stringify({ W: COVER_W, H: COVER_H, minW: PICTURE_MIN_W, minH: PICTURE_MIN_H, keeps: CROP_KEEPS_AT_LEAST, ...BLANK });
const MAX_OUTPUT = 32 * 1024 * 1024;

/** Decode and draw in a child process. Any way the picture can make the child fail (it crashed, it took too long, its
 *  answer makes no sense) is 'not_a_picture'. A child that cannot be started, or cannot load the canvas library, is
 *  not the picture's fault: that is a plain Error, so it is reported as a fault and never remembered as "no picture".
 *  The child gets no secrets: its environment is PATH and NODE_ENV alone. */
function decodeAndDraw(body: Buffer): Promise<Cover> {
  return new Promise((resolve, reject) => {
    const refuse = (code: SitePictureCode = 'not_a_picture') => reject(new SitePictureError(code));
    const unavailable = (why: string) => reject(new Error('The picture decoder could not run: ' + why));
    let child: ReturnType<typeof spawn>;
    try { child = spawn(process.execPath, ['-e', CHILD, CHILD_OPTIONS], { cwd: process.cwd(), env: { PATH: process.env.PATH || '', NODE_ENV: process.env.NODE_ENV }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }); }
    catch (error: any) { unavailable(error?.message || 'spawn failed'); return; }
    const out: Buffer[] = []; let size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), DECODE_TIMEOUT_MS);
    child.stdout!.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_OUTPUT) child.kill('SIGKILL'); else out.push(chunk); });
    child.stdin!.on('error', () => { /* the child ended before it read everything */ });
    child.on('error', error => { clearTimeout(timer); unavailable(error?.message || 'spawn failed'); });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      if (status !== 0 || signal || size > MAX_OUTPUT) { refuse(); return; }
      try {
        const all = Buffer.concat(out); const length = all.readUInt32BE(0);
        const head = JSON.parse(all.toString('utf8', 4, 4 + length)); const png = all.subarray(4 + length);
        if (head.code === 'too_small') { refuse('too_small'); return; }
        if (head.code === 'unavailable') { unavailable('the canvas library did not load'); return; }
        const made = probeImage(png);
        if (head.code || !made || made.type !== 'image/png' || !made.complete || made.width !== COVER_W || made.height !== COVER_H || !(head.w > 0 && head.h > 0) || (head.fit !== 'crop' && head.fit !== 'backdrop')) { refuse(); return; }
        resolve({ png, w: head.w, h: head.h, fit: head.fit });
      } catch { refuse(); }
    });
    child.stdin!.end(body);
  });
}

// One picture is decoded at a time: the worst case is about 100 MB of pixels, and the owner action is served by the web process.
let decoding: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = decoding.then(work, work);
  decoding = run.catch(() => {});
  return run;
}

/** The 1200×628 PNG for a fetched picture. Throws SitePictureError('not_a_picture' | 'too_large' | 'too_small'); a
 *  plain Error only when the decoder itself could not run. */
export async function readPicture(res: OwnResponse): Promise<Cover> {
  // The header and the bytes need not name the same one of the three (servers mislabel); the bytes decide.
  if (!HEADER_TYPES.has(headerType(res.type))) throw new SitePictureError('not_a_picture');
  const probe = probeImage(res.body);
  if (!probe || !probe.complete || probe.animated || !(probe.width > 0 && probe.height > 0)) throw new SitePictureError('not_a_picture');
  // Before any decode: the decoder allocates the whole bitmap on load, so a small file declaring a huge size is stopped here.
  if (probe.width > PICTURE_MAX_SIDE || probe.height > PICTURE_MAX_SIDE || probe.width * probe.height > PICTURE_MAX_PIXELS) throw new SitePictureError('too_large');
  return oneAtATime(() => decodeAndDraw(res.body));
}
