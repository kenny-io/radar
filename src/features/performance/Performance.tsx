'use client';
// Performance (Search + AI Visibility) — port of prototype/radar-performance.jsx.
// Data: gsc.search / suggestions.list / visibility.list read actions; writes go through server actions and jobs.
import { BrandIcon } from '@/components/brand';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, Metric, PageHead, Section, Seg, Sheet, Skel, Status, Tabs } from '@/components/ui';
import { GscConnect } from '@/features/gsc/GscConnect';
import { CopyPrompt } from '@/components/CopyPrompt';
import { AI_ENGINES } from '@/lib/constants';
import { fmtD, fmtDW, fmtN } from '@/lib/format';
import { buildSuggestionPrompt, type SuggestionPromptSelection } from '@/lib/suggestionPrompt';
import type { AiPrompt, AiResult, Workspace } from '@/lib/types';

type MK = 'clicks' | 'impr' | 'ctr' | 'pos';
interface Pt { d: string; clicks: number; impr: number; ctr: number; pos: number }
interface Tot { clicks: number; impr: number; ctr: number; pos: number }
interface QRow { q: string; clicks: number; impr: number; ctr: number; pos: number }
interface PRow { path: string; url: string; title: string; clicks: number; impr: number; ctr: number; pos: number }
interface SearchData { cur: Tot; prev: Tot | null; series: Pt[]; queries: QRow[]; pages: PRow[]; kw: Record<string, QRow | null>; property: string }
interface Diff { title: [string, string] | null; meta: [string, string] | null; blocks: ['add' | 'edit', string, string][] }
interface Sugg { id: string; prio: 'High' | 'Medium' | 'Low'; title: string; why: string; impact: string; page: string; url?: string; kind: string; state: 'open' | 'calendar' | 'dismissed'; diff: Diff }
interface Vis { prompts: AiPrompt[]; results: AiResult[]; lastCollected: string | null }

const METRICS: { k: MK; l: string; f: (v: number) => string }[] = [{ k: 'clicks', l: 'Clicks', f: v => fmtN(Math.round(v)) }, { k: 'impr', l: 'Impressions', f: v => fmtN(Math.round(v)) }, { k: 'ctr', l: 'CTR', f: v => (v * 100).toFixed(1) + '%' }, { k: 'pos', l: 'Avg. position', f: v => v.toFixed(1) }];

