'use client';
// Daily Brief — port of prototype/radar-brief.jsx on real data (01-screens §4, 02-system §9). With social publishing on
// (B.social.publishing): Post now / Schedule for X and LinkedIn posts, and Reply now (X's own reply box) for X replies.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/client/app';
import { AutoText, Btn, Empty, Field, Icon, Modal, PageHead, Popover, Seg, Sheet, Status, copyText, downloadBlob, sleep } from '@/components/ui';
import { Visual, visualBlob } from '@/components/Visual';
import { IMG_DEFAULT, STYLES, imgSeed, styleK, styleL, type ImgRange, type StyleKey } from '@/lib/imageOptions';
import { PlatLogo } from '@/components/brand';
import { BMENTION, BPLAT, BRIEF_DEFAULT, PLAT, PORDER } from '@/lib/constants';
import { ageFromIso, ageL, fmtD, fmtDW, fmtTime } from '@/lib/format';
import type { BriefAccount, BriefDay, BriefItem, BriefPlatform, BriefSettings, BriefState, JobSummary, Workspace } from '@/lib/types';
import { BriefScan } from './BriefScan';
import { accountsOf, acctOf, isLive, platsFor, textOf, variantOf, type BriefScanProgress, type BriefScanResult } from './model';
import { PLAT_L, accountsOf as socialAccountsOf, acctLabel, atTz, briefPreflightInput, briefPublish, briefSid, charCount, chOf, defaultSlot, failedLine, isLocked, preflight, xReplyIntentUrl, xStatusId } from '@/lib/socialPublish';
import type { Pub, SocialChannel } from '@/lib/types';
import { LogoLabel } from '@/features/social/channels/LogoLabel';
import { ScheduleModal } from '@/features/social/channels/ScheduleModal';
import { failToast } from '@/features/social/channels/PublishBox';
import { compressToast, heldLines, repub, rescheduleAction, withPub } from '@/features/social/channels/logic';
import { ConnectSocial } from '@/features/social/channels/ConnectSocial';
import { useNowMs } from '@/features/social/channels/useSocial';

