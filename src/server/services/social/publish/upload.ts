// Custom posts: the user's own image for one platform of a custom pack (.factory/custom-post-scheduling/architecture.md §5.2).
// The bytes are untrusted: the type is read from the bytes (never the filename or the declared type), the declared size is
// checked before any decode, and the picture is decoded and re-encoded only in a child process (untrustedImage.ts). Every
// later in-process read of the stored file sees only bytes Radar wrote: upright, without EXIF, in an allowlisted type.
// The previous media is kept on every refusal: the pack changes only after the new file is stored.
import { COPY, MAX_IMAGE_BYTES, canPost, mediaGenerationPending, packSid } from '@/lib/socialPublish';
import { UPLOAD_IMAGE_TYPES, isCustomPack, storedImageType } from '@/lib/customPost';
import type { MediaMeta, Platform } from '@/lib/types';
import { RadarError, notFound } from '../../../errors';
import { bump, type BizRow } from '../../../workspace';
import { track } from '../../../events';
import { getPack, updatePack, type StoredPack } from '../generate';
import { objectKey, putObject } from '../../storage';
import { ImageRefused, decodeInChild, overPixelLimits, probeImage } from '../../untrustedImage';
import { pubState } from './guards';
import { VIDEO_PLATFORMS, assertVideoEditable, boundedForm, type VideoPlatform } from './video';
import { discardUpload } from './uploadCleanup';

export const UPLOAD_COPY = {
  tooLarge: 'Choose an image smaller than 5 MB.',
  choose: 'Choose an image to upload.',
  youtube: 'YouTube posts use a video.',
  notCustom: 'Radar can only add your images to posts you wrote.',
  type: 'Choose a JPG, PNG or WebP image.',
  incomplete: 'That image file is incomplete. Export it again.',
  animated: 'Animated images aren’t supported yet. Use a still image.',
  pixels: 'That image is too large. Use one under 10,000 pixels on each side.',
  unreadable: 'Radar couldn’t read that image. Try another file.',
  ratio: 'Instagram images must be between 4:5 portrait and 1.91:1 landscape.',
  tooBigAfter: 'Radar couldn’t fit this image under 5 MB. Export a smaller file.',
} as const;
const invalid = (msg: string) => new RadarError(msg, 400, 'invalid_image');

/** The multipart body, bounded to 5 MB plus form overhead before anything is parsed. */
export const imageForm = (req: Request) => boundedForm(req, MAX_IMAGE_BYTES + 64 * 1024, { tooLarge: UPLOAD_COPY.tooLarge, invalid: UPLOAD_COPY.choose, invalidCode: 'invalid_image' });

/** Refuse a media change on a post that was posted or is locked (sends within 5 minutes). Copy-only platforms have no
 *  pub. No-op with publishing off (guards.ts). */
export async function assertMediaEditable(biz: Pick<BizRow, 'id' | 'ownerId'>, packId: string, k: Platform) {
  if ((VIDEO_PLATFORMS as readonly string[]).includes(k)) return assertVideoEditable(biz, packId, k as VideoPlatform);
  if (!canPost(k)) return;
  const s = await pubState(biz, packSid(packId, k));
  if (s?.pub.status === 'posted') throw new RadarError(COPY.alreadyPosted, 409, 'posted');
  if (s?.locked) throw new RadarError(COPY.lockedEdit, 409, 'locked');
}
/** The custom pack's post for `k`, or the refusal: 404 for a missing pack/post, 409 `not_custom` for a pack Radar wrote. */
export function customPost(p: StoredPack | null, k: Platform) {
  const q = p?.posts[k];
  if (!p || !q) throw notFound('Post');
  if (!isCustomPack(p)) throw new RadarError(UPLOAD_COPY.notCustom, 409, 'not_custom');
  return q;
}

/* ── Validation and re-encoding ── */

interface RecodeOptions { type: string; max: number; maxW: number; maxH: number; ratio?: [number, number]; short?: number; long?: number }
/** Per platform: Instagram feed images are JPEG at 4:5–1.91:1, at most 1440 wide; TikTok photos fit 1080 px on the short
 *  side; everything else fits 4096 × 4096. Only allowlisted constants (decodeInChild's contract). */
