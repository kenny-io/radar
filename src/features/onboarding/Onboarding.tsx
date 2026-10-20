'use client';
// Port of Onboarding / StepRail / ReviewStep / GscStep / SaveStep (prototype/radar-onboarding.jsx).
// Works against the ONBOARDING business (POST /api/b), not app.bid: its own workspace, job progress and saves.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/client/app';
import { api, actCall } from '@/client/api';
import { Btn, Icon, LogoTile, Mark, Modal, Status } from '@/components/ui';
import { RadarField, type Blip } from '@/components/RadarField';
import { GscConnect } from '@/features/gsc/GscConnect';
import { ProfileGroup, type GroupKey } from '@/features/profile/ProfileGroup';
import { kwList } from '@/features/profile/KeywordList';
import { inferredLeft } from '@/lib/constants';
import { cleanDomain, DOMAIN_RE } from '@/lib/format';
import type { Profile, Workspace } from '@/lib/types';

const ANALYSIS = [
  { k: 'site', l: 'Reading your website' },
  { k: 'biz', l: 'Understanding the business' },
  { k: 'content', l: 'Mapping existing content' },
  { k: 'aud', l: 'Finding your audience' },
  { k: 'brand', l: 'Extracting your brand' },
] as const;
type Step = 'domain' | 'analyzing' | 'review' | 'gsc' | 'save';
const STEPS: [Step, string][] = [['domain', 'Website'], ['review', 'Review'], ['gsc', 'Search Console'], ['save', 'Save']];
const GENERIC = 'Radar couldn’t finish this. Try again.';

function StepRail({ step }: { step: Step }) {
  const idx = STEPS.findIndex(s => s[0] === step || (step === 'analyzing' && s[0] === 'domain'));
  return <nav className="row" style={{ gap: 22 }} aria-label="Setup">{STEPS.map(([k, l], i) => <span key={k} className="row small" style={{ gap: 7, color: i === idx ? 'var(--ink)' : i < idx ? 'var(--ink2)' : 'var(--faint)', fontWeight: i === idx ? 500 : 400 }}>
    {i < idx ? <Icon n="check" s={13} w={2} /> : <i className="dot" style={{ background: i === idx ? 'var(--signal)' : 'var(--line)' }} />}<span className={i === idx ? '' : 'hide-sm'}>{l}</span></span>)}</nav>;
}

interface JobLive { id: string; kind: string; status: 'queued' | 'running' | 'done' | 'failed'; progress: any; error: string | null; createdAt?: string }

/** The onboarding business: workspace, live job state (SSE + polling fallback) and debounced profile saves. */
function useOnboardingBiz(initialId: string | null) {
  const [id, setId] = useState<string | null>(initialId);
  const [W, setW] = useState<Workspace | null>(null);
  const [jobs, setJobs] = useState<Record<string, JobLive>>({});
  const wRef = useRef<Workspace | null>(null); wRef.current = W;
  const idRef = useRef(id); idRef.current = id;
  const dirty = useRef(0); const timer = useRef<any>(null);
  const load = useCallback(async (bid = idRef.current) => {
    if (!bid) return null;
    const w = await api<Workspace>(`/api/b/${bid}/workspace`);
    if (idRef.current === bid) setW(w);
    return w;
  }, []);
  useEffect(() => {
    if (!id) return;
    let es: EventSource | null = null; let stop = false; let retry: any;
    const open = () => {
      es = new EventSource(`/api/b/${id}/events`);
      es.addEventListener('job', (ev: MessageEvent) => { const j = JSON.parse(ev.data); setJobs(m => ({ ...m, [j.id]: j })); });
      es.addEventListener('rev', () => { if (!dirty.current && !timer.current) load(id).catch(() => {}); });
      es.onerror = () => { es?.close(); if (!stop) retry = setTimeout(open, 3000); };
    };
    open();
    return () => { stop = true; clearTimeout(retry); es?.close(); };
  }, [id, load]);
  const act = useCallback(async <T,>(name: string, input: any, bid = idRef.current): Promise<T> => {
    const r = await actCall<T>(bid!, name, input);
    if (r.workspace && idRef.current === bid && !dirty.current && !timer.current) setW(r.workspace);
    return r.data as T;
  }, []);
  const save = useCallback(async () => {
    clearTimeout(timer.current); timer.current = null;
    const w = wRef.current; const bid = idRef.current; if (!w || !bid) return;
    const seq = ++dirty.current;
    try {
      const r = await actCall(bid, 'profile.update', { profile: w.profile, editedKeys: Object.keys(w.edited) });
      if (seq === dirty.current && !timer.current && r.workspace && idRef.current === bid) setW(r.workspace);
    } finally { if (seq === dirty.current) dirty.current = 0; }
  }, []);
  const edit = useCallback((p: Profile, key: string) => {
    setW(w => (w ? { ...w, profile: p, edited: { ...w.edited, [key]: true } } : w));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { save().catch(() => {}); }, key === 'brand.logo' ? 0 : 600);
  }, [save]);
  const flush = useCallback(async () => { if (timer.current) await save(); }, [save]);
  return { id, setId, W, setW, jobs, setJobs, load, act, edit, flush };
}

