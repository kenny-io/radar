// Images for social posting (architecture.md §10): the real file's size, type and pixels, the platform checks, and
// Compress images (re-encode to JPEG so it fits). Never compresses at send time — a send that fails a check fails as `media`.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { IMAGE_TYPES, LINKEDIN_MAX_PIXELS, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, type PostPlatform } from '@/lib/socialPublish';
import type { MediaMeta } from '@/lib/types';
import { objectKey, putObject, readObjectBytes, readStored, storedKey } from '../../storage';

/** MIME type from the file's first bytes (what the platform will see), else the stored content type. */
export function sniffType(b: Buffer, fallback = 'application/octet-stream'): string {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  if (b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm';
  return fallback.split(';')[0].trim();
}
export interface ImageFile { bytes: Buffer; type: string; meta: MediaMeta }
export async function readImage(url: string, bid?: string): Promise<ImageFile | null> {
  const f = await (bid ? readStored(bid, url) : readObjectBytes(url));
  if (!f) return null;
  const type = sniffType(f.body, f.type);
  return { bytes: f.body, type, meta: { bytes: f.body.length, type } };
}
export async function metaOf(url: string): Promise<MediaMeta | null> { return (await readImage(url))?.meta ?? null; }
async function pixels(b: Buffer): Promise<number | null> { try { const i = await loadImage(b); return i.width * i.height; } catch { return null; } }

/** Why this file can't go to the platform as is (size, format, LinkedIn's pixel limit), or null. */
export async function mediaProblem(k: PostPlatform, f: ImageFile): Promise<string | null> {
  if (f.bytes.length > MAX_IMAGE_BYTES) return `too big (${f.bytes.length} bytes)`;
  if (!IMAGE_TYPES[k].includes(f.type)) return `format ${f.type}`;
  if (k === 'linkedin') { const px = await pixels(f.bytes); if (px != null && px >= LINKEDIN_MAX_PIXELS) return `too many pixels (${px})`; }
  return null;
}

const MAX_SIDE = 2400;
/** Re-encode as JPEG: longest side ≤ 2400 px and under LinkedIn's pixel limit, quality 85 → 75 → 65 until it's under 5 MB. */
export async function compressBytes(b: Buffer): Promise<Buffer> {
  const img = await loadImage(b);
  let s = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  if (img.width * img.height * s * s >= LINKEDIN_MAX_PIXELS) s = Math.sqrt((LINKEDIN_MAX_PIXELS - 1) / (img.width * img.height));
  const w = Math.max(1, Math.floor(img.width * s)), h = Math.max(1, Math.floor(img.height * s));
  const c = createCanvas(w, h); const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); // JPEG has no alpha
  ctx.drawImage(img, 0, 0, w, h);
  let out = c.toBuffer('image/jpeg', 85);
  for (const q of [75, 65]) { if (out.length <= MAX_IMAGE_BYTES) break; out = c.toBuffer('image/jpeg', q); }
  return out;
}
/** Compress one stored image if it fails the platform's checks. Returns the new url + meta, or null when it already fits. */
export async function compressIfNeeded(bid: string, k: PostPlatform, url: string): Promise<{ url: string; meta: MediaMeta } | null> {
  if (!storedKey(bid, url)) return null;
  const f = await readImage(url, bid);
  if (!f || !(await mediaProblem(k, f))) return null;
  const out = await compressBytes(f.bytes);
  const nu = await putObject(objectKey(bid, 'social', 'jpg'), out, 'image/jpeg');
  return { url: nu, meta: { bytes: out.length, type: 'image/jpeg' } };
}

/** Trust actual video signatures and size, never a client filename or declared MIME type. */
export function videoMeta(bytes: Buffer): MediaMeta | null {
  if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) return null;
  const type = sniffType(bytes, 'application/octet-stream');
  const valid = type === 'video/mp4' ? validMp4(bytes) : type === 'video/webm' ? validWebm(bytes) : false;
  return valid ? { bytes: bytes.length, type } : null;
}

