'use client';
import React, { useId, useRef, useState } from 'react';
import { Btn, Modal } from '@/components/ui';
import { VIDEO_STYLES, videoStylePreset, type VideoStyleId } from '@/lib/videoStyles';
import styles from './VideoStylePicker.module.css';

/** Selection and preview are presentation-only; callers explicitly save or generate. */
export function VideoStylePicker({ value, onChange, disabled = false, label = 'Video & slide style' }: { value: VideoStyleId; onChange: (value: VideoStyleId) => void; disabled?: boolean; label?: string }) {
  const name = useId(); const [preview, setPreview] = useState<VideoStyleId | null>(null); const [previewFailed, setPreviewFailed] = useState(false); const [playing, setPlaying] = useState(false); const player = useRef<HTMLVideoElement>(null);
  const closePreview = () => { player.current?.pause(); setPlaying(false); setPreview(null); };
  const togglePlayback = () => { const video = player.current; if (!video) return; setPreviewFailed(false); if (video.paused) video.play().catch(error => { if (error.name !== 'AbortError') setPreviewFailed(true); }); else video.pause(); };
  const sample = preview ? videoStylePreset(preview) : null;
  return <div className="col" style={{ gap: 10 }}>
    <div role="radiogroup" aria-label={label} className={styles.grid}>{VIDEO_STYLES.map(preset => <div key={preset.id} className={styles.card} data-selected={value === preset.id}>
      <label className={styles.choice}>
        <img src={preset.poster} alt="" loading="lazy" className={styles.poster} />
        <span className="row" style={{ gap: 8, alignItems: 'flex-start' }}><span className="small grow" style={{ fontWeight: 600 }}>{preset.label}</span><input type="radio" name={name} aria-label={preset.label} aria-describedby={`${name}-${preset.id}-description`} value={preset.id} checked={value === preset.id} disabled={disabled} onChange={() => onChange(preset.id)} onKeyDown={e => { if (e.key === 'Enter' && !disabled) { e.preventDefault(); onChange(preset.id); } }} /></span>
        <span id={`${name}-${preset.id}-description`} className="xs sub">{preset.description}</span>
      </label>
      <Btn size="sm" kind="link" aria-label={`Preview ${preset.label}`} onClick={() => { setPreviewFailed(false); setPlaying(false); setPreview(preset.id); }} style={{ alignSelf: 'flex-start', margin: '0 12px 12px' }}>Preview</Btn>
    </div>)}</div>
    <span className="xs sub">Preview or choose a style without starting generation. All videos use Brian narration.</span>
    <Modal open={!!sample} onClose={closePreview} label={sample ? `${sample.label} visual preview` : 'Visual preview'} width={460} focus><div className="col" onKeyDownCapture={e => { if (e.key === 'Escape') { e.stopPropagation(); closePreview(); } }} style={{ padding: 24, gap: 14 }}>
      <div className="row"><h3 className="h3 grow">{sample?.label}</h3><Btn kind="ghost" icon="x" aria-label="Close style preview" data-autofocus onClick={closePreview} /></div>
      {sample && <video key={sample.id} ref={player} id={`${name}-preview-video`} tabIndex={0} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setPreviewFailed(true)} controls muted playsInline preload="none" poster={sample.poster} src={sample.preview} aria-label={`${sample.label} sample`} style={{ width: '100%', aspectRatio: '9 / 16', maxHeight: '60vh', background: 'var(--surface)', borderRadius: 10 }} />}
      <div><Btn size="sm" kind="ghost" aria-controls={`${name}-preview-video`} onClick={togglePlayback}>{playing ? 'Pause sample' : 'Play sample'}</Btn></div>
      {previewFailed && <p role="status" className="small sub">This sample could not play. You can still choose the style for your next generated explanation.</p>}
      <p className="small sub">Visual preview · silent sample. Brian narration is the same across styles.</p>
    </div></Modal>
  </div>;
}
