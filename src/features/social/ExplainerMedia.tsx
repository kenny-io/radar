'use client';
import React, { useEffect, useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, downloadBlob, Field, Modal, Status } from '@/components/ui';
import { mediaGenerationPending } from '@/lib/socialPublish';
import type { ExplainerFormat, Platform, SocialPost, SocialSlide } from '@/lib/types';

export function CarouselPreview({ slides }: { slides: SocialSlide[] }) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [slides[0]?.url]);
  const i = Math.min(index, slides.length - 1); const slide = slides[i];
  if (!slide) return null;
  return <div className="col" role="region" aria-roledescription="carousel" aria-label="Explanatory slides" style={{ gap: 12 }} onKeyDown={e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setIndex(x => Math.max(0, x - 1)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setIndex(x => Math.min(slides.length - 1, x + 1)); }
  }} tabIndex={0}>
    <img src={slide.url} alt={slide.alt || `Explanatory slide ${i + 1}`} style={{ width: '100%', maxHeight: 680, objectFit: 'contain', borderRadius: 12, background: '#111' }} />
    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
      <Btn size="sm" disabled={i === 0} onClick={() => setIndex(i - 1)} aria-label="Previous slide">Previous</Btn>
      <span className="xs sub" aria-live="polite">Slide {i + 1} of {slides.length}</span>
      <Btn size="sm" disabled={i === slides.length - 1} onClick={() => setIndex(i + 1)} aria-label="Next slide">Next</Btn>
    </div>
    <div className="row" style={{ overflowX: 'auto', gap: 8, padding: 3 }} aria-label="Choose slide">{slides.map((s, n) => <button type="button" key={s.url} aria-label={`Show slide ${n + 1}`} aria-pressed={n === i} onClick={() => setIndex(n)} style={{ flex: '0 0 54px', borderRadius: 6, padding: 2, background: 'none', border: `2px solid ${n === i ? 'var(--ink)' : 'transparent'}`, cursor: 'pointer' }}><img src={s.url} alt="" style={{ width: '100%', display: 'block', borderRadius: 3 }} /></button>)}</div>
  </div>;
}

const stageLabel = (post: SocialPost) => {
  const g = post.mediaGeneration;
  if (!g) return '';
  if (g.stage === 'Explanation prepared') return 'Explanation prepared';
  if (g.status === 'preparing') return g.stage === 'mechanism_reviewed' || g.stage === 'clarity_reviewed' ? 'Checking accuracy and clarity' : 'Preparing explanation';
  return ({ queued: 'Queued', narrating: 'Recording Brian', rendering: 'Drawing and rendering', ready: 'Explainer ready', failed: 'Generation needs attention', needs_attention: 'Check narration before retrying', cancelled: 'Generation cancelled' } as Record<string, string>)[g.status] || 'Preparing explanation';
};