/** Read container duration from stored bytes. No client-supplied duration is trusted. */
export function videoDuration(bytes: Buffer): number | undefined {
  const good = (n: number) => Number.isFinite(n) && n > 0 && n < 365 * 86400 ? n : undefined;
  if (sniffType(bytes) === 'video/mp4') {
    const atoms = (start: number, end: number, depth = 0): number | undefined => {
      if (depth > 8) return undefined;
      for (let p = start; p + 8 <= end;) {
        let size = bytes.readUInt32BE(p); let header = 8;
        if (size === 1) { if (p + 16 > end) break; const big = bytes.readBigUInt64BE(p + 8); if (big > BigInt(end - p)) break; size = Number(big); header = 16; }
        if (!size) size = end - p;
        if (size < header || p + size > end) break;
        const type = bytes.toString('ascii', p + 4, p + 8); const d = p + header;
        if (type === 'moov') { const n = atoms(d, p + size, depth + 1); if (n) return n; }
        if (type === 'mvhd' && d + 20 <= p + size) {
          const v1 = bytes[d] === 1; const scaleAt = d + (v1 ? 20 : 12), durationAt = d + (v1 ? 24 : 16);
          if (durationAt + (v1 ? 8 : 4) <= p + size) {
            const scale = bytes.readUInt32BE(scaleAt);
            const duration = v1 ? Number(bytes.readBigUInt64BE(durationAt)) : bytes.readUInt32BE(durationAt);
            if (scale) return good(duration / scale);
          }
        }
        p += size;
      }
    };
    return atoms(0, bytes.length);
  }
  if (sniffType(bytes) !== 'video/webm') return undefined;
  const vint = (p: number, id = false): { value: number; length: number; unknown: boolean } | null => {
    if (p >= bytes.length || !bytes[p]) return null;
    let length = 1; for (let mask = 128; length <= 8 && !(bytes[p] & mask); mask >>= 1) length++;
    if (length > (id ? 4 : 8) || p + length > bytes.length) return null;
    let value = id ? bytes[p] : bytes[p] & (255 >> length); let unknown = !id && value === (255 >> length);
    for (let i = 1; i < length; i++) { value = value * 256 + bytes[p + i]; unknown = unknown && bytes[p + i] === 255; }
    return { value, length, unknown };
  };
  let scale = 1_000_000; let duration: number | undefined;
  const elements = (start: number, end: number, depth: number) => {
    for (let p = start; p < end && depth < 4;) {
      const id = vint(p, true); const len = id && vint(p + id.length); if (!id || !len) break;
      const d = p + id.length + len.length; const finish = len.unknown ? end : d + len.value;
      if (finish > end || finish <= p) break;
      if (id.value === 0x18538067 || id.value === 0x1549a966) elements(d, finish, depth + 1);
      if (id.value === 0x2ad7b1 && len.value <= 6) { scale = 0; for (let j = d; j < finish; j++) scale = scale * 256 + bytes[j]; }
      if (id.value === 0x4489 && (len.value === 4 || len.value === 8)) duration = len.value === 4 ? bytes.readFloatBE(d) : bytes.readDoubleBE(d);
      p = finish;
    }
  };
  elements(0, bytes.length, 0);
  return duration == null ? undefined : good(duration * scale / 1e9);
}


/** Structural container checks distinguish video from HEIC/AVIF and arbitrary magic bytes. */
function validMp4(b: Buffer): boolean {
  const imageBrands = new Set(['avif', 'avis', 'heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);
  const videoBrands = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ']);
  let brand = false, data = false, video = false;
  const walk = (start: number, end: number, path: string[], depth: number): boolean => {
    if (depth > 8) return false;
    for (let p = start; p < end;) {
      if (p + 8 > end) return false;
      let n = b.readUInt32BE(p), h = 8;
      if (n === 1) { if (p + 16 > end) return false; const large = b.readBigUInt64BE(p + 8); if (large > BigInt(end - p)) return false; n = Number(large); h = 16; }
      if (!n) n = end - p;
      if (n < h || p + n > end) return false;
      const type = b.toString('ascii', p + 4, p + 8), d = p + h;
      if (type === 'ftyp' && !path.length) {
        if (n < h + 8 || (n - h) % 4) return false;
        const major = b.toString('ascii', d, d + 4);
        if (imageBrands.has(major)) return false;
        brand = videoBrands.has(major);
        for (let j = d + 8; j + 4 <= p + n; j += 4) brand ||= videoBrands.has(b.toString('ascii', j, j + 4));
      }
      if (type === 'mdat' && !path.length && n > h) data = true;
      if (type === 'hdlr' && path.join('/') === 'moov/trak/mdia' && n >= h + 12 && b.toString('ascii', d + 8, d + 12) === 'vide') video = true;
      if (['moov', 'trak', 'mdia'].includes(type) && !walk(d, p + n, [...path, type], depth + 1)) return false;
      p += n;
    }
    return true;
  };
  return walk(0, b.length, [], 0) && brand && data && video && !!videoDuration(b);
}
function validWebm(b: Buffer): boolean {
  let webm = false, video = false, codec = false, cluster = false;
  const vint = (p: number, id: boolean): { n: number; h: number; unknown: boolean } | null => {
    if (p >= b.length || !b[p]) return null;
    let h = 1; for (let m = 128; h <= 8 && !(b[p] & m); m >>= 1) h++;
    if (h > (id ? 4 : 8) || p + h > b.length) return null;
    let n = id ? b[p] : b[p] & (255 >> h), unknown = !id && n === (255 >> h);
    for (let j = 1; j < h; j++) { n = n * 256 + b[p + j]; unknown &&= b[p + j] === 255; }
    return { n, h, unknown };
  };
  const walk = (start: number, end: number, parent: number, depth: number): boolean => {
    if (depth > 5) return false;
    for (let p = start; p < end;) {
      const id = vint(p, true), len = id && vint(p + id.h, false); if (!id || !len) return false;
      const d = p + id.h + len.h, finish = len.unknown ? end : d + len.n;
      if (finish > end || finish <= p) return false;
      if (id.n === 0x4282 && parent === 0x1a45dfa3 && b.toString('ascii', d, finish) === 'webm') webm = true;
      if (id.n === 0x83 && parent === 0xae && len.n === 1 && b[d] === 1) video = true;
      if (id.n === 0x86 && parent === 0xae && ['V_VP8', 'V_VP9', 'V_AV1'].includes(b.toString('ascii', d, finish))) codec = true;
      if (id.n === 0x1f43b675 && parent === 0x18538067 && finish > d) cluster = true;
      if ([0x1a45dfa3, 0x18538067, 0x1654ae6b, 0xae].includes(id.n) && !walk(d, finish, id.n, depth + 1)) return false;
      p = finish;
    }
    return true;
  };
  return walk(0, b.length, 0, 0) && webm && video && codec && cluster;
}
