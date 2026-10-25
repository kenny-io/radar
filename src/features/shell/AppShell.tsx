'use client';
// App shell — port of Root/Side/GhostDash from prototype/radar-app.jsx.
import React, { useRef, useState } from 'react';
import { useApp, type Page } from '@/client/app';
import { Btn, Icon, LogoTile, Mark, Popover, Skel, type IconName } from '@/components/ui';
import { Onboarding } from '@/features/onboarding/Onboarding';
import type { BusinessSummary, DraftSummary } from '@/lib/types';

const NAV: [Page, string, IconName][] = [['dashboard', 'Dashboard', 'home'], ['brief', 'Daily Brief', 'brief'], ['calendar', 'Content Calendar', 'calendar'], ['social', 'Social Marketing', 'social'], ['performance', 'Performance', 'chart'], ['backlinks', 'Backlinks', 'link']];

export function AppShell({ children }: { children: React.ReactNode }) {
  const app = useApp(); const { B, route, onboarding, me } = app;
  const [side, setSide] = useState(false);
  const page = route.page;
  let body: React.ReactNode;
  if (!me.currentId) body = <GhostDash name={me.user.name} />;
  else if (!B) body = null; // workspace loading — keep the canvas calm
  else body = children;
  return <div className="app">
    <Side open={side} onClose={() => setSide(false)} />
    {side && <div onClick={() => setSide(false)} style={{ position: 'fixed', inset: 0, zIndex: 55, background: 'oklch(0 0 0 / .2)' }} />}
    <div style={{ minWidth: 0 }}>
      <div className="mob-bar"><Btn kind="ghost" icon="menu" onClick={() => setSide(true)} aria-label="Menu" /><Mark s={20} /><span style={{ fontWeight: 600 }}>Radar</span></div>
      <main className="main" key={page + (B?.id || '')}>{body}</main>
    </div>
    {onboarding.open && <Onboarding actor="user" draft={draftOf(me.businesses)} saveCommits autoDomain={null} inApp />}
  </div>;
}

/** "Add a business" resumes the account's unfinished draft, if any; Onboarding reads its step from the workspace. */
function draftOf(list: BusinessSummary[]): DraftSummary | null {
  const b = list.find(x => x.status === 'onboarding');
  return b ? { id: b.id, domain: b.domain, name: b.name, brand: b.brand, step: null, savedAt: null, analyzed: false } : null;
}

/** The dashboard placeholder behind onboarding. A guest has no name yet: "Welcome." */
export function GhostDash({ name }: { name?: string | null }) {
  return <div className="page" style={{ opacity: .5 }}><div className="col" style={{ gap: 16 }}><span className="sub">{name ? 'Welcome, ' + name.split(' ')[0] + '.' : 'Welcome.'}</span><Skel w="55%" h={40} /><div className="grid-2" style={{ marginTop: 24 }}><Skel h={280} style={{ borderRadius: 20 }} /><Skel h={280} style={{ borderRadius: 20 }} /></div></div></div>;
}