function LineChart({ data, k, fmt, height = 240 }: { data: Pt[]; k: MK; fmt: (v: number) => string; height?: number }) {
  const wrap = useRef<HTMLDivElement>(null); const [w, setW] = useState(800); const [hov, setHov] = useState<number | null>(null);
  useEffect(() => { const ro = new ResizeObserver(([e]) => setW(e.contentRect.width)); ro.observe(wrap.current!); return () => ro.disconnect(); }, []);
  const vals = data.map(d => d[k]); const inv = k === 'pos'; let mn = Math.min(...vals), mx = Math.max(...vals); const pad = (mx - mn) * .15 || 1; mn -= pad; mx += pad;
  const H = height, L = 0, R = w, T = 12, Bm = H - 26; const n1 = Math.max(1, data.length - 1);
  const x = (i: number) => L + i / n1 * (R - L); const y = (v: number) => inv ? T + (v - mn) / (mx - mn) * (Bm - T) : Bm - (v - mn) / (mx - mn) * (Bm - T);
  const d = data.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[k]).toFixed(1)).join(' ');
  const [drawn, setDrawn] = useState(false); useEffect(() => { setDrawn(false); const t = setTimeout(() => setDrawn(true), 30); return () => clearTimeout(t); }, [k, data.length]);
  const ticks = [...new Set([0, Math.floor(data.length / 2), data.length - 1])];
  return <div ref={wrap} style={{ position: 'relative', width: '100%', minWidth: 0, overflow: 'hidden' }} onMouseLeave={() => setHov(null)} onMouseMove={e => { const r = wrap.current!.getBoundingClientRect(); const i = Math.round((e.clientX - r.left) / r.width * (data.length - 1)); setHov(Math.max(0, Math.min(data.length - 1, i))); }}>
    <svg width={w} height={H} style={{ display: 'block', overflow: 'visible' }}>
      {[0, .5, 1].map(t => <line key={t} x1={0} x2={w} y1={T + t * (Bm - T)} y2={T + t * (Bm - T)} stroke="var(--line2)" />)}
      <path d={d + ` L${x(data.length - 1)} ${Bm} L0 ${Bm}Z`} fill="oklch(0.66 0.19 42 / .07)" style={{ opacity: drawn ? 1 : 0, transition: 'opacity .8s .4s' }} />
      <path d={d} fill="none" stroke="var(--signal)" strokeWidth="1.8" strokeLinejoin="round" pathLength="1" strokeDasharray="1" strokeDashoffset={drawn ? 0 : 1} style={{ transition: 'stroke-dashoffset 1.2s var(--ease)' }} />
      {ticks.map(i => <text key={i} x={x(i)} y={H - 6} fontSize="11" fill="var(--mute)" textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} fontFamily="var(--mono)">{fmtD(data[i].d)}</text>)}
      {hov != null && <g><line x1={x(hov)} x2={x(hov)} y1={T} y2={Bm} stroke="var(--ink)" strokeWidth="1" opacity=".25" /><circle cx={x(hov)} cy={y(data[hov][k])} r="4.5" fill="var(--surface)" stroke="var(--signal)" strokeWidth="2" /></g>}
    </svg>
    {hov != null && <div style={{ position: 'absolute', left: Math.min(Math.max(x(hov) - 60, 0), w - 130), top: -6, background: 'var(--night)', color: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, pointerEvents: 'none', whiteSpace: 'nowrap' }}><span style={{ opacity: .7 }}>{fmtD(data[hov].d)}</span> · <span className="num">{fmt(data[hov][k])}</span></div>}
  </div>;
}

export function Performance() {
  const app = useApp();
  const [tab, setTab] = useState<'search' | 'ai'>('search');
  if (!app.B) return null;
  return <div className="page">
    <PageHead title="Performance" sub={tab === 'search' ? 'How people find you in Google, and what to improve next.' : 'How AI assistants answer the questions your customers ask.'} />
    <Tabs value={tab} onChange={setTab} items={[{ v: 'search', l: 'Search' }, { v: 'ai', l: 'AI Visibility' }]} style={{ marginBottom: 32, marginTop: -12 }} />
    <div key={tab} className="enter">{tab === 'search' ? <SearchTab /> : <AiTab />}</div>
  </div>;
}

const SyncSkel = () => <><Skel h={240} style={{ borderRadius: 14 }} /><Skel h={18} w="60%" /><Skel h={18} w="40%" /></>;