export function recodeOptions(k: Platform, inputType: string): RecodeOptions {
  const type = storedImageType(k, inputType);
  if (k === 'instagram') return { type, max: MAX_IMAGE_BYTES, maxW: 1440, maxH: 4096, ratio: [0.8, 1.91] };
  if (k === 'tiktok') return { type, max: MAX_IMAGE_BYTES, maxW: 1920, maxH: 1920, short: 1080, long: 1920 };
  return { type, max: MAX_IMAGE_BYTES, maxW: 4096, maxH: 4096 };
}
// Runs in the child, on the decoded image (loadImage applies EXIF orientation, so img.width/height are upright). Scales down,
// never up; JPEG is flattened onto white; a quality ladder keeps the file at most `o.max` bytes, falling back to JPEG when a
// PNG or WebP can't fit. Answers { w, h, type } plus the encoded bytes, or { code } for a refusal.
const RECODE = `
    const w = img.width, h = img.height;
    if (!(w > 0 && h > 0)) return reply({ code: 'empty' });
    if (o.ratio && (w / h < o.ratio[0] || w / h > o.ratio[1])) return reply({ code: 'ratio' });
    let maxW = o.maxW, maxH = o.maxH;
    if (o.short) { const portrait = h >= w; maxW = portrait ? o.short : o.long; maxH = portrait ? o.long : o.short; }
    const s = Math.min(1, maxW / w, maxH / h);
    const W = Math.max(1, Math.round(w * s)), H = Math.max(1, Math.round(h * s));
    const encode = type => {
      const canvas = createCanvas(W, H); const ctx = canvas.getContext('2d');
      if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); }
      ctx.drawImage(img, 0, 0, W, H);
      if (type === 'image/png') { const b = canvas.toBuffer('image/png'); return b.length <= o.max ? b : null; }
      for (const q of [92, 85, 75]) { const b = canvas.toBuffer(type, q); if (b.length <= o.max) return b; }
      return null;
    };
    let type = o.type, out = encode(type);
    if (!out && type !== 'image/jpeg') { type = 'image/jpeg'; out = encode(type); }
    if (!out) return reply({ code: 'too_big' });
    reply({ w: W, h: H, type }, out);
`;
const RECODE_LIMITS = { timeoutMs: 20_000, maxOutput: 8 * 1024 * 1024 };
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export interface Recoded { bytes: Buffer; type: 'image/jpeg' | 'image/png' | 'image/webp'; width: number; height: number }
/** Check the bytes, then decode and re-encode them in the child. Throws RadarError with user copy for every refusal. */
export async function recodeUpload(k: Platform, bytes: Buffer): Promise<Recoded> {
  if (k === 'youtube') throw new RadarError(UPLOAD_COPY.youtube, 400, 'invalid_image');
  if (bytes.length > MAX_IMAGE_BYTES) throw new RadarError(UPLOAD_COPY.tooLarge, 413, 'too_large');
  const probe = probeImage(bytes);
  if (!probe || !UPLOAD_IMAGE_TYPES[k].includes(probe.type)) throw invalid(UPLOAD_COPY.type);
  if (!probe.complete) throw invalid(UPLOAD_COPY.incomplete);
  if (probe.animated) throw invalid(UPLOAD_COPY.animated);
  if (!(probe.width > 0 && probe.height > 0) || overPixelLimits(probe)) throw invalid(UPLOAD_COPY.pixels);
  const opts = recodeOptions(k, probe.type);
  const { head, data } = await decodeInChild(bytes, RECODE, opts, RECODE_LIMITS)
    .catch(e => { throw e instanceof ImageRefused ? invalid(UPLOAD_COPY.unreadable) : e; });
  if (head.code === 'ratio') throw invalid(UPLOAD_COPY.ratio);
  if (head.code === 'too_big') throw invalid(UPLOAD_COPY.tooBigAfter);
  // The stored type is the one the output bytes are, and only one Radar asked for (the platform's, or the JPEG fallback).
  const made = probeImage(data);
  if (head.code || !made || !made.complete || made.animated || made.type !== head.type || (made.type !== opts.type && made.type !== 'image/jpeg')
    || made.width !== head.w || made.height !== head.h || data.length > MAX_IMAGE_BYTES) throw invalid(UPLOAD_COPY.unreadable);
  return { bytes: data, type: made.type, width: made.width, height: made.height };
}

