'use client';
// Automatic generation modal — port of AutoModal (prototype/radar-social.jsx). Saves via `social.auto`. Nothing is posted.
import React, { useEffect, useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, Field, Modal, Seg, Toggle } from '@/components/ui';
import { PLAT, STYLES } from '@/lib/constants';
import type { SocialAuto } from '@/lib/types';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function AutoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp(); const B = app.B!; const { toast } = app;
  const [a, setA] = useState<SocialAuto>(B.social.auto);
  useEffect(() => { if (open) setA({ ...B.social.auto, time: B.social.auto.time || '08:00' }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    onClose();
    app.act('social.auto', { auto: a }, { optimistic: b => ({ ...b, social: { ...b.social, auto: a } }) })
      .then(() => toast(a.on ? 'Automatic generation on. New packs appear in your library.' : 'Automatic generation off')).catch(() => {});
  };
  return <Modal open={open} onClose={onClose} width={560}><div className="col" style={{ padding: 32, gap: 22 }}>
    <div className="row" style={{ alignItems: 'flex-start' }}><div className="col grow" style={{ gap: 6 }}><h2 className="h1" style={{ fontSize: 24 }}>Automatic generation</h2><p className="sub">Radar creates new packs from your latest articles and Business Profile, and saves them to your library. Nothing is posted.</p></div><Toggle on={a.on} onChange={v => setA({ ...a, on: v })} label="Automatic generation" /></div>
    <div className="col" style={{ gap: 20, opacity: a.on ? 1 : .4, pointerEvents: a.on ? 'auto' : 'none', transition: 'opacity .3s' }}>
      <div className="grid-2" style={{ gap: 14 }}><Field label="Frequency"><Seg value={a.freq} onChange={v => setA({ ...a, freq: v })} options={[{ v: 'daily', l: 'Daily' }, { v: 'custom', l: 'Custom' }]} /></Field><Field label="Time"><input type="time" className="input" value={a.time} onChange={e => setA({ ...a, time: e.target.value })} /></Field></div>
      {a.freq === 'custom' && <div className="row enter" style={{ gap: 6, flexWrap: 'wrap' }}>{DAYS.map(d => { const on = a.days.includes(d); return <button key={d} onClick={() => setA({ ...a, days: on ? a.days.filter(x => x !== d) : [...a.days, d] })} style={{ width: 46, height: 40, borderRadius: 10, border: '1px solid ' + (on ? 'var(--ink)' : 'var(--line)'), background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink)', cursor: 'pointer', fontSize: 13 }}>{d}</button>; })}</div>}
      <Field label="Platforms"><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{PLAT.map(p => { const on = a.platforms.includes(p.k); return <button key={p.k} onClick={() => setA({ ...a, platforms: on ? a.platforms.filter(x => x !== p.k) : [...a.platforms, p.k] })} style={{ height: 36, padding: '0 14px', borderRadius: 99, border: '1px solid ' + (on ? 'var(--ink)' : 'var(--line)'), background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink)', cursor: 'pointer', fontSize: 13 }}>{p.l}</button>; })}</div></Field>
      <Field label="Image style"><select className="input" value={a.style} onChange={e => setA({ ...a, style: e.target.value as SocialAuto['style'] })}>{STYLES.filter(s => s.k !== 'custom').map(s => <option key={s.k} value={s.k}>{s.l}</option>)}</select></Field>
    </div>
    <div className="row" style={{ justifyContent: 'flex-end', borderTop: '1px solid var(--line2)', paddingTop: 18 }}><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={a.on && !a.platforms.length} onClick={save}>Save</Btn></div>
  </div></Modal>;
}
