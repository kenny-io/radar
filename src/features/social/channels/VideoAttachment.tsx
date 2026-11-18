'use client';
import React, { useRef, useState } from 'react';
import { useApp } from '@/client/app';
import { Btn } from '@/components/ui';
import type { Platform, SocialPost } from '@/lib/types';

/** Uploads the actual video, rather than treating a generated still as a video post. */
export function VideoAttachment({ packId, platform, post, disabled, onBusy }: { packId: string; platform: Platform; post: SocialPost; disabled: boolean; onBusy: (busy: boolean) => void }) {
  const app = useApp(); const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  if (!['instagram', 'tiktok', 'youtube'].includes(platform)) return null;
  const upload = async (file?: File) => {
    if (!file) return;
    setError('');
    if (file.size > 100 * 1024 * 1024) { setError('Choose a video under 100 MB.'); return; }
    setBusy(true); onBusy(true);
    try {
      await app.flushLater();
      const data = new FormData(); data.set('packId', packId); data.set('platform', platform); data.set('file', file);
      const response = await fetch(`/api/b/${app.bid}/social-video`, { method: 'POST', body: data, credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.error || 'The video could not be uploaded. Try again.');
      await app.refresh(); app.toast('Video attached', { tone: 'ok' });
    } catch (e: any) { setError(e.message || 'The video could not be uploaded. Try again.'); }
    finally { setBusy(false); onBusy(false); if (input.current) input.current.value = ''; }
  };
  return <div className="col" style={{ gap: 10 }}>
    <span className="small" style={{ fontWeight: 500 }}>{platform === 'youtube' ? 'YouTube video' : 'Video attachment'}</span>
    <p className="xs sub">{platform === 'youtube' ? 'Upload your video to publish to YouTube. The generated image is a preview only.' : platform === 'instagram' ? 'Publish the image to your feed, or attach a video to publish a Reel.' : 'Publish the image as a photo post, or attach your own video.'} MP4 or WebM, up to 100 MB{platform === 'instagram' ? ' (Reels require MP4)' : ''}.</p>
    {post.video && <span className="xs sub">Video attached · {(post.video.meta.bytes / 1024 / 1024).toFixed(1)} MB</span>}
    <input ref={input} type="file" accept={platform === 'instagram' ? 'video/mp4,.mp4' : 'video/mp4,video/webm,.mp4,.webm'} hidden aria-label="Upload video file" disabled={disabled || busy} onChange={e => upload(e.target.files?.[0])} />
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <Btn loading={busy} disabled={disabled} onClick={() => input.current?.click()}>{post.video ? 'Replace video' : 'Upload video'}</Btn>
      {post.video && <Btn kind="ghost" disabled={disabled || busy} onClick={async () => { setBusy(true); onBusy(true); try { await app.act('social.videoRemove', { packId, platform }); } catch { /* toasted */ } finally { setBusy(false); onBusy(false); } }}>Remove video</Btn>}
    </div>
    {error && <span className="xs" role="alert" style={{ color: 'var(--bad)' }}>{error}</span>}
  </div>;
}
