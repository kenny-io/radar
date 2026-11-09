'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Btn, Field, Status } from '@/components/ui';
import { api, ApiError } from '@/client/api';
import { EMAIL_RE } from '@/lib/format';
import { AuthShell } from './Signup';

export function PasswordRecovery({ mode }: { mode: 'request' | 'reset' }) {
  const reset = mode === 'reset';
  const [mounted, setMounted] = useState(false);
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [invalidLink, setInvalidLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const parsed = useRef(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    const readFragment = (initial = false) => {
      // Opening another email link in this tab can be a hash-only navigation. An empty hash after our own
      // replaceState is not a new link and must not invalidate the token retained during StrictMode's replay.
      if (!initial && !window.location.hash) return;
      parsed.current = true;
      generation.current++;
      inFlight.current = false;
      const value = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
      setToken(value);
      setInvalidLink(!/^[A-Za-z0-9_-]{43}$/.test(value));
      setError(''); setDone(false); setPassword(''); setConfirm(''); setBusy(false);
      // Drop the bearer secret from history once read; it stays only in this form's memory.
      if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    };
    const onHashChange = () => readFragment();
    if (reset && (!parsed.current || window.location.hash)) readFragment(!parsed.current);
    if (reset) window.addEventListener('hashchange', onHashChange);
    setMounted(true);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [reset]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mounted || busy || inFlight.current || done || invalidLink) return;
    if (!reset && !EMAIL_RE.test(email.trim())) { setError('Enter a valid email.'); return; }
    if (reset && password.length < 8) { setError('Use at least 8 characters.'); return; }
    if (reset && new TextEncoder().encode(password).length > 72) { setError('Use a password of 72 bytes or fewer (some characters use more than one byte).'); return; }
    if (reset && password !== confirm) { setError('The passwords don’t match.'); return; }
    const submittedGeneration = generation.current;
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      await api(reset ? '/api/auth/reset-password' : '/api/auth/forgot-password', { body: reset ? { token, password } : { email } });
      if (generation.current !== submittedGeneration) return;
      setDone(true); setPassword(''); setConfirm(''); setToken('');
    } catch (e) {
      if (generation.current !== submittedGeneration) return;
      setError(e instanceof Error ? e.message : 'Radar couldn’t finish this. Try again.');
      if (e instanceof ApiError && e.code === 'invalid_reset') setInvalidLink(true);
    } finally {
      if (generation.current === submittedGeneration) { inFlight.current = false; setBusy(false); }
    }
  };

  return <AuthShell energy={.2} art={<><span style={{ fontSize: 'clamp(32px,4.4vw,56px)', lineHeight: 1.02, fontWeight: 600, letterSpacing: '-0.045em' }}>A fresh way back in.</span><span style={{ color: 'var(--ink2)', marginTop: 14, fontSize: 15 }}>Keep your account secure and return to your next steps.</span></>}>
    <form className="col enter" style={{ gap: 18, maxWidth: 380, width: '100%', margin: '0 auto', position: 'relative' }} onSubmit={submit} noValidate>
      <div className="col" style={{ gap: 8 }}><h1 className="h1">{done ? reset ? 'Password updated' : 'Check your email' : reset ? 'Reset your password' : 'Forgot your password?'}</h1>
        <p className="sub">{done
          ? reset ? 'Your password has changed and you’ve been signed out on every device. Sign in with your new password.' : 'If a password account exists for that email, we’ll send a link that expires in one hour. If you joined with Google, continue with Google instead.'
          : reset ? 'Choose a new password for your Radar account.' : 'Enter the email you use for Radar and we’ll send you a reset link.'}</p></div>
      {done && <div role="status"><Status tone="ok">{reset ? 'Your account is ready to sign in' : 'Reset request received'}</Status></div>}
      {!done && !invalidLink && (!reset
        ? <Field label="Email"><input className="input" type="email" disabled={!mounted || busy} value={email} onChange={e => { setEmail(e.target.value); setError(''); }} autoComplete="email" maxLength={320} /></Field>
        : <><Field label="New password" hint="At least 8 characters"><input className="input" type="password" disabled={!mounted || busy} value={password} onChange={e => { setPassword(e.target.value); setError(''); }} autoComplete="new-password" maxLength={256} /></Field>
          <Field label="Confirm new password"><input className="input" type="password" disabled={!mounted || busy} value={confirm} onChange={e => { setConfirm(e.target.value); setError(''); }} autoComplete="new-password" maxLength={256} /></Field></>)}
      {invalidLink && <p className="small" role="alert" style={{ color: 'var(--bad)' }}>{error || 'This reset link is missing or invalid. Request a new one to continue.'}</p>}
      {error && !invalidLink && <p className="small" role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
      {!done && !invalidLink && <Btn kind="primary" size="lg" className="btn-block" type="submit" disabled={!mounted} loading={busy}>{reset ? 'Save new password' : 'Send reset link'}</Btn>}
      {invalidLink && <a href="/forgot-password">Request a new reset link</a>}
      <a href="/signin" className="small" style={{ textAlign: 'center' }}>Back to sign in</a>
      <p className="xs sub" style={{ textAlign: 'center' }}>Need help? <a href="mailto:support@thally.io">Contact support</a></p>
    </form>
  </AuthShell>;
}
