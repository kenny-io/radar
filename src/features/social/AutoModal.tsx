'use client';
// Automatic generation modal — port of AutoModal (prototype/radar-social.jsx). Saves via `social.auto`. With social publishing
// off nothing is posted; with it on, "When a pack is ready → Schedule posts" is an explicit opt-in.
import { PlatLogo } from '@/components/brand';
import React, { useEffect, useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, Field, Modal, Seg, Toggle } from '@/components/ui';
import { ApiError } from '@/client/api';
import { PLAT, STYLES } from '@/lib/constants';
import { accountsOf, atTz } from '@/lib/socialPublish';
import { addDays } from '@/lib/format';
import type { SocialAuto } from '@/lib/types';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function AutoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp(); const B = app.B!; const { toast } = app;
  const [a, setA] = useState<SocialAuto>(B.social.auto);
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (open) { setA({ ...B.social.auto, time: B.social.auto.time || '08:00' }); setError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const pubOn = !!B.social.publishing; const sched = pubOn && a.post === 'schedule'; const live = accountsOf(B).some(x => !x.expired);
  const invalid = a.on && (!a.platforms.length || (a.freq === 'custom' && !a.days.length) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time) || (sched && !live));
  const save = async () => {
    if (invalid || saving) return;
    setSaving(true); setError('');
    try {
      await app.act('social.auto', { auto: a }, { silent: true });
      toast(!a.on ? 'Automatic drafts paused' : sched ? 'Settings saved. New posts will be scheduled to your connected accounts.' : 'Settings saved. New drafts will appear in your library.');
      onClose();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Radar couldn’t save your settings. Try again.'); }
    finally { setSaving(false); }
  };
  return <Modal open={open} onClose={onClose} dismissable={!saving} label="Draft settings" width={560}><div className="col" style={{ padding: 32, gap: 22 }} aria-busy={saving}>
    <div className="row" style={{ alignItems: 'flex-start' }}><div className="col grow" style={{ gap: 6 }}><h2 className="h1" style={{ fontSize: 24 }}>Automatic drafts</h2><p className="sub">Radar uses your Business Profile, content calendar and blog articles to prepare posts in your brand voice. {sched ? 'New packs are scheduled to your connected accounts.' : 'New packs are saved for you to review and edit. You choose when to publish.'}</p></div><Toggle on={a.on} onChange={v => setA({ ...a, on: v })} label="Automatic drafts" disabled={saving} /></div>
    <fieldset disabled={!a.on || saving} className="col" style={{ border: 0, padding: 0, margin: 0, minWidth: 0, gap: 20, opacity: a.on ? 1 : .55 }}>
      <div className="grid-2" style={{ gap: 14 }}><Field label="Frequency"><Seg value={a.freq} onChange={v => setA({ ...a, freq: v })} options={[{ v: 'daily', l: 'Daily' }, { v: 'custom', l: 'Custom' }]} /></Field><Field label="Prepare from" hint={B.tz}><input type="time" className="input" value={a.time} onChange={e => setA({ ...a, time: e.target.value })} /></Field></div>
      {a.freq === 'custom' && <div className="col" style={{ gap: 8 }}><div className="row enter" role="group" aria-label="Generation days" style={{ gap: 6, flexWrap: 'wrap' }}>{DAYS.map(d => { const on = a.days.includes(d); return <button type="button" key={d} aria-pressed={on} onClick={() => setA({ ...a, days: on ? a.days.filter(x => x !== d) : [...a.days, d] })} style={{ width: 46, height: 40, borderRadius: 10, border: '1px solid ' + (on ? 'var(--ink)' : 'var(--line)'), background: on ? 'var(--ink)' : 'var(--surface)', color: on ? 'var(--on-ink)' : 'var(--ink)', cursor: 'pointer', fontSize: 13 }}>{d}</button>; })}</div>{a.on && !a.days.length && <span className="xs" style={{ color: 'var(--bad)' }}>Choose at least one day.</span>}</div>}
      {pubOn && <Field label="When a pack is ready"><Seg value={a.post || 'library'} onChange={v => setA({ ...a, post: v })} options={[{ v: 'library' as const, l: 'Save drafts' }, { v: 'schedule' as const, l: 'Schedule posts' }]} /></Field>}
      {sched && <p className="xs sub enter" style={{ marginTop: -10 }}>{live ? `X and LinkedIn posts are scheduled for the next day at ${atTz(B.tz, addDays(B.today, 1), a.time || '08:00')}, to your connected accounts. Each one shows on your calendar first, so you can edit, move or unschedule it. Other platforms stay copy-and-paste.` : 'Connect X or LinkedIn in Settings first.'}</p>}
      <Field label="Platforms" hint={a.on && !a.platforms.length ? 'Choose at least one platform.' : undefined}><div className="row" role="group" aria-label="Platforms" style={{ gap: 6, flexWrap: 'wrap' }}>{PLAT.map(p => { const on = a.platforms.includes(p.k); return <button type="button" key={p.k} aria-pressed={on} onClick={() => setA({ ...a, platforms: on ? a.platforms.filter(x => x !== p.k) : [...a.platforms, p.k] })} style={{ height: 36, padding: '0 14px', borderRadius: 99, border: '1px solid ' + (on ? 'var(--ink)' : 'var(--line)'), background: on ? 'var(--ink)' : 'var(--surface)', color: on ? 'var(--on-ink)' : 'var(--ink)', cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 7, paddingLeft: 10 }}><PlatLogo k={p.k} s={16} />{p.l}</button>; })}</div></Field>
      <Field label="Image style"><select className="input" value={a.style} onChange={e => setA({ ...a, style: e.target.value as SocialAuto['style'] })}>{STYLES.filter(s => s.k !== 'custom').map(s => <option key={s.k} value={s.k}>{s.l}</option>)}</select></Field>
    </fieldset>
    {!a.on && <p className="small sub">Automatic drafts are paused. Your existing packs stay in the library. You can still generate a pack manually.</p>}
    {error && <p role="alert" className="small" style={{ color: 'var(--bad)' }}>{error}</p>}
    <div className="row" style={{ justifyContent: 'flex-end', borderTop: '1px solid var(--line2)', paddingTop: 18 }}><Btn kind="ghost" disabled={saving} onClick={onClose}>Cancel</Btn><Btn kind="primary" loading={saving} disabled={invalid} onClick={save}>Save settings</Btn></div>
  </div></Modal>;
}
