'use client';
// Port of LogoLabel (prototype/radar-channels.jsx): every third-party button carries the platform logo.
import React from 'react';
import { PlatLogo } from '@/components/brand';

/** Logo + label inside a button. The logo is decorative here (the label names the platform), so screen readers hear the label once. */
export function LogoLabel({ k, children }: { k: string; children?: React.ReactNode }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}><span aria-hidden="true" style={{ display: 'inline-flex' }}><PlatLogo k={k} s={16} /></span><span>{children}</span></span>;
}