type Act = { copy: (it: BriefItem) => void; posted: (it: BriefItem) => void; skip: (it: BriefItem) => void; undo: (it: BriefItem) => void;
  /** Reply now opened X's reply box: mark it copied (then "I posted it"), carrying any unsaved edit, without touching the clipboard. */
  opened: (it: BriefItem) => void;
  /** Posted or scheduled from Radar: move on to the next item. */
  direct: (it: BriefItem) => void };
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
  const [day, setDay] = useState(today); const [sel, setSel] = useState<string | null>(null); const [scan, setScan] = useState<ScanState | null>(null); const [sheet, setSheet] = useState(false); const [mob] = useState(false); const [acct, setAcct] = useState<BriefAccount>('founder');
  const [pendingSel, setPendingSel] = useState<string | null>(null);
  // Phones and narrow windows: a list, then one conversation at a time (with a way back), instead of a long stacked page.
  const narrow = useNarrow(1000); const [opened, setOpened] = useState(false);
  useEffect(() => { setOpened(false); }, [day]);
  /** Local text the user typed that the server hasn't confirmed yet (per item + variant). */
  const [overlay, setOverlay] = useState<Record<string, Record<string, string>>>({});
  const editTimers = useRef<Record<string, any>>({});
  const detailRef = useRef<HTMLDivElement>(null);
  const br = B!.brief as BriefState;

  /** Status/mention/platform changes not yet confirmed by the server: a slower response to an earlier write must not undo them. */
  const [pending, setPending] = useState<Record<string, Patch & { seq: number }>>({});
  const seq = useRef(0);
  const withOverlay = (i0: BriefItem): BriefItem => {
    const pp = pending[i0.id]; let i = i0;
    if (pp) { const { seq: _s, ...p } = pp; i = { ...i, ...p }; }
    return overlay[i.id] ? { ...i, edits: { ...(i.edits || {}), ...overlay[i.id] } } : i;
  };
  const D: BriefDay | undefined = br.days[day];
  const all = (D ? D.items : []).map(withOverlay);
  // Two voices (UPDATE-2026-10-20b §1): the queue, keys and done state cover the current account only. Founder first.
  const accts = [...new Set(all.map(acctOf))].sort((a, b) => (a === 'founder' ? -1 : b === 'founder' ? 1 : 0));
  const cur: BriefAccount = accts.includes(acct) ? acct : accts[0] || 'founder';
  const items = all.filter(i => acctOf(i) === cur);
  const openOf = (a: BriefAccount) => all.filter(i => acctOf(i) === a && (i.st === 'open' || i.st === 'copied')).length;
  const bizName = B!.profile.business.name;
  const open = items.filter(i => i.st === 'open' || i.st === 'copied');
  const groups = [...PORDER.map(p => ({ k: p as string, l: BPLAT[p], items: items.filter(i => i.kind === 'reply' && i.plat === p) })), { k: 'post', l: cur === 'company' ? `For ${bizName}’s page` : 'For your feed', items: items.filter(i => i.kind === 'post') }].filter(g => g.items.length);
  const order = groups.flatMap(g => g.items);
  useEffect(() => { if (!sel || !items.find(i => i.id === sel)) { const f = order.find(i => i.st === 'open' || i.st === 'copied'); setSel(f ? f.id : null); } }, [day, cur, items.map(i => i.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new item from Scan again: switch to its account and select it.
  useEffect(() => { const n = pendingSel ? all.find(i => i.id === pendingSel) : null; if (n) { setAcct(acctOf(n)); setSel(pendingSel); setPendingSel(null); } }, [pendingSel, all.map(i => i.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const switchAcct = (a: BriefAccount) => { setAcct(a); setSel(null); setOpened(false); };

  /* ── item writes (optimistic) ── */
  const setItem = useCallback((id: string, patch: Patch, extra: { edit?: { v: string; text: string | null } } = {}) => {
    const my = ++seq.current;
    if (Object.keys(patch).length) setPending(m => ({ ...m, [id]: { ...(m[id] || {}), ...patch, seq: my } }));
    const settle = () => setPending(m => { if (!m[id] || m[id].seq !== my) return m; const n = { ...m }; delete n[id]; return n; });
    app.act('brief.item', { date: day, id, ...patch, ...extra }, { optimistic: b => patchB(b, day, id, i => {
      const n: BriefItem = { ...i, ...patch, edits: { ...(i.edits || {}) } };
      if (extra.edit) { if (extra.edit.text == null) delete n.edits[extra.edit.v]; else n.edits[extra.edit.v] = extra.edit.text; }
      return n;
    }) }).then(settle, settle);
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

  const toDetail = () => setTimeout(() => { const el = document.getElementById('brief-back'); if (el) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 72) }); }, 30);
  const pick = (id: string) => { setSel(id); if (narrow) { setOpened(true); toDetail(); } };
  const backToList = () => { setOpened(false); setTimeout(() => { const el = document.querySelector('.brief-qi.on') as HTMLElement | null; if (el) el.scrollIntoView({ block: 'center' }); }, 30); };
  const advance = (id: string) => { const idx = order.findIndex(i => i.id === id); const rest = [...order.slice(idx + 1), ...order.slice(0, idx)].filter(i => i.id !== id && (i.st === 'open' || i.st === 'copied')); setSel(rest[0] ? rest[0].id : null); if (narrow) toDetail(); };
  const act: Act = {
    copy: it => {
      copyText(textOf(it)); const pend = takePending(it.id);
      setItem(it.id, { st: 'copied' }, pend ? { edit: pend } : {});
      if (pend) setTimeout(() => clearOverlay(it.id, pend.v, pend.text), 400);
      toast(it.kind === 'reply' ? `Copied. Paste it under the ${it.plat === 'reddit' ? 'thread' : 'post'}.` : `Copied. Paste it into ${BPLAT[it.pl as BriefPlatform]}.`, { action: it.url ? { label: 'Open', fn: () => window.open(it.url, '_blank', 'noopener') } : null });
    },
    posted: it => { setItem(it.id, { st: 'posted' }); advance(it.id); },
    opened: it => { const pend = takePending(it.id); setItem(it.id, { st: 'copied' }, pend ? { edit: pend } : {}); if (pend) setTimeout(() => clearOverlay(it.id, pend.v, pend.text), 400); },
    direct: it => advance(it.id),
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
      else if (e.key === 's' && it && day === today && it.st !== 'posted' && it.st !== 'skipped' && it.st !== 'expired' && it.st !== 'scheduled') act.skip(it);
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

  const name = bizName;
  const days = [...new Set([...Object.keys(br.days), today])].sort(); const di = days.indexOf(day);
  const isToday = day === today;
  if (!br.setup && !scan) return <BriefSetup onRun={st => runScan('first', { settings: st })} />;
  const it = items.find(i => i.id === sel) || (allDoneCalc(items, isToday) ? null : open[0] || items[0] || null);
  const allDone = allDoneCalc(items, isToday);
  const progress = (live?.progress || null) as BriefScanProgress | null;
  /** Enabled platforms (or, for past days, the ones scanned) that produced no conversations, so silence is explained. */
  // Per account: the company is only ever drafted on X and LinkedIn.
  const enabledAccts = accountsOf(br.settings);
  const scope = (k: BriefPlatform) => (enabledAccts.includes(cur) ? [cur] : enabledAccts).some(a => platsFor(a, [k]).length > 0);
  const quietPlats: BriefPlatform[] = D ? PORDER.filter(k => (isToday ? br.settings.platforms.includes(k) : !!D.stats?.[k]) && scope(k) && !items.some(i => i.kind === 'reply' && i.plat === k)) : [];
  const quietList = quietPlats.length ? <div className="col brief-quiet" style={{ gap: 8 }}>{quietPlats.map(k => { const n = D?.stats?.[k]?.read; return <span key={k} className="row xs sub" style={{ gap: 8 }}><PlatLogo k={k} s={13} /><span>{BPLAT[k]} · {n == null ? 'Not scanned yet. Scan again to include it.' : `Nothing worth joining${isToday ? ' yet' : ''} · ${n === 0 ? 'no recent threads found' : `read ${n} ${n === 1 ? 'thread' : 'threads'}`}`}</span></span>; })}</div> : null;
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
      {accts.length > 1 && <Seg value={cur} onChange={switchAcct} options={accts.map(a => { const n = isToday ? openOf(a) : 0; return { v: a, l: <span className="row" style={{ gap: 7 }}>{a === 'founder' ? 'You' : name}{n > 0 && <span className="num" style={{ color: 'var(--mute)', fontWeight: 400 }}>{n}</span>}</span> }; })} />}
      <span className="grow hide-sm" />
      <span className="sub">{isToday ? `Found at ${fmtTime(D.scannedAt)}` : `Scanned at ${fmtTime(D.scannedAt)}`}</span>
      {isToday && <Btn kind="link" className="small" onClick={() => runScan('again')}>Scan again</Btn>}
    </div>}
    {scan ? <BriefScan key={scan.jobId || 'pending'} who={enabledAccts.length > 1 ? 'both' : enabledAccts[0]} name={name} platforms={scan.platforms} progress={progress} err={failedName} busy={scan.busy}
        onRetry={() => runScan(scan.kind, { retryOf: scan.jobId || undefined })}
        onCancel={br.days[today] ? () => { if (scan.jobId) app.act('brief.keep', { jobId: scan.jobId }, { silent: true }).catch(() => {}); setResult(null); setScan(null); } : null} />
    : !D ? <Empty icon="brief" title="No brief for this day" body="Radar only keeps briefs from days it scanned." />
    : !items.length ? <Empty icon="brief" title={isToday ? 'Nothing worth joining yet' : 'Nothing worth joining that day'}
        body={isToday ? `Radar read today’s conversations but none were a good fit for ${name}. It scans again tomorrow at ${fmtTime(br.settings.time)}, or you can scan again later today.` : 'Radar scanned but found no conversations that were a good fit.'}>
        {isToday && <Btn kind="secondary" onClick={() => runScan('again')}>Scan again</Btn>}
        {quietList && <div style={{ flexBasis: '100%', display: 'flex', justifyContent: 'center', marginTop: 16 }}>{quietList}</div>}
      </Empty>
    : <div className={'brief-grid' + (mob ? ' mob' : '')}>
      {narrow && allDone && !opened && <div className="brief-dw"><BriefDone items={items} settings={br.settings} acct={cur} name={name} other={accts.find(a => a !== cur && openOf(a) > 0)} otherN={accts.filter(a => a !== cur).reduce((n, a) => n + openOf(a), 0)} onSwitch={switchAcct} /></div>}
      {!(narrow && opened) && <nav className="brief-q" aria-label="Today’s recommendations">
        {groups.map(g => <div key={g.k} className="col">{g.k === 'post' ? <div className="brief-gh post"><span className="brief-ght">{g.l}</span><span className="brief-ghs">Original posts to publish, not replies</span></div> : <div className="brief-gh"><PlatLogo k={g.k} s={14} /><span>{g.l}</span></div>}
          {g.items.map((x, j) => { const done = x.st === 'posted' || x.st === 'skipped' || x.st === 'expired' || x.st === 'scheduled'; const age = ageOf(x); return <button key={x.id} className={'brief-qi enter' + (sel === x.id ? ' on' : '') + (done ? ' done' : '')} style={{ animationDelay: j * 40 + 'ms' }} onClick={() => pick(x.id)} aria-current={sel === x.id}>
            <span className="brief-qt">{x.title}</span>
            <span className="row xs sub" style={{ gap: 6, minWidth: 0 }}>{x.kind === 'post' ? (x.plats || []).map(p => <PlatLogo key={p} k={p} s={13} />) : <span className="trunc">{x.where}{isToday && age != null ? ' · ' + ageL(age) : ''}</span>}{x.fresh && <span style={{ color: 'var(--signal-ink)', flex: 'none' }}>New</span>}<span className="grow" />{x.st === 'posted' ? <Status tone="ok" style={{ fontSize: 12 }}>Posted</Status> : x.st === 'skipped' ? <span>Skipped</span> : x.st === 'expired' ? <span>Expired</span> : x.st === 'copied' ? <Status tone="signal" style={{ fontSize: 12 }}>Copied</Status> : null}</span>
          </button>; })}
        </div>)}
        {quietList}
        {isToday && <span className="xs sub brief-keys hide-sm"><span className="kbd">↑</span><span className="kbd">↓</span> move · <span className="kbd">C</span> copy · <span className="kbd">S</span> skip</span>}
      </nav>}
      {narrow && opened && <div id="brief-back" className="row" style={{ gap: 10, marginBottom: -8 }}><Btn kind="ghost" size="sm" icon="back" onClick={backToList}>{cur === 'company' ? `All ${name} items` : 'All conversations'}</Btn><span className="grow" />{it && order.length > 1 && <span className="xs sub num">{order.findIndex(x => x.id === it.id) + 1} of {order.length}</span>}</div>}
      {(!narrow || opened) && <div ref={detailRef} className="brief-dw">
        {allDone && !it ? <BriefDone items={items} settings={br.settings} acct={cur} name={name} other={accts.find(a => a !== cur && openOf(a) > 0)} otherN={accts.filter(a => a !== cur).reduce((n, a) => n + openOf(a), 0)} onSwitch={switchAcct} />
        : it ? <BriefDetail key={it.id + day} it={it} day={day} name={name} past={!isToday} act={act} setItem={p => setItem(it.id, p)} setText={t => setText(it, t)} restore={() => restore(it)}
            takePending={() => takePending(it.id)} clearOverlay={(v, t) => clearOverlay(it.id, v, t)} />
        : null}
      </div>}
    </div>}
    <BriefSettingsSheet open={sheet} onClose={() => setSheet(false)} br={br} />
  </div>;
}

function BriefDone({ items, settings, acct, name, other, otherN, onSwitch }: { items: BriefItem[]; settings: BriefSettings; acct: BriefAccount; name: string; other?: BriefAccount; otherN: number; onSwitch: (a: BriefAccount) => void }) {
  const p = items.filter(i => i.st === 'posted').length; const co = acct === 'company';
  return <div className="col enter" style={{ padding: '72px 32px', alignItems: 'center', textAlign: 'center', gap: 10 }}>
    <span style={{ color: 'var(--ok)', marginBottom: 6 }}><Icon n="check" s={26} w={1.6} /></span>
    <h2 className="h2">{other ? (co ? `That’s it for ${name}` : 'That’s it for you') : 'That’s today’s brief'}</h2>
    {(p > 0 || !other) && <p className="sub" style={{ maxWidth: 360 }}>{p ? `${co ? name + ' joined' : 'You joined'} ${p} ${p === 1 ? 'conversation' : 'conversations'}. ` : ''}{other ? '' : `Radar scans again tomorrow at ${fmtTime(settings.time)}.`}</p>}
    {other && <Btn kind="secondary" style={{ marginTop: 8, alignSelf: 'center' }} onClick={() => onSwitch(other)}>{other === 'company' ? `${otherN} left for ${name}` : `${otherN} left for you`}</Btn>}
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
  const noun = it.kind === 'reply' ? 'reply' : 'post'; const co = acctOf(it) === 'company';
  /* ── Add visuals (UPDATE-2026-10-21-image-options §5) ── */
  const B = app.B!; const brand = B.profile.brand;
  const [vis, setVis] = useState(false); const [vIx, setVIx] = useState(0);
  const ratio = PLAT.find(p => p.k === plat)?.ratio || 1.91;
  const im = it.kind === 'post' ? it.img || null : null;
  const vn = im ? Math.min(im.n, plat === 'x' ? 4 : 5) : 0; const vi = Math.min(vIx, Math.max(0, vn - 1));
  const vBusy = !!im && im.status === 'generating';
  const vUrl = im ? im.urls[vi] || null : null;
  const createVis = (x: { style: StyleKey; range: ImgRange }) => {
    setVis(false); setVIx(0);
    app.act('brief.visuals', { date: day, id: it.id, style: x.style, range: x.range }, { optimistic: b => {
      const nb = patchB(b, day, it.id, i => ({ ...i, img: { style: x.style, range: x.range, seed: -1, n: x.range === 'many' ? 3 : 1, urls: [], status: 'generating' } }));
      return { ...nb, social: { ...nb.social, img: { on: true, style: x.style, range: x.range } } };
    } }).catch(() => {});
  };
  const removeVis = () => { app.act('brief.visuals', { date: day, id: it.id, style: null }, { optimistic: b => patchB(b, day, it.id, i => ({ ...i, img: null })) }).catch(() => {}); };
  const dlVis = async () => {
    if (!im) return;
    for (let i = 0; i < vn; i++) {
      if (i) await sleep(200);
      const blob = await visualBlob(im.urls[i], { style: im.style, brand, headline: i ? '' : it.title, seed: imgSeed(im.seed, i), name }, 1200, Math.round(1200 / ratio));
      if (blob) downloadBlob(blob, 'post' + (vn > 1 ? '-' + (i + 1) : '') + '.png');
    }
    toast(vn > 1 ? `Downloaded ${vn} images` : 'Downloaded image');
  };
  const visInitial: { style: StyleKey; range: ImgRange } = im ? { style: styleK(im.style), range: im.range || 'few' } : { style: styleK((B.social.img || IMG_DEFAULT).style), range: (B.social.img || IMG_DEFAULT).range || 'few' };
  /* ── Social channels (publishing on): Post now / Schedule / Reply now ── */
  const now = useNowMs(); const pubOn = !!B.social.publishing;
  const bp = pubOn ? briefPublish(socialAccountsOf(B), it) : null;
  const k = bp?.platform || null; const sa = bp?.acct || null; const pub = it.pub || null;
  const postDirect = !!bp?.direct && it.kind === 'post' && !!sa; const replyDirect = !!bp?.direct && it.kind === 'reply' && bp.replyMode === 'intent';
  const pl = k ? PLAT_L[k] : ''; const ppl = pub ? PLAT_L[pub.platform] : pl; const sid = briefSid(day, it.id);
  const label = acctLabel(sa) || pub?.acctLabel || '';
  const problems = (postDirect || (pubOn && it.kind === 'post' && it.st === 'scheduled')) && k ? preflight(k, briefPreflightInput(it, k, text)) : replyDirect ? preflight('x', { text, images: [] }) : [];
  const locked = isLocked(pub, now);
  const [cf, setCf] = useState(false); const [sc, setSc] = useState(false); const [pBusy, setPBusy] = useState(false); const [fixing, setFixing] = useState(false); const [recon, setRecon] = useState(false);
  const flushEdit = async () => { const pend = takePending(); if (pend) { await app.act('brief.item', { date: day, id: it.id, edit: pend }); clearOverlay(pend.v, pend.text); } };
  const postNow = async () => {
    setCf(false); setPBusy(true);
    try {
      await flushEdit();
      const r = await app.act<{ pub: Pub }>('social.postNow', { sid });
      if (r.pub?.status === 'posted') { toast(`Posted to ${pl} as ${label}`, { tone: 'ok' }); act.direct(it); }
      else if (r.pub?.status === 'failed') toast(failToast(r.pub), { tone: 'bad' });
    } catch { /* toasted */ }
    setPBusy(false);
  };
  // X's reply box opens straight from the click (popup blockers), then the item goes to "I posted it".
  const replyNow = () => { const id = xStatusId(it.url); if (!id) return; window.open(xReplyIntentUrl(id, text), '_blank', 'noopener'); act.opened(it); };
  const schedule = async ({ date, time }: { date: string; time: string }) => {
    setSc(false);
    const how = rescheduleAction(pub, date, time); if (how === 'none') return;
    try {
      await flushEdit();
      if (how === 'move' && pub) { // same time, new day: works while the account is on hold
        await app.act('social.move', { sid, date }, { optimistic: b => withPub(b, sid, repub(pub, date, time, B.tz)) });
        toast(`Scheduled for ${fmtDW(date)} at ${atTz(B.tz, date, time)}`, { tone: 'ok' }); return;
      }
      const base: Pub = pub || { status: 'scheduled', platform: k!, date, time, dueAt: '', acct: sa?.id || null, acctLabel: label, direct: true };
      await app.act('social.schedule', { sid, date, time }, { optimistic: b => withPub(b, sid, { ...repub(base, date, time, B.tz), status: 'scheduled', err: null, code: null }) });
      toast(`Scheduled for ${fmtDW(date)} at ${atTz(B.tz, date, time)}`, { tone: 'ok' });
      if (it.st !== 'scheduled') act.direct(it);
    } catch { /* toasted */ }
  };
  const unschedule = () => { app.act('social.unschedule', { sid }, { optimistic: b => withPub(b, sid, null) }).then(() => toast('Unscheduled')).catch(() => {}); };
  const compress = async () => { setFixing(true); try { const r = await app.act<{ compressed: number }>('social.compress', { sid }); toast(compressToast(r?.compressed), { tone: r?.compressed ? 'ok' : null }); } catch { /* toasted */ } setFixing(false); };
  const hintCh: SocialChannel | null = k === 'x' ? 'x' : k === 'linkedin' ? (co ? 'li_page' : 'li_profile') : null;
  const showHint = pubOn && !past && live && it.kind === 'post' && !!bp?.can && !postDirect && !!hintCh && (B.social.channels || ['x', 'li_profile', 'li_page']).includes(hintCh);
  // On hold (its account is expired): the pack panel's lines, plus Reconnect. Reschedule (time locked) and Unschedule stay.
  const pubAcct = pub ? socialAccountsOf(B).find(a => a.id === pub.acct) || sa : null; const held = heldLines(pub, pubAcct, B.tz);
  const scheduledLine = pub && <>{held ? <span className="col" style={{ gap: 2 }}><Status tone="warn">{held.head}</Status><span className="xs sub">{held.body}</span></span>
      : <span className="col" style={{ gap: 2 }}><Status tone="ok">{`Scheduled · ${fmtDW(pub.date)} at ${atTz(B.tz, pub.date, pub.time)}`}</Status><span className="xs sub">{`As ${label}`}</span></span>}
    <Btn size="sm" icon="calendar" disabled={locked || problems.length > 0} onClick={() => setSc(true)}>Reschedule</Btn><Btn size="sm" kind="ghost" disabled={locked} onClick={unschedule}>Unschedule</Btn>
    {held && pubAcct && <Btn size="sm" kind="primary" onClick={() => setRecon(true)}><LogoLabel k={pub.platform}>{`Reconnect ${chOf(pubAcct.ch).l}`}</LogoLabel></Btn>}</>;
  const postedL = (p: Pub | null) => (p?.direct ? `${it.kind === 'reply' ? 'Replied on' : 'Posted to'} ${ppl}` : 'Posted');
  return <article className="brief-d enter">
    {it.kind === 'reply' ? <>
      <div className="row xs sub" style={{ gap: 8, flexWrap: 'wrap' }}><PlatLogo k={it.plat!} s={16} /><span>{it.where}{!past && age != null ? ' · ' + ageL(age) : ''}{it.eng ? ' · ' + it.eng : ''}</span><span className="grow" />{it.url && <a className="small row" style={{ gap: 5, textDecoration: 'none', color: 'var(--ink2)' }} href={it.url} target="_blank" rel="noopener">Open thread<Icon n="ext" s={13} /></a>}</div>
      <h2 className="h2" style={{ marginTop: 10 }}>{it.title}</h2>
      {it.body && <p className="sub brief-body">{it.body}</p>}
      {it.replyTo && <div className="brief-quote"><span className="xs sub">Replying to {it.replyTo.who}</span><p className="small">{it.replyTo.text}</p></div>}
    </> : <>
      <span className="row xs sub" style={{ gap: 8 }}>{(it.plats || []).map(p => <PlatLogo key={p} k={p} s={16} />)}{co ? `For ${name}’s page` : 'For your feed'}</span>
      <h2 className="h2" style={{ marginTop: 10 }}>{it.title}</h2>
    </>}
    {it.why && <p className="small brief-why">{it.why}</p>}
    <div className="brief-compose">
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', minHeight: 32 }}>
        <span className="label grow">{co ? (it.kind === 'reply' ? 'Reply as ' : 'Post as ') + name : it.kind === 'reply' ? 'Your reply' : 'Your post'}</span>
        {it.kind === 'reply' && !co && live && <Seg value={it.mention ? 'm' : 'h'} onChange={x => setItem({ mention: x === 'm' })} options={it.noMention ? [{ v: 'h', l: 'Just help' }] : [{ v: 'h', l: 'Just help' }, { v: 'm', l: 'Plug ' + name }]} />}
        {it.kind === 'post' && (it.plats || []).length > 1 && live && <Seg value={it.pl as string} onChange={x => setItem({ pl: x as BriefPlatform })} options={(it.plats || []).map(p => ({ v: p as string, l: BPLAT[p] }))} />}
      </div>
      <AutoText className="input-bare brief-text" value={text} readOnly={!live} onChange={e => setText(e.target.value)} style={{ opacity: busy ? .35 : 1 }} aria-label={it.kind === 'reply' ? 'Reply text' : 'Post text'} />
      <div className="row xs sub" style={{ gap: 12, minHeight: 18 }}>
        {plat === 'x' && (() => { const n = pubOn ? charCount('x', text) : text.length; return <span className="num" style={{ color: n > 280 ? 'var(--bad)' : undefined }}>{n}/280</span>; })()}
        {edited && live && <><span>Edited</span><Btn kind="link" className="xs" onClick={restore}>Restore draft</Btn></>}
        {busy && <span className="row" style={{ gap: 6 }}><span className="spin" style={{ width: 11, height: 11, color: 'var(--signal)' }} />Rewriting…</span>}
      </div>
    </div>
    {im && (vBusy || vn > 0 || im.status === 'failed') && <div className="col" style={{ gap: 10, marginTop: 18 }}>
      {im.status === 'failed' && !im.urls.some(Boolean) ? <div className="row small" style={{ gap: 10, flexWrap: 'wrap', padding: '12px 14px', borderRadius: 12, background: 'var(--fill)' }}><span className="grow" style={{ color: 'var(--bad)' }}>Radar couldn’t make these images.</span>{live && <Btn kind="link" className="small" onClick={() => createVis({ style: im.style, range: im.range })}>Try again</Btn>}{live && <Btn kind="link" className="small" style={{ color: 'var(--mute)' }} onClick={removeVis}>Remove</Btn>}</div> : <>
      <Visual key={vi + ':' + (vUrl || '')} style={im.style} brand={brand} headline={vi ? '' : it.title} seed={imgSeed(Math.max(1, im.seed), vi)} ratio={ratio} name={name} radius={12} busy={vBusy && !vUrl} url={vUrl} />
      {!(vBusy && !vn) && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {vn > 1 && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} role="tablist" aria-label="Images">{Array.from({ length: vn }, (_, i) => <button key={i} type="button" role="tab" aria-selected={i === vi} aria-label={'Image ' + (i + 1)} onClick={() => setVIx(i)} style={{ width: 56, padding: 2, border: 0, borderRadius: 9, background: 'none', cursor: 'pointer', boxShadow: i === vi ? '0 0 0 2px var(--ink)' : '0 0 0 1px var(--line)', transition: 'box-shadow .2s' }}><Visual style={im.style} brand={brand} headline="" seed={imgSeed(Math.max(1, im.seed), i)} ratio={1} name="" radius={7} url={im.urls[i] || null} busy={vBusy && !im.urls[i]} /></button>)}</div>}
        <span className="grow" />
        {!vBusy && <>
          {live && <Btn kind="link" className="small" onClick={() => setVis(true)}>Change</Btn>}
          <Btn kind="link" className="small" onClick={dlVis}>{vn > 1 ? 'Download ' + vn : 'Download'}</Btn>
          {live && <Btn kind="link" className="small" style={{ color: 'var(--mute)' }} onClick={removeVis}>Remove</Btn>}
        </>}
      </div>}
      <span className="xs sub">{vBusy ? `Creating ${vn > 1 ? vn + ' images' : 'image'} · ${styleL(im.style)}` : `${styleL(im.style)}${vn > 1 ? ' · ' + vn + ' images' : ''}`}</span>
      </>}
    </div>}
    {pubOn && live && pub?.status === 'failed' && <div className="col" style={{ gap: 2, marginTop: 18 }}><Status tone="bad">{`Didn’t post ${fmtDW(pub.date)} at ${atTz(B.tz, pub.date, pub.time)}`}</Status><span className="xs sub">{failedLine(pub)}</span></div>}
    {past ? <div className="row brief-acts">{it.st === 'scheduled' && pub ? scheduledLine : it.st === 'posted' ? <Status tone="ok">{postedL(pub)}</Status> : <span className="small sub">{it.st === 'expired' ? 'Expired. Replies this late rarely get seen.' : 'Skipped'}</span>}<span className="grow" /><Btn size="sm" kind="ghost" icon="copy" onClick={() => { copyText(text); toast('Copied'); }}>Copy</Btn></div>
    : <div className="row brief-acts">
      {postDirect && live && <><Btn kind="primary" loading={pBusy} disabled={busy || problems.length > 0} onClick={() => setCf(true)}><LogoLabel k={k!}>{pub?.status === 'failed' ? 'Try again' : 'Post now'}</LogoLabel></Btn>
        <Btn icon="calendar" disabled={busy || pBusy || problems.length > 0} onClick={() => setSc(true)}>Schedule</Btn>
        <Btn kind="ghost" icon="copy" aria-label="Copy post" title="Copy post" onClick={() => act.copy(it)} /></>}
      {replyDirect && it.st === 'open' && <><Btn kind="primary" disabled={busy || problems.length > 0} onClick={replyNow}><LogoLabel k="x">Reply now</LogoLabel></Btn><Btn kind="ghost" icon="copy" aria-label="Copy reply" title="Copy reply" onClick={() => act.copy(it)} /></>}
      {it.st === 'scheduled' && scheduledLine}
      {!postDirect && !replyDirect && it.st === 'open' && <Btn kind="primary" icon="copy" disabled={busy} onClick={() => act.copy(it)}>Copy {noun}</Btn>}
      {!postDirect && it.st === 'copied' && <><Btn kind="primary" icon="check" onClick={() => act.posted(it)}>I posted it</Btn><Btn kind="ghost" icon="copy" onClick={() => act.copy(it)}>Copy again</Btn></>}
      {it.st === 'posted' && <Status tone="ok">{postedL(pub)}</Status>}
      {it.st === 'posted' && pub?.direct && <Btn size="sm" kind="ghost" disabled={!pub.url} onClick={() => pub.url && window.open(pub.url, '_blank', 'noopener')}><LogoLabel k={pub.platform}>{`View on ${ppl}`}</LogoLabel></Btn>}
      {it.st === 'skipped' && <span className="small sub">Skipped</span>}
      {live && <span style={{ position: 'relative' }} ref={anchor}><Btn kind="ghost" icon="wand" disabled={busy} onClick={() => setMenu(!menu)} aria-haspopup="menu">Rewrite</Btn>
        <Popover anchor={anchor} open={menu} onClose={() => setMenu(false)} style={{ width: 260 }}>
          {['Make it shorter', 'Make it more casual', 'Add a concrete example'].map(o => <button key={o} className="pop-i" onClick={() => rewrite(o)}>{o}</button>)}
          <hr className="hair" style={{ margin: '6px 0' }} />
          <form onSubmit={e => { e.preventDefault(); if (custom.trim()) rewrite(custom.trim()); }}><input className="input" style={{ height: 36, fontSize: 13 }} placeholder="Or say what to change" value={custom} onChange={e => setCustom(e.target.value)} autoFocus /></form>
        </Popover></span>}
      <span className="grow" />
      {it.kind === 'post' && live && !im && <Btn kind="link" className="small" onClick={() => setVis(true)}>Add visuals</Btn>}
      {live && <Btn kind="link" className="small" style={{ color: 'var(--mute)' }} onClick={() => act.skip(it)}>Skip</Btn>}
      {!live && it.st !== 'scheduled' && !pub?.direct && <Btn kind="link" className="small" onClick={() => act.undo(it)}>Undo</Btn>}
    </div>}
    {live && !past && it.kind === 'reply' && <p className="xs sub" style={{ marginTop: 14 }}>{co ? `Post from the ${name} account. Help first, product second.` : it.noMention ? `${it.where} doesn’t allow self-promotion, so this reply stays purely helpful.` : it.plat === 'reddit' ? `Reddit drafts never include links${it.mention ? ', and always disclose that you work on ' + name : ''}.${it.mention && it.rulesUnknown ? ` Check ${it.where}’s rules on self-promotion before posting this version.` : ''}` : it.mention ? `Plugs ${name} once, with a disclosure.` : `Doesn’t mention ${name}. Switch to “Plug ${name}” if it fits.`}</p>}
    {showHint && <p className="xs sub" style={{ marginTop: 10 }}>{sa?.expired ? <>{`${chOf(sa.ch).l} needs reconnecting to post from here. `}<a href="#" onClick={e => { e.preventDefault(); go('settings', { social: true }); }}>Reconnect</a></> : <>{`Connect ${k === 'x' ? 'X' : co ? 'your LinkedIn page' : 'your LinkedIn profile'} to post or schedule from Radar. `}<a href="#" onClick={e => { e.preventDefault(); go('settings', { social: true }); }}>Connect</a></>}</p>}
    {((!past && live && (postDirect || (replyDirect && it.st === 'open'))) || it.st === 'scheduled') && problems.length > 0 && <p className="xs row" style={{ marginTop: 10, gap: 10, color: 'var(--bad)', flexWrap: 'wrap' }}><span>{problems[0].msg}</span>{problems[0].fix && <Btn kind="link" className="xs" disabled={fixing} onClick={compress}>{problems[0].fix.l}</Btn>}</p>}
    {postDirect && <ScheduleModal open={sc} onClose={() => setSc(false)} title={`Schedule ${pl} post`} sub={`As ${label}. It shows on your calendar, where you can drag it to another day.`} acct={sa}
      initial={pub && pub.status === 'scheduled' ? { date: pub.date, time: pub.time } : defaultSlot('brief', k!, B.today)} onSave={schedule} />}
    {it.st === 'scheduled' && pub && !postDirect && <ScheduleModal open={sc} onClose={() => setSc(false)} title={`Schedule ${ppl} post`} sub={`As ${label}. It shows on your calendar, where you can drag it to another day.`} acct={sa} lockTime={!!sa?.expired} initial={{ date: pub.date, time: pub.time }} onSave={schedule} />}
    {postDirect && <Modal open={cf} onClose={() => setCf(false)} width={440} label="Post now"><div className="col" style={{ padding: 30, gap: 16 }}>
      <h2 className="h2">{`Post to ${pl} now?`}</h2>
      <p className="sub">It goes live as <span style={{ color: 'var(--ink)' }}>{label}</span>{vn > 0 ? ` with ${vn} image${vn > 1 ? 's' : ''}` : ''}. You can delete it on {pl} afterwards.</p>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}><Btn kind="ghost" onClick={() => setCf(false)}>Cancel</Btn><Btn kind="primary" onClick={postNow}><LogoLabel k={k!}>Post now</LogoLabel></Btn></div>
    </div></Modal>}
    {held && pubAcct && <ConnectSocial ch={recon ? pubAcct.ch : null} reconnect={pubAcct} open={recon} onClose={() => setRecon(false)} />}
    {it.kind === 'post' && <BriefVisualsModal open={vis} onClose={() => setVis(false)} brand={brand} initial={visInitial} onCreate={createVis} />}
  </article>;
}

/** Add visuals window: style tiles and the number of images. */
function BriefVisualsModal({ open, onClose, brand, initial, onCreate }: { open: boolean; onClose: () => void; brand: { primary: string; secondary: string }; initial: { style: StyleKey; range: ImgRange }; onCreate: (x: { style: StyleKey; range: ImgRange }) => void }) {
  const [im, setIm] = useState(initial); useEffect(() => { if (open) setIm(initial); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Modal open={open} onClose={onClose} width={640} label="Add visuals to this post"><div className="col" style={{ padding: '32px clamp(20px,5vw,32px) 26px', gap: 22 }}>
    <div className="col" style={{ gap: 6 }}><h2 className="h1" style={{ fontSize: 24 }}>Add visuals to this post</h2><p className="sub">Radar creates images to go with the post. You can regenerate, download or remove them.</p></div>
    <Field label="Visual style"><div role="radiogroup" aria-label="Visual style" className="vis-tiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(104px,1fr))', gap: 12 }}>{STYLES.map(st => { const on = im.style === st.k; return <button key={st.k} type="button" role="radio" aria-checked={on} onClick={() => setIm({ ...im, style: st.k })} className="col" style={{ gap: 6, border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}><span style={{ borderRadius: 12, boxShadow: on ? '0 0 0 2px var(--ink)' : '0 0 0 1px var(--line)', padding: 2, transition: 'box-shadow .2s' }}><Visual style={st.k} brand={brand} headline="" seed={5} name="" radius={9} ratio={1} /></span><span className="xs" style={{ fontWeight: on ? 500 : 400, color: on ? 'var(--ink)' : 'var(--ink2)', lineHeight: 1.3 }}>{st.l}</span></button>; })}</div>
      <span className="small sub" style={{ marginTop: 10, display: 'block' }}>{(STYLES.find(st => st.k === im.style) || STYLES[0]).d}</span></Field>
    <Field label="Number of images" hint="Radar picks the exact number. X allows up to 4."><Seg value={im.range} onChange={v => setIm({ ...im, range: v })} options={[{ v: 'few' as ImgRange, l: <span className="row" style={{ gap: 7 }}>1–3<span style={{ color: 'var(--mute)', fontWeight: 400 }}>Recommended</span></span> }, { v: 'many' as ImgRange, l: '3–5' }]} /></Field>
    <div className="row" style={{ justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--line2)', paddingTop: 18 }}><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" icon="image" onClick={() => onCreate(im)}>Create images</Btn></div>
  </div></Modal>;
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
  const base: BriefSettings = { platforms: br.settings.platforms, accounts: accountsOf(br.settings), time: br.settings.time, mention: br.settings.mention };
  const [st, setSt] = useState<BriefSettings>(base); useEffect(() => { if (open) setSt(base); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = B!.profile.business.name; const dirty = JSON.stringify(st) !== JSON.stringify(base);
  const save = () => {
    app.act('brief.settings', st, { optimistic: b => ({ ...b, brief: { ...b.brief, settings: st } }) }).catch(() => {});
    onClose(); toast('Saved. Applies from tomorrow’s brief.');
  };
  return <Sheet open={open} onClose={onClose} title="Brief settings" width={480} footer={<><span className="grow" /><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={!dirty || !st.platforms.length} onClick={save}>Save</Btn></>}>
    <div className="col" style={{ gap: 28 }}>
      <Field label="Where to look" hint="Up to two conversations from each."><BriefPlatforms value={st.platforms} onChange={p => setSt({ ...st, platforms: p })} /></Field>
      <Field label="Draft for" hint={`${name} drafts cover X and LinkedIn. Reddit and Hacker News stay personal, where brand accounts aren’t welcome.`}><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{([['founder', 'You'], ['company', name]] as [BriefAccount, string][]).map(([k, l]) => { const a = st.accounts || BRIEF_DEFAULT.accounts; const on = a.includes(k); return <button key={k} type="button" className="brief-chip" data-on={on} aria-pressed={on} disabled={on && a.length === 1} onClick={() => setSt({ ...st, accounts: on ? a.filter(x => x !== k) : (['founder', 'company'] as BriefAccount[]).filter(x => x === k || a.includes(x)) })}>{l}</button>; })}</div></Field>
      <Field label={`Plug ${name}`} hint={st.mention === 'asked' ? 'Only when someone asks for a tool or recommendation. You can switch any reply.' : st.mention === 'relevant' ? 'Whenever it fits, always with a disclosure.' : 'Replies stay purely helpful.'}><Seg value={st.mention} onChange={v => setSt({ ...st, mention: v })} options={BMENTION.map(o => ({ v: o.v, l: o.l }))} /></Field>
      <Field label="Have it ready by"><input type="time" className="input" style={{ width: 140 }} value={st.time} onChange={e => setSt({ ...st, time: e.target.value })} /></Field>
      <p className="small sub">Topics and voice come from your <Btn kind="link" className="small" onClick={() => { onClose(); go('profile'); }}>Business Profile</Btn>.</p>
    </div>
  </Sheet>;
}

/** True below `px` wide (matches the CSS breakpoint where the brief stacks). */
function useNarrow(px: number) {
  const [n, setN] = useState(false);
  useEffect(() => { const m = matchMedia(`(max-width:${px}px)`); const f = () => setN(m.matches); f(); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, [px]);
  return n;
}
