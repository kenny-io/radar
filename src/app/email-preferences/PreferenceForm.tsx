'use client';
import { useState } from 'react';
import { Btn } from '@/components/ui';
import { api } from '@/client/api';
export function PreferenceForm({ token, work = false, education = false }: { token: string; work?: boolean; education?: boolean }) {
  const [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState('');
  if (done) return <p role="status">{education ? 'Weekly education emails are turned off.' : work ? 'Work reminders are turned off.' : 'Optional setup emails are turned off.'} Billing and account-security messages will still reach you.</p>;
  return <form onSubmit={async e => {
    e.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await api('/api/email-preferences', { body: { token } }); setDone(true); }
    catch { setError('Radar couldn’t save this. Try again, or contact support@thally.io.'); }
    finally { setBusy(false); }
  }}>
    <Btn type="submit" kind="primary" loading={busy}>{education ? 'Stop weekly education emails' : work ? 'Stop work reminders' : 'Stop optional setup emails'}</Btn>
    {error && <p role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
  </form>;
}
