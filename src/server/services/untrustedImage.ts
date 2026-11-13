// Reading a picture that came from someone else's server (a cover from the owner's site, a logo from the site being
// analysed). The decoder (loadImage in @napi-rs/canvas) cannot be trusted with such a file:
//  - it renders SVG, and returns a blank or partial picture for a truncated file without an error, so the type, the
//    pixel size and completeness are read from the bytes first (probeImage), and nothing is decoded until they pass;
//  - it ends the whole process (a segmentation fault, not an error) for a file that starts like a JPEG, PNG or WebP
//    and has a header it cannot read, so every decode runs in a short-lived child process (decodeInChild). A crash
//    there is one refused picture.
// What a cover is lives in realCover/picture.ts, what a logo is in analysis/brand.ts; both decode through here, so the
// two are never decoded at the same moment.
import { spawn } from 'node:child_process';

/** The largest picture that is ever handed to the decoder: it allocates the whole bitmap on load (about 100 MB here). */
export const IMAGE_MAX_PIXELS = 25_000_000, IMAGE_MAX_SIDE = 10_000;

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

/** A declared size the decoder is never given: a small file can declare a huge picture. */
export const overPixelLimits = (p: { width: number; height: number }) => p.width > IMAGE_MAX_SIDE || p.height > IMAGE_MAX_SIDE || p.width * p.height > IMAGE_MAX_PIXELS;

/** The picture is why the decode gave nothing: the child crashed on it, ran out of time, or could not load or draw it. */
export class ImageRefused extends Error {
  constructor(public reason: 'crashed' | 'timed_out' | 'too_much_output' | 'no_answer' | 'not_loaded' | 'work_failed') { super('The picture was refused by the decoder: ' + reason); this.name = 'ImageRefused'; }
}

export interface DecodeLimits { /** How long the child may live before it is stopped. */ timeoutMs: number; /** The most bytes it may answer with. */ maxOutput: number }

// The child process: plain JavaScript run with `node -e`, so it needs no file on disk and no build step. It reads the
// picture from stdin, decodes it, runs the caller's work on the decoded image, and answers on stdout with a 4-byte
// length, a JSON envelope ({ head } from the work, or { fault } from this script) and whatever bytes the work
// attached. Only the first answer counts.
const child = (work: string) => `
const o = JSON.parse(process.argv[1]);
const chunks = [];
let answered = false;
const answer = (envelope, data) => {
  if (answered) return; answered = true;
  const json = Buffer.from(JSON.stringify(envelope)); const length = Buffer.alloc(4); length.writeUInt32BE(json.length);
  process.stdout.write(Buffer.concat(data ? [length, json, data] : [length, json]), () => process.exit(0));
};
const reply = (head, data) => answer({ head }, data);
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', async () => {
  let createCanvas, loadImage, img;
  try { ({ createCanvas, loadImage } = require('@napi-rs/canvas')); } catch (e) { return answer({ fault: 'unavailable' }); }
  try { img = await loadImage(Buffer.concat(chunks)); } catch (e) { return answer({ fault: 'not_loaded' }); }
  try {
${work}
  } catch (e) { answer({ fault: 'work_failed' }); }
});
`;

function runChild(body: Buffer, work: string, options: unknown, limits: DecodeLimits): Promise<{ head: any; data: Buffer }> {
  return new Promise((resolve, reject) => {
    const refuse = (reason: ImageRefused['reason']) => reject(new ImageRefused(reason));
    const unavailable = (why: string) => reject(new Error('The picture decoder could not run: ' + why));
    let proc: ReturnType<typeof spawn>;
    try { proc = spawn(process.execPath, ['-e', child(work), JSON.stringify(options ?? {})], { cwd: process.cwd(), env: { PATH: process.env.PATH || '', NODE_ENV: process.env.NODE_ENV }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }); }
    catch (error: any) { unavailable(error?.message || 'spawn failed'); return; }
    const out: Buffer[] = []; let size = 0; let late = false;
    const timer = setTimeout(() => { late = true; proc.kill('SIGKILL'); }, limits.timeoutMs);
    proc.stdout!.on('data', (chunk: Buffer) => { size += chunk.length; if (size > limits.maxOutput) proc.kill('SIGKILL'); else out.push(chunk); });
    proc.stdin!.on('error', () => { /* the child ended before it read everything */ });
    proc.on('error', error => { clearTimeout(timer); unavailable(error?.message || 'spawn failed'); });
    proc.on('close', (status, signal) => {
      clearTimeout(timer);
      if (size > limits.maxOutput) { refuse('too_much_output'); return; }
      if (status !== 0 || signal) { refuse(late ? 'timed_out' : 'crashed'); return; }
      let envelope: any; let data: Buffer;
      try { const all = Buffer.concat(out); const length = all.readUInt32BE(0); envelope = JSON.parse(all.toString('utf8', 4, 4 + length)); data = all.subarray(4 + length); }
      catch { refuse('no_answer'); return; }
      if (envelope?.fault === 'unavailable') { unavailable('the canvas library did not load'); return; }
      if (envelope?.fault === 'not_loaded' || envelope?.fault === 'work_failed') { refuse(envelope.fault); return; }
      if (!envelope || typeof envelope.head !== 'object' || envelope.head === null) { refuse('no_answer'); return; }
      resolve({ head: envelope.head, data });
    });
    proc.stdin!.end(body);
  });
}

// One picture is decoded at a time, whoever asks: the worst case is about 100 MB of pixels, and the web process decodes too.
let decoding: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = decoding.then(work, work);
  decoding = run.catch(() => {});
  return run;
}

/** Decode `body` in a child process and run `work` there on the decoded image.
 *  `work` is JavaScript source, run after loadImage succeeded, with `img` (the decoded image), `o` (`options`, parsed),
 *  `createCanvas` and `reply(head, data?)` in scope; it answers once, with a JSON-able object and optionally a Buffer.
 *  It must be a constant written in this repository, and `options` must hold nothing taken from the picture or from
 *  anything fetched: both travel in the child's arguments. The picture itself goes in on stdin only. Check the
 *  picture with probeImage and overPixelLimits before calling this.
 *  Rejects with ImageRefused for every way the picture can make the child fail: it crashed or exited badly, it ran
 *  past `timeoutMs` and was stopped, it wrote more than `maxOutput`, its answer makes no sense, or loadImage or `work`
 *  threw. A child that cannot be started, or cannot load the canvas library, is not the picture's fault: that is a
 *  plain Error. The child gets no secrets: its environment is PATH and NODE_ENV alone.
 *  Calls wait their turn; the time limit starts when the child does. */
export function decodeInChild(body: Buffer, work: string, options: unknown, limits: DecodeLimits): Promise<{ head: any; data: Buffer }> {
  return oneAtATime(() => runChild(body, work, options, limits));
}
