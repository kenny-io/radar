'use client';
// Port of Signup (prototype/radar-onboarding.jsx). Sign in (mode="signin") is not designed — built from the same parts (DIVERGENCES #5).
// `pending` (UPDATE-2026-10-25 §4, AC-S2): a guest with a saved Business Profile sees "Save your Business Profile".
// The server decides where the account lands (AuthResult.next): onboarding, the trial page, an invite, or the app.
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Btn, Field, Icon, LogoTile, Mark, Status } from '@/components/ui';
import { GoogleButton } from '@/components/brand';
import { RadarField } from '@/components/RadarField';
import { api, ApiError } from '@/client/api';
import { EMAIL_RE } from '@/lib/format';
import type { AuthResult, PendingProfile } from '@/lib/types';

const GOOGLE_ERR = 'Google sign-in didn’t finish. Try again, or use your email.';

export function Signup({ mode = 'signup', pending = null }: { mode?: 'signup' | 'signin'; pending?: PendingProfile | null }) {
  const signin = mode === 'signin';
  const sp = useSearchParams();
  const [f, setF] = useState({ name: '', email: '', pw: '' }); const [err, setErr] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const rawNext = sp?.get('next') || '';
  const safeNext = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '';
  const next = safeNext || '/dashboard';
  useEffect(() => { if (sp?.get('error') === 'google') setErr({ email: GOOGLE_ERR }); }, [sp]);
  const submit = async (e?: React.FormEvent) => {
    e && e.preventDefault(); const er: Record<string, string> = {};
    if (!signin && !f.name.trim()) er.name = 'Add your name';
    if (!EMAIL_RE.test(f.email)) er.email = 'Enter a valid email';
    if (signin ? !f.pw : f.pw.length < 8) er.pw = signin ? 'Enter your password' : 'Use at least 8 characters';
    setErr(er); if (Object.keys(er).length) return;
    setBusy(true);
    try {
      const body = signin ? { email: f.email, password: f.pw } : { name: f.name.trim(), email: f.email, password: f.pw };
      const r = await api<Partial<AuthResult>>(signin ? '/api/auth/signin' : '/api/auth/signup', { body: safeNext ? { ...body, next: safeNext } : body });
      window.location.href = r.next || next;
    } catch (x) {
      setBusy(false);
      if (x instanceof ApiError && x.errors) setErr(x.errors); else setErr({ pw: (x as Error).message || 'Radar couldn’t finish this. Try again.' });
    }
  };
  const google = () => { setBusy(true); window.location.href = '/api/auth/google/start?next=' + encodeURIComponent(next); };
  const hint = (k: string) => err[k] && <span style={{ color: 'var(--bad)' }}>{err[k]}</span>;
  const q = rawNext ? '?next=' + encodeURIComponent(next) : '';
  return <AuthShell energy={.35} art={<><span style={{ fontSize: 'clamp(32px,4.4vw,56px)', lineHeight: 1.02, fontWeight: 600, letterSpacing: '-0.045em', textWrap: 'balance' } as React.CSSProperties}>Be found by the people looking for you.</span><span style={{ color: 'var(--ink2)', marginTop: 14, fontSize: 15 }}>Search and social marketing that runs on what makes your business yours.</span></>}>
    <form className="col enter" style={{ gap: 18, maxWidth: 380, width: '100%', margin: '0 auto', position: 'relative' }} onSubmit={submit} noValidate>
      {pending && <BackLink href="/start" />}
      {signin
        ? <div className="col" style={{ gap: 6, marginBottom: 6 }}><h1 className="h1">Sign in</h1></div>
        : <div className="col" style={{ gap: 6, marginBottom: 6 }}><h1 className="h1">{pending ? 'Save your Business Profile' : 'Create your account'}</h1><p className="sub">{pending ? <>Create an account to keep <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{pending.name}</span> and open your dashboard.</> : 'Set up your Business Profile, then start your 3-day free trial.'}</p></div>}
      {pending && !signin && <div className="row" style={{ gap: 12, padding: '12px 14px', borderRadius: 14, background: 'var(--surface)', boxShadow: '0 0 0 1px var(--line)' }}><LogoTile brand={pending.brand} s={34} /><span className="col grow" style={{ minWidth: 0, lineHeight: 1.3 }}><span className="small trunc" style={{ fontWeight: 500 }}>{pending.name}</span><span className="xs sub trunc">{pending.domain}</span></span><Status tone="ok">Ready</Status></div>}
      <GoogleButton onClick={google} disabled={busy}>Continue with Google</GoogleButton>
      <div className="row xs sub" style={{ gap: 12 }}><hr className="hair grow" />or<hr className="hair grow" /></div>
      {!signin && <Field label="Name" hint={hint('name')}><input className={'input' + (err.name ? ' err' : '')} autoComplete="name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>}
      <Field label="Work email" hint={hint('email')}><input className={'input' + (err.email ? ' err' : '')} type="email" autoComplete="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Password" hint={err.pw ? hint('pw') : signin ? null : 'At least 8 characters'}><input className={'input' + (err.pw ? ' err' : '')} type="password" autoComplete={signin ? 'current-password' : 'new-password'} value={f.pw} onChange={e => setF({ ...f, pw: e.target.value })} /></Field>
      <Btn kind="primary" size="lg" className="btn-block" type="submit" loading={busy} style={{ marginTop: 6 }}>{signin ? 'Sign in' : 'Create account'}</Btn>
      {signin
        ? <p className="xs sub" style={{ textAlign: 'center' }}>New to Radar? <a href={'/signup' + q}>Create account</a></p>
        : <p className="xs sub" style={{ textAlign: 'center' }}>Already have an account? <a href={'/signin' + q}>Sign in</a></p>}
      <p className="xs" style={{ textAlign: 'center', color: 'var(--faint)', marginTop: 8 }}><a href="/privacy" style={{ color: 'inherit' }}>Privacy</a> · <a href="/terms" style={{ color: 'inherit' }}>Terms</a></p>
    </form>
  </AuthShell>;
}

/** "Back to your profile" (small, --sub, back icon). A full navigation: the destination's server guard resumes the Save step. */
export function BackLink({ href }: { href: string }) {
  return <a href={href} className="row small sub" style={{ gap: 6, textDecoration: 'none', alignSelf: 'flex-start' }}><Icon n="back" s={15} />Back to your profile</a>;
}

/** The Signup shell, shared with the trial page (handoff §4): full-bleed radar, art column (hidden on small screens), form column. */
export function AuthShell({ energy, art, children }: { energy: number; art?: React.ReactNode; children: React.ReactNode }) {
  const dark = useResolvedDark();
  return <div style={{ position: 'relative', minHeight: '100vh', color: 'var(--ink)', overflowX: 'hidden' }}>
    {/* Full-bleed radar behind the page (UPDATE-2026-10-21 §2); it follows the resolved theme and re-mounts when it changes. */}
    {dark != null && <RadarField key={dark ? 'n' : 'p'} theme={dark ? 'night' : 'paper'} energy={energy} center={[.34, .46]} scale={1.5} style={{ position: 'fixed', inset: 0 }} />}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', minHeight: '100vh', position: 'relative' }} className="signup">
    <style>{`@media(max-width:860px){.signup{grid-template-columns:1fr!important}.signup-art{min-height:200px!important}}`}</style>
    <div className="signup-art" style={{ position: 'relative', minHeight: '100vh' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, padding: '28px 32px', gap: 9 }} className="row"><Mark s={24} /><span style={{ fontWeight: 600, fontSize: 17, letterSpacing: '-0.02em' }}>Radar</span></div>
      {art && <div style={{ position: 'absolute', left: 0, bottom: 0, padding: '0 32px 40px', maxWidth: 560 }} className="col hide-sm">{art}</div>}
    </div>
    <div className="col" style={{ justifyContent: 'center', padding: '48px clamp(24px,6vw,88px)', position: 'relative' }}>
      {/* Soft scrim behind the form only, so text stays readable as the sweep passes. Never a card: no edge, border or radius. */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: '-10% -20%', background: 'radial-gradient(closest-side,color-mix(in oklch,var(--paper) 78%,transparent) 55%,transparent)', pointerEvents: 'none' }} />
      {children}
    </div>
    </div>
  </div>;
}

/** The theme actually showing: `data-theme` on <html> if set, else the OS preference. null until mounted (no SSR guess). */
export function useResolvedDark(): boolean | null {
  const [d, setD] = useState<boolean | null>(null);
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)');
    const f = () => { const t = document.documentElement.getAttribute('data-theme'); setD(t ? t === 'dark' : m.matches); };
    f();
    const mo = new MutationObserver(f); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    m.addEventListener('change', f);
    return () => { mo.disconnect(); m.removeEventListener('change', f); };
  }, []);
  return d;
}
