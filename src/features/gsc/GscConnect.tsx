'use client';
// CONTRACT (owned by the performance/GSC area): connect flow — button → Google OAuth popup → "Finding your properties…" → radio list → connect.
// bid: the business to connect (the onboarding business during onboarding). onConnected receives the chosen property after the server has saved it and queued the backfill.
// Port of GscConnect (prototype/radar-onboarding.jsx) minus the drawn consent card: the real Google consent happens in the popup.
import React, { useState } from 'react';
import { useApp } from '@/client/app';
import { actCall, openOAuth } from '@/client/api';
import { Btn, Skel, Status } from '@/components/ui';

export interface GscConnectProps { bid: string; domain: string; compact?: boolean; onConnected: (property: string) => void }
interface Prop { v: string; l: string; note: string; recommended: boolean; otherSite: boolean }

export function GscConnect({ bid, domain, compact, onConnected }: GscConnectProps) {
  const app = useApp();
  const [st, setSt] = useState<'idle' | 'authing' | 'loading' | 'pick' | 'denied' | 'empty'>('idle');
  const [props, setProps] = useState<Prop[]>([]); const [prop, setProp] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const allow = async () => {
    setSt('authing');
    const r = await openOAuth('gsc', bid);
    if (!r.ok) { setSt('denied'); return; }
    setSt('loading');
    try {
      const res = await actCall<{ properties: Prop[] }>(bid, 'gsc.properties', {});
      const list = res.data?.properties || [];
      if (!list.length) { setSt('empty'); return; }
      setProps(list); setProp((list.find(p => p.recommended) || list[0]).v); setSt('pick');
    } catch { setSt('denied'); }
  };
  const connect = async () => {
    if (!prop) return;
    setBusy(true);
    try {
      const r = await actCall<{ property: string }>(bid, 'gsc.connect', { property: prop });
      if (r.workspace && bid === app.bid) app.setB(() => r.workspace!);
      onConnected(prop);
    } catch (e: any) { app.toast(e?.message || 'Radar couldn’t finish this. Try again.', { tone: 'bad' }); }
    finally { setBusy(false); }
  };
  if (st === 'idle' || st === 'authing') return <Btn kind="primary" size={compact ? null : 'lg'} icon="search" loading={st === 'authing'} onClick={allow}>Connect Google Search Console</Btn>;
  if (st === 'denied') return <div className="col enter" style={{ gap: 12 }}><Status tone="bad">Access wasn’t granted</Status><p className="small sub" style={{ maxWidth: 440 }}>Google didn’t return permission. This happens if the window was closed or the account doesn’t own the property.</p><div className="row"><Btn kind="primary" icon="refresh" onClick={allow}>Try again</Btn></div></div>;
  if (st === 'empty') return <div className="col enter" style={{ gap: 12 }}><Status tone="warn">No properties found</Status><p className="small sub" style={{ maxWidth: 440 }}>This Google account doesn’t have access to a Search Console property. Try again with the account that manages {domain}.</p><div className="row"><Btn kind="primary" icon="refresh" onClick={allow}>Try again</Btn></div></div>;
  if (st === 'loading') return <div className="col" style={{ gap: 10, maxWidth: 520 }}><span className="small sub row" style={{ gap: 8 }}><span className="spin" />Finding your properties…</span><Skel h={52} /><Skel h={52} /></div>;
  const cur = props.find(p => p.v === prop);
  return <div className="col enter" style={{ gap: 16, maxWidth: 560 }}>
    <span className="label">Choose the property for {domain}</span>
    <div className="col" style={{ border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', background: 'var(--surface)' }}>{props.map((p, i) => <label key={p.v} className="row tap" style={{ padding: '13px 16px', borderTop: i ? '1px solid var(--line2)' : 0, cursor: 'pointer' }}>
      <input type="radio" name="gsc" checked={prop === p.v} onChange={() => setProp(p.v)} style={{ accentColor: 'var(--ink)', width: 16, height: 16 }} />
      <span className="col grow"><span className="mono" style={{ fontSize: 13 }}>{p.l}</span><span className="xs sub">{p.note}</span></span>{p.recommended && <Status tone="ok">Recommended</Status>}</label>)}</div>
    {cur?.otherSite && <p className="small" style={{ color: 'var(--warn)' }}>This property belongs to a different website. Radar’s recommendations would be based on the wrong data.</p>}
    <div className="row"><Btn kind="primary" iconR={compact ? null : 'arrow'} loading={busy} onClick={connect}>{compact ? 'Connect property' : 'Use this property'}</Btn></div>
  </div>;
}
