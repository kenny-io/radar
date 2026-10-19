'use client';
// Selection RewriteBar + YouTube VideoPicker / VideoEmbed — ports from prototype/radar-extras.jsx.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Btn, Icon, Skel } from '@/components/ui';
import type { VideoRef } from '@/lib/types';

const REWRITES: [string, string][] = [['rewrite', 'Rewrite'], ['shorter', 'Shorter'], ['simpler', 'Simpler'], ['expand', 'Expand']];
export type RewriteFn = (mode: string, selection: string, before: string, after: string) => Promise<string | null>;

export function RewriteBar({ root, enabled, onRewrite }: { root: React.RefObject<HTMLElement | null>; enabled: boolean; onRewrite: RewriteFn }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null); const [busy, setBusy] = useState<string | null>(null); const range = useRef<Range | null>(null);
  useEffect(() => {
    if (!enabled) { setPos(null); return; }
    const h = () => {
      const sel = window.getSelection(); if (!sel || sel.isCollapsed || !root.current) { if (!busy) setPos(null); return; }
      const r = sel.getRangeAt(0); const node = r.commonAncestorContainer; const el = (node.nodeType === 1 ? node : node.parentElement) as HTMLElement | null;
      if (!el || !root.current.contains(el) || !el.closest('[contenteditable="true"]') || sel.toString().trim().length < 4) { setPos(null); return; }
      range.current = r.cloneRange(); const b = r.getBoundingClientRect(); setPos({ x: b.left + b.width / 2, y: b.top });
    };
    document.addEventListener('selectionchange', h); return () => document.removeEventListener('selectionchange', h);
  }, [enabled, busy, root]);
  if (!pos) return null;
  const run = async (k: string) => {
    const r = range.current; if (!r || busy) return;
    const host = ((r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement) as HTMLElement).closest('[contenteditable="true"]') as HTMLElement | null;
    if (!host) return;
    const pre = document.createRange(); pre.selectNodeContents(host); pre.setEnd(r.startContainer, r.startOffset);
    const post = document.createRange(); post.selectNodeContents(host); post.setStart(r.endContainer, r.endOffset);
    setBusy(k);
    const out = await onRewrite(k, r.toString(), pre.toString(), post.toString()).catch(() => null);
    if (out != null) {
      const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(r);
      document.execCommand('insertText', false, out);
      host.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    }
    setBusy(null); setPos(null);
  };
  return createPortal(<div onMouseDown={e => e.preventDefault()} role="toolbar" aria-label="Rewrite selection" style={{ position: 'fixed', left: pos.x, top: Math.max(8, pos.y - 50), transform: 'translateX(-50%)', zIndex: 90, display: 'flex', gap: 2, padding: 4, borderRadius: 999, background: 'var(--night)', boxShadow: '0 10px 30px -8px oklch(0 0 0 / .4)', animation: 'rise .2s var(--ease)' }}>
    {REWRITES.map(([k, l]) => <button key={k} onClick={() => run(k)} style={{ height: 32, padding: '0 13px', borderRadius: 999, border: 0, background: busy === k ? 'oklch(1 0 0 / .14)' : 'transparent', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }} onMouseEnter={e => { e.currentTarget.style.background = 'oklch(1 0 0 / .1)'; }} onMouseLeave={e => { e.currentTarget.style.background = busy === k ? 'oklch(1 0 0 / .14)' : 'transparent'; }}>{busy === k && <span className="spin" style={{ width: 11, height: 11 }} />}{l}</button>)}
  </div>, document.body);
}

/** Dev-stub videos have `stub-` ids: no network embed (dev only). */
const isStub = (id: string) => id.startsWith('stub-');
const STUB_DOC = '<html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#1d1f24;color:#9a9ca3;font:13px system-ui">Video embed (dev stub)</body></html>';

export function VideoEmbed({ v, edit, onRemove }: { v: VideoRef; edit: boolean; onRemove: () => void }) {
  return <figure contentEditable={false} style={{ margin: '8px 0 26px', position: 'relative' }}>
    <div style={{ aspectRatio: '16/9', borderRadius: 14, background: 'linear-gradient(135deg,oklch(0.3 0.01 265),oklch(0.18 0.01 265))', display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden' }}>
      {isStub(v.id)
        ? <iframe title={v.title} srcDoc={STUB_DOC} sandbox="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
        : <iframe title={v.title} src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?rel=0`} loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />}
      {edit && <button onClick={onRemove} aria-label="Remove video" style={{ position: 'absolute', right: 10, top: 10, width: 30, height: 30, borderRadius: 99, border: 0, background: 'oklch(0 0 0 / .5)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', zIndex: 1 }}><Icon n="x" s={14} /></button>}
    </div>
    <figcaption className="small sub" style={{ marginTop: 8 }}>{v.title} · YouTube · {v.channel}</figcaption>
  </figure>;
}

export function VideoPicker({ vids, loading, on, onToggle }: { vids: VideoRef[]; loading: boolean; on: string[]; onToggle: (v: VideoRef, has: boolean) => void }) {
  if (!loading && !vids.length) return null;
  return <div className="col" style={{ gap: 4, marginTop: 10, paddingTop: 20, borderTop: '1px solid var(--line2)' }}>
    <div className="row" style={{ marginBottom: 6 }}><span className="label grow">Relevant YouTube videos</span></div>
    {loading && !vids.length ? [0, 1, 2].map(i => <div key={i} className="row" style={{ gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--line2)' : 0 }}><Skel w={64} h={36} style={{ borderRadius: 6 }} /><span className="col grow" style={{ gap: 6 }}><Skel w="80%" h={12} /><Skel w="50%" h={10} /></span></div>)
      : vids.map((v, i) => {
        const has = on.includes(v.id);
        return <div key={v.id} className="row" style={{ gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--line2)' : 0, alignItems: 'flex-start' }}>
          <span style={{ width: 64, height: 36, borderRadius: 6, background: isStub(v.id) ? 'linear-gradient(135deg,oklch(0.32 0.01 265),oklch(0.2 0.01 265))' : `center/cover url(https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/mqdefault.jpg), oklch(0.2 0.01 265)`, display: 'grid', placeItems: 'center', color: '#fff', flex: 'none' }}><Icon n="play" s={12} /></span>
          <span className="col grow" style={{ minWidth: 0, gap: 1 }}><span className="small" style={{ fontWeight: 500, lineHeight: 1.3 }}>{v.title}</span><span className="xs sub">{v.channel} · {v.dur} · {v.views} views</span><span className="xs" style={{ color: 'var(--ink2)' }}>{v.why}</span></span>
          <Btn size="sm" kind={has ? 'secondary' : 'ghost'} icon={has ? 'check' : 'plus'} aria-label={has ? 'Remove from article' : 'Embed in article'} onClick={() => onToggle(v, has)} />
        </div>;
      })}
    <span className="xs sub" style={{ marginTop: 4 }}>Embedded with credit to the creator. Radar only suggests videos that allow embedding.</span>
  </div>;
}