/* ── Attach and remove ── */

export interface UploadedImage { url: string; meta: MediaMeta; width: number; height: number }
/** Validate, re-encode, store under `<bid>/social-upload/`, then attach under the pack's row lock (checks repeated inside). */
export async function attachImage(biz: BizRow, packId: string, k: Platform, bytes: Buffer, uid?: string | null): Promise<UploadedImage> {
  const fail = (code: string) => console.log(`[social] image upload refused: pack ${packId} ${k} ${code}`);
  try {
    if (k === 'youtube') throw new RadarError(UPLOAD_COPY.youtube, 400, 'invalid_image');
    customPost(await getPack(biz.id, packId), k);
    await assertMediaEditable(biz, packId, k);
    const r = await recodeUpload(k, bytes);
    const url = await putObject(objectKey(biz.id, 'social-upload', EXT[r.type]), r.bytes, r.type);
    const meta: MediaMeta = { bytes: r.bytes.length, type: r.type };
    // `previous` comes from the locked row, so two concurrent uploads each discard only what they replaced. `refused`: a
    // check inside the lock threw, the update rolled back, and the new file was never referenced.
    let previous = null as string | null; let refused = false as boolean;
    await updatePack(biz.id, packId, async p => {
      try {
        const post = customPost(p, k);
        await assertMediaEditable(biz, packId, k);
        if (mediaGenerationPending(post)) throw new RadarError('Finish or cancel explainer generation before replacing the image.', 409, 'media_pending');
        previous = post.imageUrl || null;
        const publishOptions = post.publishOptions?.tiktok ? { ...post.publishOptions, tiktok: { ...post.publishOptions.tiktok, consent: false } } : post.publishOptions;
        return { ...p, posts: { ...p.posts, [k]: { ...post, imageUrl: url, imageMeta: meta, compressed: false, photo: false, video: null, slides: null, generatedMedia: undefined, mediaGeneration: null, mediaRecommendation: null, mediaRevision: (post.mediaRevision || 0) + 1, publishOptions } } };
      } catch (e) { refused = true; throw e; }
    }).catch(async e => { if (refused || e?.notFound) await discardUpload(biz.id, packId, k, url); if (e?.notFound) throw notFound('Post'); throw e; });
    if (previous !== url) await discardUpload(biz.id, packId, k, previous);
    await bump(biz.id);
    await track('social.imageUploaded', { bid: biz.id, uid: uid || null, ref: packId, props: { platform: k, type: r.type, bytes: r.bytes.length, w: r.width, h: r.height } });
    return { url, meta, width: r.width, height: r.height };
  } catch (e) {
    if (e instanceof RadarError) fail(e.code);
    throw e;
  }
}
/** Remove the user's image from one platform of a custom pack. The caller (an action) bumps the revision. */
export async function removeImage(biz: BizRow, packId: string, k: Platform) {
  customPost(await getPack(biz.id, packId), k);
  await assertMediaEditable(biz, packId, k);
  let previous = null as string | null;
  await updatePack(biz.id, packId, async p => {
    const post = customPost(p, k);
    await assertMediaEditable(biz, packId, k);
    previous = post.imageUrl || null;
    const publishOptions = post.publishOptions?.tiktok ? { ...post.publishOptions, tiktok: { ...post.publishOptions.tiktok, consent: false } } : post.publishOptions;
    return { ...p, posts: { ...p.posts, [k]: { ...post, imageUrl: null, imageMeta: null, compressed: false, photo: false, mediaRevision: (post.mediaRevision || 0) + 1, publishOptions } } };
  }).catch(e => { if (e?.notFound) throw notFound('Post'); throw e; });
  await discardUpload(biz.id, packId, k, previous);
  return { removed: true as const };
}
