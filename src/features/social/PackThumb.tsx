'use client';
// Native saved-pack links shared by the full library and the four-item Dashboard summary.
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/client/app';
import { Icon, Status } from '@/components/ui';
import { Visual } from '@/components/Visual';
import { plat } from '@/lib/constants';
import { fmtD } from '@/lib/format';
import type { SocialPack, Brand } from '@/lib/types';
import { isCustomPack } from '@/lib/customPost';
import { packCover, packKeys, packSummary, type LibraryCover } from './library';
export { packKeys } from './library';
export interface PackThumbProps { p: SocialPack; brand: Brand; href: string; onOpen?: () => void }

function Cover({ cover, pack, brand }: { cover: LibraryCover; pack: SocialPack; brand: Brand }) {
  const ref = useRef<HTMLDivElement>(null); const [visible, setVisible] = useState(false); const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [cover.url]);
  useEffect(() => {
    if (cover.kind !== 'video' || !ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '120px' });
    observer.observe(ref.current); return () => observer.disconnect();
  }, [cover.kind, cover.url]);
  const duration = Math.round(cover.duration || 0);
  const label = cover.kind === 'video' ? `Video${duration ? ` · ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : ''}` : cover.kind === 'carousel' ? `Carousel · ${cover.slides} slides` : cover.kind === 'image' ? 'Image' : cover.kind === 'text' ? 'Text post' : 'Preview';
  return <div ref={ref} style={{ aspectRatio: '1.6', position: 'relative', overflow: 'hidden', borderRadius: 11, background: 'var(--line2)', display: 'grid', placeItems: 'center' }}>
    {cover.kind === 'text' ? <p className="pack-text-tile" style={{ margin: 0 }}>{cover.text}</p>
      : cover.kind === 'placeholder' ? <Visual style={pack.style} brand={brand} headline={(pack as SocialPack & { headline?: string }).headline || pack.source.label} seed={cover.post?.seed || 1} name="" radius={11} ratio={1.6} />
      : failed ? <span className="col xs sub" style={{ alignItems: 'center', gap: 8, padding: 18 }}><Icon n={cover.kind === 'video' ? 'play' : 'image'} s={24} /><span>{cover.kind === 'video' ? 'Video' : cover.kind === 'carousel' ? 'Carousel' : 'Image'} preview unavailable</span></span>
      : cover.kind === 'video' ? <><Icon n="play" s={30} style={{ position: 'absolute', color: 'var(--faint)' }} /><video muted playsInline preload={visible ? 'metadata' : 'none'} src={visible ? cover.url : undefined} onLoadedMetadata={event => { const video = event.currentTarget; if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(1.5, video.duration / 2); }} onError={() => setFailed(true)} aria-label={`${cover.platform ? plat(cover.platform).l : ''} saved video preview`} style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none', position: 'absolute' }} /></>
      : <img src={cover.url} alt={cover.alt || `${cover.platform ? plat(cover.platform).l : ''} saved ${cover.kind === 'carousel' ? 'slide' : 'image'}`} loading="lazy" decoding="async" onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
    <span className="xs" style={{ position: 'absolute', left: 9, bottom: 9, borderRadius: 6, padding: '4px 7px', background: '#10151de8', color: '#fff', display: 'inline-flex', gap: 5, alignItems: 'center' }}>{cover.kind === 'video' && <Icon n="play" s={11} />}{label}</span>
  </div>;
}

export function PackThumb({ p, brand, href, onOpen }: PackThumbProps) {
  const { B } = useApp(); const pubOn = !!B?.social.publishing; const keys = packKeys(p); const summary = packSummary(p); const cover = packCover(p);
  const open = (event: React.MouseEvent<HTMLAnchorElement>) => { if (!onOpen || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpen(); };
  const bucketLabels = { draft: 'Draft', scheduled: 'Scheduled', posted: 'Posted', mixed: 'Mixed' };
  const counts = (['draft', 'scheduled', 'posted'] as const).filter(key => summary[key]).map(key => `${summary[key]} ${key}`).join(' · ');
  return <article className="card col" aria-label={p.name} style={{ padding: 10, gap: 12, borderRadius: 18, minWidth: 0 }}>
    <a href={href} onClick={open} aria-label={`Open ${p.name}`} style={{ color: 'inherit', textDecoration: 'none', display: 'block', borderRadius: 11 }}><Cover cover={cover} pack={p} brand={brand} /></a>
    <div className="col" style={{ padding: '0 6px 6px', gap: 7, minWidth: 0 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}><Status tone={!pubOn ? 'mute' : summary.kind === 'posted' ? 'ok' : summary.kind === 'scheduled' ? 'signal' : 'ink'}>{pubOn ? bucketLabels[summary.kind] : 'Saved'}</Status>{pubOn && summary.failed > 0 && <Status tone="warn">Needs attention · {summary.failed}</Status>}{pubOn && summary.sending > 0 && <Status tone="signal">Sending · {summary.sending}</Status>}</div>
      <a href={href} onClick={open} style={{ color: 'var(--ink)', fontWeight: 500, textDecoration: 'none', overflowWrap: 'anywhere' }}>{p.name}</a>
      <span className="xs sub">{fmtD(p.created)} · {keys.map(key => plat(key).l).join(', ')}</span>
      {pubOn && summary.kind === 'mixed' && <span className="xs sub">{counts}</span>}
      {cover.platform && <span className="xs sub">Cover: {plat(cover.platform).l}{cover.style ? ` · ${cover.style}` : ''}</span>}
      {cover.state && <span className="xs sub">{cover.state}</span>}
      {p.auto && <span className="xs sub">Prepared by Radar</span>}
      {isCustomPack(p) && <span className="xs sub">Written by you</span>}
      <a href={href} onClick={open} className="unlink small" aria-label={`Open pack: ${p.name}`} style={{ alignSelf: 'flex-start', padding: '5px 0' }}>Open pack <span aria-hidden="true">→</span></a>
    </div>
  </article>;
}
