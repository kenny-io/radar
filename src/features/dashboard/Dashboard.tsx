'use client';
// Dashboard — port of prototype/radar-dashboard.jsx (Dashboard, dashIssues, PerfSummary, DashEmpty, CalMotif, PostMotif).
import React, { useEffect, useState } from 'react';
import { useApp, type AppCtx } from '@/client/app';
import { Btn, EntryStatus, Icon, Metric, Section, Skel, Spark, Status } from '@/components/ui';
import { PackThumb } from '@/features/social/PackThumb';
import { platLabel } from '@/lib/constants';
import { fmtD, fmtDW, fmtN } from '@/lib/format';
import type { Brand, Workspace } from '@/lib/types';

function greet() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

interface Suggestion { id: string; prio: string; title: string; why: string; impact: string; page: string; kind: string; state: string }
interface Issue { id: string; tone: 'bad' | 'warn' | 'signal'; label: string; head: string; body: string; btn: React.ReactNode; btnSmall: React.ReactNode }
interface Summary { cur: { clicks: number; impr: number; ctr: number; pos: number }; prev: { clicks: number; impr: number; ctr: number; pos: number } | null; series: { d: string; clicks: number }[] }

export function Dashboard() {
  const app = useApp(); const { B, go } = app;
  const top = useTopSuggestion(app);
  if (!B) return null;
  const cal = B.calendar.entries; const packs = B.social.packs;
  const first = (app.user.name || '').split(' ')[0];
  if (!cal.length && !packs.length) return <DashEmpty first={first} />;
  const review = cal.filter(e => e.status === 'review');
  const upcoming = cal.filter(e => e.date >= B.today && ['approved', 'scheduled', 'draft', 'proposed'].includes(e.status)).slice(0, 5);
  const issues = dashIssues(app, B, top);
  let head: React.ReactNode, act: React.ReactNode;
  if (review.length) { head = `${review.length} article${review.length > 1 ? 's are' : ' is'} ready for your review.`; act = <Btn kind="primary" size="lg" iconR="arrow" onClick={() => go('article', review[0].id)}>Review “{review[0].title.length > 34 ? review[0].title.slice(0, 32) + '…' : review[0].title}”</Btn>; }
  else if (issues.some(i => i.tone !== 'signal')) { const i0 = issues.find(i => i.tone !== 'signal')!; head = i0.head; act = i0.btn; }
  else if (!cal.length) { head = 'Plan the next 30 days of articles.'; act = <Btn kind="primary" size="lg" icon="calendar" onClick={() => go('calendar')}>Generate your content calendar</Btn>; }
  else {
    const pr = cal.filter(e => e.status === 'proposed').length; const sg = issues.find(i => i.tone === 'signal');
    if (!pr && sg) { head = sg.head; act = sg.btn; } else head = pr ? `${pr} proposed topics are waiting for approval.` : 'You’re set for the week.';
    act = act || (pr ? <Btn kind="primary" size="lg" iconR="arrow" onClick={() => go('calendar')}>Review topics</Btn> : <Btn kind="secondary" size="lg" icon="social" onClick={() => go('social', { generate: true })}>Create social posts</Btn>);
  }
  return <div className="page">
    <div className="col enter" style={{ gap: 18, marginBottom: 44 }}>
      <span className="sub">{greet()}, {first}.</span>
      <h1 className="h-display" style={{ maxWidth: 760 }}>{head}</h1>
      <div className="row" style={{ flexWrap: 'wrap', marginTop: 6 }}>{act}</div>
    </div>
    <PerfSummary />
    {issues.length > 0 && <Section title="Needs attention"><div>{issues.map(i => <div key={i.id} className="list-row" style={{ flexWrap: 'wrap' }}><Status tone={i.tone} pulse={i.tone === 'bad'}>{i.label}</Status><span className="grow small sub" style={{ minWidth: 200 }}>{i.body}</span>{i.btnSmall}</div>)}</div></Section>}
    <div className="grid-2" style={{ gap: 48 }}>
      <Section title="Upcoming articles" style={{ minWidth: 0 }} action={<Btn kind="link" size="sm" iconR="chevR" onClick={() => go('calendar')}>Calendar</Btn>}>
        {upcoming.length ? <div>{upcoming.map(e => <div key={e.id} className="list-row tap" style={{ margin: '0 -10px', padding: '12px 10px', borderRadius: 10 }} onClick={() => go('calendar', { open: e.id })}>
          <span className="mono sub" style={{ width: 52, flex: 'none' }}>{fmtD(e.date)}</span><span className="grow trunc">{e.title}</span><EntryStatus s={e.status} /></div>)}</div> : <p className="sub small" style={{ padding: '12px 0' }}>Nothing scheduled. <a href="#" onClick={e => { e.preventDefault(); go('calendar'); }}>Open the calendar</a></p>}
      </Section>
      <Section title="Awaiting review" style={{ minWidth: 0 }}>
        {review.length ? <div>{review.map(e => <div key={e.id} className="list-row tap" style={{ margin: '0 -10px', padding: '12px 10px', borderRadius: 10 }} onClick={() => go('article', e.id)}>
          <span className="col grow" style={{ minWidth: 0 }}><span className="trunc">{e.title}</span><span className="xs sub">Publishes {fmtDW(e.date)}</span></span><Icon n="chevR" s={16} style={{ color: 'var(--faint)' }} /></div>)}</div> : <p className="sub small" style={{ padding: '12px 0' }}>No drafts waiting. Generated articles appear here before they publish.</p>}
      </Section>
    </div>
    <Section title="Recent social packs" action={<Btn kind="link" size="sm" iconR="chevR" onClick={() => go('social')}>All packs</Btn>}>
      {packs.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 16 }}>{packs.slice(0, 4).map(p => <PackThumb key={p.id} p={p} brand={B.profile.brand} onClick={() => go('social', { pack: p.id })} />)}</div>
        : <div className="row" style={{ padding: '12px 0', gap: 16, flexWrap: 'wrap' }}><p className="sub small grow">No packs yet. Turn an idea or article into posts for every platform.</p><Btn icon="social" onClick={() => go('social', { generate: true })}>Create social posts</Btn></div>}
    </Section>
  </div>;
}

