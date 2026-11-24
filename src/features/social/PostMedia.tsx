'use client';
// The user's own media on a custom post (design.md §4). Images: POST /api/b/[bid]/social-image (not flag-gated, D2) and
// social.imageRemove. Video (Instagram, TikTok, YouTube, publishing on only): the existing /social-video route and
// social.videoRemove — the control removed in d6106456 (VideoAttachment), back for custom packs only (D4).
// The server is authoritative on every check; the client checks here only give instant feedback.
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, Icon, Modal } from '@/components/ui';
import { plat } from '@/lib/constants';
import { UPLOAD_IMAGE_TYPES, storedImageType } from '@/lib/customPost';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from '@/lib/socialPublish';
import type { Platform, SocialPack, SocialPost } from '@/lib/types';

export const VIDEO_PLATS: Platform[] = ['instagram', 'tiktok', 'youtube'];
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
const TYPE_NAME: Record<string, string> = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP' };
export const LOCKED_TITLE = 'It’s too close to send time to change now.';
const IMAGE_FAIL = 'Radar couldn’t upload this image. Try again.';
const VIDEO_FAIL = 'Radar couldn’t upload this video. Try again.';

/** The hint under Upload image, from the stored-type contract (so it can't drift from what the server keeps). */
export function imageHint(k: Platform): string {
  const converted = UPLOAD_IMAGE_TYPES[k].filter(t => t !== 'image/jpeg' && storedImageType(k, t) !== t).map(t => TYPE_NAME[t] || t);
  const others = UPLOAD_IMAGE_TYPES[k].filter(t => t !== 'image/jpeg');
  return ['JPG, PNG or WebP, up to 5 MB.', converted.length && converted.length === others.length ? 'Saved as JPG.' : converted.length ? `${converted.join(' and ')} images are saved as JPG.` : '', k === 'instagram' ? 'Between 4:5 portrait and 1.91:1 landscape.' : ''].filter(Boolean).join(' ');
}
/** Instant client-side refusal (null = send it; the server decides). An empty `file.type` is the server's call. */
export function imageProblem(k: Platform, file: { size: number; type: string }): string | null {
  if (file.size > MAX_IMAGE_BYTES) return 'Choose an image smaller than 5 MB.';
  if (file.type && !UPLOAD_IMAGE_TYPES[k].includes(file.type)) return 'Choose a JPG, PNG or WebP image.';
  return null;
}
export function videoProblem(k: Platform, file: { size: number; type: string }): string | null {
  if (file.size > MAX_VIDEO_BYTES) return 'Choose a video under 100 MB.';
  if (file.type && !(k === 'instagram' ? ['video/mp4'] : ['video/mp4', 'video/webm']).includes(file.type)) return k === 'instagram' ? 'Instagram reels need an MP4 video.' : 'Choose an MP4 or WebM video.';
  return null;
}
/** The empty media tile's copy. */
export function emptyMediaLine(k: Platform, publishing: boolean): string {
  if (k === 'youtube') return publishing ? 'Add a video to post here' : 'No video · copy the description into YouTube';
  if (publishing && (k === 'instagram' || k === 'tiktok')) return 'Add an image or video to post here';
  return 'No image · text-only post';
}

/** Left-column preview: the uploaded video or image, or a dashed empty tile. The previous media stays while uploading. */
export function MediaPreview({ k, post, busy, active }: { k: Platform; post: SocialPost; busy?: boolean; active: boolean }) {
  const { B } = useApp(); const pubOn = !!B?.social.publishing; const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [post.imageUrl]);
  const l = plat(k).l;
  const style: React.CSSProperties = { opacity: busy ? .55 : 1, transition: 'opacity .3s' };
  if (post.video) return <video controls={active} preload="metadata" src={post.video.url} style={{ ...style, width: '100%', maxHeight: 600, borderRadius: 12, background: '#111' }} aria-label={`${l} video preview`} />;
  if (post.imageUrl && !failed) return <img src={post.imageUrl} alt={`Your image for ${l}`} onError={() => setFailed(true)} style={{ ...style, display: 'block', width: '100%', maxHeight: 600, objectFit: 'contain', borderRadius: 12, background: 'var(--fill)' }} />;
  return <div className="pm-empty xs sub" style={style}><Icon n={post.imageUrl ? 'alert' : k === 'youtube' ? 'play' : 'image'} s={22} /><span>{post.imageUrl ? 'Image preview unavailable' : emptyMediaLine(k, pubOn)}</span></div>;
}

