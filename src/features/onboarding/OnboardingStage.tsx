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
import type { Me, OnboardingStageProps } from '@/lib/types';

export function OnboardingStage(props: OnboardingStageProps) {
  const name = props.user?.name || '';
  const me = useMemo<Me>(() => ({ user: { id: '', name, email: '' }, businesses: [], currentId: null }), [name]);
  return <AppProvider me={me}>
    <div className="app" inert aria-hidden="true">
      <Side open={false} onClose={() => {}} />
      <div style={{ minWidth: 0 }}>
        <div className="mob-bar"><Btn kind="ghost" icon="menu" aria-label="Menu" tabIndex={-1} /><Mark s={20} /><span style={{ fontWeight: 600 }}>Radar</span></div>
        <main className="main"><GhostDash name={name} /></main>
      </div>
    </div>
    <Onboarding actor={props.actor} draft={props.draft} saveCommits={props.saveCommits} autoDomain={props.autoDomain} />
  </AppProvider>;
}
