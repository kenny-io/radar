'use client';
// Client behavior for the marketing pages: a port of prototype/home.js (nav state, website fields, scroll reveals) and the
// shared parts of features/feature.js. Each effect cleans up on unmount.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createField, type Field } from './field';
import { cleanSite, startHref, SITE_ERROR, SITE_NOTE } from './domain';
import { RadarMark } from './mark';
import { FEATURE_LINKS } from './marketing-links';

type Kind = 'home' | 'fp';
interface Mk { kind: Kind; value: string; setValue: (v: string) => void; field: React.RefObject<Field | null>; setNogl: (v: boolean) => void }
const MkCtx = createContext<Mk | null>(null);
const useMk = () => useContext(MkCtx)!;
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Page root. Owns the shared website-field value (every field mirrors the others, as in the prototype), the no-WebGL state
 *  (the prototype's html.nogl) and the .rv scroll reveals. */
export function MkRoot({ kind, children }: { kind: Kind; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null); const field = useRef<Field | null>(null);
  const [value, setValue] = useState(''); const [nogl, setNogl] = useState(false);
  useEffect(() => {
    if (kind === 'home') try { localStorage.removeItem('radar.home.domain'); } catch { /* storage blocked */ }
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -6% 0px', threshold: kind === 'home' ? .08 : .1 });
    ref.current!.querySelectorAll('.rv').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [kind]);
  return <MkCtx.Provider value={{ kind, value, setValue, field, setNogl }}>
    <div ref={ref} className={`mk ${kind}${nogl ? ' nogl' : ''}`}>{children}</div>
    <noscript><style>{'.mk .rv{opacity:1;transform:none}'}</style></noscript>
  </MkCtx.Provider>;
}

/** WebGL dot-field (prototype home-field.js). Typing in a website field labels the centre dot and sends a pulse ring. */
export function HeroField() {
  const { field, setNogl } = useMk(); const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const hero = document.getElementById('top'); let hh = hero?.offsetHeight || innerHeight;
    const measure = () => { hh = hero?.offsetHeight || innerHeight; field.current?.measure(); };
    const f = createField(host.current!, { paused: () => scrollY > hh + 40, onLost: () => setNogl(true) });
    field.current = f; if (!f) { setNogl(true); return; }
    addEventListener('resize', measure);
    return () => { removeEventListener('resize', measure); f.destroy(); field.current = null; };
  }, [field, setNogl]);
  return <div ref={host} />;
}

/** Fixed nav. Home: white over the dark hero, `.day` once over the light sheet (until the closing band), `.sc` once scrolled.
 *  Feature pages: always `.day`. */
export function Nav() {
  const { kind } = useMk(); const home = kind === 'home';
  const pathname = usePathname();
  const [day, setDay] = useState(!home); const [sc, setSc] = useState(false);
  useEffect(() => {
    let HH = innerHeight, ET = 1e9, q = 0;
    const upd = () => { const y = scrollY; if (home) setDay(y > HH - 60 && y < ET - 60); setSc(y > 8); };
    const measure = () => { if (home) { HH = document.getElementById('top')?.offsetHeight || innerHeight; const end = document.getElementById('begin'); ET = end ? end.getBoundingClientRect().top + scrollY : 1e9; } upd(); };
    const onScroll = () => { if (!q) q = requestAnimationFrame(() => { q = 0; upd(); }); };
    measure(); addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', measure); addEventListener('load', measure);
    document.fonts?.ready.then(measure);
    const ro = new ResizeObserver(measure); ro.observe(document.body);
    return () => { removeEventListener('scroll', onScroll); removeEventListener('resize', measure); removeEventListener('load', measure); ro.disconnect(); cancelAnimationFrame(q); };
  }, [home]);
  return <header className={`nav${day ? ' day' : ''}${sc ? ' sc' : ''}`} id="nav">
    <div className="wrap nav-in">
      <Link className="brand" href={home ? '#top' : '/'} aria-label="Radar home"><RadarMark s={22} /><span>Radar</span></Link>
      <nav className="nav-r" aria-label="Primary">
        {home && <a className="lnk mhide-sm" href="#how">How it works</a>}
        <div className="dd mhide-sm">
          <Link className="lnk" href={home ? '#features' : '/#features'} aria-current={pathname?.startsWith('/features/') ? 'page' : undefined}>Features<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></Link>
          <div className="dd-p">{FEATURE_LINKS.map(item => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined}><b>{item.name}</b><span>{item.line}</span></Link>)}</div>
        </div>
        <Link className="lnk mhide-sm" href={home ? '#pricing' : '/#pricing'}>Pricing</Link>
        <Link className="lnk mhide-sm" href="/blog" aria-current={pathname?.startsWith('/blog') ? 'page' : undefined}>Blog</Link>
        <a className="lnk" href="/signin">Sign in</a><a className="mbtn mbtn-solid" href="/signup">Get started</a>
      </nav>
    </div></header>;
}

/** Website field → /start?domain={cleaned} (UPDATE-2026-10-25 §2). Never prefilled. Invalid input swaps the note for the hint and
 *  refocuses; the next keystroke restores the note. */
export function DomainForm({ id, light }: { id: string; light?: boolean }) {
  const { value, setValue, field } = useMk(); const input = useRef<HTMLInputElement>(null); const [err, setErr] = useState(false);
  return <>
    <form className={light ? 'dom lt' : 'dom'} noValidate onSubmit={e => {
      e.preventDefault(); const href = startHref(input.current!.value);
      if (!href) { setErr(true); input.current!.focus(); return; }
      window.location.assign(href);
    }}>
      <label className="sr" htmlFor={id}>Your website</label><span className="pre" aria-hidden="true">https://</span>
      <input ref={input} id={id} name="domain" type="text" inputMode="url" autoComplete="url" autoCapitalize="off" spellCheck={false} placeholder="yourcompany.com" value={value}
        onChange={e => { const v = e.target.value; setValue(v); field.current?.setName(cleanSite(v)); if (err) setErr(false); field.current?.kick(); }} />
      <button className={light ? 'mbtn mbtn-k' : 'mbtn mbtn-solid'} type="submit">Analyze website</button>
    </form>
    <p className={err ? 'dom-note err' : 'dom-note'} aria-live="polite">{err ? SITE_ERROR : SITE_NOTE}</p>
  </>;
}