function SearchTab() {
  const app = useApp(); const B = app.B!; const { toast } = app; const g = B.gsc;
  const [range, setRange] = useState<7 | 28 | 90>(28); const [m, setM] = useState<MK>('clicks'); const [diff, setDiff] = useState<Sugg | null>(null); const [tbl, setTbl] = useState<'keywords' | 'queries' | 'pages'>('keywords'); const [done, setDone] = useState<Record<string, string>>({});
  const [data, setData] = useState<SearchData | null | undefined>(undefined);
  const [suggs, setSuggs] = useState<Sugg[] | null>(null);
  const [resuming, setResuming] = useState(false);
  const live = g.status === 'connected' || g.status === 'error';
  const sjob = app.jobFor('suggestions.generate', B.id);
  useEffect(() => {
    if (!live) return; let off = false;
    app.act<SearchData | null>('gsc.search', { days: range }, { silent: true }).then(d => { if (!off) setData(d); }).catch(() => { if (!off) setData(null); });
    return () => { off = true; };
  }, [live, range, g.lastSyncedThrough, g.property]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!live) return; let off = false;
    app.act<Sugg[]>('suggestions.list', {}, { silent: true }).then(s => { if (!off) setSuggs(s || []); }).catch(() => { if (!off) setSuggs([]); });
    return () => { off = true; };
  }, [live, g.lastSyncedThrough, B.counts.highSuggestions, sjob?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (g.status === 'none' || g.status === 'skipped') return <div className="col" style={{ gap: 22, padding: '20px 0 40px', maxWidth: 560 }}><h2 className="h2">Connect Search Console to see performance</h2><p className="sub">Radar shows trends, the queries you appear for, and which pages to improve. Until then, topic research uses keyword estimates only.</p><GscConnect bid={B.id} domain={B.profile.domain} compact onConnected={() => toast('Connected. Syncing in the background.', { tone: 'ok' })} /></div>;
  if (g.status === 'syncing') {
    const j = app.jobFor('gsc.backfill', B.id); const pct = Math.max(g.progress || 0, j && (j.status === 'running' || j.status === 'queued') ? (j.progress?.pct || 0) : 0);
    return <div className="col" style={{ gap: 18 }}><Status tone="signal" pulse>Syncing Search Console · {Math.round(pct)}%</Status><p className="sub small">Importing 16 months of data. This page fills in automatically.</p><SyncSkel /></div>;
  }
  const resume = async () => { setResuming(true); try { await app.act('gsc.resume', {}); } catch { /* toasted */ } finally { setResuming(false); } };
  const errRow = g.status === 'error' && <div className="row" style={{ gap: 14, marginBottom: 22, flexWrap: 'wrap' }}><Status tone="bad">Sync paused</Status><span className="small sub grow">Showing data through {fmtD(g.lastSyncedThrough)}. Google returned a temporary error.</span><Btn size="sm" icon="refresh" loading={resuming} onClick={resume}>Resume</Btn></div>;
  if (data === undefined) return <div>{errRow}<div className="col" style={{ gap: 18 }}><SyncSkel /></div></div>;
  if (data === null) return <div>{errRow}{g.status !== 'error' && <p className="sub">Search Console has no data for this property yet.</p>}</div>;
  const agg = data.cur; const pagg = data.prev;
  const mf = METRICS.find(x => x.k === m)!;
  const handled = (s: Sugg) => done[s.id] || (s.state === 'calendar' ? 'In calendar' : s.state === 'dismissed' ? 'Dismissed' : null);
  return <div>
    {errRow}
    <div className="row" style={{ marginBottom: 20, flexWrap: 'wrap', gap: 14 }}><Seg value={range} onChange={setRange} options={[{ v: 7, l: '7 days' }, { v: 28, l: '28 days' }, { v: 90, l: '90 days' }]} /><span className="grow" /><span className="xs sub">Measured · <span className="mono">{g.property}</span></span></div>
    <div className="perf-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', marginBottom: 26 }}>
      <style>{`@media(max-width:700px){.perf-metrics{grid-template-columns:repeat(2,minmax(0,1fr))!important}}`}</style>
      {METRICS.map(x => {
        const on = m === x.k; const dv = pagg && (x.k === 'pos' ? pagg.pos - agg.pos : pagg[x.k] ? (agg[x.k] - pagg[x.k]) / pagg[x.k] * 100 : null);
        return <button key={x.k} onClick={() => setM(x.k)} className="col" style={{ border: 0, background: 'none', padding: '16px 4px 16px 0', textAlign: 'left', cursor: 'pointer', gap: 4, position: 'relative' }}>
          <span className="xs" style={{ color: on ? 'var(--ink)' : 'var(--mute)', fontWeight: on ? 500 : 400 }}>{x.l}</span>
          <span className="row" style={{ gap: 8, alignItems: 'baseline' }}><span className="num" style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em', color: on ? 'var(--ink)' : 'var(--ink2)' }}>{x.f(agg[x.k])}</span>{dv != null && <span className="xs num" style={{ color: dv >= 0 ? 'var(--ok)' : 'var(--bad)' }}>{dv >= 0 ? '+' : ''}{x.k === 'pos' ? dv.toFixed(1) : Math.round(dv) + '%'}</span>}</span>
          {on && <i style={{ position: 'absolute', left: 0, right: 16, top: -1, height: 2, background: 'var(--signal)' }} />}
        </button>;
      })}
    </div>
    {data.series.length > 0 && <LineChart data={data.series} k={m} fmt={mf.f} />}
    {suggs === null ? <Section title="What to improve" sub="Ranked by expected impact"><div className="col" style={{ gap: 12 }}><Skel h={18} w="60%" /><Skel h={18} w="40%" /></div></Section>
      : suggs.length > 0 && <Section title="What to improve" sub="Ranked by expected impact">
        <div>{suggs.map((s, i) => { const h = handled(s); return <div key={s.id} className="row perf-sg" style={{ padding: '18px 0', borderTop: i ? '1px solid var(--line2)' : 0, gap: 18, alignItems: 'flex-start', flexWrap: 'wrap', opacity: h ? .5 : 1 }}>
          <span style={{ width: 84, flex: 'none', paddingTop: 2 }}><Status tone={s.prio === 'High' ? 'signal' : s.prio === 'Medium' ? 'ink' : 'mute'}>{s.prio}</Status></span>
          <span className="col grow" style={{ gap: 4, minWidth: 240 }}><span style={{ fontWeight: 500 }}>{s.title}</span><span className="small sub" style={{ maxWidth: 620 }}>{s.why}</span><span className="xs" style={{ color: 'var(--ink2)', marginTop: 2 }}>{s.impact}</span></span>
          {h && <Status tone="ok">{h}</Status>}<Btn size="sm" onClick={() => setDiff(s)}>Review changes</Btn>
        </div>; })}</div>
      </Section>}
    <Section title={<Seg value={tbl} onChange={setTbl} options={[{ v: 'keywords', l: 'Your keywords' }, { v: 'queries', l: 'Queries' }, { v: 'pages', l: 'Pages' }]} />} action={tbl === 'keywords' && <Btn kind="link" className="small" iconR="chevR" onClick={() => app.go('profile')}>Edit keywords</Btn>}>
      {tbl === 'keywords' ? <TargetKw B={B} kw={data.kw} /> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 520 }}>
        <thead><tr className="xs sub" style={{ textAlign: 'left' }}><th style={{ fontWeight: 400, padding: '8px 0' }}>{tbl === 'queries' ? 'Query' : 'Page'}</th>{['Clicks', 'Impressions', tbl === 'queries' ? 'CTR' : null, 'Position'].filter(Boolean).map(h => <th key={h} style={{ fontWeight: 400, textAlign: 'right', padding: '8px 0 8px 16px' }}>{h}</th>)}</tr></thead>
        <tbody>{(tbl === 'queries' ? data.queries : data.pages).map((r: any, i) => <tr key={i} style={{ borderTop: '1px solid var(--line2)' }}><td style={{ padding: '12px 0' }}>{tbl === 'queries' ? r.q : <span className="col"><span>{r.title}</span><span className="mono sub">{r.path}</span></span>}</td><td className="num" style={{ textAlign: 'right', paddingLeft: 16 }}>{fmtN(r.clicks)}</td><td className="num sub" style={{ textAlign: 'right', paddingLeft: 16 }}>{fmtN(r.impr)}</td>{tbl === 'queries' && <td className="num sub" style={{ textAlign: 'right', paddingLeft: 16 }}>{(r.ctr * 100).toFixed(1)}%</td>}<td className="num" style={{ textAlign: 'right', paddingLeft: 16, color: r.pos > 10 && r.pos < 20 ? 'var(--signal-ink)' : 'inherit' }}>{r.pos.toFixed(1)}</td></tr>)}</tbody>
      </table></div>}
      <p className="xs sub" style={{ marginTop: 10 }}>Positions between 10 and 20 are highlighted — page two, where a refresh usually pays off most.</p>
    </Section>
    <RefreshSheet key={diff?.id} s={diff} onClose={() => setDiff(null)} onDone={(id, label) => { setDone(d => ({ ...d, [id]: label })); setDiff(null); }} />
  </div>;
}

