'use client';
// Port of Trial (prototype/radar-trial.jsx, UPDATE-2026-10-25 §4). The card is confirmed with a $1 PaymentIntent, then
// the server starts the subscription (architecture §7.1):
//   createPaymentMethod → POST /api/billing/start (or /restart) → confirmCardPayment (3-D Secure) → POST /api/billing/confirm
// Dates come only from the server's instants (state.trialEnd; the confirm response on success), formatted after mount
// in the browser's time zone. "Open dashboard" only navigates: the server already committed the profile.
import React, { useEffect, useRef, useState } from 'react';
import { Btn, Icon, LogoTile, sleep } from '@/components/ui';
import { api, ApiError } from '@/client/api';
import { AuthShell, BackLink } from '@/features/onboarding/Signup';
import type { BillingState, TrialPageProps } from '@/lib/types';
import { CardFields, type CardHandle } from './CardFields';
import { StubCardFields } from './StubCardFields';
import { addMonthIso, D_PLACEHOLDER, DW_PLACEHOLDER, fmtD, fmtDW } from './dates';
import { billingErrorOutcome, cardErrorMessage, trialCopy, type DateNode } from './copy';
import { firstError, type CardErrors } from './elementErrors';

interface StartRes { ok: true; clientSecret?: string; paymentIntentId?: string; subscriptionId?: string; trialEnd?: string; activated?: boolean; state?: BillingState }

export function TrialPage({ state, publishableKey }: TrialPageProps) {
  const [err, setErr] = useState<CardErrors>({}); const [busy, setBusy] = useState(false); const [fail, setFail] = useState('');
  const [done, setDone] = useState<BillingState | null>(null);
  const card = useRef<CardHandle | null>(null);
  const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), []);
  const D: DateNode = (iso, weekday) => <DateText iso={iso} weekday={weekday} mounted={mounted} />;
  const c = trialCopy(state, D, () => addMonthIso(new Date()));
  const draft = state.draft && state.draft.savedAt ? state.draft : null;

  // Focus the card number once the fields are enabled again (they're disabled while busy), i.e. after the re-render.
  const [refocus, setRefocus] = useState(0);
  useEffect(() => { if (refocus) card.current?.focus('num'); }, [refocus]);
  const stop = (msg: string) => { setBusy(false); setFail(msg); setRefocus(n => n + 1); };
  const pay = async (e?: React.FormEvent) => {
    e && e.preventDefault(); if (busy || !card.current) return;
    const er = card.current.validate(); setErr(er); setFail('');
    const first = firstError(er); if (first) { card.current.focus(first); return; }
    setBusy(true);
    try {
      const pm = await card.current.createPaymentMethod();
      if ('error' in pm) return stop(cardErrorMessage(pm.error));
      const restart = state.mode === 'restart';
      const r = await api<StartRes>(restart ? '/api/billing/restart' : '/api/billing/start', { body: { paymentMethodId: pm.id } });
      if (r.activated && r.state) { setBusy(false); setDone(r.state); return; } // an earlier $1 already went through
      if (!r.clientSecret) return stop(cardErrorMessage(null));
      const cc = await card.current.confirmCardPayment(r.clientSecret, pm.id);
      if ('error' in cc) return stop(cardErrorMessage(cc.error));
      const st = await confirmAccess(restart ? { subscriptionId: r.subscriptionId } : { paymentIntentId: r.paymentIntentId });
      setBusy(false); setDone(st);
    } catch (x) {
      const o = billingErrorOutcome(x instanceof ApiError ? x : null);
      if ('go' in o) { window.location.assign(o.go); return; }
      stop(o.message);
    }
  };

  const steps = c.steps;
  return <AuthShell energy={done ? .9 : .4} art={draft && <>
    <LogoTile brand={draft.brand} s={52} />
    <span style={{ marginTop: 22, fontSize: 'clamp(32px,4.4vw,56px)', lineHeight: 1.02, fontWeight: 600, letterSpacing: '-0.045em', textWrap: 'balance' } as React.CSSProperties}>{draft.name} is ready to be found.</span>
    <span style={{ color: 'var(--ink2)', marginTop: 14, fontSize: 15 }}>Your Business Profile is saved to your account. {state.mode === 'restart' ? 'Restart your subscription' : 'Start your trial'} to open the dashboard.</span>
  </>}>
    {!done ? <form className="col enter" style={{ gap: 18, maxWidth: 400, width: '100%', margin: '0 auto', position: 'relative' }} onSubmit={pay} noValidate>
      {state.hasDraft && <BackLink href="/onboarding" />}
      <div className="col" style={{ gap: 6 }}><h1 className="h1">{c.h1}</h1><p className="sub">{c.sub}</p></div>
      <ol className="col" style={{ listStyle: 'none', margin: '4px 0 2px', padding: 0 }} aria-label={state.mode === 'restart' ? 'How the restart works' : 'How the trial works'}>
        {steps.map(([col, t, d], i) => <li key={i} className="row" style={{ gap: 12, alignItems: 'flex-start', padding: '11px 0', borderTop: i ? '1px solid var(--line2)' : 0 }}><i className="dot" style={{ background: col, marginTop: 7 }} /><span className="col grow" style={{ gap: 1, minWidth: 0 }}><span className="small" style={{ fontWeight: 500 }}>{parts(t)}</span><span className="xs sub">{d}</span></span></li>)}
      </ol>
      {state.provider === 'stub' ? <StubCardFields err={err} handle={card} disabled={busy} /> : <CardFields publishableKey={publishableKey} err={err} handle={card} disabled={busy} />}
      {fail && <p className="small enter" role="alert" style={{ color: 'var(--bad)' }}>{fail}</p>}
      <Btn kind="primary" size="lg" className="btn-block" type="submit" loading={busy} style={{ marginTop: 4 }}>{busy ? c.busy : c.button}</Btn>
      {c.fine && <p className="xs sub">{parts(c.fine)}</p>}
    </form>
    : <div className="col enter" style={{ gap: 18, maxWidth: 400, width: '100%', margin: '0 auto', position: 'relative' }} role="status">
      <span style={{ width: 48, height: 48, borderRadius: 99, background: 'var(--ink)', color: 'var(--on-ink)', display: 'grid', placeItems: 'center' }}><Icon n="check" s={22} w={2} /></span>
      <div className="col" style={{ gap: 6 }}><h1 className="h1">{c.doneH1}</h1><p className="sub">{parts(c.doneBody(done))}</p></div>
      <Btn kind="primary" size="lg" className="btn-block" iconR="arrow" autoFocus onClick={() => window.location.assign(c.doneHref)} style={{ marginTop: 6 }}>Open dashboard</Btn>
    </div>}
  </AuthShell>;
}

