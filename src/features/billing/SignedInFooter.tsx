'use client';
// "Signed in as {email} · Sign out · Need help?" on /start-trial and the onboarding stage, the two signed-in pages with
// no app shell and so no other way out (.factory/first-five-optimizations/architecture.md §5, BE-4). A guest (no email)
// sees only "Need help?". Help is the support address: the in-app widget needs a business and the app shell.
import React, { useState } from 'react';
import { SUPPORT_MAILTO } from './notice';
import './edges.css';

/** `inModal`: the last row inside the onboarding dialog (it is passed to `Onboarding` as its footer), with a rule above. */
export function SignedInFooter({ email, inModal }: { email?: string | null; inModal?: boolean }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const signOut = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/auth/signout', { method: 'POST', credentials: 'same-origin' });
      if (!r.ok) throw new Error('signout failed');
      window.location.assign('/');
    } catch { setError('Radar couldn’t sign you out. Try again.'); setBusy(false); }
  };
  // One line where there is room (the onboarding dialog on a wide screen); otherwise the address on its own line above the
  // two actions, so a wrap never leaves a separator dangling.
  return <p className={'signed-foot' + (inModal ? ' signed-foot-modal' : '')}>
    {email && <span className="who">Signed in as <b>{email}</b></span>}
    <span className="acts">
      {email && <><span className="sep lead" aria-hidden="true">·</span>
        <button type="button" onClick={signOut} disabled={busy} aria-busy={busy}>{busy ? 'Signing out…' : 'Sign out'}</button><span className="sep" aria-hidden="true">·</span></>}
      <a href={SUPPORT_MAILTO}>Need help?</a>
    </span>
    {error && <span className="err" role="alert">{error}</span>}
  </p>;
}
