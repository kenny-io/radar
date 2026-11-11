'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Btn, Field } from '@/components/ui';
import { api, ApiError } from '@/client/api';
import { AuthShell } from './Signup';
import { authFormStyle, safeAuthNext, VerificationRequest, type HumanCheckProps } from './VerificationRequest';

export function EmailVerification(props: HumanCheckProps) {
  const sp = useSearchParams(); const next = safeAuthNext(sp?.get('next'));
  const [mounted, setMounted] = useState(false); const [token, setToken] = useState('');
  const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [pwError, setPwError] = useState('');
  const [busy, setBusy] = useState(false); const [invalid, setInvalid] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const captureLink = () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const value = fragment.get('token') || '';
      const cleanUrl = window.location.pathname + window.location.search;
      // Next keeps URLs inside its history tree as well as the address bar. Scrub both,
      // preserving the routing structure, before letting the router restore the clean URL.
      const scrub = (entry: unknown): unknown => {
        if (typeof entry === 'string') {
          const hash = entry.indexOf('#');
          return hash >= 0 && new URLSearchParams(entry.slice(hash + 1)).has('token') ? entry.slice(0, hash) : entry;
        }
        if (Array.isArray(entry)) return entry.map(scrub);
        if (entry && typeof entry === 'object') return Object.fromEntries(Object.entries(entry).map(([key, item]) => [key, scrub(item)]));
        return entry;
      };
      window.history.replaceState(scrub(window.history.state), '', cleanUrl);
      // Initial child effects can run before Next installs its history wrapper. The
      // microtask also updates its canonical URL/tree after that wrapper is ready.
      queueMicrotask(() => {
        if (window.location.pathname + window.location.search === cleanUrl && !window.location.hash) window.history.replaceState(null, '', cleanUrl);
      });
      if (value) {
        setPassword(''); setError(''); setPwError('');
        const valid = /^[A-Za-z0-9_-]{32,256}$/.test(value);
        setToken(valid ? value : ''); setInvalid(!valid);
      }
      setMounted(true);
    };
    captureLink();
    window.addEventListener('hashchange', captureLink);
    window.addEventListener('popstate', captureLink);
    return () => {
      window.removeEventListener('hashchange', captureLink);
      window.removeEventListener('popstate', captureLink);
    };
  }, []);
  useEffect(() => { if (mounted && token) heading.current?.focus(); }, [mounted, token]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!mounted || busy || !token) return;
    setError(''); setPwError('');
    if (password.length < 8) { setPwError('Use at least 8 characters'); return; }
    if (new TextEncoder().encode(password).length > 72) { setPwError('Use a password of 72 bytes or fewer (some characters use more than one byte).'); return; }
    setBusy(true);
    try {
      const result = await api<{ ok: true; next: string }>('/api/auth/verify-email', { body: { token, password } });
      setToken(''); setPassword(''); window.location.assign(safeAuthNext(result.next) || '/dashboard');
    } catch (e) {
      if (e instanceof ApiError && e.errors?.pw) setPwError(e.errors.pw);
      else if (e instanceof ApiError && e.code === 'verification_invalid') { setInvalid(true); setToken(''); setPassword(''); }
      else setError(e instanceof ApiError ? e.message : 'Radar couldn’t confirm your email. Check your connection and try again.');
      setBusy(false);
    }
  };
  return <AuthShell energy={.35}>
    {!mounted ? <div className="col" style={authFormStyle}><h1 className="h1">Confirm your email</h1><p className="sub" role="status">Opening your confirmation link…</p></div>
      : !token ? <VerificationRequest {...props} next={next} notice={invalid ? 'This confirmation link has expired, is invalid, or has already been used. Request a new email.' : 'If you refreshed this page, reopen the link from your email or request a new one below.'} />
      : <form className="col enter" style={authFormStyle} onSubmit={submit} noValidate aria-busy={busy}>
        <div className="col" style={{ gap: 8 }}><h1 className="h1" ref={heading} tabIndex={-1} style={{ outline: 'none' }}>Choose your password</h1><p className="sub">Confirm your email and choose the password you’ll use to sign in. Any previous password and other signed-in sessions will be replaced.</p></div>
        <Field label="Password" hint={<span id="confirmation-password-hint" role={pwError ? 'alert' : undefined} style={pwError ? { color: 'var(--bad)' } : undefined}>{pwError || 'At least 8 characters'}</span>}>
          <input id="confirmation-password" aria-label="Password" className={'input' + (pwError ? ' err' : '')} type="password" autoComplete="new-password" maxLength={256} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} aria-invalid={!!pwError} aria-describedby="confirmation-password-hint" />
        </Field>
        {error && <p className="small" role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
        <Btn kind="primary" size="lg" className="btn-block" type="submit" loading={busy}>Confirm email and continue</Btn>
        <p className="xs sub" style={{ textAlign: 'center' }}>This link works once and expires 30 minutes after it was sent.</p>
        <p className="xs" style={{ textAlign: 'center', color: 'var(--faint)' }}>By continuing, you agree to the <a href="/terms">Terms</a> and acknowledge the <a href="/privacy">Privacy Policy</a>.</p>
        <a className="small sub" href={'/verify-email' + (next ? '?next=' + encodeURIComponent(next) : '')} style={{ textAlign: 'center' }}>Request a new confirmation email</a>
      </form>}
  </AuthShell>;
}
