'use client';
// Settings — port of SettingsPage + FreqSetting (prototype/radar-app.jsx), AISettings/ModelSelect (radar-models.jsx),
// TeamSettings + FeatureRequest (radar-extras.jsx). Max-width 860; sections in the designed order.
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/client/app';
import { api } from '@/client/api';
import { Btn, PageHead, Section, Seg, Status } from '@/components/ui';
import { GscConnect } from '@/features/gsc/GscConnect';
import { PublishingSettings } from '@/features/publishing/PublishingSettings';
import { AI_DEFAULT, AI_MODELS, AI_TASKS, aiFind, cadenceLabel, langs, MARKETS, modelName, timezones } from '@/lib/constants';
import { EMAIL_RE } from '@/lib/format';
import type { CalendarSettings, Member, Role, Workspace } from '@/lib/types';

/** Hairline row: 220px label column (title + sub) and a control column. Module-level so inputs keep focus across renders. */
function Row({ t, d, children }: { t: React.ReactNode; d?: React.ReactNode; children?: React.ReactNode }) {
  return <div className="row" style={{ padding: '18px 0', borderTop: '1px solid var(--line2)', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}><span className="col" style={{ width: 220, gap: 3 }}><span className="small" style={{ fontWeight: 500 }}>{t}</span>{d && <span className="xs sub">{d}</span>}</span><div className="grow col" style={{ gap: 10, minWidth: 240 }}>{children}</div></div>;
}

export function FreqSetting({ cs, set }: { cs: Pick<CalendarSettings, 'cadence' | 'perWeek'>; set: (p: Partial<CalendarSettings>) => void }) {
  const n = cs.perWeek || 3; const days = cs.cadence === 'daily' ? 30 : cs.cadence === 'weekdays' ? 22 : Math.round(n * 30 / 7);
  return <div className="col" style={{ gap: 12 }}>
    <Seg value={cs.cadence} onChange={v => set({ cadence: v })} options={[{ v: 'daily', l: 'Daily' }, { v: 'weekdays', l: 'Weekdays' }, { v: 'custom', l: 'Custom' }]} />
    {cs.cadence === 'custom' && <div className="row enter" style={{ gap: 10 }}><Btn size="sm" aria-label="Fewer per week" disabled={n <= 1} onClick={() => set({ perWeek: n - 1 })}>−</Btn><span className="num small" style={{ minWidth: 96, textAlign: 'center' }}>{n} per week</span><Btn size="sm" aria-label="More per week" disabled={n >= 7} onClick={() => set({ perWeek: n + 1 })}>+</Btn></div>}
    <span className="xs sub">About {days} articles a month{cs.cadence === 'weekdays' ? ', Monday to Friday' : cs.cadence === 'custom' ? ', spread evenly across the week' : ''}.</span>
  </div>;
}

export function ModelSelect({ value, onChange, width = 280, label }: { value: string; onChange: (v: string) => void; width?: number; label?: string }) {
  const m = aiFind(value);
  return <div className="col" style={{ gap: 6 }}>
    <select className="input" style={{ maxWidth: width }} value={value} onChange={e => onChange(e.target.value)} aria-label={label}>
      {AI_MODELS.map(g => <optgroup key={g.p} label={g.p}>{g.list.map(x => <option key={x.id} value={x.id}>{x.l}</option>)}</optgroup>)}
    </select>
    {m && <span className="xs sub">{m.p} · {m.d}</span>}
  </div>;
}

export function AISettings() {
  const { B, act, toast } = useApp();
  const set = (k: 'writing' | 'research', v: string) => {
    act('settings.ai', { task: k, model: v }, { optimistic: b => ({ ...b, ai: { ...AI_DEFAULT, ...(b.ai || {}), [k]: v } }) })
      .then(() => toast(`${AI_TASKS.find(t => t.k === k)!.l} now uses ${modelName(v)}`)).catch(() => {});
  };
  return <>{AI_TASKS.map(t => <div key={t.k} className="row" style={{ padding: '18px 0', borderTop: '1px solid var(--line2)', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
    <span className="col" style={{ width: 220, gap: 3 }}><span className="small" style={{ fontWeight: 500 }}>{t.l}</span><span className="xs sub">{t.d}</span></span>
    <div className="grow" style={{ minWidth: 240 }}><ModelSelect value={(B?.ai as any)?.[t.k] || AI_DEFAULT[t.k]} onChange={v => set(t.k, v)} label={t.l} /></div>
  </div>)}</>;
}

export function SettingsPage() {
  const app = useApp(); const { B, act, toast, route } = app;
  const gscRef = useRef<HTMLDivElement>(null); const pubRef = useRef<HTMLDivElement>(null);
  const [tzList] = useState(() => timezones());
  const [langList] = useState(() => langs());
  // ?gsc=1 / ?publishing=1 scroll the relevant section into view.
  useEffect(() => {
    const el = route.params?.gsc ? gscRef.current : route.params?.publishing ? pubRef.current : null;
    if (el) { const t = setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); return () => clearTimeout(t); }
  }, [route.params?.gsc, route.params?.publishing, !!B]);
  if (!B) return null;
  const g = B.gsc; const bl = B.blog; const cs = B.calendar.settings;
  const setCs = (p: Partial<CalendarSettings>) => act('settings.calendarDefaults', p, { optimistic: b => ({ ...b, calendar: { ...b.calendar, settings: { ...b.calendar.settings, ...p } } }) });
  const markets = MARKETS.includes(cs.market) ? MARKETS : [cs.market, ...MARKETS];
  const languages = langList.includes(cs.language) ? langList : [cs.language, ...langList];
  const tzs = tzList.includes(bl.tz) ? tzList : [bl.tz, ...tzList];
  const sched = (p: { time?: string; tz?: string }) => (b: Workspace): Workspace => ({ ...b, tz: p.tz || b.tz, blog: { ...b.blog, ...p } });
  return <div className="page" style={{ maxWidth: 860 }}>
    <PageHead title="Settings" />
    <div ref={gscRef} style={{ scrollMarginTop: 24 }}><Section title="Search Console" style={{ marginTop: 0 }}>
      <Row t="Connection" d="Read-only access to search performance.">
        {g.status === 'connected' || g.status === 'syncing' || g.status === 'error' ? <><div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>{g.status === 'connected' ? <Status tone="ok">Connected</Status> : g.status === 'syncing' ? <Status tone="signal" pulse>Syncing · {Math.round(g.progress)}%</Status> : <Status tone="bad">Sync paused</Status>}<span className="mono sub">{g.property}</span></div><div className="row">{g.status === 'error' && <Btn size="sm" icon="refresh" onClick={() => act('gsc.resume', {}, { optimistic: b => ({ ...b, gsc: { ...b.gsc, status: 'syncing', error: null } }) }).catch(() => {})}>Resume sync</Btn>}<Btn size="sm" kind="ghost" onClick={() => act('gsc.disconnect', {}, { optimistic: b => ({ ...b, gsc: { ...b.gsc, status: 'skipped', property: null, progress: 0 } }) }).then(() => toast('Search Console disconnected')).catch(() => {})}>Disconnect</Btn></div></>
          : <GscConnect bid={app.bid!} domain={B.profile.domain} compact onConnected={() => toast('Connected. Syncing in the background.', { tone: 'ok' })} />}
      </Row>
    </Section></div>
    <Section title="AI models" sub="Choose the model behind each part of Radar."><AISettings /></Section>
    <div ref={pubRef} style={{ scrollMarginTop: 24 }}><Section title="Publishing">
      <PublishingSettings />
      <Row t="Schedule"><div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><input type="time" className="input" style={{ width: 130 }} value={bl.time} onChange={e => { const time = e.target.value; if (/^\d{2}:\d{2}$/.test(time)) app.actLater('blog.schedule', 'blog.schedule', { time }, { optimistic: sched({ time }) }); }} aria-label="Publish time" /><select className="input" style={{ width: 220 }} value={bl.tz} onChange={e => act('blog.schedule', { tz: e.target.value }, { optimistic: sched({ tz: e.target.value }) }).catch(() => {})} aria-label="Timezone">{tzs.map(t => <option key={t}>{t}</option>)}</select></div></Row>
    </Section></div>
    <Section title="Calendar defaults">
      <Row t="Market & language"><div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><select className="input" style={{ width: 200 }} value={cs.market} onChange={e => setCs({ market: e.target.value }).catch(() => {})} aria-label="Market">{markets.map(m => <option key={m}>{m}</option>)}</select><select className="input" style={{ width: 200 }} value={cs.language} onChange={e => setCs({ language: e.target.value }).catch(() => {})} aria-label="Language">{languages.map(m => <option key={m}>{m}</option>)}</select></div></Row>
      <Row t="Frequency" d="Used for your next generated calendar."><FreqSetting cs={cs} set={p => { setCs(p).catch(() => {}); toast('Frequency saved · ' + cadenceLabel({ ...cs, ...p })); }} /></Row>
    </Section>
    <Section title="Team"><TeamSettings /></Section>
    <Section title="Account">
      <Row t="Name"><AccountName /></Row>
      <Row t="Email"><span className="small">{app.user.email}</span></Row>
    </Section>
    <Section title="Request a feature"><FeatureRequest /></Section>
  </div>;
}

/** Account → Name: autosaves to PATCH /api/me, then refreshes the signed-in user (sidebar initials). */
function AccountName() {
  const app = useApp();
  const [name, setName] = useState(app.user.name);
  const timer = useRef<any>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (v: string) => {
    setName(v); clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!v.trim()) return;
      try { await api('/api/me', { method: 'PATCH', body: { name: v.trim() } }); await app.refreshMe(); }
      catch (e: any) { app.toast(e?.message || 'Radar couldn’t finish this. Try again.', { tone: 'bad' }); }
    }, 600);
  };
  return <input className="input" style={{ maxWidth: 320 }} value={name} onChange={e => change(e.target.value)} aria-label="Name" />;
}

