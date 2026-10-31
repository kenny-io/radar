'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Btn, Status } from '@/components/ui';
import type { BillingOverview } from '@/lib/types';
import { PortalButton } from './PortalButton';
import { overviewCopy, periodLabel } from './overviewCopy';

function BillingRow({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="row" style={{ padding: '18px 0', borderTop: '1px solid var(--line2)', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
    <span className="small set-l" style={{ width: 220, fontWeight: 500 }}>{title}</span>
    <div className="grow col" style={{ gap: 8, minWidth: 0, flexBasis: 240 }}>{children}</div>
  </div>;
}

export function BillingSettings() {
  const [state, setState] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    let controller: AbortController | null = null;
    const load = async () => {
      const version = ++generation.current;
      controller?.abort(); controller = new AbortController();
      setLoading(true); setError('');
      try {
        const r = await fetch('/api/billing/overview', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        if (!r.ok) throw new Error('Your billing details couldn’t load. Try again.');
        const next = await r.json() as BillingOverview;
        if (generation.current === version) setState(next);
      } catch (e: unknown) {
        if (generation.current === version && !(e instanceof Error && e.name === 'AbortError')) setError('Your billing details couldn’t load. Try again.');
      } finally { if (generation.current === version) setLoading(false); }
    };
    void load();
    const focus = () => { void load(); };
    window.addEventListener('focus', focus);
    return () => { generation.current++; controller?.abort(); window.removeEventListener('focus', focus); };
  }, [retry]);

  if (loading && !state) return <p className="small sub" role="status">Loading your billing details…</p>;
  if (error) return <div className="col" style={{ gap: 12, alignItems: 'flex-start' }}>
    <p className="small" role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>
    <Btn size="sm" onClick={() => setRetry(n => n + 1)}>Try again</Btn>
  </div>;
  if (!state) return null;
  const c = overviewCopy(state);
  const label = periodLabel(state);
  const date = state.status === 'trialing' ? state.trialEnd || state.currentPeriodEnd : state.currentPeriodEnd;
  return <div aria-busy={loading}>
    <BillingRow title="Your account">
      <Status tone={c.tone}>{c.label}</Status>
      <p className="small sub" style={{ margin: 0 }}>{c.description}</p>
      {state.status === 'comp' && state.canManage && <p className="xs sub" style={{ margin: 0 }}>{state.cancelAtPeriodEnd ? 'Your Stripe subscription is scheduled to end after its current billing period. Review your billing below.' : 'Any existing Stripe subscription continues until you cancel it. Review your billing below.'}</p>}
      {!state.enforced && state.status !== 'comp' && state.status !== 'none' && <p className="xs sub" style={{ margin: 0 }}>Your account currently has access without a subscription. Existing Stripe subscriptions continue until canceled.</p>}
    </BillingRow>
    {state.status !== 'comp' && <BillingRow title="Plan"><span className="small">Radar · $50/month</span><span className="xs sub">One subscription covers all businesses you own. Team businesses may be covered by their owner.</span></BillingRow>}
    {label && date && <BillingRow title={label}><time className="small" dateTime={date}>{new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(date))}</time></BillingRow>}
    {state.canManage ? <BillingRow title="Payments & invoices"><PortalButton /><p className="xs sub" style={{ margin: 0 }}>Update your card, download invoices, or manage cancellation securely in Stripe.</p></BillingRow>
      : state.provider !== 'stripe' ? <BillingRow title="Payments & invoices"><p className="small sub" style={{ margin: 0 }}>{state.provider === 'stub' ? 'Hosted billing is unavailable in local development.' : 'Payment management is temporarily unavailable. Try again in a few minutes.'}</p></BillingRow>
      : <BillingRow title="Payments & invoices"><p className="small sub" style={{ margin: 0 }}>There are no payment details to manage on your account yet.</p></BillingRow>}
    {loading && <p className="xs sub" role="status">Refreshing billing details…</p>}
  </div>;
}