const parts = (p: React.ReactNode[]) => p.map((x, i) => <React.Fragment key={i}>{x}</React.Fragment>);

/** Formats after mount only (B12). Before mount: an invisible stand-in of similar width, so nothing jumps. */
function DateText({ iso, weekday, mounted }: { iso: string | null; weekday?: boolean; mounted: boolean }) {
  if (!iso) return null;
  if (!mounted) return <span style={{ visibility: 'hidden' }}>{weekday ? DW_PLACEHOLDER : D_PLACEHOLDER}</span>;
  return <>{weekday ? fmtDW(iso) : fmtD(iso)}</>;
}

/** POST /api/billing/confirm: retried 3 times (1s, 2s, 4s) on network errors and 5xx, then GET /api/billing/state every
 *  2s for up to 30s until the account has access (the webhook may get there first). */
async function confirmAccess(body: { paymentIntentId?: string; subscriptionId?: string }): Promise<BillingState> {
  let last: unknown = null;
  for (const wait of [0, 1000, 2000, 4000]) {
    if (wait) await sleep(wait);
    try { return (await api<{ ok: true; state: BillingState }>('/api/billing/confirm', { body })).state; }
    catch (e) { last = e; if (e instanceof ApiError && e.status < 500 && e.code !== 'payment_not_succeeded') throw e; }
  }
  for (const until = Date.now() + 30000; Date.now() < until;) {
    await sleep(2000);
    try { const s = await api<BillingState>('/api/billing/state'); if (s.access) return s; } catch { /* keep polling */ }
  }
  throw last;
}
