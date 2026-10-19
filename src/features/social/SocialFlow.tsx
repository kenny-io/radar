'use client';
// Generate flow — port of SocialFlow + SuggestIdeas (prototype/radar-social.jsx). Generation is the `social.generate`
// job (ref = client token); the "Writing your pack…" rows follow its progress { done }.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, EntryStatus, Field, Icon, LogoTile, Modal, Seg, Skel } from '@/components/ui';
import { Visual } from '@/components/Visual';
import { PLAT, STYLES, plat } from '@/lib/constants';
import type { Platform, PackStyle } from '@/lib/types';

const SF_STEPS: [string, string][] = [['source', 'Source'], ['platforms', 'Platforms'], ['style', 'Image style'], ['brand', 'Brand']];
type Kind = 'idea' | 'url' | 'article' | 'suggest';
export interface IdeaRow { t: string; metric: string; why: string; tie: string | null; page: string | null; q: string }
interface St { step: string; kind: Kind; idea: string; url: string; article: string | null; platforms: Platform[]; style: PackStyle; custom: string; voice: string; picked?: string | null; pickedIdea?: IdeaRow | null }
const GENERIC = 'Radar couldn’t finish this. Try again.';
const newToken = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function SuggestIdeas({ gsc, picked, onPick, onGenerate }: { gsc: boolean; picked?: string | null; onPick: (t: string | null, idea: IdeaRow | null) => void; onGenerate: () => void }) {
  const app = useApp();
  const [loading, setLoading] = useState(true); const [more, setMore] = useState(false);
  const [all, setAll] = useState<IdeaRow[]>([]); const [on, setOn] = useState(gsc); const [failed, setFailed] = useState(false);
  useEffect(() => {
    let off = false; const t0 = Date.now();
    app.act<{ ideas: IdeaRow[]; gsc: boolean }>('social.ideas', {}, { silent: true })
      .then(r => { if (!off) { setAll(r.ideas); setOn(r.gsc); } })
      .catch(() => { if (!off) setFailed(true); })
      .finally(() => { const w = Math.max(0, 600 - (Date.now() - t0)); setTimeout(() => { if (!off) setLoading(false); }, w); });
    return () => { off = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ideas = more ? all : all.slice(0, 5);
  if (loading) return <div className="col"><span className="small sub row" style={{ gap: 8, marginBottom: 10 }}><span className="spin" style={{ color: 'var(--signal)' }} />Reading {gsc ? 'Search Console, ' : ''}your keywords and Business Profile…</span>{[0, 1, 2, 3, 4].map(i => <div key={i} className="col" style={{ gap: 7, padding: '14px 0', borderTop: i ? '1px solid var(--line2)' : 0 }}><Skel w={(64 - i * 5) + '%'} h={15} /><Skel w="40%" h={11} /></div>)}</div>;
  if (failed) return <p className="small sub">{GENERIC}</p>;
  if (!all.length) return <p className="small sub">Add target keywords to your Business Profile and Radar will suggest ideas with real demand behind them.</p>;
  return <div className="col">
    {ideas.map((it, i) => { const sel = picked === it.t; return <div key={it.t} className="enter" style={{ borderTop: i ? '1px solid var(--line2)' : 0, animationDelay: i * 40 + 'ms' }}>
      <button onClick={() => onPick(sel ? null : it.t, sel ? null : it)} aria-expanded={sel} className="row tap" style={{ width: '100%', border: 0, background: 'none', padding: '13px 10px', margin: '0 -10px', borderRadius: 10, textAlign: 'left', cursor: 'pointer', gap: 14, boxSizing: 'content-box' }}>
        <span className="col grow" style={{ gap: 3, minWidth: 0 }}><span style={{ fontWeight: sel ? 600 : 500 }}>{it.t}</span><span className="xs sub trunc">{it.metric}</span></span>
        <Icon n={sel ? 'chevD' : 'chevR'} s={16} style={{ color: 'var(--faint)' }} /></button>
      {sel && <div className="col enter" style={{ gap: 14, padding: '0 0 18px' }}>
        <div className="col" style={{ gap: 6 }}>{([['Why', it.why], ['Ties to', it.tie], ['Links to', it.page]] as [string, string | null][]).filter(r => r[1]).map(([k, v]) => <div key={k} className="row small" style={{ gap: 14, alignItems: 'baseline' }}><span className="sub" style={{ width: 64, flex: 'none' }}>{k}</span><span className="grow">{v}</span></div>)}</div>
        <Btn kind="primary" onClick={onGenerate}>Generate posts</Btn>
      </div>}
    </div>; })}
    <div className="row xs sub" style={{ marginTop: 12, gap: 14, flexWrap: 'wrap' }}>{all.length > 5 && !more && <Btn kind="link" className="xs" onClick={() => setMore(true)}>{all.length - 5} more</Btn>}<span>Ranked by search impact{on ? '' : ' · Search Console not connected'}</span></div>
  </div>;
}

export function SocialFlow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp(); const B = app.B!; const { go, toast } = app;
  const [st, setSt] = useState<St>({ step: 'source', kind: 'idea', idea: '', url: '', article: null, platforms: ['linkedin', 'x'], style: 'branded', custom: '', voice: '' });
  const [gen, setGen] = useState(-1); const [err, setErr] = useState('');
  const [job, setJob] = useState<{ id: string; token: string } | null>(null);
  useEffect(() => { if (open) { setGen(-1); setJob(null); setSt(s => ({ ...s, step: 'source' })); } }, [open]);
  const set = (p: Partial<St>) => { setErr(''); setSt(s => ({ ...s, ...p })); };
  const arts = B.calendar.entries.filter(e => e.status !== 'proposed');
  const srcLabel = st.kind === 'suggest' ? st.picked || '' : st.kind === 'idea' ? st.idea.trim() : st.kind === 'url' ? st.url.trim() : (arts.find(a => a.id === st.article) || { title: '' }).title;
  const next = () => {
    const i = SF_STEPS.findIndex(s => s[0] === st.step);
    if (st.step === 'source') { if (st.kind === 'suggest' && !st.picked) return setErr('Pick an idea to continue.'); if (st.kind === 'idea' && st.idea.trim().length < 8) return setErr('Describe the idea in a few words.'); if (st.kind === 'url' && !/^https?:\/\/\S+\.\S+/.test(st.url.trim())) return setErr('Paste a full URL, starting with https://'); if (st.kind === 'article' && !st.article) return setErr('Choose an article.'); }
    if (st.step === 'platforms' && !st.platforms.length) return setErr('Pick at least one platform.');
    if (st.step === 'style' && st.style === 'custom' && !st.custom.trim()) return setErr('Describe the look you want.');
    if (i < SF_STEPS.length - 1) set({ step: SF_STEPS[i + 1][0] }); else run();
  };
  const back = () => { const i = SF_STEPS.findIndex(s => s[0] === st.step); if (i > 0) set({ step: SF_STEPS[i - 1][0] }); };
  const run = async () => {
    const token = newToken(); setErr(''); setGen(0);
    const source = st.kind === 'article' ? { kind: st.kind, label: srcLabel, ref: st.article } : { kind: st.kind, label: srcLabel };
    try {
      const r = await app.act<{ jobId: string }>('social.generate', { token, source, platforms: st.platforms, style: st.style, custom: st.style === 'custom' ? st.custom : '', voice: st.voice, idea: st.kind === 'suggest' ? st.pickedIdea || null : null }, { silent: true });
      setJob({ id: r.jobId, token });
    } catch (e: any) { setGen(-1); setErr(e?.message || GENERIC); }
  };

  // Follow the job: live SSE progress, with a polling fallback.
  const live = job ? app.jobs[job.id] || app.jobFor('social.generate', job.token) : null;
  const [polled, setPolled] = useState<any>(null);
  const finished = useRef<string | null>(null);
  useEffect(() => {
    if (!job) { setPolled(null); return; }
    let off = false;
    const tick = async () => { try { const j = await app.act('job.get', { id: job.id }, { silent: true }); if (!off && j) setPolled(j); } catch { /* */ } };
    const iv = setInterval(tick, 1200); tick();
    return () => { off = true; clearInterval(iv); };
  }, [job]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = useMemo(() => {
    const cands = [live, polled && polled.id === job?.id ? polled : null].filter(Boolean) as any[];
    const end = cands.find(j => j.status === 'done' || j.status === 'failed');
    if (end) return end;
    return cands.sort((a, b) => ((b.progress?.done ?? 0) - (a.progress?.done ?? 0)))[0] || null;
  }, [live, polled, job]);
  useEffect(() => {
    if (!job || !cur) return;
    const d = cur.progress && typeof cur.progress.done === 'number' ? cur.progress.done : 0;
    setGen(g => (g >= 0 ? Math.max(g, d) : g));
    if (cur.status === 'failed' && finished.current !== job.id) { finished.current = job.id; setJob(null); setGen(-1); setErr(cur.error || GENERIC); }
    if (cur.status === 'done' && finished.current !== job.id) {
      const packId = cur.result && cur.result.packId;
      if (!packId) return; // wait for the polled result
      finished.current = job.id; setGen(st.platforms.length);
      (async () => { await app.refresh(); setJob(null); onClose(); go('social', { pack: packId }); toast('Pack saved to your library', { tone: 'ok' }); })();
    }
  }, [cur, job]); // eslint-disable-line react-hooks/exhaustive-deps

  const idx = SF_STEPS.findIndex(s => s[0] === st.step); const brand = B.profile.brand;
  const previewHead = B.profile.business.differentiators[0] || B.profile.business.name || 'Your brand';
  return <Modal open={open} onClose={gen >= 0 ? null : onClose} dismissable={gen < 0} width={820}><div className="col" style={{ minHeight: 'min(620px,calc(100vh - 48px))' }}>
    <div className="row" style={{ padding: '20px 28px', borderBottom: '1px solid var(--line2)' }}><span className="h3 grow">Generate social posts</span>
      <nav className="row hide-sm" style={{ gap: 18 }}>{SF_STEPS.map(([k, l], i) => <span key={k} className="row small" style={{ gap: 6, color: i === idx ? 'var(--ink)' : i < idx ? 'var(--ink2)' : 'var(--faint)', fontWeight: i === idx ? 500 : 400 }}>{i < idx ? <Icon n="check" s={13} w={2} /> : <i className="dot" style={{ background: i === idx ? 'var(--signal)' : 'var(--line)' }} />}{l}</span>)}</nav>
      {gen < 0 && <Btn kind="ghost" icon="x" onClick={onClose} aria-label="Close" style={{ marginLeft: 8 }} />}</div>
    <div key={st.step + (gen >= 0)} className="grow col enter" style={{ padding: '30px clamp(20px,4vw,40px)', gap: 22 }}>
      {gen >= 0 ? <div className="col" style={{ gap: 4, maxWidth: 520 }}><h2 className="h1" style={{ fontSize: 24, marginBottom: 16 }}>Writing your pack…</h2>{st.platforms.map((k, i) => <div key={k} className="row" style={{ height: 46, borderTop: i ? '1px solid var(--line2)' : 0, opacity: i > gen ? .4 : 1 }}><span style={{ width: 20 }}>{i < gen ? <Icon n="check" s={15} w={2} style={{ color: 'var(--ok)' }} /> : i === gen ? <span className="spin" style={{ color: 'var(--signal)' }} /> : <i className="dot" style={{ background: 'var(--line)' }} />}</span><span className="grow">{plat(k).l}</span>{i < gen && <span className="small sub">Copy + visual</span>}</div>)}</div>
        : st.step === 'source' ? <>
          <div className="col" style={{ gap: 6 }}><h2 className="h1" style={{ fontSize: 24 }}>What should the posts be about?</h2></div>
          <Seg value={st.kind} onChange={k => set({ kind: k })} options={[{ v: 'idea' as Kind, l: 'An idea' }, { v: 'url' as Kind, l: 'Article URL' }, { v: 'article' as Kind, l: 'Radar article' }, { v: 'suggest' as Kind, l: 'Suggest ideas' }]} />
          {st.kind === 'suggest' && <SuggestIdeas gsc={B.gsc.status === 'connected' || B.gsc.status === 'error'} picked={st.picked} onPick={(t, it) => set({ picked: t, pickedIdea: it })} onGenerate={run} />}
          {st.kind === 'idea' && <textarea autoFocus className="input" rows={4} style={{ fontSize: 16 }} placeholder="e.g. Why most freelancers undercharge in their first year" value={st.idea} onChange={e => set({ idea: e.target.value })} />}
          {st.kind === 'idea' && !st.idea.trim() && <Btn kind="link" className="small" style={{ alignSelf: 'flex-start' }} onClick={() => set({ kind: 'suggest' })}>Not sure what to post? Let Radar suggest ideas</Btn>}
          {st.kind === 'url' && <input autoFocus className="input" style={{ height: 50, fontSize: 16 }} placeholder="https://" value={st.url} onChange={e => set({ url: e.target.value })} />}
          {st.kind === 'article' && (arts.length ? <div className="col" style={{ border: '1px solid var(--line)', borderRadius: 14, maxHeight: 280, overflow: 'auto' }}>{arts.map((a, i) => <label key={a.id} className="row tap" style={{ padding: '12px 16px', borderTop: i ? '1px solid var(--line2)' : 0, cursor: 'pointer' }}><input type="radio" checked={st.article === a.id} onChange={() => set({ article: a.id })} style={{ accentColor: 'var(--ink)' }} /><span className="grow trunc">{a.title}</span><EntryStatus s={a.status} /></label>)}</div>
            : <p className="sub small">No approved Radar articles yet. <a href="#" onClick={e => { e.preventDefault(); onClose(); go('calendar'); }}>Open the calendar</a> or use an idea instead.</p>)}
        </>
          : st.step === 'platforms' ? <>
            <div className="row"><h2 className="h1 grow" style={{ fontSize: 24 }}>Where will you post?</h2><Btn kind="link" className="small" onClick={() => set({ platforms: st.platforms.length === PLAT.length ? [] : PLAT.map(p => p.k) })}>{st.platforms.length === PLAT.length ? 'Clear' : 'Select all'}</Btn></div>
            <div className="grid-2" style={{ gap: 12 }}>{PLAT.map(p => { const on = st.platforms.includes(p.k); return <button key={p.k} aria-pressed={on} onClick={() => set({ platforms: on ? st.platforms.filter(x => x !== p.k) : [...st.platforms, p.k] })} className="row" style={{ padding: '16px 18px', borderRadius: 14, border: '1px solid ' + (on ? 'var(--ink)' : 'var(--line)'), background: 'var(--surface)', boxShadow: on ? 'inset 0 0 0 1px var(--ink)' : 'none', textAlign: 'left', cursor: 'pointer', transition: 'all .2s', gap: 14 }}>
              <span className="col grow"><span style={{ fontWeight: 500 }}>{p.l}</span><span className="small sub">{p.d}</span></span><span style={{ width: 22, height: 22, borderRadius: 99, border: on ? 0 : '1.5px solid var(--line)', background: on ? 'var(--ink)' : 'transparent', color: '#fff', display: 'grid', placeItems: 'center' }}>{on && <Icon n="check" s={13} w={2.4} />}</span></button>; })}</div>
          </>
            : st.step === 'style' ? <>
              <h2 className="h1" style={{ fontSize: 24 }}>Choose an image style</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 14 }}>{STYLES.map(s => { const on = st.style === s.k; return <button key={s.k} onClick={() => set({ style: s.k })} className="col" style={{ gap: 8, border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ borderRadius: 14, boxShadow: on ? '0 0 0 2px var(--ink)' : '0 0 0 1px var(--line)', padding: 3, transition: 'box-shadow .2s' }}><Visual style={s.k} brand={brand} headline={previewHead} seed={3} name="" radius={10} ratio={1} /></span>
                <span className="small" style={{ fontWeight: on ? 500 : 400, paddingLeft: 2 }}>{s.l}</span></button>; })}</div>
              {st.style === 'custom' && <textarea autoFocus className="input enter" rows={2} placeholder="e.g. Hand-drawn ink sketches on cream paper, lots of whitespace" value={st.custom} onChange={e => set({ custom: e.target.value })} />}
            </>
              : <>
                <div className="col" style={{ gap: 6 }}><h2 className="h1" style={{ fontSize: 24 }}>Your brand, applied</h2><p className="sub">Inherited from your Business Profile. Change it there to update every future pack.</p></div>
                <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}><LogoTile brand={brand} s={52} />{([['Primary', brand.primary], ['Secondary', brand.secondary]] as [string, string][]).map(([l, c]) => <span key={l} className="row" style={{ gap: 10 }}><i style={{ width: 36, height: 36, borderRadius: 10, background: c, boxShadow: 'inset 0 0 0 1px oklch(0 0 0 / .08)' }} /><span className="col"><span className="xs sub">{l}</span><span className="mono">{c}</span></span></span>)}</div>
                <Field label="Voice"><p style={{ padding: '2px 0' }}>{B.profile.brand.voice}</p></Field>
                <Field label="Notes for this pack" hint="Optional. Applies to this pack only."><input className="input" placeholder="e.g. More playful than usual" value={st.voice} onChange={e => set({ voice: e.target.value })} /></Field>
                <Btn kind="link" className="small" style={{ alignSelf: 'flex-start' }} onClick={() => { onClose(); go('profile'); }}>Edit Business Profile</Btn>
              </>}
      {err && <span className="small" style={{ color: 'var(--bad)' }}>{err}</span>}
    </div>
    {gen < 0 && <div className="row" style={{ padding: '16px 28px', borderTop: '1px solid var(--line2)' }}>{idx > 0 && <Btn kind="ghost" icon="back" onClick={back}>Back</Btn>}<span className="grow" /><Btn kind="primary" iconR={st.step === 'brand' ? null : 'arrow'} onClick={next}>{st.step === 'brand' ? `Generate ${st.platforms.length} post${st.platforms.length > 1 ? 's' : ''}` : 'Continue'}</Btn></div>}
  </div></Modal>;
}
