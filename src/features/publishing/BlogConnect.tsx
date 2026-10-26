'use client';
// CONTRACT (owned by the publishing area): connect / edit a blog connection, including the first-connection Mode step.
// type: null (closed) | 'wordpress' (new connection of that platform) | { type, id?, step?: 'mode' } (edit / mode-only).
// Port of BlogConnect (radar-publish.jsx): real OAuth popups, targets from the platform, a real test (draft created, then deleted).
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/client/app';
import { openOAuth } from '@/client/api';
import { Btn, Field, Modal, Status } from '@/components/ui';
import { BrandIcon, PlatMark } from '@/components/brand';
import { platOf, SECRET_FIELDS, timezones } from '@/lib/constants';
import type { ConnectionPublic } from '@/lib/types';

export interface BlogConnectProps { type: null | string | { type: string; id?: string | null; step?: 'mode' }; onClose: () => void; onSaved?: (c: ConnectionPublic) => void }
interface Target { id: string; name: string; suggested?: boolean }

const GENERIC = 'Radar couldn’t finish this. Try again.';
const providerOf = (k: string) => (k === 'nextjs' ? 'github' : k);

export function BlogConnect({ type, onClose, onSaved }: BlogConnectProps) {
  const app = useApp(); const B = app.B!;
  const t = type ? (typeof type === 'string' ? { type } as { type: string; id?: string | null; step?: 'mode' } : type) : null;
  const conns = B.blog.conns; const editing = t && t.id ? conns.find(c => c.id === t.id) || null : null;
  const P = t ? platOf(t.type) : null; const dom = B.profile.domain;
  const [f, setF] = useState<Record<string, string>>({}); const [auth, setAuth] = useState<'none' | 'authing' | 'ok'>('none'); const [oauthRef, setOauthRef] = useState<string | null>(null);
  const [opts, setOpts] = useState<Target[] | null>(null); const [pick, setPick] = useState<string | null>(null);
  const [test, setTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle'); const [failMsg, setFailMsg] = useState('');
  const [step, setStep] = useState<'conn' | 'mode'>('conn'); const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState(B.blog.mode); const [ack, setAck] = useState(false); const [tz, setTz] = useState(B.blog.tz); const [time, setTime] = useState(B.blog.time);
  const [secret, setSecret] = useState<{ ref: string; secret: string; masked: string } | null>(null); const [showSecret, setShowSecret] = useState(false);
  const gen = useRef(0); const tzs = useRef<string[] | null>(null); if (!tzs.current) tzs.current = timezones();
  const key = t ? `${t.type}|${t.id || ''}|${t.step || ''}` : '';

  const loadTargets = async (input: any, g: number): Promise<Target[] | null> => {
    try {
      const r = await app.act<{ targets: Target[]; error?: string }>('blog.targets', input, { silent: true });
      if (g !== gen.current) return null;
      if (r.error) { setOpts([]); setFailMsg(r.error); setTest('fail'); return null; }
      setOpts(r.targets); return r.targets;
    } catch (e: any) { if (g === gen.current) { setOpts([]); setFailMsg(e?.message || GENERIC); setTest('fail'); } return null; }
  };

  useEffect(() => {
    if (!t || !P) return;
    const g = ++gen.current;
    const init: Record<string, string> = {};
    (P.fields || []).forEach(([k]) => { init[k] = k === 'url' && P.k !== 'framer' ? 'https://' + dom : k === 'path' ? 'content/posts' : ''; });
    if (editing) Object.assign(init, Object.fromEntries(Object.entries(editing.f || {}).filter(([k]) => !SECRET_FIELDS.includes(k))));
    // A Next.js connection saved before the repository picker has no targetId: its fields.repo is the pick.
    const cur = editing ? editing.targetId || (P.k === 'nextjs' && editing.f.repo ? editing.f.repo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/(\.git)?\/*$/, '') : null) : null;
    const curOpt = cur ? { id: cur, name: editing!.target || cur } : null;
    setF(init); setAuth(editing && P.oauth ? 'ok' : 'none'); setOauthRef(null); setPick(cur); setTest(editing ? 'ok' : 'idle'); setFailMsg('');
    setStep(t.step || 'conn'); setMode(B.blog.mode); setAck(B.blog.mode === 'autopilot'); setTz(B.blog.tz); setTime(B.blog.time); setSaving(false); setShowSecret(false);
    setSecret(null); setOpts(curOpt ? [curOpt] : null);
    if (editing && P.pick && !t.step) loadTargets({ type: P.k, id: editing.id }, g).then(list => {
      if (!list || !curOpt) return;
      const same = list.find(x => x.id.toLowerCase() === curOpt.id.toLowerCase());
      if (same) setPick(same.id); else setOpts([curOpt, ...list]);
    });
    if (!editing && P.secret) app.act<{ oauthRef: string; secret: string; masked: string }>('blog.newSecret', {}, { silent: true }).then(r => { if (g === gen.current) setSecret({ ref: r.oauthRef, secret: r.secret, masked: r.masked }); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Framer: collections come from the project token, so list them once the URL and token are filled in.
  const framerKey = P && P.k === 'framer' ? `${f.url || ''}|${f.key || ''}` : '';
  useEffect(() => {
    if (!P || P.k !== 'framer' || step !== 'conn') return;
    const okUrl = (f.url || '').trim().length > 2; const okKey = (f.key || '').trim().length > 2 || !!editing;
    if (!okUrl || !okKey) return;
    if (editing && !(f.key || '').trim() && f.url === editing.f.url) return; // loaded by the init effect
    const g = gen.current;
    const tm = setTimeout(() => { loadTargets({ type: 'framer', id: editing?.id || null, fields: f }, g).then(list => { if (list && list.length && !list.some(x => x.id === pick)) setPick(null); }); }, 700);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framerKey]);

  if (!t || !P) return null;
  const isSecretField = (ty?: string) => ty === 'password';
  const fieldsOk = (P.fields || []).every(([k, , , ty]) => (f[k] || '').trim().length > 2 || (isSecretField(ty) && !!editing)) && (P.k !== 'webhook' || (f.hook || '').startsWith('https://'));
  const ready = fieldsOk && (!P.oauth || auth === 'ok') && (!P.pick || !!pick) && (P.k !== 'webhook' || !!editing || !!secret);
  const pickName = (opts || []).find(o => o.id === pick)?.name || (editing && pick === editing.targetId ? editing.target : null) || null;

  const doAuth = async () => {
    setAuth('authing'); const g = gen.current;
    const r = await openOAuth(providerOf(P.k), app.bid!, P.k === 'shopify' ? { shop: (f.store || '').trim() } : {});
    if (g !== gen.current) return;
    if (!r.ok || !r.result?.oauthRef) { setAuth('none'); if (r.error && r.error !== 'closed') app.toast(GENERIC, { tone: 'bad' }); return; }
    setOauthRef(r.result.oauthRef); setTest('idle');
    if (P.pick) { const list = await loadTargets({ type: P.k, oauthRef: r.result.oauthRef }, g); if (g !== gen.current) return; setAuth('ok'); if (list && list[0] && (P.k !== 'nextjs' || list[0].suggested)) setPick(list[0].id); }
    else setAuth('ok');
  };
  const payload = () => ({ type: P.k, id: editing?.id || null, fields: f, target: pickName, targetId: pick, oauthRef: P.k === 'webhook' ? secret?.ref || null : oauthRef });
  const run = async () => {
    setTest('testing');
    try {
      const r = await app.act<{ ok: boolean; message?: string }>('blog.test', payload(), { silent: true });
      if (r.ok) setTest('ok'); else { setFailMsg(r.message || GENERIC); setTest('fail'); }
    } catch (e: any) { setFailMsg(e?.message || GENERIC); setTest('fail'); }
  };
  const first = !conns.length || (!!editing && conns.length === 1);
  const save = async () => {
    setSaving(true);
    try {
      if (t.step === 'mode') {
        await app.act('blog.setMode', { mode, ack: mode === 'autopilot' ? ack : null, time, tz });
        if (editing && onSaved) onSaved(editing);
        else onClose();
      } else {
        const withMode = step === 'mode' || first ? { mode, ack: mode === 'autopilot' ? ack : null, time, tz } : {};
        const r = await app.act<{ connection: ConnectionPublic }>('blog.saveConnection', { ...payload(), ...withMode });
        onSaved ? onSaved(r.connection) : onClose();
      }
    } catch { /* toast shown by act */ } finally { setSaving(false); }
  };
  const failCopy = failMsg || (P.oauth && !P.fields ? 'The authorization expired. Reconnect and try again.' : '401 Unauthorized — check the credentials');
  const fieldsEl = (P.fields || []).map(([k, l, ph, ty, hint]) => <Field key={k} label={l} hint={hint}><input className={'input' + (['hook', 'repo', 'path', 'key'].includes(k) ? ' mono' : '')} style={['hook', 'repo', 'path', 'key'].includes(k) ? { fontSize: 13 } : undefined} type={ty || 'text'} placeholder={ph} value={f[k] || ''} autoComplete={ty === 'password' ? 'new-password' : 'off'} onChange={e => { setF({ ...f, [k]: e.target.value }); setTest('idle'); }} /></Field>);
  const secretValue = editing ? editing.secretHint || 'whsec_…' : secret ? (showSecret ? secret.secret : secret.masked) : '';

  return <Modal open onClose={onClose} width={560}><div className="col" style={{ padding: 32, gap: 22 }}>
    {step === 'conn' ? <>
      <div className="row" style={{ gap: 14 }}><PlatMark k={P.k} s={44} /><div className="col"><span className="eyebrow">{editing ? 'Edit connection' : 'New connection'}</span><h2 className="h1" style={{ fontSize: 24 }}>Connect {P.l}</h2></div></div>
      {!P.authFirst && fieldsEl}
      {P.secret && <Field label="Signing secret" hint="Use it to verify each request came from Radar."><input className="input mono" style={{ fontSize: 13 }} readOnly value={secretValue} onFocus={e => { if (secret && !editing) { setShowSecret(true); const el = e.currentTarget; setTimeout(() => el.select(), 0); } }} onBlur={() => setShowSecret(false)} /></Field>}
      {P.oauth && <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>{auth === 'ok' ? <Status tone="ok">Authorized with {P.oauthLabel || P.l}</Status> : <button className="btn btn-secondary" disabled={(!!P.fields && !P.authFirst && !fieldsOk) || auth === 'authing'} onClick={doAuth}>{auth === 'authing' ? <span className="spin" /> : <BrandIcon k={P.k === 'nextjs' ? 'github' : P.k} s={16} />}<span>Sign in with {P.oauthLabel || P.l}</span></button>}{auth === 'ok' && <Btn kind="link" className="small" onClick={() => { gen.current++; setAuth('none'); setOauthRef(null); setPick(null); setOpts(null); setTest('idle'); }}>Switch account</Btn>}</div>}
      {P.pick && (auth === 'ok' || !P.oauth) && <Field label={P.pick} hint={P.k === 'nextjs' ? <>Don’t see your repository? Its organization may need to approve Radar in <a href="https://github.com/settings/applications" target="_blank" rel="noopener">GitHub Settings → Applications</a>.</> : undefined}><select className="input" value={pick || ''} onChange={e => { setPick(e.target.value); setTest('idle'); }}><option value="" disabled>Choose…</option>{(opts || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>}
      {P.authFirst && auth === 'ok' && fieldsEl}
      {P.help && <span className="xs sub">{P.help}</span>}
      <div className="row" style={{ minHeight: 40, gap: 14, flexWrap: 'wrap' }}><Btn icon="refresh" loading={test === 'testing'} disabled={!ready} onClick={run}>Test connection</Btn>
        {test === 'ok' && <Status tone="ok">Connected · test {P.k === 'nextjs' ? 'branch' : 'draft'} created, then deleted</Status>}
        {test === 'fail' && <Status tone="bad">{failCopy}</Status>}</div>
      <div className="row" style={{ justifyContent: 'flex-end', borderTop: '1px solid var(--line2)', paddingTop: 18 }}><Btn kind="ghost" onClick={onClose}>Cancel</Btn>{first && !editing ? <Btn kind="primary" disabled={test !== 'ok'} iconR="arrow" onClick={() => setStep('mode')}>Continue</Btn> : <Btn kind="primary" disabled={test !== 'ok'} loading={saving} onClick={save}>{editing ? 'Save changes' : 'Add connection'}</Btn>}</div>
    </> : <>
      <div className="col" style={{ gap: 6 }}><h2 className="h1" style={{ fontSize: 24 }}>How should articles publish?</h2><p className="sub">Applies to every connection. You can change this or pause publishing anytime.</p></div>
      <div className="col" style={{ border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden' }}>
        {([['review', 'Review-first', 'Each article waits for your approval, then publishes on its scheduled date.'], ['autopilot', 'Daily autopilot', 'Radar writes and publishes one article a day without waiting for review.']] as const).map(([k, l, d], i) => <label key={k} className="row tap" style={{ padding: '16px 18px', borderTop: i ? '1px solid var(--line2)' : 0, cursor: 'pointer', alignItems: 'flex-start' }}><input type="radio" checked={mode === k} onChange={() => setMode(k)} style={{ accentColor: 'var(--ink)', width: 16, height: 16, marginTop: 3 }} /><span className="col grow"><span style={{ fontWeight: 500 }}>{l}</span><span className="small sub">{d}</span></span></label>)}
      </div>
      {mode === 'autopilot' && <label className="row small enter" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ accentColor: 'var(--ink)', width: 16, height: 16, marginTop: 2 }} /><span>I understand articles will go live on {dom} without my review. I can pause anytime.</span></label>}
      <div className="grid-2" style={{ gap: 14 }}><Field label="Publish time"><input type="time" className="input" value={time} onChange={e => setTime(e.target.value)} /></Field><Field label="Timezone"><select className="input" value={tz} onChange={e => setTz(e.target.value)}>{(tzs.current.includes(tz) ? tzs.current : [tz, ...tzs.current]).map(z => <option key={z}>{z}</option>)}</select></Field></div>
      <div className="row" style={{ justifyContent: 'flex-end', borderTop: '1px solid var(--line2)', paddingTop: 18 }}>{!t.step && <Btn kind="ghost" onClick={() => setStep('conn')}>Back</Btn>}{t.step && <Btn kind="ghost" onClick={onClose}>Cancel</Btn>}<Btn kind="primary" disabled={(mode === 'autopilot' && !ack) || !/^\d\d:\d\d$/.test(time || '')} loading={saving} onClick={save}>{mode === 'autopilot' ? 'Turn on autopilot' : t.step ? 'Save' : 'Save and schedule'}</Btn></div>
    </>}
  </div></Modal>;
}
