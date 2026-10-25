// Stripe webhook signatures (https://docs.stripe.com/webhooks/signature), verified by hand: no SDK dependency.
// `Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>…]`; v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). Other schemes (v0, the
// test scheme) are ignored. Several v1 entries appear while a secret is being rolled; any match passes.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOLERANCE_SEC = 300;

export function verifySignature(raw: string, header: string | null | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000), tolerance = TOLERANCE_SEC): boolean {
  if (!secret || !header) return false;
  let t: number | null = null; const v1: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 't') t = /^\d+$/.test(v) ? Number(v) : null;
    else if (k === 'v1' && v) v1.push(v);
  }
  if (t == null || !v1.length || Math.abs(nowSec - t) > tolerance) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${raw}`, 'utf8').digest('hex'), 'utf8');
  return v1.some(s => { const b = Buffer.from(s, 'utf8'); return b.length === expected.length && timingSafeEqual(b, expected); });
}

/** Tests and the dev tooling: a header Stripe would send for `raw`. */
export const signPayload = (raw: string, secret: string, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`, 'utf8').digest('hex')}`;