/** Top open High suggestion (Performance → What to improve), loaded only when the workspace says there are some. */
function useTopSuggestion(app: AppCtx): { top: Suggestion | null; highs: Suggestion[] } | null {
  const n = app.B?.counts.highSuggestions || 0; const rev = app.B?.rev; const bid = app.bid;
  const [s, setS] = useState<{ top: Suggestion | null; highs: Suggestion[] } | null>(null);
  useEffect(() => {
    if (!n || !bid) { setS(null); return; }
    let live = true;
    app.act<Suggestion[]>('suggestions.list', {}, { silent: true })
      .then(list => { if (!live) return; const highs = (list || []).filter(x => x.state === 'open' && x.prio === 'High'); setS({ top: highs[0] || null, highs }); })
      .catch(() => { if (live) setS(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, bid, rev]);
  return s;
}

const NUM_WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const numWord = (n: number) => NUM_WORD[n] || String(n);
/** "Refresh “Scope creep: a field guide”" → "Scope creep"; otherwise the page path. */
function subjectOf(s: Suggestion) { const m = s.title.match(/“([^”]+)”/); return m ? m[1].split(/[:—–]/)[0].trim() : s.page; }
/** "Est. +80–140 clicks / month" → "80–140" (null when the impact isn't a click estimate). */
function clicksOf(impact: string) { const m = impact.match(/\+?\s*([\d,]+(?:\s*[–-]\s*[\d,]+)?)\s*clicks/i); return m ? m[1].replace(/\s*-\s*/, '–') : null; }

/** The "{n} high-priority suggestions" issue, phrased like the prototype from the user's real top suggestion. */
function suggestionIssue(app: AppCtx, n: number, sg: { top: Suggestion | null; highs: Suggestion[] } | null): Issue | null {
  if (!n || !sg || !sg.top) return null;
  const t = sg.top; const go = app.go;
  const same = sg.highs.filter(h => h.kind === t.kind).length || 1;
  const pages = same === 1 ? 'One page' : numWord(same) + ' pages';
  const head = t.kind === 'refresh' ? `${pages} ${same === 1 ? 'is' : 'are'} close to page one.`
    : t.kind === 'meta' ? `${pages} could earn more clicks from the same rankings.`
    : `${numWord(n)} high-priority ${n === 1 ? 'improvement is' : 'improvements are'} ready.`;
  const verb = t.kind === 'refresh' ? 'Refreshing' : t.kind === 'meta' ? 'Rewriting the title on' : t.kind === 'links' ? 'Adding links to' : 'Improving';
  const c = clicksOf(t.impact || '');
  const subj = t.kind === 'refresh' ? `“${subjectOf(t)}”` : t.page;
  const body = c ? `${verb} ${subj} could add ${c} clicks a month.` : `${t.title}.`;
  return { id: 'sug', tone: 'signal', label: `${n} high-priority suggestion${n === 1 ? '' : 's'}`, head, body, btn: <Btn kind="primary" size="lg" iconR="arrow" onClick={() => go('performance')}>See suggestions</Btn>, btnSmall: <Btn size="sm" onClick={() => go('performance')}>Review</Btn> };
}

function dashIssues(app: AppCtx, B: Workspace, sg: { top: Suggestion | null; highs: Suggestion[] } | null): Issue[] {
  const { go, act } = app; const out: Issue[] = [];
  const resumeGsc = () => act('gsc.resume', {}, { optimistic: b => ({ ...b, gsc: { ...b.gsc, status: 'syncing', error: null } }) }).catch(() => {});
  if (B.gsc.status === 'error') out.push({ id: 'gsc', tone: 'bad', label: 'Search Console sync paused', head: 'Search Console stopped syncing.', body: 'Google returned a temporary error.' + (B.gsc.lastSyncedThrough ? ` Data up to ${fmtD(B.gsc.lastSyncedThrough)} is safe.` : ''), btn: <Btn kind="primary" size="lg" icon="refresh" onClick={resumeGsc}>Resume sync</Btn>, btnSmall: <Btn size="sm" icon="refresh" onClick={resumeGsc}>Resume</Btn> });
  const failed = B.calendar.entries.find(e => e.status === 'failed');
  if (failed) {
    const conn = B.blog.conns.find(c => c.id === (failed.dest || B.blog.defaultId)) || B.blog.conns[0];
    const platform = failed.publishError?.platform || platLabel(conn?.type);
    const http = failed.publishError?.http;
    out.push({ id: 'pub', tone: 'bad', label: 'Publishing failed', head: 'An article didn’t publish.', body: `“${failed.title}” — ${platform} rejected the request${http ? ` (${http})` : ''}.`, btn: <Btn kind="primary" size="lg" onClick={() => go('article', failed.id)}>Fix and retry</Btn>, btnSmall: <Btn size="sm" onClick={() => go('article', failed.id)}>Fix</Btn> });
  }
  const resumePub = () => act('blog.pause', { paused: false }, { optimistic: b => ({ ...b, blog: { ...b.blog, paused: false } }) }).catch(() => {});
  if (B.blog.paused) out.push({ id: 'pause', tone: 'warn', label: 'Publishing paused', head: 'Publishing is paused.', body: 'Scheduled articles will wait until you resume.', btn: <Btn kind="primary" size="lg" icon="play" onClick={resumePub}>Resume publishing</Btn>, btnSmall: <Btn size="sm" icon="play" onClick={resumePub}>Resume</Btn> });
  const s = suggestionIssue(app, B.counts.highSuggestions, sg);
  if (s) out.push(s);
  return out;
}

export function PerfSummary() {
  const app = useApp(); const { B, go } = app;
  const g = B!.gsc;
  const connected = g.status === 'connected' || g.status === 'error';
  const [sum, setSum] = useState<Summary | null | undefined>(undefined); // undefined = loading
  useEffect(() => {
    if (!connected) return;
    let live = true;
    app.act<Summary | null>('gsc.summary', { days: 28 }, { silent: true }).then(r => { if (live) setSum(r ?? null); }).catch(() => { if (live) setSum(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, app.bid, g.lastSyncedThrough]);
  if (g.status === 'none' || g.status === 'skipped') return <div className="card row" style={{ padding: '18px 22px', gap: 16, flexWrap: 'wrap' }}><span className="grow col"><span className="h3">See how you perform in search</span><span className="small sub">Connect Search Console so topics and suggestions use your real data.</span></span><Btn icon="search" onClick={() => go('settings', { gsc: true })}>Connect Search Console</Btn></div>;
  if (g.status === 'syncing') return <div className="card col" style={{ padding: '18px 22px', gap: 12 }}><div className="row"><Status tone="signal" pulse>Syncing Search Console</Status><span className="grow" /><span className="mono sub num">{Math.round(g.progress || 0)}%</span></div><div style={{ height: 2, background: 'var(--line2)', borderRadius: 2, overflow: 'hidden' }}><div style={{ height: '100%', width: (g.progress || 0) + '%', background: 'var(--ink)', transition: 'width .6s var(--ease)' }} /></div><span className="xs sub">Importing 16 months of queries and pages. Keep working — Radar will update recommendations when it’s done.</span></div>;
  const loading = sum === undefined;
  const c = sum?.cur.clicks, pc = sum?.prev?.clicks;
  const d = sum && pc ? Math.round(((c! - pc) / pc) * 100) : null;
  const v = (x: React.ReactNode) => (loading ? <Skel w={64} h={26} style={{ marginTop: 4 }} /> : sum ? x : '—');
  return <div className="card tap" style={{ padding: '20px 24px', cursor: 'pointer' }} onClick={() => go('performance')}>
    <div className="row" style={{ marginBottom: 14 }}><span className="label grow">Search · last 28 days</span></div>
    <div className="row" style={{ gap: '28px 44px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <Metric l="Clicks" v={v(fmtN(c))} d={d} /><Metric l="Impressions" v={v(fmtN(sum?.cur.impr))} /><Metric l="Avg. position" v={v(sum && sum.cur.impr ? sum.cur.pos.toFixed(1) : '—')} />
      <span className="grow" style={{ minWidth: 160 }}>{sum && <Spark data={sum.series.map(x => x.clicks)} w={260} h={40} fill="oklch(0.66 0.19 42 / .08)" color="var(--signal)" />}</span>
    </div>
  </div>;
}

function DashEmpty({ first }: { first: string }) {
  const { go, B } = useApp(); const [hov, setHov] = useState<string | null>(null);
  const tile = (k: string, title: string, body: string, onClick: () => void) => <button className="card col" onMouseEnter={() => setHov(k)} onMouseLeave={() => setHov(null)} onClick={onClick} style={{ textAlign: 'left', padding: 28, gap: 0, cursor: 'pointer', minHeight: 300, position: 'relative', overflow: 'hidden', transition: 'transform .4s var(--ease),box-shadow .4s var(--ease),border-color .3s', transform: hov === k ? 'translateY(-3px)' : 'none', boxShadow: hov === k ? '0 24px 50px -24px oklch(0.2 0.02 265 / .3)' : 'none', borderColor: hov === k ? 'var(--faint)' : 'var(--line)' }}>
    <div className="grow" style={{ position: 'relative', marginBottom: 24, minHeight: 130 }}>{k === 'cal' ? <CalMotif on={hov === k} /> : <PostMotif on={hov === k} brand={B!.profile.brand} />}</div>
    <span className="row" style={{ gap: 10, alignItems: 'center' }}><span className="h2 grow">{title}</span><span style={{ width: 34, height: 34, borderRadius: 99, background: hov === k ? 'var(--ink)' : 'var(--fill)', color: hov === k ? '#fff' : 'var(--ink)', display: 'grid', placeItems: 'center', transition: 'all .3s' }}><Icon n="arrow" s={16} /></span></span>
    <span className="sub small" style={{ marginTop: 6, maxWidth: 360 }}>{body}</span>
  </button>;
  return <div className="page">
    <div className="col enter" style={{ gap: 14, marginBottom: 40 }}><span className="sub">Welcome, {first}.</span><h1 className="h-display">Where would you like to start?</h1><p className="sub" style={{ fontSize: 16, maxWidth: 560 }}>Both use your Business Profile for {B!.profile.business.name}, so everything sounds like you from the first draft.</p></div>
    <div className="grid-2 enter" style={{ animationDelay: '.08s' }}>
      {tile('cal', 'Generate your content calendar', '30 days of articles, researched from your profile, website, and search data.', () => go('calendar', { setup: true }))}
      {tile('soc', 'Create social posts', 'Turn an idea or article into a ready-to-copy pack for LinkedIn, X, and more.', () => go('social', { generate: true }))}
    </div>
    <div style={{ marginTop: 28 }}><PerfSummary /></div>
  </div>;
}

function CalMotif({ on }: { on: boolean }) {
  const cells = Array.from({ length: 28 });
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6, maxWidth: 300 }}>{cells.map((_, i) => <span key={i} style={{ aspectRatio: '1.6', borderRadius: 5, background: on && i < 26 ? (i % 5 === 2 ? 'var(--signal)' : 'var(--ink)') : 'var(--fill)', opacity: on ? (i % 5 === 2 ? 1 : .12 + ((i * 7) % 10) / 40) : 1, transition: `all .5s var(--ease) ${i * 14}ms` }} />)}</div>;
}
function PostMotif({ on, brand }: { on: boolean; brand: Brand }) {
  return <div style={{ position: 'relative', height: 140 }}>{[0, 1, 2].map(i => <span key={i} style={{ position: 'absolute', left: i * 46, top: on ? i * -4 + 10 : 14, width: 150, height: 116, borderRadius: 12, background: i === 2 ? brand.primary : 'var(--surface)', boxShadow: '0 0 0 1px var(--line), 0 10px 24px -14px oklch(0 0 0 / .25)', transform: on ? `rotate(${(i - 1) * 4}deg) translateX(${i * 10}px)` : 'none', transition: `all .55s var(--spring) ${i * 50}ms`, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
    <i style={{ height: 6, width: '60%', borderRadius: 3, background: i === 2 ? brand.secondary : 'var(--line)' }} /><i style={{ height: 6, width: '85%', borderRadius: 3, background: i === 2 ? 'oklch(1 0 0 / .25)' : 'var(--line2)' }} /><i style={{ flex: 1, borderRadius: 6, background: i === 2 ? 'oklch(1 0 0 / .12)' : 'var(--fill)', marginTop: 4 }} /></span>)}</div>;
}
