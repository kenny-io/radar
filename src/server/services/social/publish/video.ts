import { COPY, MAX_VIDEO_BYTES, mediaGenerationPending, packSid } from '@/lib/socialPublish';
import { isCustomPack } from '@/lib/customPost';
import { RadarError, notFound } from '../../../errors';
import type { BizRow } from '../../../workspace';
import { bump } from '../../../workspace';
import { getPack, updatePack } from '../generate';
import { objectKey, putObject } from '../../storage';
import { pubState } from './guards';
import { videoMeta, videoDuration } from './media';

export const VIDEO_PLATFORMS = ['instagram', 'tiktok', 'youtube'] as const;
export type VideoPlatform = typeof VIDEO_PLATFORMS[number];
export async function assertVideoEditable(biz: Pick<BizRow, 'id' | 'ownerId'>, packId: string, platform: VideoPlatform) {
  const state = await pubState(biz, packSid(packId, platform));
  if (state?.pub.status === 'posted') throw new RadarError(COPY.alreadyPosted, 409, 'posted');
  if (state?.locked) throw new RadarError(COPY.lockedEdit, 409, 'locked');
}
export async function attachVideo(biz: BizRow, packId: string, platform: VideoPlatform, bytes: Buffer) {
  const pack = await getPack(biz.id, packId);
  if (!pack?.posts[platform]) throw notFound('Post');
  if (mediaGenerationPending(pack.posts[platform]!)) throw new RadarError('Finish or cancel explainer generation before replacing the video.', 409, 'media_pending');
  await assertVideoEditable(biz, packId, platform);
  const meta = videoMeta(bytes);
  if (!meta) throw new RadarError(`Upload a valid MP4 or WebM video smaller than ${MAX_VIDEO_BYTES / 1024 / 1024} MB.`, 400, 'invalid_video');
  if (platform === 'instagram' && meta.type !== 'video/mp4') throw new RadarError('Instagram reels need an MP4 video.', 400, 'invalid_video');
  const url = await putObject(objectKey(biz.id, 'social-video', meta.type === 'video/mp4' ? 'mp4' : 'webm'), bytes, meta.type);
  const video = { url, meta, durationSec: videoDuration(bytes) };
  await updatePack(biz.id, packId, async p => {
    await assertVideoEditable(biz, packId, platform);
    const post = p.posts[platform]; if (!post) throw notFound('Post');
    if (mediaGenerationPending(post)) throw new RadarError('Finish or cancel explainer generation before replacing the video.', 409, 'media_pending');
    const publishOptions = post.publishOptions?.tiktok ? { ...post.publishOptions, tiktok: { ...post.publishOptions.tiktok, consent: false } } : post.publishOptions;
    // Custom packs: the video replaces the user's image too, so removing the video never brings back an older image.
    return { ...p, posts: { ...p.posts, [platform]: { ...post, ...(isCustomPack(p) ? { imageUrl: null, imageMeta: null, compressed: false, photo: false } : {}), video, slides: null, mediaGeneration: null, mediaRecommendation: null, generatedMedia: undefined, mediaRevision: (post.mediaRevision || 0) + 1, publishOptions } } };
  });
  await bump(biz.id);
  return video;
}

/** Multipart parsing bounded to `max` bytes even when Content-Length is omitted or forged. */
export async function boundedForm(req: Request, max: number, copy: { tooLarge: string; invalid: string; invalidCode: string }): Promise<FormData> {
  if (Number(req.headers.get('content-length')) > max) throw new RadarError(copy.tooLarge, 413, 'too_large');
  const reader = req.body?.getReader(); if (!reader) throw new RadarError(copy.invalid, 400, copy.invalidCode);
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > max) { await reader.cancel(); throw new RadarError(copy.tooLarge, 413, 'too_large'); }
    chunks.push(part.value);
  }
  try { return await new Response(Buffer.concat(chunks), { headers: { 'content-type': req.headers.get('content-type') || '' } }).formData(); }
  catch { throw new RadarError(copy.invalid, 400, copy.invalidCode); }
}
/** Multipart parsing is bounded even when Content-Length is omitted or forged. */
export const videoForm = (req: Request): Promise<FormData> =>
  boundedForm(req, MAX_VIDEO_BYTES + 64 * 1024, { tooLarge: 'Upload a video smaller than 100 MB.', invalid: 'Choose a video to upload.', invalidCode: 'invalid_video' });
