'use client';
import React, { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { useApp } from '@/client/app';
import { ApiError, openOAuth } from '@/client/api';
import { oauthErrorCopy } from '@/lib/oauthReturn';
import { Btn, Icon } from '@/components/ui';
import { fmtD } from '@/lib/format';
import { isGscReconnectNeeded } from '@/lib/gsc';

interface Recovery { busy: boolean; authorizing: boolean; error: string | null; reconnect: () => Promise<void>; cancel: () => void }
const RecoveryContext = createContext<Recovery | null>(null);

/** One recovery operation per mounted business, shared by the banner and Settings. */
export function GscReconnectProvider({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const current = useRef(app); current.current = app;
  const mounted = useRef(false); const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false); const [authorizing, setAuthorizing] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); pending.current = null; }; }, []);
  const cancel = () => {
    const request = pending.current; pending.current = null; request?.abort();
    setBusy(false); setAuthorizing(false); setError(oauthErrorCopy('Google Search Console', 'cancelled'));
  };
  const reconnect = async () => {
    const business = current.current.B;
    if (!business || business.id !== current.current.bid || business.role === 'Viewer' || pending.current) return;
    const bid = business.id;
    const request = new AbortController(); pending.current = request;
    const active = () => mounted.current && pending.current === request && current.current.bid === bid && current.current.B?.id === bid;
    setBusy(true); setAuthorizing(true); setError(null);
    try {
      // Open synchronously from the click, so browsers do not block the consent popup.
      const oauth = await openOAuth('gsc', bid, {}, { signal: request.signal });
      if (!active()) return;
      setAuthorizing(false);
      if (!oauth.ok) {
        setError(oauthErrorCopy('Google Search Console', oauth.error));
        return;
      }
      // active() and act() run synchronously together: act captures this business before its first await,
      // and owns workspace revisions, pending edits and access/deletion handling.
      const response = await current.current.act<{ ok: boolean }>('gsc.reconnect', {}, { silent: true });
      if (!active()) return;
      if (!response?.ok) { setError('Search Console couldn’t reconnect. Try again.'); return; }
      current.current.toast('Search Console reconnected. Syncing in the background.', { tone: 'ok' });
    } catch (e) {
      if (active()) setError(e instanceof ApiError ? e.message : 'Search Console couldn’t reconnect. Try again.');
    } finally {
      if (active()) { pending.current = null; setBusy(false); setAuthorizing(false); }
    }
  };
  return <RecoveryContext.Provider value={{ busy, authorizing, error, reconnect, cancel }}>{children}</RecoveryContext.Provider>;
}

export function GscReconnect() {
  const recovery = useContext(RecoveryContext); const id = useId();
  const { B } = useApp();
  if (!B || !isGscReconnectNeeded(B.gsc)) return null;
  if (B.role === 'Viewer') return <p className="gsc-reconnect-note">Ask an editor or admin to reconnect Google.</p>;
  if (!recovery) return null;
  return <div className="gsc-reconnect-action">
    <Btn icon="refresh" loading={recovery.busy} aria-busy={recovery.busy} aria-describedby={recovery.error ? id : undefined} onClick={recovery.reconnect}>{recovery.busy ? 'Reconnecting…' : 'Reconnect Google'}</Btn>
    {recovery.authorizing && <><p className="gsc-reconnect-note" role="status">Finish sign-in in the other window. If it closed, cancel and try again.</p><Btn kind="ghost" size="sm" onClick={recovery.cancel}>Cancel sign-in</Btn></>}
    {recovery.error && <p id={id} role="alert" className="gsc-reconnect-error">{recovery.error}</p>}
  </div>;
}

export function GscReconnectBanner() {
  const { B, bid, onboarding } = useApp(); const titleId = useId();
  if (!B || B.id !== bid || B.status !== 'active' || onboarding.open || !isGscReconnectNeeded(B.gsc)) return null;
  return <section className="gsc-reconnect-banner" aria-labelledby={titleId}>
    <Icon n="alert" s={20} style={{ color: 'var(--signal-ink)', marginTop: 2 }} />
    <div className="gsc-reconnect-copy">
      <h2 id={titleId}>Reconnect Search Console</h2>
      <p>Reconnect Google to keep your search data up to date.{B.gsc.lastSyncedThrough && <> Your data through {fmtD(B.gsc.lastSyncedThrough)} is saved.</>}</p>
    </div>
    <GscReconnect />
  </section>;
}
