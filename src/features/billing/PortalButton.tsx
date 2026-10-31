'use client';
import React, { useState } from 'react';
import { api } from '@/client/api';
import { Btn } from '@/components/ui';

/** Creates a fresh session on an explicit click. Never save the bearer URL in browser storage. */
export function PortalButton({ label = 'Manage billing', disabled = false, kind = 'secondary' }: { label?: string; disabled?: boolean; kind?: 'secondary' | 'link' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = async () => {
    if (busy || disabled) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ ok: true; url: string }>('/api/billing/portal', { method: 'POST' });
      window.location.assign(r.url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Billing couldn’t open. Try again in a few minutes.');
      setBusy(false);
    }
  };
  return <div className="col" style={{ gap: 8, alignItems: 'flex-start' }}>
    <Btn kind={kind} iconR="ext" loading={busy} disabled={disabled} aria-busy={busy} onClick={open}>{busy ? 'Opening billing…' : label}</Btn>
    {error && <p className="small" role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
  </div>;
}