export function Side({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { B, me, go, route, switchBusiness, onboarding } = useApp();
  const [sw, setSw] = useState(false); const swRef = useRef<HTMLDivElement>(null); const page = route.page;
  const ct: Partial<Record<Page, number | null>> = { brief: B?.counts.briefOpen || null, calendar: B?.counts.review || null, backlinks: B?.counts.backlinksPending || null };
  const initials = (me.user.name || '?').split(' ').map(x => x[0]).join('').slice(0, 2);
  const nav = (p: Page) => { onClose(); go(p); };
  // Locked businesses (the owner has no trialing/active subscription) are hidden; absent `access` means unlocked.
  const biz = me.businesses.filter(b => b.status === 'active' && b.access !== false);
  return <aside className={'side' + (open ? ' open' : '')}>
    <div className="row" style={{ padding: '4px 8px 18px', gap: 9 }}><Mark s={22} /><span style={{ fontWeight: 600, fontSize: 16, letterSpacing: '-0.02em' }}>Radar</span></div>
    {B ? <div style={{ position: 'relative', marginBottom: 18 }} ref={swRef}>
      <button className="nav-i" style={{ height: 52, background: sw ? 'var(--fill)' : undefined }} onClick={() => setSw(!sw)} aria-haspopup="menu"><LogoTile brand={B.profile.brand} s={30} /><span className="col grow" style={{ minWidth: 0, lineHeight: 1.25 }}><span className="trunc" style={{ color: 'var(--ink)' }}>{B.profile.business.name}</span><span className="xs sub trunc" style={{ fontWeight: 400 }}>{B.profile.domain}</span></span><Icon n="chevUD" s={14} /></button>
      <Popover anchor={swRef} open={sw} onClose={() => setSw(false)} style={{ width: '100%' }}>
        {biz.map(b => <button key={b.id} className="pop-i" style={{ height: 46 }} onClick={() => { setSw(false); onClose(); if (b.id !== me.currentId) switchBusiness(b.id); else go('dashboard'); }}><LogoTile brand={b.brand} s={26} /><span className="col grow" style={{ lineHeight: 1.2 }}><span className="small">{b.name}</span><span className="xs sub">{b.domain}</span></span>{b.id === me.currentId && <Icon n="check" s={15} />}</button>)}
        <hr className="hair" style={{ margin: '6px 0' }} />
        <button className="pop-i" onClick={() => { setSw(false); onClose(); onboarding.start(); }}><Icon n="plus" s={16} />Add a business</button>
      </Popover>
    </div> : <div style={{ height: 70 }} />}
    {NAV.map(([k, l, ic]) => <button key={k} className={'nav-i' + (page === k || (page === 'article' && k === 'calendar') ? ' on' : '')} onClick={() => nav(k)} disabled={!B}><Icon n={ic} s={18} />{l}{ct[k] ? <span className="ct">{ct[k]}</span> : null}</button>)}
    <span className="grow" />
    <button className={'nav-i' + (page === 'profile' ? ' on' : '')} onClick={() => nav('profile')} disabled={!B}><Icon n="profile" s={18} />Business Profile</button>
    <button className={'nav-i' + (page === 'settings' ? ' on' : '')} onClick={() => nav('settings')} disabled={!B}><Icon n="gear" s={18} />Settings</button>
    <UserMenu name={me.user.name} email={me.user.email} initials={initials} onNavigate={onClose} />
  </aside>;
}

/** Sidebar user row → menu with name, email and Log out (the only place to log out). Logging out ends the session and
 *  returns to sign in; business data stays saved. */
function UserMenu({ name, email, initials, onNavigate }: { name: string; email: string; initials: string; onNavigate: () => void }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null); const [busy, setBusy] = useState(false);
  const logout = async () => {
    setBusy(true); setOpen(false); onNavigate();
    try { await fetch('/api/auth/signout', { method: 'POST' }); } catch { /* the session cookie is cleared server-side when reachable */ }
    window.location.href = '/signin';
  };
  return <div style={{ position: 'relative', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }} ref={ref}>
    <button className="nav-i" style={{ height: 44, background: open ? 'var(--fill)' : undefined }} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} disabled={busy}>
      <span style={{ width: 28, height: 28, borderRadius: 99, background: 'var(--ink)', color: 'var(--on-ink)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, flex: 'none' }}>{initials}</span>
      <span className="grow trunc" style={{ color: 'var(--ink)' }}>{name}</span><Icon n="chevUD" s={14} />
    </button>
    <Popover anchor={ref} open={open} onClose={() => setOpen(false)} style={{ width: '100%', top: 'auto', bottom: 'calc(100% + 6px)' }}>
      <div className="col" style={{ padding: '8px 10px 10px', lineHeight: 1.3 }}><span className="small" style={{ fontWeight: 500 }}>{name}</span><span className="xs sub trunc">{email}</span></div>
      <hr className="hair" style={{ margin: '0 0 6px' }} />
      <button className="pop-i" onClick={logout}><Icon n="logout" s={16} />Log out</button>
    </Popover>
  </div>;
}