function TargetKw({ B, kw }: { B: Workspace; kw: Record<string, QRow | null> }) {
  const kl = [...(B.profile.keywords?.list || [])].sort((a, b) => (Number(b.priority) - Number(a.priority)) || ((b.vol || 0) - (a.vol || 0)));
  if (!kl.length) return <p className="small sub" style={{ padding: '12px 0' }}>No target keywords yet. Add them in Business Profile.</p>;
  return <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 520 }}>
    <thead><tr className="xs sub" style={{ textAlign: 'left' }}><th style={{ fontWeight: 400, padding: '8px 0' }}>Keyword</th>{['Est. searches', 'Clicks', 'Position'].map(h => <th key={h} style={{ fontWeight: 400, textAlign: 'right', padding: '8px 0 8px 16px' }}>{h}</th>)}</tr></thead>
    <tbody>{kl.map(k => { const m = k.kw in kw ? kw[k.kw] : B.measured[k.kw]; return <tr key={k.kw} style={{ borderTop: '1px solid var(--line2)' }}><td style={{ padding: '12px 0' }}><span className="row" style={{ gap: 8 }}>{k.priority && <i className="dot" style={{ background: 'var(--signal)' }} title="Priority" />}<span style={{ fontWeight: k.priority ? 600 : 400 }}>{k.kw}</span></span></td><td className="num sub" style={{ textAlign: 'right', paddingLeft: 16 }}>{k.vol != null ? '~' + fmtN(k.vol) : '—'}</td><td className="num" style={{ textAlign: 'right', paddingLeft: 16 }}>{m ? fmtN(m.clicks) : <span className="sub">—</span>}</td><td className="num" style={{ textAlign: 'right', paddingLeft: 16, color: m ? (m.pos > 10 && m.pos < 20 ? 'var(--signal-ink)' : 'inherit') : 'var(--mute)' }}>{m ? m.pos.toFixed(1) : 'Not ranking'}</td></tr>; })}</tbody>
  </table></div>;
}

