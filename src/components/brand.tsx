'use client';
import React from 'react';
import { platOf } from '@/lib/constants';
import { BRAND_ICONS, SERVICE_ICONS } from '@/lib/brandIcons';

/** Single-colour black marks are drawn in the text colour so they stay visible in dark mode (the design's .logo-inv). */
const markFill = (hex: string) => (hex === 'mono' || /^#(000000|15171a|181717|191919)$/i.test(hex) ? 'currentColor' : hex);

/** 44px CMS tiles (publishing). Port of PlatMark; icons bundled locally instead of the simple-icons CDN. */
export function PlatMark({ k, s = 40 }: { k: string; s?: number }) {
  const p = platOf(k);
  const box: React.CSSProperties = { width: s, height: s, borderRadius: s * .28, background: 'var(--surface)', boxShadow: 'inset 0 0 0 1px var(--line), 0 1px 2px oklch(0 0 0 / .04)', display: 'grid', placeItems: 'center', flex: 'none' };
  if (p.k === 'webhook') return <span aria-hidden="true" style={{ ...box, color: 'var(--ink)' }}><svg width={s * .5} height={s * .5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 8.5a3 3 0 1 1 4.6 2.5L16.5 15M6.6 13.2a3 3 0 1 0 3.9 4.3h5M17.5 18a3 3 0 1 0-1-5.8l-2.4-4.2" /></svg></span>;
  const ic = BRAND_ICONS[p.k];
  if (ic) return <span aria-hidden="true" style={{ ...box, color: 'var(--ink)' }}><svg width={s * .52} height={s * .52} viewBox="0 0 24 24" style={{ display: 'block' }}><path d={ic.path} fill={markFill(ic.hex)} /></svg></span>;
  return <span aria-hidden="true" style={{ ...box, fontWeight: 600, fontSize: p.mono.length > 2 ? s * .3 : s * .36, letterSpacing: '-0.03em', color: 'var(--ink)' }}>{p.mono}</span>;
}

/** Platform logos for the Daily Brief (14–16px). Ported from the prototype's PlatLogo. */
export function PlatLogo({ k, s = 16 }: { k: string; s?: number }) {
  const box: React.CSSProperties = { width: s, height: s, flex: 'none', display: 'block' };
  if (k === 'x') return <svg viewBox="0 0 24 24" style={box} aria-label="X"><rect width="24" height="24" rx="5.5" fill="#000" /><rect x=".5" y=".5" width="23" height="23" rx="5" fill="none" stroke="var(--line)" /><path transform="translate(4.6 4.6) scale(.62)" fill="#fff" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>;
  if (k === 'linkedin') return <svg viewBox="0 0 24 24" style={box} aria-label="LinkedIn"><rect width="24" height="24" rx="5.5" fill="#0A66C2" /><path transform="translate(4.4 4.4) scale(.64)" fill="#fff" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.064 2.064 0 1 1 0-4.128 2.064 2.064 0 0 1 0 4.128zm1.782 13.019H3.555V9h3.564v11.452z" /></svg>;
  if (k === 'hn') return <svg viewBox="0 0 24 24" style={box} aria-label="Hacker News"><rect width="24" height="24" rx="5.5" fill="#FF6600" /><path fill="#fff" d="M7.6 6h2.1l2.3 4.6L14.3 6h2.1l-3.4 6.4V18h-1.9v-5.6z" /></svg>;
  if (k === 'quora') return <svg viewBox="0 0 24 24" style={box} aria-label="Quora"><rect width="24" height="24" rx="5.5" fill="#B92B27" /><circle cx="11.6" cy="11.2" r="4.6" fill="none" stroke="#fff" strokeWidth="2" /><path d="M12.4 13.2l3.6 4.6" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>;
  if (k === 'facebook') return <svg viewBox="0 0 24 24" style={box} aria-label="Facebook"><circle cx="12" cy="12" r="12" fill="#0866FF" /><path fill="#fff" d="M16.4 15.4l.5-3.4h-3.3V9.8c0-.9.5-1.8 1.9-1.8H17V5.1s-1.3-.2-2.6-.2c-2.7 0-4.4 1.6-4.4 4.6V12H7v3.4h3v8.5a12 12 0 0 0 3.6 0v-8.5z" /></svg>;
  return <svg viewBox="0 0 24 24" style={box} aria-label="Reddit"><circle cx="12" cy="12" r="12" fill="#FF4500" /><ellipse cx="12" cy="14" rx="6.4" ry="4.3" fill="#fff" /><circle cx="17.3" cy="6.3" r="1.4" fill="#fff" /><path d="M12 9.8l1.2-4 4.1 .5" stroke="#fff" strokeWidth="1" fill="none" strokeLinecap="round" /><circle cx="6.4" cy="11.2" r="1.5" fill="#fff" /><circle cx="17.6" cy="11.2" r="1.5" fill="#fff" /><circle cx="9.7" cy="13.5" r="1.05" fill="#FF4500" /><circle cx="14.3" cy="13.5" r="1.05" fill="#FF4500" /><path d="M9.6 15.9c1.4.9 3.4.9 4.8 0" stroke="#FF4500" strokeWidth=".9" fill="none" strokeLinecap="round" /></svg>;
}

/** Google's standard multi-colour "G" for "Continue with Google" (required by Google's sign-in branding guidelines). */
export function GoogleMark({ s = 16 }: { s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 48 48" aria-hidden="true" style={{ flex: 'none' }}>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>;
}

export const GoogleG = GoogleMark;

/** Google's sign-in button spec: 40px pill, 20px G, Roboto Medium 14px; light/dark colours come from --gsi-* tokens. */
export function GoogleButton({ children, busy, onClick, disabled, href }: { children: React.ReactNode; busy?: boolean; onClick?: () => void; disabled?: boolean; href?: string }) {
  const inner = <>{busy ? <span className="spin" style={{ width: 18, height: 18 }} /> : <GoogleMark s={20} />}<span>{children}</span></>;
  if (href && !disabled) return <a className="gsi" href={href} onClick={onClick} style={{ textDecoration: 'none' }}>{inner}</a>;
  return <button type="button" className="gsi" onClick={onClick} disabled={disabled || busy}>{inner}</button>;
}

const PLAT_KEYS = ['reddit', 'x', 'linkedin', 'hn', 'quora', 'facebook'];
/** Logo for any outside service by key (search console, AI engines and providers, GitHub, social platforms, CMSs). Falls back to
 *  a first-letter tile. Engine names like "ChatGPT" are accepted as-is. */
export function BrandIcon({ k, s = 16, style }: { k: string; s?: number; style?: React.CSSProperties }) {
  const key = String(k).toLowerCase().replace(/\s+/g, '');
  if (key === 'google') return <GoogleMark s={s} />;
  if (PLAT_KEYS.includes(key)) return <PlatLogo k={key} s={s} />;
  const ic = SERVICE_ICONS[key] || BRAND_ICONS[key];
  if (!ic) return <span aria-hidden="true" style={{ width: s, height: s, borderRadius: s * .25, background: 'var(--fill)', color: 'var(--ink2)', display: 'grid', placeItems: 'center', fontSize: s * .55, fontWeight: 600, flex: 'none', ...style }}>{String(k).charAt(0).toUpperCase()}</span>;
  return <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block', flex: 'none', color: 'var(--ink)', ...style }}><path d={ic.path} fill={markFill(ic.hex)} fillRule={(ic as any).evenodd ? 'evenodd' : undefined} /></svg>;
}

/** Logo + name, inline. */
export function PlatName({ k, l, s = 16, gap = 8 }: { k: string; l: React.ReactNode; s?: number; gap?: number }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap, whiteSpace: 'nowrap' }}><BrandIcon k={k} s={s} />{l}</span>;
}
