'use client';
import React, { useRef, useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, Status } from '@/components/ui';
import { PUBLISH_FAILURE_MESSAGE, REPORT_ISSUE_ERROR, REPORT_ISSUE_LABEL } from '@/lib/publishingFailure';

/** Only an explicit click sends a report. All technical context is loaded by the server. */
export function ReportPublishIssue({ entryId }: { entryId: string }) {
  const app = useApp();
  const [state, setState] = useState<'idle' | 'sending' | 'reported'>('idle');
  const pending = useRef(false);
  const report = async () => {
    if (pending.current || state === 'reported') return;
    pending.current = true; setState('sending');
    try {
      const result = await app.act<{ delivered: boolean; reference: string }>('publish.reportIssue', { entryId }, { silent: true });
      if (result.delivered !== true) {
        setState('idle');
        app.toast('Your report was saved locally. No email was sent.', { tone: 'warn' });
        return;
      }
      setState('reported');
      app.toast('Issue reported to the team.', { tone: 'ok' });
    } catch {
      setState('idle'); app.toast(REPORT_ISSUE_ERROR, { tone: 'bad' });
    } finally { pending.current = false; }
  };
  return <Btn kind="primary" size="sm" loading={state === 'sending'} disabled={state === 'reported'} onClick={report} aria-live="polite">{state === 'sending' ? 'Sending…' : state === 'reported' ? 'Issue reported' : REPORT_ISSUE_LABEL}</Btn>;
}

export function PublishFailure({ entryId, onRetry }: { entryId: string; onRetry?: () => void }) {
  return <div className="row enter" role="group" aria-label="Publishing failed" style={{ padding: '14px clamp(16px,3vw,32px)', borderBottom: '1px solid var(--line)', gap: 14, flexWrap: 'wrap' }}>
    <Status tone="bad">Publishing failed</Status>
    <span className="small grow" style={{ minWidth: 220 }}>{PUBLISH_FAILURE_MESSAGE}</span>
    <ReportPublishIssue key={entryId} entryId={entryId} />
    {onRetry && <Btn size="sm" icon="refresh" onClick={onRetry}>Retry</Btn>}
  </div>;
}