export function Onboarding() {
  const app = useApp();
  const pending = app.me.businesses.find(b => b.status === 'onboarding') || null;
  const ob = useOnboardingBiz(pending?.id || null);
  const [ready, setReady] = useState(!pending);
  const [step, setStep] = useState<Step>('domain');
  const [domain, setDomain] = useState(pending?.domain || ''); const [dErr, setDErr] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [blips, setBlips] = useState<Blip[]>([]);
  const [starting, setStarting] = useState(false);

  // Resume after a reload: running analysis → Analyzing; analyzed profile → Review; otherwise the domain step.
  useEffect(() => {
    if (!pending) return;
    ob.load(pending.id).then(w => {
      if (!w) return;
      const j = w.jobs.filter(x => x.kind === 'analysis.site').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
      setDomain(w.profile.domain);
      if (j && (j.status === 'queued' || j.status === 'running' || j.status === 'failed')) { setJobId(j.id); ob.setJobs(m => ({ ...m, [j.id]: j as JobLive })); setStep('analyzing'); }
      else if (w.site.analyzedAt) setStep('review');
    }).catch(() => {}).finally(() => setReady(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const job: JobLive | null = jobId ? ob.jobs[jobId] || null : null;
  // Polling fallback when SSE is slow or unavailable.
  useEffect(() => {
    if (!jobId || !ob.id || (job && (job.status === 'done' || job.status === 'failed'))) return;
    const bid = ob.id;
    const iv = setInterval(() => { actCall<JobLive | null>(bid, 'job.get', { id: jobId }).then(r => { if (r.data) ob.setJobs(m => ({ ...m, [jobId]: { ...(m[jobId] || {}), ...r.data! } })); }).catch(() => {}); }, 2500);
    return () => clearInterval(iv);
  }, [jobId, ob.id, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const prog = job?.progress || { phase: 'site', results: {} };
  const fail: string | null = prog.failed || (job?.status === 'failed' ? (job.error || GENERIC) : null);
  const phase = prog.phase === 'done' ? ANALYSIS.length : Math.max(0, ANALYSIS.findIndex(a => a.k === prog.phase));
  const finished = !!job && job.status === 'done' && prog.phase === 'done';
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => { if (finished && jobId && loaded !== jobId) ob.load().then(() => setLoaded(jobId)).catch(() => {}); }, [finished, jobId]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = finished && loaded === jobId && !fail;
  // One blip per finished phase.
  const seenPhase = useRef(0);
  useEffect(() => {
    if (step !== 'analyzing') return;
    const n = Math.min(phase, ANALYSIS.length);
    if (n > seenPhase.current) { const add: Blip[] = []; for (let i = seenPhase.current; i < n; i++) { const a = Math.random() * 6.28, r = .25 + Math.random() * .6; add.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, at: performance.now() }); } setBlips(b => [...b, ...add]); }
    seenPhase.current = n;
  }, [phase, step]);

  const run = async (keepEdits: boolean, bid = ob.id) => {
    if (!bid) return;
    await ob.flush().catch(() => {});
    setStep('analyzing'); setBlips([]); seenPhase.current = 0; setJobId(null);
    try { const r = await ob.act<{ jobId: string }>('onboarding.analyze', { keepEdits }, bid); ob.setJobs(m => { const n = { ...m }; delete n[r.jobId]; return n; }); setLoaded(null); setJobId(r.jobId); }
    catch (e: any) { app.toast(e?.message || GENERIC, { tone: 'bad' }); setStep(keepEdits ? 'review' : 'domain'); }
  };
  const start = async (e?: React.FormEvent) => {
    e && e.preventDefault(); const d = cleanDomain(domain);
    if (!DOMAIN_RE.test(d)) { setDErr('Enter a domain like yourcompany.com'); return; }
    setDErr(''); setDomain(d); setStarting(true);
    try { const r = await api<{ id: string }>('/api/b', { body: { domain: d } }); ob.setId(r.id); ob.setW(null); await run(false, r.id); }
    catch (x: any) { setDErr(x?.message || GENERIC); }
    finally { setStarting(false); }
  };
  const obDomain = ob.W?.profile.domain || domain;
  const energy = step === 'analyzing' ? (done ? .35 : .95) : .3;
  const bandH = step === 'domain' || step === 'analyzing' ? 220 : 0;
  return <Modal full open width={940} dismissable={false} label="Set up your business">
    <div className="col" style={{ minHeight: 'min(680px,calc(100vh - 48px))' }}>
      <div style={{ height: bandH, transition: 'height .7s var(--ease)', position: 'relative', flex: 'none', overflow: 'hidden' }}>
        <RadarField theme="night" energy={energy} blips={blips} center={[.5, .18]} scale={1.25} dens={30} style={{ position: 'absolute', inset: 0 }} />
        <div className="row" style={{ position: 'absolute', left: 28, right: 28, top: 22, color: '#fff' }}><Mark s={20} night /><span style={{ fontWeight: 600, letterSpacing: '-0.02em' }}>Radar</span></div>
        {step === 'analyzing' && <div style={{ position: 'absolute', left: 28, bottom: 22, color: '#fff' }} className="col enter"><span className="mono" style={{ color: 'oklch(0.75 0.01 265)' }}>{done ? 'Analysis complete' : 'Scanning'}</span><span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em' }}>{obDomain}</span></div>}
      </div>
      <div className="row" style={{ padding: '20px 32px', borderBottom: '1px solid var(--line2)', display: bandH ? 'none' : 'flex' }}><Mark s={20} /><span className="grow" /><StepRail step={step} /></div>
      <div className="grow col" style={{ padding: '34px clamp(22px,4vw,48px) 30px' }}>
        {ready && step === 'domain' && <form className="col enter" style={{ gap: 22, maxWidth: 600 }} onSubmit={start}>
          <div className="col" style={{ gap: 10 }}><h1 className="h1" style={{ fontSize: 32 }}>Let’s get to know your business.</h1><p className="sub" style={{ fontSize: 16 }}>Paste your website. Radar reads it to learn what you offer, who buys it, and how your brand sounds — you’ll review everything before it’s saved.</p></div>
          <div className="col" style={{ gap: 8 }}><div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <div className="grow row" style={{ minWidth: 240, height: 54, border: '1px solid ' + (dErr ? 'var(--bad)' : 'var(--line)'), borderRadius: 14, padding: '0 16px', gap: 4, background: 'var(--surface)' }}><span className="sub mono" style={{ fontSize: 14 }}>https://</span><input autoFocus className="input-bare" style={{ fontSize: 17 }} placeholder="yourcompany.com" value={domain} onChange={e => { setDomain(e.target.value); setDErr(''); }} aria-label="Website domain" /></div>
            <Btn kind="primary" size="lg" type="submit" loading={starting} style={{ height: 54, borderRadius: 14 }} iconR="arrow">Analyze website</Btn>
          </div>{dErr && <span className="small" style={{ color: 'var(--bad)' }}>{dErr}</span>}</div>
        </form>}
        {step === 'analyzing' && <div className="col" style={{ gap: 0, maxWidth: 640 }}>
          {ANALYSIS.map((a, i) => {
            const st = i < phase ? 'done' : i === phase ? (fail ? 'fail' : 'run') : 'wait'; const brandErr = a.k === 'brand' && !!prog.logoMissing;
            return <div key={a.k} className="row ob-row" style={{ height: 52, borderTop: i ? '1px solid var(--line2)' : 0, opacity: st === 'wait' ? .4 : 1, transition: 'opacity .4s' }}>
              <span style={{ width: 20, display: 'grid', placeItems: 'center' }}>{st === 'done' ? <Icon n="check" s={15} w={2} style={{ color: brandErr ? 'var(--warn)' : 'var(--ok)' }} /> : st === 'run' ? <span className="spin" style={{ color: 'var(--signal)' }} /> : st === 'fail' ? <i className="dot" style={{ background: 'var(--bad)' }} /> : <i className="dot" style={{ background: 'var(--line)' }} />}</span>
              <span className="grow ob-l" style={{ fontWeight: st === 'run' ? 500 : 400 }}>{a.l}</span>
              {st === 'done' && <span className="small enter ob-d" style={{ color: brandErr ? 'var(--warn)' : 'var(--ink2)' }}>{prog.results?.[a.k]}</span>}
              {st === 'done' && a.k === 'brand' && !brandErr && prog.colors && <span className="row enter" style={{ gap: 4 }}><i style={{ width: 14, height: 14, borderRadius: 4, background: prog.colors[0] }} /><i style={{ width: 14, height: 14, borderRadius: 4, background: prog.colors[1] }} /></span>}
            </div>;
          })}
          {fail && <div className="col enter" style={{ gap: 12, marginTop: 20 }}><p style={{ color: 'var(--bad)' }}>{fail}</p><div className="row"><Btn kind="primary" icon="refresh" onClick={() => run(true)}>Try again</Btn><Btn kind="ghost" onClick={() => setStep('domain')}>Change domain</Btn></div></div>}
          {done && <div className="row enter" style={{ marginTop: 26, gap: 12, flexWrap: 'wrap' }}><Btn kind="primary" size="lg" iconR="arrow" autoFocus onClick={() => setStep('review')}>Review what Radar found</Btn><span className="small sub">About a minute to check.</span></div>}
        </div>}
        {step === 'review' && ob.W && <ReviewStep W={ob.W} onChange={ob.edit} next={async () => { await ob.flush().catch(() => {}); setStep('gsc'); }} reanalyze={() => run(true)} />}
        {step === 'gsc' && ob.W && ob.id && <GscStep W={ob.W} bid={ob.id} back={() => setStep('review')} next={() => setStep('save')} reload={() => ob.load()} />}
        {step === 'save' && ob.W && ob.id && <SaveStep W={ob.W} back={() => setStep('gsc')} save={async () => {
          await ob.flush();
          let tz: string | undefined; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* */ }
          await ob.act('onboarding.finish', { tz });
          await api('/api/b/current', { body: { id: ob.id } });
          await app.refreshMe();
          app.onboarding.close(); app.go('dashboard');
          app.toast('Business Profile saved', { tone: 'ok' });
        }} />}
      </div>
    </div>
  </Modal>;
}

function ReviewStep({ W, onChange, next, reanalyze }: { W: Workspace; onChange: (p: Profile, key: string) => void; next: () => void; reanalyze: () => void }) {
  const [tab, setTab] = useState<GroupKey>('business');
  const edits = Object.keys(W.edited || {}).length;
  return <div className="col enter" style={{ gap: 24, flex: 1 }}>
    <div className="col" style={{ gap: 8 }}><h1 className="h1">Here’s what Radar found.</h1><p className="sub">Everything marked <span className="inf" style={{ verticalAlign: 1 }}><i />Inferred</span> was read from {W.profile.domain}. Correct anything that’s off — your edits are kept, even if you re-analyze.</p></div>
    <div style={{ display: 'grid', gridTemplateColumns: '170px minmax(0,1fr)', gap: 32, flex: 1 }} className="review-grid">
      <style>{`@media(max-width:700px){.review-grid{grid-template-columns:1fr!important;gap:20px!important}.review-nav{flex-direction:row!important;overflow-x:auto;scrollbar-width:none;z-index:3;background:var(--surface);margin:0 -22px;padding:6px 22px;border-bottom:1px solid var(--line2)}}`}</style>
      <div className="col review-nav" style={{ gap: 2, position: 'sticky', top: 0, alignSelf: 'start' }}>
        {([['business', 'Business'], ['audience', 'Audience'], ['keywords', 'Keywords'], ['brand', 'Brand']] as const).map(([k, l]) => { const n = inferredLeft(W.edited, k); return <button key={k} className="nav-i" style={tab === k ? { background: 'var(--fill)', color: 'var(--ink)' } : {}} onClick={() => setTab(k)}>{l}<span className="ct">{n ? n + ' to check' : <Icon n="check" s={13} />}</span></button>; })}
      </div>
      <div key={tab} className="enter"><ProfileGroup group={tab} profile={W.profile} edited={W.edited || {}} onChange={onChange} gsc={W.gsc.status} measured={W.measured} suggestions={W.kwSuggestions} /></div>
    </div>
    <div className="row" style={{ borderTop: '1px solid var(--line2)', paddingTop: 20, flexWrap: 'wrap' }}>
      <Btn kind="ghost" icon="refresh" onClick={reanalyze}>Re-analyze</Btn>{edits > 0 && <span className="xs sub">{edits} edit{edits > 1 ? 's' : ''} will be kept</span>}
      <span className="grow" />
      {tab !== 'brand' ? <Btn kind="secondary" iconR="arrow" onClick={() => setTab(({ business: 'audience', audience: 'keywords', keywords: 'brand' } as const)[tab])}>{({ business: 'Audience', audience: 'Keywords', keywords: 'Brand' } as const)[tab]}</Btn> : null}
      <Btn kind="primary" iconR="arrow" onClick={next}>Looks right</Btn>
    </div>
  </div>;
}

const gscOn = (W: Workspace) => W.gsc.status === 'syncing' || W.gsc.status === 'connected' || W.gsc.status === 'error';

function GscStep({ W, bid, back, next, reload }: { W: Workspace; bid: string; back: () => void; next: () => void; reload: () => Promise<any> }) {
  const [changing, setChanging] = useState(false);
  const connected = gscOn(W) && !changing && W.gsc.property;
  return <div className="col enter" style={{ gap: 28, maxWidth: 640, flex: 1 }}>
    <div className="col" style={{ gap: 10 }}><h1 className="h1">Connect Google Search Console</h1><p className="sub" style={{ fontSize: 16 }}>Radar uses your real search performance — the queries you already appear for and pages that almost rank — to find keyword opportunities and recommend what to write or refresh.</p></div>
    <div className="col small" style={{ gap: 10, color: 'var(--ink2)' }}>
      <span className="row" style={{ gap: 10 }}><Icon n="eye" s={16} />Read-only. Radar never changes your Search Console settings.</span>
      <span className="row" style={{ gap: 10 }}><Icon n="clock" s={16} />Syncs 16 months of history in the background.</span>
    </div>
    {connected ? <div className="col" style={{ gap: 14 }}><Status tone="ok">Connected · <span className="mono">{W.gsc.property}</span></Status><div className="row"><Btn kind="ghost" size="sm" onClick={() => setChanging(true)}>Change</Btn></div></div>
      : <GscConnect bid={bid} domain={W.profile.domain} onConnected={() => { reload().catch(() => {}); setChanging(false); next(); }} />}
    <span className="grow" />
    <div className="row" style={{ borderTop: '1px solid var(--line2)', paddingTop: 20 }}><Btn kind="ghost" icon="back" onClick={back}>Back</Btn><span className="grow" />{connected ? <Btn kind="primary" iconR="arrow" onClick={next}>Continue</Btn> : <Btn kind="ghost" onClick={next}>Skip for now</Btn>}</div>
  </div>;
}

function SaveStep({ W, back, save }: { W: Workspace; back: () => void; save: () => Promise<void> }) {
  const app = useApp();
  const [busy, setBusy] = useState(false); const p = W.profile;
  const onSave = async () => { setBusy(true); try { await save(); } catch (e: any) { setBusy(false); app.toast(e?.message || GENERIC, { tone: 'bad' }); } };
  const kl = kwList(p); const pri = kl.filter(k => k.priority); const shown = pri.length ? pri : kl.slice(0, 3);
  const rows: [string, React.ReactNode][] = [
    ['Audience', p.audience.segments.join(', ')],
    ['Keywords', kl.length ? shown.map(k => k.kw).join(', ') + (kl.length > 3 ? ` and ${kl.length - shown.length} more` : '') : 'None yet'],
    ['Voice', p.brand.voice],
    ['Markets', p.brand.markets.join(', ') + ' · ' + p.brand.language],
    ['Search Console', gscOn(W) ? <Status tone="ok">Connected · syncing after you save</Status> : <Status tone="mute">Skipped · connect anytime in Settings</Status>],
  ];
  return <div className="col enter" style={{ gap: 28, flex: 1 }}>
    <div className="col" style={{ gap: 10 }}><h1 className="h1">Your Business Profile is ready.</h1><p className="sub" style={{ fontSize: 16 }}>Radar uses it for every topic, article, and post. You can change it anytime from Business Profile.</p></div>
    <div className="row" style={{ gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <LogoTile brand={p.brand} s={56} />
      <div className="col grow" style={{ gap: 4, minWidth: 240 }}><span className="h2">{p.business.name}</span><span className="sub small">{p.domain} · {p.business.industry}</span><p style={{ marginTop: 6, maxWidth: 520 }}>{p.business.description}</p></div>
      <div className="row" style={{ gap: 6 }}><i style={{ width: 28, height: 28, borderRadius: 8, background: p.brand.primary }} /><i style={{ width: 28, height: 28, borderRadius: 8, background: p.brand.secondary, boxShadow: 'inset 0 0 0 1px oklch(0 0 0 / .08)' }} /></div>
    </div>
    <div className="col" style={{ borderTop: '1px solid var(--line2)' }}>
      {rows.map(([k, v]) => <div key={k} className="row" style={{ padding: '13px 0', borderBottom: '1px solid var(--line2)', alignItems: 'baseline' }}><span className="label sum-l" style={{ width: 130, flex: 'none' }}>{k}</span><span className="grow small" style={{ minWidth: 0 }}>{v}</span></div>)}
    </div>
    <span className="grow" />
    <div className="row" style={{ flexWrap: 'wrap' }}><Btn kind="ghost" icon="back" onClick={back}>Back</Btn><span className="grow" /><Btn kind="primary" size="lg" loading={busy} onClick={onSave}>Save profile &amp; open dashboard</Btn></div>
  </div>;
}
