'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Btn, Field } from '@/components/ui';
import { api, ApiError } from '@/client/api';
import { EMAIL_RE } from '@/lib/format';
import { Turnstile } from './Turnstile';

export type HumanCheckProps = { turnstileRequired: boolean; turnstileSiteKey: string; devStubs: boolean };
export const authFormStyle: React.CSSProperties = { gap: 18, maxWidth: 380, width: '100%', minWidth: 0, margin: '0 auto', position: 'relative' };
export const safeAuthNext = (value?: string | null) => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\u0000-\u0020\u007f\\]/.test(value) ? value : '';

/** Generic copy is intentional: requesting email must not disclose whether an account exists. */
export function VerificationRequest({ turnstileRequired, turnstileSiteKey, devStubs, initialEmail = '', initialSent = false, next = '', hasDraft = false, notice = '' }: HumanCheckProps & { initialEmail?: string; initialSent?: boolean; next?: string; hasDraft?: boolean; notice?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(initialSent);
  const [cooldown, setCooldown] = useState(initialSent ? 60 : 0);
  const [token, setToken] = useState(''); const [resetKey, setResetKey] = useState(0);
  const [mounted, setMounted] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [emailError, setEmailError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { setMounted(true); heading.current?.focus(); }, []);
  useEffect(() => { if (!cooldown) return; const timer = window.setTimeout(() => setCooldown(n => Math.max(0, n - 1)), 1000); return () => window.clearTimeout(timer); }, [cooldown]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!mounted || busy || cooldown || (turnstileRequired && !token)) return;
    setError(''); setEmailError('');
    if (!EMAIL_RE.test(email.trim())) { setEmailError('Enter a valid email'); return; }
    setBusy(true);
    try {
      await api('/api/auth/verification/resend', { body: { email: email.trim(), ...(turnstileRequired ? { turnstileToken: token } : {}), ...(safeAuthNext(next) ? { next: safeAuthNext(next) } : {}) } });
      setSent(true); setCooldown(60); heading.current?.focus();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Radar couldn’t send the email. Check your connection and try again.'); }
    finally { setBusy(false); setToken(''); setResetKey(n => n + 1); }
  };
  return <form className="col enter" style={authFormStyle} onSubmit={submit} noValidate aria-busy={busy}>
    <div className="col" style={{ gap: 8 }}>
      <h1 className="h1" ref={heading} tabIndex={-1} style={{ outline: 'none' }}>{sent ? 'Check your email' : 'Confirm your email'}</h1>
      <p className="sub" role="status">{sent ? <>If <strong style={{ color: 'var(--ink)', overflowWrap: 'anywhere' }}>{email.trim()}</strong> needs confirmation, an email will arrive shortly. Open the link to confirm your address and choose your password.</> : 'Enter your account email to request a confirmation link. You’ll choose your password after opening the email.'}</p>
      {sent && <p className="small sub">The link expires in 30 minutes. Check your spam folder too. If you’ve already confirmed your email, sign in or continue with Google.</p>}
      {hasDraft && <p className="small sub">Your Business Profile stays saved in this browser while you confirm your email.</p>}
      {notice && <p className="small" role="status">{notice}</p>}
    </div>
    <Field label="Work email" hint={emailError && <span id="confirmation-email-error" role="alert" style={{ color: 'var(--bad)' }}>{emailError}</span>}>
      <input id="confirmation-email" aria-label="Work email" className={'input' + (emailError ? ' err' : '')} type="email" autoComplete="email" maxLength={320} value={email} onChange={e => { setEmail(e.target.value); setSent(false); }} disabled={!mounted || busy} aria-invalid={!!emailError} aria-describedby={emailError ? 'confirmation-email-error' : undefined} />
    </Field>
    {turnstileRequired && <Turnstile siteKey={turnstileSiteKey} devStubs={devStubs} resetKey={resetKey} onToken={setToken} />}
    {error && <p className="small" role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
    <Btn kind="primary" size="lg" className="btn-block" type="submit" loading={busy} disabled={!mounted || (turnstileRequired && !token) || cooldown > 0}>{cooldown > 0 ? `Request another email in ${cooldown}s` : sent ? 'Send another email' : 'Send confirmation email'}</Btn>
    <p className="xs sub" style={{ textAlign: 'center' }}><a href={'/signin' + (safeAuthNext(next) ? '?next=' + encodeURIComponent(safeAuthNext(next)) : '')}>Back to sign in</a></p>
  </form>;
}
