'use client';
// Daily Brief — port of prototype/radar-brief.jsx on real data (01-screens §4, 02-system §9).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/client/app';
import { AutoText, Btn, Empty, Field, Icon, PageHead, Popover, Seg, Sheet, Status, copyText } from '@/components/ui';
import { PlatLogo } from '@/components/brand';
import { BMENTION, BPLAT, BRIEF_DEFAULT, PORDER } from '@/lib/constants';
import { ageFromIso, ageL, fmtD, fmtTime } from '@/lib/format';
import type { BriefDay, BriefItem, BriefPlatform, BriefSettings, BriefState, JobSummary, Workspace } from '@/lib/types';
import { BriefScan } from './BriefScan';
import { isLive, textOf, variantOf, type BriefScanProgress, type BriefScanResult } from './model';

type Act = { copy: (it: BriefItem) => void; posted: (it: BriefItem) => void; skip: (it: BriefItem) => void; undo: (it: BriefItem) => void };
type Patch = Partial<Pick<BriefItem, 'st' | 'mention' | 'pl'>>;
interface ScanState { jobId: string | null; kind: 'first' | 'again'; platforms: BriefPlatform[]; busy?: boolean }
type ScanJob = (JobSummary & { result?: BriefScanResult | null }) | null;

const allDoneCalc = (items: BriefItem[], isToday: boolean) => isToday && items.length > 0 && !items.some(i => i.st === 'open' || i.st === 'copied');
const ageOf = (it: BriefItem) => ageFromIso(it.postedAt);
const REWRITE_ERROR = 'Radar couldn’t rewrite this. Try again.';

/** Apply a change to one item of one day in the workspace (optimistic), keeping the sidebar count in step. */
function patchB(B: Workspace, day: string, id: string, fn: (i: BriefItem) => BriefItem): Workspace {
  const d = B.brief.days[day]; if (!d) return B;
  const items = d.items.map(i => (i.id === id ? fn(i) : i));
  const days = { ...B.brief.days, [day]: { ...d, items } };
  const t = days[B.today];
  return { ...B, brief: { ...B.brief, days }, counts: { ...B.counts, briefOpen: t ? t.items.filter(i => i.st === 'open' || i.st === 'copied').length : 0 } };
}

