'use client';
import React, { useEffect, useRef } from 'react';
import { drawVisual, type VisualOpts } from '@/lib/visual';

/** On-brand visual. Shows the generated image (url) when Radar has one, otherwise renders the brand template live. */
export function Visual({ style, brand, headline, seed = 1, ratio = 1.91, name, radius = 14, busy, url }: { style: string; brand: { primary: string; secondary: string }; headline: string; seed?: number; ratio?: number; name?: string; radius?: number; busy?: boolean; url?: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null); const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (url) return;
    const c = ref.current!; const draw = () => { if (!wrap.current) return; const W = wrap.current.clientWidth || 400; const dpr = Math.min(2, window.devicePixelRatio || 1); const w = Math.round(W * dpr), h = Math.round(W / ratio * dpr); c.width = w; c.height = h; drawVisual(c.getContext('2d'), { w, h, style, brand, headline, seed, name }); };
    draw(); ((document as any).fonts && (document as any).fonts.ready || Promise.resolve()).then(draw); const ro = new ResizeObserver(draw); ro.observe(wrap.current!); return () => ro.disconnect();
  }, [style, brand.primary, brand.secondary, headline, seed, ratio, name, url]);
  const fx: React.CSSProperties = { width: '100%', height: '100%', display: 'block', opacity: busy ? .35 : 1, transition: 'opacity .3s', filter: busy ? 'blur(6px)' : 'none' };
  return <div ref={wrap} style={{ position: 'relative', width: '100%', aspectRatio: ratio, borderRadius: radius, overflow: 'hidden', background: 'var(--fill)' }}>
    {url ? <img src={url} alt="" style={{ ...fx, objectFit: 'cover' }} /> : <canvas ref={ref} style={fx} />}
    {busy && <span className="spin" style={{ position: 'absolute', left: '50%', top: '50%', marginLeft: -7, marginTop: -7 }} />}
  </div>;
}

export function renderVisualBlob(opts: Omit<VisualOpts, 'w' | 'h'>, w = 1200, h = 628): Promise<Blob | null> {
  return new Promise(r => { const c = document.createElement('canvas'); c.width = w; c.height = h; drawVisual(c.getContext('2d'), { ...opts, w, h }); c.toBlob(r, 'image/png'); });
}
/** Download either the stored generated image or a client render of the template. */
export async function visualBlob(url: string | null | undefined, opts: Omit<VisualOpts, 'w' | 'h'>, w: number, h: number): Promise<Blob | null> {
  if (url) { try { const r = await fetch(url); if (r.ok) return await r.blob(); } catch { /* fall through */ } }
  return renderVisualBlob(opts, w, h);
}