/** Right-column media controls ("Media · {Platform}"). Hidden for Viewers; disabled while locked or posted. */
export function PostMedia({ pack, k, post, disabled, uploading, onBusy }: { pack: SocialPack; k: Platform; post: SocialPost; disabled?: string; /** An upload for this platform is still running (it may have started before a tab switch). */ uploading?: boolean; onBusy: (busy: boolean) => void }) {
  const app = useApp(); const B = app.B!; const pubOn = !!B.social.publishing; const l = plat(k).l;
  const imgIn = useRef<HTMLInputElement>(null); const vidIn = useRef<HTMLInputElement>(null);
  const [busy, setBusyState] = useState<'' | 'image' | 'video' | 'remove'>(''); const [error, setError] = useState(''); const [ask, setAsk] = useState(false);
  const setBusy = (b: typeof busy) => { setBusyState(b); onBusy(!!b); };
  useEffect(() => { setError(''); }, [k]);
  const imageOk = UPLOAD_IMAGE_TYPES[k].length > 0; const videoOk = pubOn && VIDEO_PLATS.includes(k);
  if (B.role === 'Viewer' || (!imageOk && !videoOk)) return null;
  const off = !!disabled || !!busy || !!uploading;
  const reset = () => { if (imgIn.current) imgIn.current.value = ''; if (vidIn.current) vidIn.current.value = ''; };

  const upload = async (kind: 'image' | 'video', file?: File) => {
    if (!file) return;
    setError('');
    const problem = kind === 'image' ? imageProblem(k, file) : videoProblem(k, file);
    if (problem) { setError(problem); reset(); return; }
    setBusy(kind);
    try {
      await app.flushLater();
      const data = new FormData(); data.set('packId', pack.id); data.set('platform', k); data.set('file', file);
      const r = await fetch(`/api/b/${app.bid}/social-${kind}`, { method: 'POST', body: data, credentials: 'same-origin' });
      let result: any = null; try { result = await r.json(); } catch { /* a proxy page, not Radar's reply */ }
      if (!r.ok || !result || result.ok === false) throw new Error(result?.error || (r.status === 413 ? (kind === 'image' ? 'Choose an image smaller than 5 MB.' : 'Choose a video under 100 MB.') : kind === 'image' ? IMAGE_FAIL : VIDEO_FAIL));
      // refresh() replaces the workspace without waiting for pending autosaves: send them first, or text typed during the
      // upload would snap back to the server copy.
      await app.flushLater(); await app.refresh(); app.toast(kind === 'image' ? `Image added to ${l}` : `Video added to ${l}`, { tone: 'ok' });
    } catch (e: any) { setError(e?.message || (kind === 'image' ? IMAGE_FAIL : VIDEO_FAIL)); }
    finally { setBusy(''); reset(); }
  };
  const remove = async (kind: 'image' | 'video') => {
    setError(''); setBusy('remove');
    try { await app.flushLater(); await app.act(kind === 'image' ? 'social.imageRemove' : 'social.videoRemove', { packId: pack.id, platform: k }, { silent: true }); }
    catch (e: any) { setError(e?.message || 'Radar couldn’t remove it. Try again.'); }
    finally { setBusy(''); }
  };
  const pickImage = () => { if (post.video) setAsk(true); else imgIn.current?.click(); };

  return <section className="col" aria-label={`Media for ${l}`} style={{ gap: 12 }}>
    <span className="small" style={{ fontWeight: 500 }}>Media · {l}</span>
    {imageOk && <div className="col" style={{ gap: 8 }}>
      <input ref={imgIn} type="file" accept={IMAGE_ACCEPT} hidden tabIndex={-1} aria-label={`Upload image for ${l}`} disabled={off} onChange={e => upload('image', e.target.files?.[0])} />
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Btn icon="image" loading={busy === 'image'} disabled={off} title={disabled} onClick={pickImage}>{busy === 'image' ? 'Uploading…' : post.imageUrl && !post.video ? 'Replace image' : 'Upload image'}</Btn>
        {post.imageUrl && !post.video && <Btn kind="ghost" icon="trash" disabled={off} title={disabled} onClick={() => remove('image')}>Remove image</Btn>}
      </div>
      <span className="xs sub">{imageHint(k)}</span>
    </div>}
    {videoOk && <div className="col" style={{ gap: 8 }}>
      <input ref={vidIn} type="file" accept={k === 'instagram' ? 'video/mp4,.mp4' : 'video/mp4,video/webm,.mp4,.webm'} hidden tabIndex={-1} aria-label={`Upload video for ${l}`} disabled={off} onChange={e => upload('video', e.target.files?.[0])} />
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Btn icon="upload" loading={busy === 'video'} disabled={off} title={disabled} onClick={() => vidIn.current?.click()}>{busy === 'video' ? 'Uploading…' : post.video ? 'Replace video' : 'Upload video'}</Btn>
        {post.video && <Btn kind="ghost" icon="trash" disabled={off} title={disabled} onClick={() => remove('video')}>Remove video</Btn>}
      </div>
      <span className="xs sub">{post.video ? `Video attached · ${(post.video.meta.bytes / 1024 / 1024).toFixed(1)} MB. ` : ''}{k === 'instagram' ? 'MP4, up to 100 MB. Instagram posts it as a Reel.' : 'MP4 or WebM, up to 100 MB.'}</span>
    </div>}
    <span role="status" className="xs sub">{busy === 'image' || busy === 'video' ? `Uploading your ${busy} for ${l}…` : busy === 'remove' ? 'Removing…' : ''}</span>
    {error && <span className="xs" role="alert" style={{ color: 'var(--bad)' }}>{error}</span>}
    <Modal open={ask} onClose={() => setAsk(false)} width={420} focus label="Replace the video with this image?"><div className="col" style={{ padding: 28, gap: 14 }}>
      <h2 className="h2">Replace the video with this image?</h2>
      <p className="sub small">{`${l} posts one or the other. The video is removed when the image is saved.`}</p>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}><Btn kind="ghost" data-autofocus onClick={() => setAsk(false)}>Keep the video</Btn><Btn kind="primary" onClick={() => { setAsk(false); imgIn.current?.click(); }}>Choose an image</Btn></div>
    </div></Modal>
  </section>;
}