export function ExplainerMedia({ packId, platform, post, disabled }: { packId: string; platform: Platform; post: SocialPost; disabled: boolean }) {
  const app = useApp(); const viewer = app.B?.role === 'Viewer';
  const [notes, setNotes] = useState(''); const [dirty, setDirty] = useState(false);
  const [format, setFormat] = useState<ExplainerFormat | 'recommended'>(() => post.mediaGeneration?.overridden ? post.mediaGeneration.format : 'recommended');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [confirmRetry, setConfirmRetry] = useState(false);
  const [notesBusy, setNotesBusy] = useState<string | null>(null);
  const g = post.mediaGeneration; const recommendation = post.mediaRecommendation; const active = mediaGenerationPending(post);
  useEffect(() => { setNotes(''); setDirty(false); setFormat(post.mediaGeneration?.overridden ? post.mediaGeneration.format : 'recommended'); setError(''); }, [packId, platform]);
  useEffect(() => { if (post.mediaGeneration?.overridden) setFormat(post.mediaGeneration.format); }, [recommendation?.requestId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Reconcile persisted progress after reload, including workers finishing while the browser was away.
  useEffect(() => {
    if (!active) return;
    let inFlight = false;
    const iv = setInterval(async () => { if (inFlight) return; inFlight = true; try { await app.refresh(); } catch { /* existing state stays usable */ } finally { inFlight = false; } }, 3000);
    return () => clearInterval(iv);
  }, [active, packId, platform]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!['instagram', 'tiktok', 'youtube'].includes(platform) || (!app.B?.social.mediaGeneration && !g && !post.generatedMedia)) return null;
  const selected = platform === 'instagram' ? format === 'recommended' ? recommendation?.format || 'video' : format : 'video';
  const invoke = async (name: string, input: object) => {
    setBusy(true); setError('');
    try { await app.flushLater(); await app.act(name, input, { silent: true }); return true; }
    catch (e: any) { setError(e?.message || 'Radar couldn’t finish this request. Your previous media is kept.'); return false; }
    finally { setBusy(false); }
  };
  const generate = async () => {
    const sourceNotes = notes.trim();
    const ok = !recommendation || dirty
      ? await invoke('social.mediaPrepare', { packId, platforms: [platform], generateAfterPrepare: true, choices: [{ platform, format: platform === 'instagram' ? format : 'video' }], ...(sourceNotes ? { sourceNotes } : {}) })
      : await invoke('social.mediaGenerate', { packId, choices: [{ platform, format: selected }], requestId: recommendation.requestId, ...(sourceNotes ? { sourceNotes } : {}) });
    if (ok) setDirty(false);
  };
  const retry = async (acknowledgePossibleCharge = false) => { setConfirmRetry(false); if (g) await invoke('social.mediaRetry', { generationId: g.id, ...(acknowledgePossibleCharge ? { acknowledgePossibleCharge: true } : {}) }); };
  const downloadNotes = async (artifact: string) => {
    if (!post.generatedMedia || notesBusy) return;
    setNotesBusy(artifact); setError('');
    try {
      const result = await app.act<{ text: string; type: string; filename: string }>('social.mediaNotes', { generationId: post.generatedMedia.id, artifact }, { silent: true });
      downloadBlob(new Blob([result.text], { type: result.type }), result.filename);
    } catch (e: any) { setError(e?.message || 'Radar couldn’t download these notes. Try again.'); }
    finally { setNotesBusy(null); }
  };
  const blocked = disabled || viewer || busy || !app.B?.social.mediaGeneration;
  const hasMedia = !!post.video || !!post.slides?.length || !!post.imageUrl;
  const duration = Math.round(post.video?.durationSec || 0);
  return <section className="col" aria-label="Explainer media" style={{ gap: 12, borderBottom: '1px solid var(--line2)', paddingBottom: 22 }} aria-busy={busy}>
    <div className="row" style={{ gap: 12 }}><h3 className="small grow" style={{ fontWeight: 600 }}>Explainer media</h3>{post.generatedMedia && <span className="xs sub">AI generated</span>}</div>
    <p className="xs sub">Narrated diagrams with Brian, timed captions and a dark hand-drawn style. {platform === 'instagram' ? 'Radar can choose explanatory slides when the topic is easier to read at your own pace.' : 'Length follows the topic, up to 3 minutes.'} Radar generates the complete media for your posts. Review it, then choose when to publish.</p>
    {recommendation && <div className="col" style={{ gap: 5 }}><span className="small" style={{ fontWeight: 500 }}>Recommended: {recommendation.format === 'carousel' ? 'Explanatory slides' : 'Explainer video'}</span><p className="xs sub">{recommendation.reason}</p>{recommendation.format === 'video' && recommendation.estimatedSeconds > 0 && <span className="xs sub">About {recommendation.estimatedSeconds < 60 ? `${Math.ceil(recommendation.estimatedSeconds / 5) * 5} sec` : `${Math.ceil(recommendation.estimatedSeconds / 60)} min`} · Brian narration</span>}</div>}
    {platform === 'instagram' && <Field label="Format"><select className="input" aria-label="Explainer format" value={format} disabled={blocked || active} onChange={e => setFormat(e.target.value as typeof format)}><option value="recommended">Use Radar’s recommendation</option><option value="video">Explainer video</option><option value="carousel">Explanatory slides</option></select></Field>}
    {!viewer && app.B?.social.mediaGeneration && <Field label="Source details" hint="Optional. Add facts, steps or a source link that explain how this works. These details stay with this business; only the finished explanation is published."><textarea className="input" rows={3} maxLength={4000} value={notes} disabled={blocked || active} placeholder="What happens, why it happens, and what changes as a result…" onChange={e => { setNotes(e.target.value); setDirty(true); }} /></Field>}
    {g && <div className="col" role="status" aria-live="polite" style={{ gap: 6 }}><Status tone={g.status === 'failed' || g.status === 'needs_attention' ? 'warn' : g.status === 'ready' ? 'ok' : 'mute'} pulse={active}>{stageLabel(post)}</Status>
      {!app.B?.social.mediaGeneration && <span className="xs sub">New explainer generation is currently unavailable. Saved media remains available.</span>}
      {active && hasMedia && <span className="xs sub">Previous attachment shown until the replacement is ready. Posting waits for generation to finish or be cancelled.</span>}
      {g.progress && g.progress.total > 0 && <span className="xs sub">{g.progress.done} of {g.progress.total}</span>}
      {g.status === 'failed' && <span className="xs sub">{g.stage || 'Your previous media is kept. Add more source details or retry when the issue is resolved.'}</span>}
      {g.status === 'ready' && g.stage && !['Ready', 'Explanation prepared'].includes(g.stage) && <span className="xs sub">{g.stage}</span>}
      {g.status === 'needs_attention' && <span className="xs sub">Narration may have completed before the connection was interrupted. Radar has not requested it again. A new request may be billed.</span>}
    </div>}
    {post.generatedMedia && post.video && duration > 0 && <span className="xs sub">{Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')} · Brian narration · {(post.video.meta.bytes / 1024 / 1024).toFixed(1)} MB</span>}
    {!viewer && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {active && g ? <Btn size="sm" disabled={busy} onClick={() => invoke('social.mediaCancel', { packId, platform, requestId: g.requestId })}>Cancel generation</Btn> : <>
        {g?.status !== 'needs_attention' && <Btn kind="primary" disabled={blocked} loading={busy} onClick={g?.status === 'failed' && !dirty ? () => retry() : generate}>{g?.status === 'failed' && !dirty ? 'Retry generation' : post.generatedMedia ? 'Regenerate explainer' : platform === 'instagram' && format === 'recommended' ? 'Generate explainer' : selected === 'carousel' ? 'Generate slides' : 'Generate video'}</Btn>}
        {g?.status === 'needs_attention' && <Btn size="sm" disabled={blocked} onClick={() => setConfirmRetry(true)}>Review retry</Btn>}
      </>}
    </div>}
    {dirty && <span className="xs sub">Your updated source details will be used for the next generated explanation.</span>}
    {post.generatedMedia && <details className="small"><summary style={{ cursor: 'pointer' }}>Script and source notes</summary><div className="col" style={{ gap: 7, paddingTop: 10, alignItems: 'flex-start' }}>{['script', 'sources', 'storyboard', ...(post.generatedMedia.format === 'video' ? ['captions', 'alignment'] : [])].map(artifact => <Btn kind="link" size="sm" key={artifact} loading={notesBusy === artifact} disabled={notesBusy !== null} onClick={() => downloadNotes(artifact)}>{`Download ${artifact}`}</Btn>)}</div></details>}
    {error && <p role="alert" className="xs" style={{ color: 'var(--bad)' }}>{error}</p>}
    <Modal open={confirmRetry} onClose={() => setConfirmRetry(false)} label="Retry narration" width={440}><div className="col" style={{ padding: 28, gap: 16 }}><h2 className="h2">Request narration again?</h2><p className="small sub">The earlier request may already have been billed. Radar will reuse saved audio if available; otherwise this requests a new recording from ElevenLabs and may incur another charge.</p><div className="row" style={{ justifyContent: 'flex-end' }}><Btn kind="ghost" onClick={() => setConfirmRetry(false)}>Cancel</Btn><Btn kind="primary" onClick={() => retry(true)}>Retry narration</Btn></div></div></Modal>
  </section>;
}
