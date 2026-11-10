'use client';
// The Dashboard while B.firstRun is present (.factory/first-five-optimizations/architecture.md §1, FS-2/FS-3): one row
// per job Radar started when the business was saved. Each row is a link to its screen (it works while the job runs and
// after), with the job's live step from the event stream; a failed row says what failed and has Retry. The page leaves
// by itself: a finishing job bumps the revision and the refetched workspace has no `firstRun`.
import React, { useEffect, useState } from 'react';
import { routeToUrl, useApp } from '@/client/app';
import { Btn, Icon, Status } from '@/components/ui';
import { accountsOf } from '@/features/brief/model';
import { firstWeekRow, firstWeekSummary, type FirstWeekRow } from './firstWeekRows';
import type { FirstRunKey, Workspace } from '@/lib/types';

function greet() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
const withoutFirstRun = (b: Workspace): Workspace => { const { firstRun: _gone, ...rest } = b; return rest; };

function RowIcon({ s }: { s: FirstWeekRow['status'] }) {
  if (s === 'done') return <Icon n="check" s={16} w={2} style={{ color: 'var(--ok)' }} />;
  if (s === 'running') return <span className="spin" style={{ color: 'var(--signal)' }} />;
  if (s === 'failed') return <Icon n="alert" s={16} style={{ color: 'var(--bad)' }} />;
  return <Icon n="clock" s={16} style={{ color: 'var(--faint)' }} />;
}

export function FirstWeek(): React.ReactElement | null {
  const app = useApp(); const { B, go } = app;
  const [busy, setBusy] = useState<FirstRunKey | 'dismiss' | null>(null);
  const items = B?.firstRun?.items || [];
  const accts = B ? accountsOf(B.brief.settings) : [];
  const rows = B ? items.map(it => firstWeekRow(it, it.jobId ? app.jobs[it.jobId] : null, {
    gsc: ['connected', 'syncing', 'error'].includes(B.gsc.status),
    draftFor: accts.length > 1 ? 'both' : accts[0] || 'founder', name: B.profile.business.name || 'your business',
    topics: B.calendar.entries.length, briefItems: B.brief.days[B.today]?.items.length || 0,
  })) : [];
  const sum = firstWeekSummary(rows);
  // Two cases no revision bump announces: the jobs are still being started (no ids yet, so no job events either), and
  // every job has ended on the stream while the workspace still lists one as working. Ask again until they agree.
  const starting = items.some(i => !i.jobId && i.status === 'queued');
  const behind = !sum.active && items.some(i => i.status === 'queued' || i.status === 'running');
  const refresh = app.refresh;
  useEffect(() => {
    if (!starting && !behind) return;
    const t = setInterval(() => { refresh(); }, starting ? 8000 : 3000);
    return () => clearInterval(t);
  }, [starting, behind, refresh]);
  if (!B?.firstRun) return null;

  const first = (app.user.name || '').split(' ')[0];
  const canAct = B.role !== 'Viewer';
  const retry = async (key: FirstRunKey) => {
    if (busy) return;
    setBusy(key);
    try { await app.act('firstRun.retry', { key }); } catch { /* toasted; the row stays failed */ } finally { setBusy(null); }
  };
  const dismiss = async () => {
    if (busy) return;
    setBusy('dismiss');
    try { await app.act('firstRun.dismiss', {}, { optimistic: withoutFirstRun }); } catch { /* toasted; the workspace is refetched */ } finally { setBusy(null); }
  };
  const open = (page: FirstWeekRow['page']) => (e: React.MouseEvent) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; e.preventDefault(); go(page); };
  const head = sum.active ? 'Radar is preparing your first week.' : sum.failed ? 'Radar couldn’t finish preparing your first week.' : 'Your first week is ready.';
  const lead = sum.active ? `Radar is researching article topics, finding conversations worth joining today, and checking how AI assistants answer questions in your market, all from your Business Profile for ${B.profile.business.name || B.profile.domain}.`
    : sum.failed ? (canAct ? 'Try again below. Everything that finished is ready to open.' : 'Everything that finished is ready to open. An owner or editor can try the rest again.') : 'Opening your dashboard.';
  return <div className="page">
    <div className="col enter" style={{ gap: 18, marginBottom: 32 }}>
      <span className="sub">{greet()}, {first}.</span>
      <h1 className="h-display" style={{ maxWidth: 760 }}>{head}</h1>
      <p className="sub" style={{ fontSize: 16, maxWidth: 620 }}>{lead}</p>
    </div>
    {/* One quiet announcement per change in the counts; the step lines change too often to announce. */}
    <span className="fw-sr" role="status">{sum.done} of {sum.total} ready{sum.failed ? `, ${sum.failed} failed` : ''}</span>
    <ul className="card fw-list enter" style={{ animationDelay: '.08s' }} aria-label="Your first week">
      {rows.map(r => <li key={r.key} className="fw-item" data-status={r.status}>
        <a className="fw-row tap" href={routeToUrl(r.page)} onClick={open(r.page)} title={r.open}>
          <span className="fw-ic" aria-hidden="true"><RowIcon s={r.status} /></span>
          <span className="fw-main">
            <span className="fw-t">{r.title}</span>
            <span className={'small fw-d' + (r.status === 'failed' ? '' : ' sub')}>{r.detail}{r.meta && <span className="num sub"> · {r.meta}</span>}</span>
            {r.pct != null && <span className="fw-bar" aria-hidden="true"><i style={{ width: Math.round(r.pct * 100) + '%' }} /></span>}
          </span>
          <Status tone={r.tone}>{r.label}</Status>
          <span className="fw-sr">. {r.open}</span>
          <Icon n="chevR" s={16} />
        </a>
        {r.status === 'failed' && canAct && <div className="fw-act"><Btn size="sm" icon="refresh" loading={busy === r.key} disabled={!!busy} onClick={() => retry(r.key)} aria-label={`Retry ${r.title}`}>Retry</Btn></div>}
      </li>)}
    </ul>
    <div className="fw-foot">
      {sum.active ? <p className="xs sub">You can leave this page. Radar keeps working, and this list updates by itself.</p>
        : sum.canDismiss && canAct ? <><p className="small sub grow" style={{ minWidth: 200 }}>Or dismiss this and start what’s missing from its own screen whenever you like.</p><Btn kind="ghost" loading={busy === 'dismiss'} disabled={!!busy} onClick={dismiss}>Dismiss</Btn></>
        : null}
    </div>
  </div>;
}
