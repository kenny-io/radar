'use client';
// CONTRACT (owned by the social area): pack thumbnail card used in the library and on the Dashboard.
// Port of PackThumb (prototype/radar-social.jsx).
import React from 'react';
import { Visual } from '@/components/Visual';
import { plat } from '@/lib/constants';
import { fmtD } from '@/lib/format';
import type { SocialPack, Brand } from '@/lib/types';
export interface PackThumbProps { p: SocialPack; brand: Brand; onClick: () => void }

export function PackThumb({ p, brand, onClick }: PackThumbProps) {
  const first: any = p.posts ? Object.values(p.posts)[0] : null;
  const headline = (p as any).headline || p.source.label;
  return <button className="card tap col" onClick={onClick} style={{ padding: 10, textAlign: 'left', cursor: 'pointer', gap: 12, borderRadius: 18 }}>
    <Visual style={p.style} brand={brand} headline={headline} seed={first ? first.seed : 1} name="" radius={11} ratio={1.6} url={first && first.photo ? first.imageUrl : null} />
    <span className="col" style={{ padding: '0 6px 6px', gap: 2 }}><span className="trunc" style={{ fontWeight: 500 }}>{p.name}</span><span className="xs sub">{fmtD(p.created)} · {p.posts ? Object.keys(p.posts).map(k => plat(k).l).join(', ') : ''}{p.auto ? ' · Auto' : ''}</span></span>
  </button>;
}
