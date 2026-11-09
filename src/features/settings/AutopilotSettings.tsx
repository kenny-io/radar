'use client';

import React, { useState } from 'react';
import { useApp } from '@/client/app';
import { ApiError } from '@/client/api';
import { Btn, Section, Status, Toggle } from '@/components/ui';

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <div className="row" style={{ padding: '18px 0', borderTop: '1px solid var(--line2)', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
    <span className="col set-l" style={{ width: 220, gap: 3 }}><span className="small" style={{ fontWeight: 500 }}>{title}</span>{hint && <span className="xs sub">{hint}</span>}</span>
    <div className="grow col" style={{ gap: 10, minWidth: 0, flexBasis: 240 }}>{children}</div>
  </div>;
}

export function AutopilotSettings({ onSection }: { onSection: (section: 'calendar' | 'publishing' | 'social') => void }) {
  const { B, act, toast, go } = useApp();
  const [busy, setBusy] = useState<'toggle' | 'run' | null>(null);
  const [error, setError] = useState('');
  if (!B) return null;
  const program = B.autopilot;
  const enabled = !!program?.enabled;
  const owner = B.role === 'Owner';
  const ownerEmail = B.team.find(member => member.role === 'Owner' && member.status === 'active')?.email;
  const running = enabled && B.jobs.some(job => job.kind === 'autopilot.run' && (job.status === 'queued' || job.status === 'running'));
  const lastRun = program?.lastRunAt && !Number.isNaN(Date.parse(program.lastRunAt)) ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: B.tz }).format(new Date(program.lastRunAt)) : null;

  const change = async (next: boolean) => {
    if (!owner || busy) return;
    setBusy('toggle'); setError('');
    try {
      await act('settings.autopilot', { enabled: next }, { silent: true });
      toast(next ? 'Autopilot is on. Radar will start your marketing program.' : 'Autopilot is off. Future Autopilot actions are stopped.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Radar couldn’t save Autopilot. Try again.'); }
    finally { setBusy(null); }
  };
  const run = async () => {
    if (!owner || busy || !enabled || running) return;
    setBusy('run'); setError('');
    try {
      await act('settings.autopilotRun', {}, { silent: true });
      toast('Autopilot is queued. Radar will check what needs doing.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Radar couldn’t start Autopilot. Try again.'); }
    finally { setBusy(null); }
  };

  return <Section title="Autopilot" style={{ marginTop: 0 }}>
    <p className="small" style={{ fontWeight: 500, marginBottom: 6, overflowWrap: 'anywhere' }}>{B.profile.business.name || B.profile.domain} · {B.profile.domain}</p>
    <p className="xs sub" style={{ marginBottom: 16 }}>Applies only to this business. Switch businesses to set up Autopilot for another.</p>
    <p className="small sub" style={{ marginBottom: 20, maxWidth: 590 }}>Let Radar plan, write and publish for your business. Turning this on authorizes Radar to publish articles and social posts without your review.</p>
    <div aria-busy={busy !== null}>
      <Row title="Run my marketing" hint="Only the workspace owner can change this.">
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <Toggle on={enabled} onChange={change} label="Autopilot" disabled={!owner || busy !== null} />
          <span role="status" aria-live="polite"><Status tone={enabled ? 'ok' : 'mute'} pulse={running}>{busy === 'toggle' ? 'Saving…' : enabled ? running ? 'On · Working' : 'On' : 'Off'}</Status></span>
        </div>
        <p className="xs sub">{enabled ? 'Radar checks your program in the background, even while you’re away.' : 'Turn on to start. Your current drafts and individual automation settings stay saved.'}</p>
        <p className="xs sub">Turning off stops future Autopilot actions. Manual schedules and separate automations continue. A send already in progress may finish.</p>
      </Row>
      {error && <p role="alert" className="small" style={{ color: 'var(--bad)', marginBottom: 18 }}>{error}</p>}
      <Row title="What Radar handles" hint="Uses your Business Profile and saved schedule.">
        <p className="small sub">Creates and replenishes your content calendar, drafts articles, and publishes them to your connected blog. Generates social posts and publishes or schedules them through connected X and LinkedIn accounts.</p>
        <p className="xs sub">Your calendar frequency, social draft days and business timezone guide the program. Existing drafts and manual publication choices are preserved.</p>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
          <button type="button" className="unlink" onClick={() => onSection('calendar')}>Calendar defaults</button>
          <button type="button" className="unlink" onClick={() => onSection('publishing')}>Blog connections</button>
          {B.social.publishing && <button type="button" className="unlink" onClick={() => onSection('social')}>Social accounts</button>}
          {B.role !== 'Viewer' && <button type="button" className="unlink" onClick={() => go('social', { auto: true })}>Social draft settings</button>}
        </div>
      </Row>
      <Row title="When you’re needed" hint="Radar emails the workspace owner.">
        {ownerEmail && <span className="small" style={{ overflowWrap: 'anywhere' }}>{ownerEmail}</span>}
        <p className="small sub">You receive the prepared text and a link for actions Radar can’t take, including Reddit comments and other replies. Missing connections and publishing problems also reach your inbox.</p>
        <p className="xs sub">Search and visibility monitoring keep running. Backlink participation follows your existing opt-in.</p>
      </Row>
      <Row title="Latest activity" hint={lastRun ? `Last checked ${lastRun} · ${B.tz}` : 'The first check starts when Autopilot is turned on.'}>
        {program?.summary ? <p className="small" style={{ overflowWrap: 'anywhere' }}>{program.summary}</p> : <p className="small sub">{enabled ? 'Radar is preparing the first check. Activity will appear here.' : 'No Autopilot activity yet.'}</p>}
        {program?.lastError && <p className="small" role="alert" style={{ color: 'var(--bad)', overflowWrap: 'anywhere' }}>{program.lastError}</p>}
        {owner && enabled && <div><Btn size="sm" loading={busy === 'run'} disabled={busy !== null || running} onClick={run}>{running ? 'Checking program…' : program?.lastError ? 'Try again' : 'Run now'}</Btn></div>}
      </Row>
    </div>
  </Section>;
}
