'use client';
import React from 'react';
import { platOf } from '@/lib/constants';
import { BRAND_ICONS } from '@/lib/brandIcons';

/** 44px CMS tiles (publishing). Port of PlatMark; icons bundled locally instead of the simple-icons CDN. */
export function PlatMark({ k, s = 40 }: { k: string; s?: number }) {
  const p = platOf(k);
  const box: React.CSSProperties = { width: s, height: s, borderRadius: s * .28, background: 'var(--surface)', boxShadow: 'inset 0 0 0 1px var(--line), 0 1px 2px oklch(0 0 0 / .04)', display: 'grid', placeItems: 'center', flex: 'none' };
  if (p.k === 'webhook') return <span aria-hidden="true" style={{ ...box, color: 'var(--ink)' }}><svg width={s * .5} height={s * .5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 8.5a3 3 0 1 1 4.6 2.5L16.5 15M6.6 13.2a3 3 0 1 0 3.9 4.3h5M17.5 18a3 3 0 1 0-1-5.8l-2.4-4.2" /></svg></span>;
  const ic = BRAND_ICONS[p.k];
  if (ic) return <span aria-hidden="true" style={box}><svg width={s * .52} height={s * .52} viewBox="0 0 24 24" style={{ display: 'block' }}><path d={ic.path} fill={ic.hex} /></svg></span>;
  return <span aria-hidden="true" style={{ ...box, fontWeight: 600, fontSize: p.mono.length > 2 ? s * .3 : s * .36, letterSpacing: '-0.03em', color: 'var(--ink)' }}>{p.mono}</span>;
}

/** Platform logos for the Daily Brief (14–16px). Ported from the prototype's PlatLogo. */
export function PlatLogo({ k, s = 16 }: { k: string; s?: number }) {
  const box: React.CSSProperties = { width: s, height: s, flex: 'none', display: 'block' };
  if (k === 'x') return <svg viewBox="0 0 24 24" style={box} aria-label="X"><rect width="24" height="24" rx="5.5" fill="#000" /><path transform="translate(4.6 4.6) scale(.62)" fill="#fff" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>;
  if (k === 'linkedin') return <svg viewBox="0 0 24 24" style={box} aria-label="LinkedIn"><rect width="24" height="24" rx="5.5" fill="#0A66C2" /><path transform="translate(4.4 4.4) scale(.64)" fill="#fff" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.064 2.064 0 1 1 0-4.128 2.064 2.064 0 0 1 0 4.128zm1.782 13.019H3.555V9h3.564v11.452z" /></svg>;
  if (k === 'hn') return <svg viewBox="0 0 24 24" style={box} aria-label="Hacker News"><rect width="24" height="24" rx="5.5" fill="#FF6600" /><path fill="#fff" d="M7.6 6h2.1l2.3 4.6L14.3 6h2.1l-3.4 6.4V18h-1.9v-5.6z" /></svg>;
  if (k === 'quora') return <svg viewBox="0 0 24 24" style={box} aria-label="Quora"><rect width="24" height="24" rx="5.5" fill="#B92B27" /><circle cx="11.6" cy="11.2" r="4.6" fill="none" stroke="#fff" strokeWidth="2" /><path d="M12.4 13.2l3.6 4.6" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>;
  return <svg viewBox="0 0 24 24" style={box} aria-label="Reddit"><circle cx="12" cy="12" r="12" fill="#FF4500" /><ellipse cx="12" cy="14" rx="6.4" ry="4.3" fill="#fff" /><circle cx="17.3" cy="6.3" r="1.4" fill="#fff" /><path d="M12 9.8l1.2-4 4.1 .5" stroke="#fff" strokeWidth="1" fill="none" strokeLinecap="round" /><circle cx="6.4" cy="11.2" r="1.5" fill="#fff" /><circle cx="17.6" cy="11.2" r="1.5" fill="#fff" /><circle cx="9.7" cy="13.5" r="1.05" fill="#FF4500" /><circle cx="14.3" cy="13.5" r="1.05" fill="#FF4500" /><path d="M9.6 15.9c1.4.9 3.4.9 4.8 0" stroke="#FF4500" strokeWidth=".9" fill="none" strokeLinecap="round" /></svg>;
}