function RefreshSheet({ s, onClose, onDone }: { s: Sugg | null; onClose: () => void; onDone: (id: string, label: string) => void }) {
  const app = useApp(); const { toast } = app; const [busy, setBusy] = useState(false);
  if (!s) return null; const df = s.diff;
  const business = { name: app.B!.profile.business.name, domain: app.B!.profile.domain };
  const prompt = (selection: SuggestionPromptSelection) => buildSuggestionPrompt(s, business, selection);
  const canEdit = app.B!.role !== 'Viewer' && s.state === 'open';
  const seoRow = (l: string, v: [string, string] | null, selection: 'title' | 'meta') => v ? <div className="col" style={{ gap: 8, overflowWrap: 'anywhere' }}><span className="label">{l}</span><div className="col" style={{ gap: 6 }}><span className="small" style={{ color: 'var(--mute)', textDecoration: 'line-through', textDecorationColor: 'var(--faint)' }}>{v[0]}</span><span className="small" style={{ background: 'var(--signal-wash)', padding: '6px 9px', borderRadius: 8 }}>{v[1]}</span></div><CopyPrompt prompt={prompt(selection)} label={`Copy prompt for ${l} on ${s.page}`} /></div> : null;
  const accept = async () => {
    setBusy(true);
    try { const r = await app.act<{ entryId: string; date: string }>('suggestions.accept', { id: s.id }); toast('Added to your calendar for review on ' + fmtDW(r.date), { tone: 'ok' }); onDone(s.id, 'In calendar'); }
    catch { /* toasted */ } finally { setBusy(false); }
  };
  const dismiss = () => { app.act('suggestions.dismiss', { id: s.id }).catch(() => {}); onDone(s.id, 'Dismissed'); };
  return <Sheet open onClose={onClose} width={560} eyebrow={'Suggested changes · ' + s.page} title={s.title} footer={canEdit ? <><Btn kind="ghost" onClick={dismiss} disabled={busy}>Dismiss</Btn><span className="grow" /><Btn kind="primary" icon="check" loading={busy} onClick={accept}>Add to calendar for review</Btn></> : <Btn kind="ghost" onClick={onClose}>Close</Btn>}>
    <div className="col" style={{ gap: 26 }}>
      <p className="small sub">{s.why}</p>
      <div className="col" style={{ gap: 10 }}><p className="small sub">Copy a prompt and paste it into your coding agent to implement these changes.</p><CopyPrompt prompt={prompt('all')} label={`Copy all suggested changes for ${s.page}`} all /></div>
      {seoRow('SEO title', df.title, 'title')}{seoRow('Meta description', df.meta, 'meta')}
      {df.blocks.length > 0 && <div className="col" style={{ gap: 2 }}><span className="label" style={{ marginBottom: 6 }}>Content changes</span>{df.blocks.map(([k, h, d], i) => <div key={i} className="row" style={{ padding: '12px 0', borderTop: '1px solid var(--line2)', alignItems: 'flex-start', gap: 12 }}><span className="mono" style={{ width: 40, flex: 'none', color: k === 'add' ? 'var(--ok)' : 'var(--signal-ink)', paddingTop: 2 }}>{k === 'add' ? '+ add' : '~ edit'}</span><div className="col" style={{ gap: 8, minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}><div className="col"><span className="small" style={{ fontWeight: 500 }}>{h}</span><span className="small sub">{d}</span></div><CopyPrompt prompt={prompt({ block: i })} label={`Copy prompt for content change ${i + 1}: ${h} on ${s.page}`} /></div></div>)}</div>}
      <p className="xs sub">Copying a prompt does not change your site or add this suggestion to your calendar.</p>
    </div>
  </Sheet>;
}

/* ── AI Visibility ── */
const hostOf = (u: string) => { try { return new URL(/^https?:/i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const ownCite = (u: string, domain: string) => { const h = hostOf(u); const d = domain.replace(/^www\./, '').toLowerCase(); return !!h && (h === d || h.endsWith('.' + d)); };
const citeL = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function highlight(text: string, names: string[]) {
  const ns = names.filter(n => n && n.length > 1);
  if (!ns.length) return text;
  const re = new RegExp(`(${ns.map(esc).join('|')})`, 'gi');
  return text.split(re).map((t, i) => (i % 2 ? <mark key={i} className="mark-hl" style={{ background: undefined, color: 'inherit' }}>{t}</mark> : t));
}

function AiResultS({ r }: { r: AiResult }) {
  if (r.status === 'mentioned') return <Status tone="ok">Mentioned{r.pos ? ' · #' + r.pos : ''}</Status>;
  if (r.status === 'not-mentioned') return <Status tone="ink" style={{ color: 'var(--ink2)' }}>Not mentioned</Status>;
  return <span className="status" style={{ color: 'var(--mute)' }}><i className="dot" style={{ background: 'transparent', border: '1.3px dashed var(--faint)' }} />Not collected</span>;
}
function AiCell({ r }: { r: AiResult }) {
  if (r.collecting) return <Status tone="signal" pulse>…</Status>;
  if (r.status === 'mentioned') return <span className="status num" style={{ color: 'var(--ok)', fontWeight: 500 }}><i className="dot" style={{ background: 'var(--ok)' }} />{'#' + r.pos}</span>;
  if (r.status === 'not-mentioned') return <span className="status num" style={{ color: 'var(--ink2)' }}><i className="dot" style={{ background: 'var(--ink)' }} />0</span>;
  return <span className="status" style={{ color: 'var(--mute)' }}><i className="dot" style={{ background: 'transparent', border: '1.3px dashed var(--faint)' }} />No data</span>;
}

function AiTab() {
  const app = useApp(); const B = app.B!; const { toast } = app;
  const [vis, setVis] = useState<Vis | null>(null); const [open, setOpen] = useState<string | null>(null); const [np, setNp] = useState(''); const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Record<string, string>>({}); // resultId → jobId
  const load = useCallback(() => app.act<Vis>('visibility.list', {}, { silent: true }).then(v => { setVis(v); return v; }).catch(() => null), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [B.rev, load]);
  // Finish "Collect now": refetch when the job is done, then toast.
  useEffect(() => {
    for (const [rid, jid] of Object.entries(pending)) {
      const j = app.jobs[jid] || B.jobs.find(x => x.id === jid);
      if (!j || (j.status !== 'done' && j.status !== 'failed')) continue;
      setPending(p => { const n = { ...p }; delete n[rid]; return n; });
      load().then(v => {
        const r = v?.results.find(x => x.id === rid);
        if (j.status === 'done' && r && r.status !== 'not-collected') toast('Response collected');
        else toast('Radar couldn’t collect a response. Try again later.', { tone: 'bad' });
      });
    }
  }, [app.jobs, B.jobs, pending, load, toast]);
  if (!vis) return <div className="col" style={{ gap: 18 }}><Skel h={56} /><Skel h={18} w="60%" /><Skel h={240} style={{ borderRadius: 14 }} /></div>;
  const domain = B.profile.domain; const bizName = B.profile.business.name;
  const rows: AiResult[] = vis.results.map(r => { const j = pending[r.id] ? app.jobs[pending[r.id]] : app.jobFor('visibility.collect', r.id); return { ...r, collecting: !!r.collecting || !!pending[r.id] || (!!j && (j.status === 'queued' || j.status === 'running')) }; });
  const measured = rows.filter(r => r.status !== 'not-collected'); const men = measured.filter(r => r.status === 'mentioned'); const cites = measured.reduce((s, r) => s + r.cites.filter(c => ownCite(c, domain)).length, 0);
  const prompts = vis.prompts.filter(p => rows.some(r => r.promptId === p.id)); const cell = (pid: string, en: string) => rows.find(r => r.promptId === pid && r.engine === en); const cur = rows.find(r => r.id === open);
  const collect = async (id: string) => {
    setPending(p => ({ ...p, [id]: 'pending' }));
    try { const r = await app.act<{ jobId: string }>('visibility.collect', { id }); setPending(p => ({ ...p, [id]: r.jobId })); }
    catch { setPending(p => { const n = { ...p }; delete n[id]; return n; }); }
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); if (np.trim().length < 6) return;
    setAdding(true);
    try { const r = await app.act<Vis>('visibility.addPrompt', { prompt: np.trim() }); setVis(r); setNp(''); toast('Prompt added. First collection runs tonight.'); }
    catch { /* toasted */ } finally { setAdding(false); }
  };
  return <div>
    <div className="row" style={{ gap: '24px 48px', flexWrap: 'wrap', paddingBottom: 24, borderBottom: '1px solid var(--line)', alignItems: 'flex-end' }}>
      <Metric l="Mentioned" v={`${men.length} of ${measured.length}`} /><Metric l="Cited your site" v={cites} /><Metric l="Not collected" v={rows.length - measured.length} />
      <span className="grow" /><span className="col xs sub" style={{ alignItems: 'flex-end', gap: 2 }}><span style={{ whiteSpace: 'nowrap' }}>Last collected {fmtD(vis.lastCollected)}</span></span>
    </div>
    <p className="small sub" style={{ margin: '16px 0 24px', maxWidth: 680 }}>Prompts are built from your target keywords. <span style={{ color: 'var(--ink)' }}>Not mentioned</span> means Radar asked and you weren’t in the answer. <span style={{ color: 'var(--ink)' }}>Not collected</span> means there’s no response yet — it isn’t counted as zero.</p>
    <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 12 }}><span className="small sub grow" style={{ whiteSpace: 'nowrap' }}>{prompts.length} prompts · {AI_ENGINES.length} assistants</span>
      <form className="row vis-add" style={{ gap: 8 }} onSubmit={add}><input className="input" style={{ height: 36, width: 260, fontSize: 14 }} placeholder="Track a new prompt" value={np} onChange={e => setNp(e.target.value)} /><Btn size="sm" icon="plus" type="submit" loading={adding} aria-label="Add prompt" /></form>
    </div>
    <div style={{ overflowX: 'auto' }}><table className="ai-grid" style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr className="xs sub" style={{ textAlign: 'left' }}><th style={{ fontWeight: 400, padding: '10px 8px 10px 0' }}>Prompt</th>{AI_ENGINES.map(en => <th key={en} style={{ fontWeight: 400, padding: '10px 4px', width: 78 }}><span className="row" style={{ gap: 6 }}><BrandIcon k={en} s={14} />{en}</span></th>)}</tr></thead>
      <tbody>{prompts.map(pr => <tr key={pr.id} style={{ borderTop: '1px solid var(--line2)' }}><td style={{ padding: '14px 12px 14px 0', fontSize: 15, textWrap: 'pretty' } as React.CSSProperties}><span className="ai-q">{pr.prompt}</span></td>
        {AI_ENGINES.map(en => { const r = cell(pr.id, en); return <td key={en} data-eng={en} style={{ padding: '6px 0' }}>{r ? <button className="tap" onClick={() => setOpen(r.id)} aria-label={en + ': ' + (r.status === 'mentioned' ? 'mentioned at position ' + r.pos : r.status === 'not-mentioned' ? 'not mentioned' : 'not collected')} style={{ border: 0, background: 'none', borderRadius: 8, padding: '8px', width: '100%', textAlign: 'left', cursor: 'pointer' }}><AiCell r={r} /></button> : null}</td>; })}
      </tr>)}</tbody></table></div>
    <style>{`@media(max-width:640px){.ai-grid thead{display:none}.ai-grid tr{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));padding:12px 0}.ai-grid td:first-child{grid-column:1/-1;padding:0 0 6px!important}.ai-grid td[data-eng]:before{content:attr(data-eng);display:block;font-size:11px;color:var(--mute);padding:0 8px}.ai-grid td[data-eng]{white-space:nowrap;font-size:12px;padding-left:0!important;padding-right:0!important}.ai-grid td[data-eng] button{padding:6px 4px!important}.ai-grid td[data-eng]:before{padding:0 4px}}`}</style>
    <div className="row xs sub" style={{ gap: 20, marginTop: 14, flexWrap: 'wrap' }}><span className="row" style={{ gap: 6 }}><i className="dot" style={{ background: 'var(--ok)' }} />#2 Mentioned, ranked 2nd</span><span className="row" style={{ gap: 6 }}><i className="dot" style={{ background: 'var(--ink)' }} />0 Asked, not mentioned</span><span className="row" style={{ gap: 6 }}><i className="dot" style={{ background: 'transparent', border: '1.3px dashed var(--faint)' }} />No data yet</span></div>
    <Sheet open={!!cur} onClose={() => setOpen(null)} width={540} eyebrow={cur && (cur.engine + ' · ' + (cur.date ? 'collected ' + fmtD(cur.date) : 'not collected'))} title={cur && cur.prompt}>
      {cur && (cur.status === 'not-collected' ? <div className="col" style={{ gap: 14 }}><p className="sub">No response has been collected for this prompt on {cur.engine} yet, so there’s nothing to measure. This isn’t the same as not being mentioned.</p><div className="row"><Btn kind="primary" icon="refresh" loading={cur.collecting} onClick={() => collect(cur.id)}>Collect now</Btn></div></div>
        : <div className="col" style={{ gap: 24 }}><AiResultS r={cur} />
          <div className="col" style={{ gap: 8 }}><span className="label">Response</span><p style={{ fontSize: 16, lineHeight: 1.65, whiteSpace: 'pre-line' }}>{highlight(cur.resp || '', [bizName, domain])}</p></div>
          <div className="col" style={{ gap: 6 }}><span className="label">Citations</span>{cur.cites.length ? cur.cites.map(c => <span key={c} className="row mono" style={{ fontSize: 13, gap: 8, overflowWrap: 'anywhere' }}>{ownCite(c, domain) ? <i className="dot" style={{ background: 'var(--ok)' }} /> : <i className="dot" style={{ background: 'var(--line)' }} />}{citeL(c)}</span>) : <span className="small sub">No sources cited in this response.</span>}</div>
          {cur.status === 'not-mentioned' && <p className="small" style={{ color: 'var(--ink2)' }}>Articles that answer this question directly tend to be cited. <a href="#" onClick={e => { e.preventDefault(); app.go('calendar'); }}>Add a topic to your calendar</a></p>}
        </div>)}
    </Sheet>
  </div>;
}
