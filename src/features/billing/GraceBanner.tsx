'use client';
// Past-due grace banner above <main> on every app screen (.factory/first-five-optimizations/architecture.md §5, BE-2).
// B.billing.graceEndsAt is present for every member while the owner's failed payment is inside the grace period; only the
// payer gets the button. It renders after the workspace loads (client only), so the date is formatted in the browser's zone.
import React from 'react';
import { useApp } from '@/client/app';
import { PortalButton } from './PortalButton';
import { fmtDeadline, graceMessage } from './notice';
import './edges.css';

export function GraceBanner(): React.ReactElement | null {
  const { B } = useApp();
  const end = B?.billing?.graceEndsAt;
  if (!B || !end) return null;
  const payer = !!B.billing?.payer;
  return <div className="grace-banner" role="status">
    <p className="grace-msg"><i className="dot" aria-hidden="true" /><span>{graceMessage(payer, fmtDeadline(end))}</span></p>
    {payer && <div className="grace-act"><PortalButton label="Update card" /></div>}
  </div>;
}
