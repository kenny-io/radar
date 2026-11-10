'use client';
// "Trial · N days left" in the sidebar, above the user menu (.factory/first-five-optimizations/architecture.md §5, BE-3).
// B.billing.trialEndsAt is present only for the payer while trialing, so comp, grandfathered, billing-off accounts and
// members never see it. A real link to Settings → Billing (SettingsPage reads ?section=billing).
import React, { useEffect, useState } from 'react';
import { routeToUrl, useApp } from '@/client/app';
import { Icon } from '@/components/ui';
import { fmtDW } from './dates';
import { daysLeft, trialChipLabel } from './notice';
import './edges.css';

/** `onNavigate`: lets the shell close the mobile drawer, as the other sidebar rows do. */
export function TrialChip({ onNavigate }: { onNavigate?: () => void } = {}): React.ReactElement | null {
  const { B, go } = useApp();
  const end = B?.billing?.trialEndsAt;
  // Re-read the clock every minute so the count is right after midnight in a tab left open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!end) return; const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, [end]);
  if (!end) return null;
  const to = { section: 'billing' };
  return <a className={'trial-chip' + (daysLeft(end, now) <= 1 ? ' last' : '')} href={routeToUrl('settings', to)} title={`Your trial ends ${fmtDW(end)}. See what you’ll be charged in Billing.`}
    onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onNavigate?.(); go('settings', to); }}>
    <i className="dot" aria-hidden="true" /><span>{trialChipLabel(end, now)}</span><Icon n="chevR" s={14} />
  </a>;
}
