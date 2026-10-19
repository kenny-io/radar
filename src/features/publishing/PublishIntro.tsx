'use client';
// CONTRACT (owned by the publishing area): platform picker modal. Port of PublishIntro (radar-publish.jsx).
import React from 'react';
import { Btn, Modal } from '@/components/ui';
import { PlatMark } from '@/components/brand';
import { PLATFORMS } from '@/lib/constants';
import { useApp } from '@/client/app';

export interface PublishIntroProps { open: boolean; onClose: () => void; onPick: (type: string) => void; onSkip?: (() => void) | null; title?: string; sub?: string; existing?: string[] }

export function PublishIntro({ open, onClose, onPick, onSkip, title, sub, existing = [] }: PublishIntroProps) {
  // Only platforms this deployment can connect (OAuth apps configured) — see DIVERGENCES.
  const avail = useApp().B?.blog?.available;
  const list = avail ? PLATFORMS.filter(p => avail.includes(p.k) || existing.includes(p.k)) : PLATFORMS;
  return <Modal open={open} onClose={onClose} width={680}><div className="col" style={{ padding: '32px 32px 26px', gap: 24 }}>
    <div className="row" style={{ alignItems: 'flex-start' }}><div className="col grow" style={{ gap: 8 }}><h2 className="h1" style={{ fontSize: 24 }}>{title || 'Where should Radar publish?'}</h2><p className="sub">{sub || 'Connect your blog once. You’ll choose whether each article waits for you or publishes on its own.'}</p></div><Btn kind="ghost" icon="x" aria-label="Close" onClick={onClose} /></div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(112px,1fr))', gap: 8 }}>{list.map(p => {
      const has = existing.includes(p.k);
      return <button key={p.k} onClick={() => onPick(p.k)} className="col tap" style={{ alignItems: 'center', gap: 10, padding: '18px 8px 14px', border: 0, borderRadius: 14, background: 'none', cursor: 'pointer', textAlign: 'center' }}>
        <PlatMark k={p.k} s={44} /><span className="small" style={{ fontWeight: 500, lineHeight: 1.2 }}>{p.l}</span>{has ? <span className="xs" style={{ color: 'var(--ok)', marginTop: -6 }}>Connected</span> : p.d ? <span className="xs sub" style={{ marginTop: -6, whiteSpace: 'nowrap' }}>{p.d}</span> : null}</button>;
    })}</div>
    {onSkip && <div className="row" style={{ borderTop: '1px solid var(--line2)', paddingTop: 18 }}><Btn kind="link" className="small" onClick={onSkip}>Not now — approve without publishing</Btn></div>}
  </div></Modal>;
}