/* ── page ─────────────────────────────────────────────── */
export function DailyBrief() {
  const app = useApp(); const { B, toast } = app;
  const today = B!.today;
  const [day, setDay] = useState(today); const [sel, setSel] = useState<string | null>(null); const [scan, setScan] = useState<ScanState | null>(null); const [sheet, setSheet] = useState(false); const [mob] = useState(false);
  const [pendingSel, setPendingSel] = useState<string | null>(null);
  /** Local text the user typed that the server hasn't confirmed yet (per item + variant). */
  const [overlay, setOverlay] = useState<Record<string, Record<string, string>>>({});
  const editTimers = useRef<Record<string, any>>({});
  const detailRef = useRef<HTMLDivElement>(null);
  const br = B!.brief as BriefState;

  const withOverlay = (i: BriefItem): BriefItem => (overlay[i.id] ? { ...i, edits: { ...(i.edits || {}), ...overlay[i.id] } } : i);
  const D: BriefDay | undefined = br.days[day];
  const items = (D ? D.items : []).map(withOverlay);
  const open = items.filter(i => i.st === 'open' || i.st === 'copied');
  const groups = [...PORDER.map(p => ({ k: p as string, l: BPLAT[p], items: items.filter(i => i.kind === 'reply' && i.plat === p) })), { k: 'post', l: 'For your feed', items: items.filter(i => i.kind === 'post') }].filter(g => g.items.length);
  const order = groups.flatMap(g => g.items);
  useEffect(() => { if (!sel || !items.find(i => i.id === sel)) { const f = order.find(i => i.st === 'open' || i.st === 'copied'); setSel(f ? f.id : null); } }, [day, items.map(i => i.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (pendingSel && items.find(i => i.id === pendingSel)) { setSel(pendingSel); setPendingSel(null); } }, [pendingSel, items.map(i => i.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── item writes (optimistic) ── */
  const setItem = useCallback((id: string, patch: Patch, extra: { edit?: { v: string; text: string | null } } = {}) => {
    app.act('brief.item', { date: day, id, ...patch, ...extra }, { optimistic: b => patchB(b, day, id, i => {
      const n: BriefItem = { ...i, ...patch, edits: { ...(i.edits || {}) } };
      if (extra.edit) { if (extra.edit.text == null) delete n.edits[extra.edit.v]; else n.edits[extra.edit.v] = extra.edit.text; }
      return n;
    }) }).catch(() => {});
  }, [app, day]);
  /** Pull a not-yet-saved edit for an item so the next write carries it. */
  const takePending = (id: string): { v: string; text: string } | undefined => {
    const o = overlay[id]; if (!o) return undefined;
    for (const k of Object.keys(editTimers.current)) if (k.startsWith(id + ':')) { clearTimeout(editTimers.current[k]); delete editTimers.current[k]; }
    const v = Object.keys(o)[0]; return v ? { v, text: o[v] } : undefined;
  };
  const clearOverlay = (id: string, v: string, text?: string | null) => setOverlay(m => {
    if (!m[id] || (text !== undefined && m[id][v] !== text)) return m;
    const n = { ...m[id] }; delete n[v]; const out = { ...m }; if (Object.keys(n).length) out[id] = n; else delete out[id]; return out;
  });
  const setText = (it: BriefItem, t: string) => {
    const v = variantOf(it); const id = it.id; const d = day;
    setOverlay(m => ({ ...m, [id]: { ...(m[id] || {}), [v]: t } }));
    if (it.st === 'copied') setItem(id, { st: 'open' });
    const key = id + ':' + v;
    clearTimeout(editTimers.current[key]);
    editTimers.current[key] = setTimeout(() => {
      delete editTimers.current[key];
      app.act('brief.item', { date: d, id, edit: { v, text: t } }, { optimistic: b => patchB(b, d, id, i => ({ ...i, edits: { ...(i.edits || {}), [v]: t } })) })
        .then(() => clearOverlay(id, v, t)).catch(() => {});
    }, 600);
  };
  const restore = (it: BriefItem) => {
    const v = variantOf(it); const key = it.id + ':' + v;
    clearTimeout(editTimers.current[key]); delete editTimers.current[key];
    clearOverlay(it.id, v);
    setItem(it.id, {}, { edit: { v, text: null } });
  };

  const pick = (id: string) => { setSel(id); if (window.innerWidth < 1000) setTimeout(() => { const el = detailRef.current; if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 16, behavior: 'smooth' }); }, 30); };
  const advance = (id: string) => { const idx = order.findIndex(i => i.id === id); const rest = [...order.slice(idx + 1), ...order.slice(0, idx)].filter(i => i.id !== id && (i.st === 'open' || i.st === 'copied')); setSel(rest[0] ? rest[0].id : null); };
  const act: Act = {
    copy: it => {
      copyText(textOf(it)); const pend = takePending(it.id);
      setItem(it.id, { st: 'copied' }, pend ? { edit: pend } : {});
      if (pend) setTimeout(() => clearOverlay(it.id, pend.v, pend.text), 400);
      toast(it.kind === 'reply' ? `Copied. Paste it under the ${it.plat === 'reddit' ? 'thread' : 'post'}.` : `Copied. Paste it into ${BPLAT[it.pl as BriefPlatform]}.`, { action: it.url ? { label: 'Open', fn: () => window.open(it.url, '_blank', 'noopener') } : null });
    },
    posted: it => { setItem(it.id, { st: 'posted' }); advance(it.id); },
    skip: it => { const prev = it.st as 'open' | 'copied'; setItem(it.id, { st: 'skipped' }); advance(it.id); toast('Skipped', { action: { label: 'Undo', fn: () => { setItem(it.id, { st: prev }); setSel(it.id); } } }); },
    undo: it => setItem(it.id, { st: 'open' }),
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(tg.tagName) || tg.isContentEditable || e.metaKey || e.ctrlKey || e.altKey || sheet || scan) return;
      const idx = order.findIndex(i => i.id === sel); const it = order[idx];
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); const n = order[Math.min(order.length - 1, idx + 1)]; n && setSel(n.id); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); const n = order[Math.max(0, idx - 1)]; n && setSel(n.id); }
      else if (e.key === 'c' && it && day === today && isLive(it)) act.copy(it);
      else if (e.key === 's' && it && day === today && it.st !== 'posted' && it.st !== 'skipped' && it.st !== 'expired') act.skip(it);
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [sel, order.map(i => i.id + i.st).join(), sheet, scan, day, overlay]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── scanning (job brief.scan, ref = today) ── */
  const live: ScanJob = scan?.jobId ? ((app.jobs[scan.jobId] as any) || B!.jobs.find(j => j.id === scan.jobId) || null) : null;
  const running = app.jobFor('brief.scan', today) as ScanJob;
  // A scan started elsewhere (the morning schedule, another tab) shows here too.
  useEffect(() => {
    if (!scan && running && (running.status === 'queued' || running.status === 'running') && !(running.progress as BriefScanProgress | null)?.quiet)
      setScan({ jobId: running.id, kind: br.days[today] ? 'again' : 'first', platforms: br.settings.platforms });
  }, [running?.id, running?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const [result, setResult] = useState<BriefScanResult | null>(null);
  const jobDone = live && (live.status === 'done' || live.status === 'failed');
  useEffect(() => {
    if (!scan?.jobId || !jobDone) return;
    let alive = true;
    (async () => {
      let r: BriefScanResult | null = (live as any).result || null;
      if (!r && live!.status === 'done') { try { r = ((await app.act('job.get', { id: scan.jobId })) as any)?.result || null; } catch { /* */ } }
      if (!alive) return;
      if (live!.status === 'failed' || r?.failed) { setResult(r || { mode: scan.kind, failed: 'source' }); return; }
      setTimeout(() => { if (alive) scanDone(r!); }, 350);
    })();
    return () => { alive = false; };
  }, [scan?.jobId, jobDone]); // eslint-disable-line react-hooks/exhaustive-deps
  const scanDone = async (r: BriefScanResult) => {
    await app.refresh(); // the new day (and setup) must be in B before the scan view closes
    if (r.mode === 'again' || r.mode === 'keep') {
      const n = r.added || 0;
      toast(n ? `${n} new ${n === 1 ? 'conversation' : 'conversations'} since ${fmtTime(r.since)}` : 'Nothing new since this morning', { tone: n ? 'signal' : null });
    }
    if (r.addedIds && r.addedIds.length) setPendingSel(r.addedIds[0]);
    setResult(null); setScan(null);
  };
  const runScan = async (kind: 'first' | 'again', input: { settings?: { platforms: BriefPlatform[]; time: string }; retryOf?: string } = {}) => {
    const platforms = input.settings?.platforms || br.settings.platforms;
    setDay(today); setResult(null); setScan({ jobId: null, kind, platforms, busy: true });
    try { const r = await app.act<{ jobId: string }>('brief.scan', input, input.settings ? { optimistic: b => ({ ...b, brief: { ...b.brief, settings: { ...b.brief.settings, ...input.settings } } }) } : {}); setScan({ jobId: r.jobId, kind, platforms }); }
    catch { setScan(null); }
  };
  const failedName = result?.failed ? (BPLAT[result.failed as BriefPlatform] || 'A source') : null;

  const name = B!.profile.business.name;
  const days = [...new Set([...Object.keys(br.days), today])].sort(); const di = days.indexOf(day);
  const isToday = day === today;
  if (!br.setup && !scan) return <BriefSetup onRun={st => runScan('first', { settings: st })} />;
  const it = items.find(i => i.id === sel) || (allDoneCalc(items, isToday) ? null : open[0] || items[0] || null);
  const allDone = allDoneCalc(items, isToday);
  const progress = (live?.progress || null) as BriefScanProgress | null;
  return <div className="page">
    <PageHead title="Daily Brief" sub={isToday ? 'Conversations worth joining today, with replies drafted in your voice. You choose what to post.' : `What Radar found on ${fmtD(day, { weekday: 'long', month: 'long', day: 'numeric' })}.`}>
      <div className="row" style={{ gap: 4 }}>
        <Btn kind="ghost" icon="chevL" aria-label="Previous day" disabled={di <= 0 || !!scan} onClick={() => setDay(days[di - 1])} />
        <span className="small num" style={{ minWidth: 92, textAlign: 'center', fontWeight: 500 }}>{isToday ? 'Today' : fmtD(day, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        <Btn kind="ghost" icon="chevR" aria-label="Next day" disabled={isToday || !!scan} onClick={() => setDay(days[di + 1] || today)} />
      </div>
      <Btn kind="ghost" icon="gear" aria-label="Brief settings" onClick={() => setSheet(true)} />
    </PageHead>
    {!scan && D && <div className="row small brief-meta">
      <span className="sub">{isToday ? `Found at ${fmtTime(D.scannedAt)}` : `Scanned at ${fmtTime(D.scannedAt)}`}</span>
      {isToday && <Btn kind="link" className="small" onClick={() => runScan('again')}>Scan again</Btn>}
    </div>}
    {scan ? <BriefScan key={scan.jobId || 'pending'} platforms={scan.platforms} progress={progress} err={failedName} busy={scan.busy}
        onRetry={() => runScan(scan.kind, { retryOf: scan.jobId || undefined })}
        onCancel={br.days[today] ? () => { if (scan.jobId) app.act('brief.keep', { jobId: scan.jobId }, { silent: true }).catch(() => {}); setResult(null); setScan(null); } : null} />
    : !D ? <Empty icon="brief" title="No brief for this day" body="Radar only keeps briefs from days it scanned." />
    : <div className={'brief-grid' + (mob ? ' mob' : '')}>
      <nav className="brief-q" aria-label="Today’s recommendations">
        {groups.map(g => <div key={g.k} className="col"><div className="brief-gh">{g.k !== 'post' && <PlatLogo k={g.k} s={14} />}<span>{g.l}</span></div>
          {g.items.map((x, j) => { const done = x.st === 'posted' || x.st === 'skipped' || x.st === 'expired'; const age = ageOf(x); return <button key={x.id} className={'brief-qi enter' + (sel === x.id ? ' on' : '') + (done ? ' done' : '')} style={{ animationDelay: j * 40 + 'ms' }} onClick={() => pick(x.id)} aria-current={sel === x.id}>
            <span className="brief-qt">{x.title}</span>
            <span className="row xs sub" style={{ gap: 6, minWidth: 0 }}>{x.kind === 'post' ? (x.plats || []).map(p => <PlatLogo key={p} k={p} s={13} />) : <span className="trunc">{x.where}{isToday && age != null ? ' · ' + ageL(age) : ''}</span>}{x.fresh && <span style={{ color: 'var(--signal-ink)', flex: 'none' }}>New</span>}<span className="grow" />{x.st === 'posted' ? <Status tone="ok" style={{ fontSize: 12 }}>Posted</Status> : x.st === 'skipped' ? <span>Skipped</span> : x.st === 'expired' ? <span>Expired</span> : x.st === 'copied' ? <Status tone="signal" style={{ fontSize: 12 }}>Copied</Status> : null}</span>
          </button>; })}
        </div>)}
        {isToday && <span className="xs sub brief-keys hide-sm"><span className="kbd">↑</span><span className="kbd">↓</span> move · <span className="kbd">C</span> copy · <span className="kbd">S</span> skip</span>}
      </nav>
      <div ref={detailRef} className="brief-dw">
        {allDone && !it ? <BriefDone items={items} settings={br.settings} />
        : it ? <BriefDetail key={it.id + day} it={it} day={day} name={name} past={!isToday} act={act} setItem={p => setItem(it.id, p)} setText={t => setText(it, t)} restore={() => restore(it)}
            takePending={() => takePending(it.id)} clearOverlay={(v, t) => clearOverlay(it.id, v, t)} />
        : null}
      </div>
    </div>}
    <BriefSettingsSheet open={sheet} onClose={() => setSheet(false)} br={br} />
  </div>;
}

function BriefDone({ items, settings }: { items: BriefItem[]; settings: BriefSettings }) {
  const p = items.filter(i => i.st === 'posted').length;
  return <div className="col enter" style={{ padding: '72px 32px', alignItems: 'center', textAlign: 'center', gap: 10 }}>
    <span style={{ color: 'var(--ok)', marginBottom: 6 }}><Icon n="check" s={26} w={1.6} /></span>
    <h2 className="h2">That’s today’s brief</h2>
    <p className="sub" style={{ maxWidth: 360 }}>{p ? `You joined ${p} ${p === 1 ? 'conversation' : 'conversations'}. ` : ''}Radar scans again tomorrow at {fmtTime(settings.time)}.</p>
  </div>;
}

function BriefDetail({ it, day, name, past, act, setItem, setText, restore, takePending, clearOverlay }: {
  it: BriefItem; day: string; name: string; past: boolean; act: Act; setItem: (p: Patch) => void; setText: (t: string) => void; restore: () => void;
  takePending: () => { v: string; text: string } | undefined; clearOverlay: (v: string, text?: string) => void;
}) {
  const app = useApp(); const { toast, go } = app;
  const [busy, setBusy] = useState(false); const [menu, setMenu] = useState(false); const [custom, setCustom] = useState(''); const anchor = useRef<HTMLSpanElement>(null);
  const text = textOf(it); const v = variantOf(it); const plat = it.kind === 'reply' ? it.plat : it.pl;
  const edited = it.edits && it.edits[v] != null && it.edits[v] !== it.drafts[v];
  const age = ageOf(it);
  const rewrite = async (instr: string) => {
    setMenu(false); setBusy(true); takePending();
    try {
      await app.act('brief.rewrite', { date: day, id: it.id, v, text, instruction: instr }, { silent: true });
      clearOverlay(v);
    } catch { toast(REWRITE_ERROR, { tone: 'bad' }); }
    setBusy(false); setCustom('');
  };
  const live = it.st === 'open' || it.st === 'copied';
  const noun = it.kind === 'reply' ? 'reply' : 'post';
  return <article className="brief-d enter">
    {it.kind === 'reply' ? <>
      <div className="row xs sub" style={{ gap: 8, flexWrap: 'wrap' }}><PlatLogo k={it.plat!} s={16} /><span>{it.where}{!past && age != null ? ' · ' + ageL(age) : ''}{it.eng ? ' · ' + it.eng : ''}</span><span className="grow" />{it.url && <a className="small row" style={{ gap: 5, textDecoration: 'none', color: 'var(--ink2)' }} href={it.url} target="_blank" rel="noopener">Open thread<Icon n="ext" s={13} /></a>}</div>
      <h2 className="h2" style={{ marginTop: 10 }}>{it.title}</h2>
      {it.body && <p className="sub brief-body">{it.body}</p>}
      {it.replyTo && <div className="brief-quote"><span className="xs sub">Replying to {it.replyTo.who}</span><p className="small">{it.replyTo.text}</p></div>}
    </> : <>
      <span className="row xs sub" style={{ gap: 8 }}>{(it.plats || []).map(p => <PlatLogo key={p} k={p} s={16} />)}For your feed</span>
      <h2 className="h2" style={{ marginTop: 10 }}>{it.title}</h2>
    </>}
    {it.why && <p className="small brief-why">{it.why}</p>}
    <div className="brief-compose">
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', minHeight: 32 }}>
        <span className="label grow">{it.kind === 'reply' ? 'Your reply' : 'Your post'}</span>
        {it.kind === 'reply' && live && <Seg value={it.mention ? 'm' : 'h'} onChange={x => setItem({ mention: x === 'm' })} options={[{ v: 'h', l: 'Just help' }, { v: 'm', l: 'Mention ' + name }]} />}
        {it.kind === 'post' && (it.plats || []).length > 1 && live && <Seg value={it.pl as string} onChange={x => setItem({ pl: x as BriefPlatform })} options={(it.plats || []).map(p => ({ v: p as string, l: BPLAT[p] }))} />}
      </div>
      <AutoText className="input-bare brief-text" value={text} readOnly={!live} onChange={e => setText(e.target.value)} style={{ opacity: busy ? .35 : 1 }} aria-label={it.kind === 'reply' ? 'Reply text' : 'Post text'} />
      <div className="row xs sub" style={{ gap: 12, minHeight: 18 }}>
        {plat === 'x' && <span className="num" style={{ color: text.length > 280 ? 'var(--bad)' : undefined }}>{text.length}/280</span>}
        {edited && live && <><span>Edited</span><Btn kind="link" className="xs" onClick={restore}>Restore draft</Btn></>}
        {busy && <span className="row" style={{ gap: 6 }}><span className="spin" style={{ width: 11, height: 11, color: 'var(--signal)' }} />Rewriting…</span>}
      </div>
    </div>
    {past ? <div className="row brief-acts">{it.st === 'posted' ? <Status tone="ok">Posted</Status> : <span className="small sub">{it.st === 'expired' ? 'Expired. Replies this late rarely get seen.' : 'Skipped'}</span>}<span className="grow" /><Btn size="sm" kind="ghost" icon="copy" onClick={() => { copyText(text); toast('Copied'); }}>Copy</Btn></div>
    : <div className="row brief-acts">
      {it.st === 'open' && <Btn kind="primary" icon="copy" disabled={busy} onClick={() => act.copy(it)}>Copy {noun}</Btn>}
      {it.st === 'copied' && <><Btn kind="primary" icon="check" onClick={() => act.posted(it)}>I posted it</Btn><Btn kind="ghost" icon="copy" onClick={() => act.copy(it)}>Copy again</Btn></>}
      {it.st === 'posted' && <Status tone="ok">Posted</Status>}
      {it.st === 'skipped' && <span className="small sub">Skipped</span>}
      {live && <span style={{ position: 'relative' }} ref={anchor}><Btn kind="ghost" icon="wand" disabled={busy} onClick={() => setMenu(!menu)} aria-haspopup="menu">Rewrite</Btn>
        <Popover anchor={anchor} open={menu} onClose={() => setMenu(false)} style={{ width: 260 }}>
          {['Make it shorter', 'Make it more casual', 'Add a concrete example'].map(o => <button key={o} className="pop-i" onClick={() => rewrite(o)}>{o}</button>)}
          <hr className="hair" style={{ margin: '6px 0' }} />
          <form onSubmit={e => { e.preventDefault(); if (custom.trim()) rewrite(custom.trim()); }}><input className="input" style={{ height: 36, fontSize: 13 }} placeholder="Or say what to change" value={custom} onChange={e => setCustom(e.target.value)} autoFocus /></form>
        </Popover></span>}
      <span className="grow" />
      {it.kind === 'post' && live && <Btn kind="link" className="small" onClick={() => go('social', { generate: true })}>Add visuals</Btn>}
      {live && <Btn kind="link" className="small" style={{ color: 'var(--mute)' }} onClick={() => act.skip(it)}>Skip</Btn>}
      {!live && <Btn kind="link" className="small" onClick={() => act.undo(it)}>Undo</Btn>}
    </div>}
    {live && !past && it.kind === 'reply' && <p className="xs sub" style={{ marginTop: 14 }}>{it.plat === 'reddit' ? `Reddit drafts never include links${it.mention ? ', and always disclose that you work on ' + name : ''}.` : it.mention ? `Mentions ${name} once, with a disclosure.` : `Doesn’t mention ${name}. Switch to “Mention ${name}” if it fits.`}</p>}
  </article>;
}

function BriefPlatforms({ value, onChange }: { value: BriefPlatform[]; onChange: (v: BriefPlatform[]) => void }) {
  return <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{(Object.keys(BPLAT) as BriefPlatform[]).map(k => { const on = value.includes(k); return <button key={k} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter(x => x !== k) : [...value, k])} className="brief-chip" data-on={on}><PlatLogo k={k} s={15} />{BPLAT[k]}</button>; })}</div>;
}

function BriefSetup({ onRun }: { onRun: (st: { platforms: BriefPlatform[]; time: string }) => void }) {
  const { B } = useApp(); const [st, setSt] = useState({ platforms: [...BRIEF_DEFAULT.platforms], time: BRIEF_DEFAULT.time }); const name = B!.profile.business.name;
  return <div className="page" style={{ maxWidth: 640 }}>
    <PageHead title="Daily Brief" sub={`Every morning, Radar reads public conversations where ${name} can genuinely help, and drafts replies in your voice. You decide what to post.`} />
    <div className="col" style={{ gap: 30 }}>
      <Field label="Where to look"><BriefPlatforms value={st.platforms} onChange={p => setSt({ ...st, platforms: p })} /></Field>
      <Field label="Have it ready by" hint={`${B!.tz ? B!.tz.replace(/_/g, ' ') : 'Your time zone'}. Topics come from your Business Profile.`}><input type="time" className="input" style={{ width: 140 }} value={st.time} onChange={e => setSt({ ...st, time: e.target.value })} /></Field>
      <div className="row" style={{ gap: 16, paddingTop: 6 }}><Btn kind="primary" size="lg" disabled={!st.platforms.length} onClick={() => onRun(st)}>Run first scan</Btn><span className="small sub">Takes about a minute.</span></div>
    </div>
  </div>;
}

function BriefSettingsSheet({ open, onClose, br }: { open: boolean; onClose: () => void; br: BriefState }) {
  const app = useApp(); const { B, toast, go } = app;
  const base: BriefSettings = { platforms: br.settings.platforms, time: br.settings.time, mention: br.settings.mention };
  const [st, setSt] = useState<BriefSettings>(base); useEffect(() => { if (open) setSt(base); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = B!.profile.business.name; const dirty = JSON.stringify(st) !== JSON.stringify(base);
  const save = () => {
    app.act('brief.settings', st, { optimistic: b => ({ ...b, brief: { ...b.brief, settings: st } }) }).catch(() => {});
    onClose(); toast('Saved. Applies from tomorrow’s brief.');
  };
  return <Sheet open={open} onClose={onClose} title="Brief settings" width={480} footer={<><span className="grow" /><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!dirty || !st.platforms.length} onClick={save}>Save</Btn></>}>
    <div className="col" style={{ gap: 28 }}>
      <Field label="Where to look" hint="Up to two conversations from each."><BriefPlatforms value={st.platforms} onChange={p => setSt({ ...st, platforms: p })} /></Field>
      <Field label={`Mention ${name}`} hint={st.mention === 'asked' ? 'Only when someone asks for a tool or recommendation. You can switch any reply.' : st.mention === 'relevant' ? 'Whenever it fits, always with a disclosure.' : 'Replies stay purely helpful.'}><Seg value={st.mention} onChange={v => setSt({ ...st, mention: v })} options={BMENTION.map(o => ({ v: o.v, l: o.l }))} /></Field>
      <Field label="Have it ready by"><input type="time" className="input" style={{ width: 140 }} value={st.time} onChange={e => setSt({ ...st, time: e.target.value })} /></Field>
      <p className="small sub">Topics and voice come from your <Btn kind="link" className="small" onClick={() => { onClose(); go('profile'); }}>Business Profile</Btn>.</p>
    </div>
  </Sheet>;
}
