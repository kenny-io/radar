// Images for social posting (architecture.md §10): the real file's size, type and pixels, the platform checks, and
// Compress images (re-encode to JPEG so it fits). Never compresses at send time — a send that fails a check fails as `media`.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { IMAGE_TYPES, LINKEDIN_MAX_PIXELS, MAX_IMAGE_BYTES, type PostPlatform } from '@/lib/socialPublish';
import type { MediaMeta } from '@/lib/types';
import { objectKey, putObject, readObjectBytes } from '../../storage';

/** MIME type from the file's first bytes (what the platform will see), else the stored content type. */
export function sniffType(b: Buffer, fallback = 'application/octet-stream'): string {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return fallback.split(';')[0].trim();
}
export interface ImageFile { bytes: Buffer; type: string; meta: MediaMeta }
export async function readImage(url: string): Promise<ImageFile | null> {
  const f = await readObjectBytes(url);
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
  const f = await readImage(url);
  if (!f || !(await mediaProblem(k, f))) return null;
  const out = await compressBytes(f.bytes);
  const nu = await putObject(objectKey(bid, 'social', 'jpg'), out, 'image/jpeg');
  return { url: nu, meta: { bytes: out.length, type: 'image/jpeg' } };
}
