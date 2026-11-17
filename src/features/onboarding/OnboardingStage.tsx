'use client';
// Standalone onboarding (/start for guests, /onboarding when signed in; architecture §9, B16). The prototype draws the
// onboarding modal over the app shell; guests can't enter the app, so this draws the same shell as a static, inert
// backdrop (sidebar with initials "?" for a guest, GhostDash "Welcome."), with the Onboarding modal on top.
// AppProvider gets a synthetic Me with no current business, so it makes no workspace or SSE requests; it is here so
// the shared pieces (Side, toasts, GscConnect) work unchanged.
import React, { useMemo } from 'react';
import { AppProvider } from '@/client/app';
import { Btn, Mark } from '@/components/ui';
import { GhostDash, Side } from '@/features/shell/AppShell';
import { Onboarding } from './Onboarding';
import { SignedInFooter } from '@/features/billing/SignedInFooter';
import { useLocalTime } from '@/features/restore/RecentlyDeleted';
import { restoreLine } from '@/client/deletion';
import type { Me, OnboardingStageProps } from '@/lib/types';

export function OnboardingStage(props: OnboardingStageProps) {
  const name = props.user?.name || '';
  const me = useMemo<Me>(() => ({ user: { id: '', name, email: '' }, businesses: [], currentId: null, deleted: [] }), [name]);
  // An owner with a deleted business still inside its 7 days (they may have deleted their only one) gets one line to
  // /restore. The date is in the viewer's own time zone, which the server does not know: until this page is live in
  // the browser the line holds its place in UTC, unseen, so nothing moves when the real date arrives.
  const local = useLocalTime();
  const line = restoreLine(props.deleted, local ? undefined : 'UTC');
  return <AppProvider me={me}>
    <div className="app" inert aria-hidden="true">
      <Side open={false} onClose={() => {}} />
      <div style={{ minWidth: 0 }}>
        <div className="mob-bar"><Btn kind="ghost" icon="menu" aria-label="Menu" tabIndex={-1} /><Mark s={20} /><span style={{ fontWeight: 600 }}>Radar</span></div>
        <main className="main"><GhostDash name={name} /></main>
      </div>
    </div>
    {/* The footer is the only way out of this page: the modal can't be dismissed and the shell behind it is inert (BE-4).
        It is rendered inside the dialog, so keyboard and screen-reader users reach it. */}
    <Onboarding actor={props.actor} draft={props.draft} saveCommits={props.saveCommits} autoDomain={props.autoDomain}
      footer={<>
        {line && <p className="restore-line" style={local ? undefined : { visibility: 'hidden' }}>{line.text} <a href="/restore">{line.link}</a></p>}
        <SignedInFooter inModal email={props.actor === 'user' ? props.user?.email : null} />
      </>} />
  </AppProvider>;
}