export function TeamSettings() {
  const { B, act, toast } = useApp();
  const team: Member[] = B!.team;
  const [email, setEmail] = useState(''); const [role, setRole] = useState<Role>('Editor'); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const invite = async (e: React.FormEvent) => {
    e.preventDefault(); const v = email.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) return setErr('Enter a valid email');
    if (team.find(m => m.email === v)) return setErr('Already on the team');
    setBusy(true);
    try { await act('team.invite', { email: v, role }, { silent: true }); setEmail(''); setErr(''); toast('Invite sent to ' + v); }
    catch (x: any) { if (x?.code === 'invalid_email' || x?.code === 'duplicate') setErr(x.message); else toast(x?.message || 'Radar couldn’t finish this. Try again.', { tone: 'bad' }); }
    finally { setBusy(false); }
  };
  const setMemberRole = (m: Member, r: Role) => act('team.role', { memberId: m.id, role: r }, { optimistic: b => ({ ...b, team: b.team.map(x => (x.id === m.id ? { ...x, role: r } : x)) }) }).catch(() => {});
  const remove = (m: Member) => act('team.remove', { memberId: m.id }, { optimistic: b => ({ ...b, team: b.team.filter(x => x.id !== m.id) }) }).then(() => toast('Removed ' + m.email)).catch(() => {});
  return <div className="col" style={{ gap: 14 }}>
    <div className="col">{team.map((m, i) => <div key={m.id} className="row" style={{ gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--line2)' : 0, flexWrap: 'wrap' }}>
      <span style={{ width: 30, height: 30, borderRadius: 99, background: m.status === 'invited' ? 'var(--fill)' : 'var(--ink)', color: m.status === 'invited' ? 'var(--mute)' : '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, flex: 'none' }}>{(m.name || m.email).slice(0, 1).toUpperCase()}</span>
      <span className="col grow" style={{ minWidth: 160 }}><span className="small" style={{ fontWeight: 500 }}>{m.name || m.email}{m.you && <span className="sub" style={{ fontWeight: 400 }}> · You</span>}</span>{m.name && <span className="xs sub">{m.email}</span>}</span>
      {m.status === 'invited' && <Status tone="warn">Invited</Status>}
      {m.role === 'Owner' ? <span className="small sub" style={{ width: 110 }}>Owner</span> : <select className="input" style={{ width: 110, height: 34, fontSize: 13 }} value={m.role} onChange={e => setMemberRole(m, e.target.value as Role)} aria-label="Role"><option>Admin</option><option>Editor</option><option>Viewer</option></select>}
      {!m.you && <Btn kind="ghost" size="sm" icon="x" aria-label={'Remove ' + m.email} onClick={() => remove(m)} />}
    </div>)}</div>
    <form className="row" style={{ gap: 8, flexWrap: 'wrap' }} onSubmit={invite}><input className={'input' + (err ? ' err' : '')} style={{ flex: '1 1 200px' }} placeholder="name@company.com" value={email} onChange={e => { setEmail(e.target.value); setErr(''); }} aria-label="Invite by email" /><select className="input" style={{ width: 110 }} value={role} onChange={e => setRole(e.target.value as Role)} aria-label="Role for invite"><option>Admin</option><option>Editor</option><option>Viewer</option></select><Btn type="submit" loading={busy}>Invite</Btn></form>
    {err ? <span className="xs" style={{ color: 'var(--bad)' }}>{err}</span> : <span className="xs sub">Invite as many people as you need. Editors can approve articles; viewers can’t publish.</span>}
  </div>;
}

export function FeatureRequest() {
  const { act, toast } = useApp(); const [t, setT] = useState(''); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  if (sent) return <div className="col" style={{ gap: 8 }}><Status tone="ok">Request sent</Status><span className="small sub">The team reads every request and will reply by email.</span><div><Btn size="sm" kind="ghost" onClick={() => setSent(false)}>Send another</Btn></div></div>;
  return <form className="col" style={{ gap: 10 }} onSubmit={async e => { e.preventDefault(); if (t.trim().length < 6) return; setBusy(true); try { await act('feature.request', { text: t }); setSent(true); setT(''); toast('Thanks — request sent'); } catch { /* toasted */ } finally { setBusy(false); } }}><textarea className="input" rows={3} placeholder="What should Radar do that it doesn’t today?" value={t} onChange={e => setT(e.target.value)} /><div><Btn size="sm" kind="primary" type="submit" disabled={t.trim().length < 6} loading={busy}>Send request</Btn></div></form>;
}
