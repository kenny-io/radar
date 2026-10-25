'use client';
// Card fields for the trial page (handoff §4 rows, decision D5): Stripe's split Card Elements (number, expiry, CVC)
// mounted inside `.input`-styled containers, plus our own ZIP input. Raw card numbers never touch Radar.
// Elements iframes can't read CSS variables, so their text style is read from a hidden `.input` and re-applied when
// the theme changes (element.update, which keeps what the person typed). Validation runs on submit only.
import React, { useEffect, useRef, useState } from 'react';
import type { Stripe, StripeCardCvcElement, StripeCardExpiryElement, StripeCardNumberElement, StripeElementStyle, CustomFontSource } from '@stripe/stripe-js';
import { Field } from '@/components/ui';
import { useResolvedDark } from '@/features/onboarding/Signup';
import { elementErrors, type CardErrors, type CardField, type ElementState } from './elementErrors';

export interface CardApiError { type?: string; code?: string; decline_code?: string; message?: string }
/** What TrialPage needs from either card form (real Elements or the dev stub). */
export interface CardHandle {
  validate(): CardErrors;
  focus(f: CardField): void;
  createPaymentMethod(): Promise<{ id: string } | { error: CardApiError }>;
  /** Runs the $1 confirmation, including the bank's 3-D Secure step. */
  confirmCardPayment(clientSecret: string, paymentMethodId: string): Promise<{ ok: true } | { error: CardApiError }>;
}
export interface CardFormProps { err: CardErrors; handle: React.MutableRefObject<CardHandle | null>; disabled?: boolean }

const hintOf = (m?: string) => m && <span style={{ color: 'var(--bad)' }}>{m}</span>;

/** The designed rows: Card number, then Expiry / CVC / ZIP (grid 1.2fr .8fr 1fr, gap 12). Slots hold the inputs. */
export function CardRows({ err, num, exp, cvc, zip }: { err: CardErrors; num: React.ReactNode; exp: React.ReactNode; cvc: React.ReactNode; zip: React.ReactNode }) {
  return <>
    <Field label="Card number" hint={hintOf(err.num)}>{num}</Field>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,.8fr) minmax(0,1fr)', gap: 12 }}>
      <Field label="Expiry" hint={hintOf(err.exp)}>{exp}</Field>
      <Field label="CVC" hint={hintOf(err.cvc)}>{cvc}</Field>
      <Field label="ZIP" hint={hintOf(err.zip)}>{zip}</Field>
    </div>
  </>;
}

export function ZipInput({ value, onChange, invalid, inputRef, disabled }: { value: string; onChange: (v: string) => void; invalid: boolean; inputRef: React.Ref<HTMLInputElement>; disabled?: boolean }) {
  return <input ref={inputRef} className={'input' + (invalid ? ' err' : '')} autoComplete="postal-code" placeholder="10001" value={value} aria-invalid={invalid || undefined} disabled={disabled} onChange={e => onChange(e.target.value.slice(0, 10))} />;
}

type Key = 'num' | 'exp' | 'cvc';
type Els = { num?: StripeCardNumberElement; exp?: StripeCardExpiryElement; cvc?: StripeCardCvcElement };

export function CardFields({ publishableKey, err, handle, disabled }: CardFormProps & { publishableKey: string | null }) {
  const probe = useRef<HTMLInputElement>(null);
  const box = { num: useRef<HTMLDivElement>(null), exp: useRef<HTMLDivElement>(null), cvc: useRef<HTMLDivElement>(null) };
  const els = useRef<Els>({}); const st = useRef<Partial<Record<Key, ElementState>>>({}); const stripe = useRef<Stripe | null>(null);
  const [failed, setFailed] = useState(false);
  const [zip, setZip] = useState(''); const zipRef = useRef<HTMLInputElement>(null);
  const dark = useResolvedDark();

  useEffect(() => {
    if (!publishableKey) { setFailed(true); return; }
    let cancelled = false; const made: Els = {};
    (async () => {
      try {
        // The pure entry injects js.stripe.com only when called, so nothing loads on pages that never take a card.
        const { loadStripe } = await import('@stripe/stripe-js/pure');
        const s = await loadStripe(publishableKey);
        if (cancelled) return;
        if (!s) { setFailed(true); return; }
        stripe.current = s;
        const elements = s.elements({ fonts: fontSources() });
        const style = styleFromProbe(probe.current);
        made.num = elements.create('cardNumber', { style, showIcon: true, disableLink: true, placeholder: '1234 1234 1234 1234' });
        made.exp = elements.create('cardExpiry', { style, placeholder: 'MM / YY' });
        made.cvc = elements.create('cardCvc', { style, placeholder: '123' });
        (['num', 'exp', 'cvc'] as const).forEach(k => {
          const el = made[k]!; st.current[k] = { empty: true, complete: false };
          (el as any).on('change', (e: { empty: boolean; complete: boolean; error?: { code?: string } }) => { st.current[k] = { empty: e.empty, complete: e.complete, error: e.error || null }; });
          el.mount(box[k].current!);
        });
        els.current = made;
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; made.num?.destroy(); made.exp?.destroy(); made.cvc?.destroy(); els.current = {}; };
  }, [publishableKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dark == null) return;
    const style = styleFromProbe(probe.current);
    els.current.num?.update({ style }); els.current.exp?.update({ style }); els.current.cvc?.update({ style });
  }, [dark]);

  useEffect(() => { els.current.num?.update({ disabled }); els.current.exp?.update({ disabled }); els.current.cvc?.update({ disabled }); }, [disabled]);

  useEffect(() => {
    handle.current = {
      // When Stripe.js didn't load, let the submit run so the person sees "couldn't confirm" instead of field errors.
      validate: () => (failed || !els.current.num ? {} : elementErrors(st.current, zip)),
      focus: f => { if (f === 'zip') zipRef.current?.focus(); else els.current[f]?.focus(); },
      createPaymentMethod: async () => {
        const s = stripe.current, num = els.current.num;
        if (!s || !num) return { error: { type: 'api_connection_error' } };
        const r = await s.createPaymentMethod({ type: 'card', card: num, billing_details: { address: { postal_code: zip.trim() } } });
        return r.error ? { error: r.error } : { id: r.paymentMethod.id };
      },
      confirmCardPayment: async (clientSecret, paymentMethodId) => {
        const s = stripe.current; if (!s) return { error: { type: 'api_connection_error' } };
        // Always pass payment_method: a restart's open-invoice PaymentIntent doesn't use the subscription default.
        const r = await s.confirmCardPayment(clientSecret, { payment_method: paymentMethodId });
        if (r.error) return { error: r.error };
        return r.paymentIntent.status === 'succeeded' || r.paymentIntent.status === 'processing' ? { ok: true } : { error: { type: 'card_error', code: 'payment_intent_' + r.paymentIntent.status } };
      },
    };
  });

  const slot = (k: Key) => <div className={'input ce' + (err[k] ? ' err' : '')} aria-invalid={!!err[k] || undefined} onClick={() => els.current[k]?.focus()}><div ref={box[k]} style={{ width: '100%' }} /></div>;
  return <>
    <style>{`.ce{display:flex;align-items:center;cursor:text}.ce:focus-within{border-color:color-mix(in oklch,var(--ink) 38%,var(--line));box-shadow:0 0 0 3px color-mix(in oklch,var(--ink) 6%,transparent)}.ce.err:focus-within{border-color:var(--bad)}`}</style>
    {/* The style source for the Elements iframes: same class, never shown. */}
    <input ref={probe} className="input" aria-hidden="true" tabIndex={-1} readOnly placeholder="x" style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
    <CardRows err={err} num={slot('num')} exp={slot('exp')} cvc={slot('cvc')} zip={<ZipInput value={zip} onChange={setZip} invalid={!!err.zip} inputRef={zipRef} disabled={disabled} />} />
  </>;
}

/** Any CSS color (the tokens are oklch) → rgba(), which Stripe's style parser accepts. */
function toRgb(color: string): string {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); if (!x) return color;
    x.fillStyle = color; x.fillRect(0, 0, 1, 1); const [r, g, b, a] = x.getImageData(0, 0, 1, 1).data;
    return `rgba(${r},${g},${b},${+(a / 255).toFixed(3)})`;
  } catch { return color; }
}
function styleFromProbe(el: HTMLElement | null): StripeElementStyle {
  if (!el) return {};
  const cs = getComputedStyle(el); let ph = cs.color;
  try { ph = getComputedStyle(el, '::placeholder').color || ph; } catch { /* */ }
  const color = toRgb(cs.color);
  const base = { color, iconColor: color, fontFamily: `${cs.fontFamily}, system-ui, -apple-system, "Segoe UI", sans-serif`, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontSmoothing: 'antialiased', '::placeholder': { color: toRgb(ph) } };
  // Validation is shown on submit, by us: Stripe's live "invalid" colouring stays neutral.
  return { base, invalid: { color, iconColor: color } };
}
/** The page's self-hosted @font-face rules for the input font, so the iframes can use Geist. Best effort. */
function fontSources(): CustomFontSource[] {
  const out: CustomFontSource[] = [];
  try {
    const fam = getComputedStyle(document.body).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList; try { rules = sheet.cssRules; } catch { continue; }
      for (const r of Array.from(rules)) {
        if (!(r instanceof CSSFontFaceRule)) continue;
        const s = r.style; if (s.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '') !== fam) continue;
        const m = /url\(["']?([^"')]+)["']?\)/.exec(s.getPropertyValue('src')); if (!m) continue;
        out.push({ family: fam, src: `url(${new URL(m[1], sheet.href || location.href).href})`, weight: s.getPropertyValue('font-weight') || undefined, style: (s.getPropertyValue('font-style') || 'normal') as 'normal' });
      }
    }
  } catch { /* */ }
  return out.slice(0, 4);
}
