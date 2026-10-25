// POST raw body, Stripe-Signature → 200 {received: true} (architecture §7.3). 400 on a bad or missing signature (and
// when STRIPE_WEBHOOK_SECRET is unset: never verify against an empty secret); 500 on a handler failure so Stripe retries.
import { env } from '@/server/env';
import { json } from '@/server/http/handle';
import { verifySignature } from '@/server/billing/signature';
import { processEvent, type StripeEvent } from '@/server/billing/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const raw = await req.text();
  if (!env.stripeWebhookSecret) { console.error('[billing] webhook refused: STRIPE_WEBHOOK_SECRET is not set'); return json({ ok: false, error: 'Webhook signing secret not configured' }, 400); }
  if (!verifySignature(raw, req.headers.get('stripe-signature'), env.stripeWebhookSecret)) return json({ ok: false, error: 'Bad signature' }, 400);
  let ev: StripeEvent;
  try { ev = JSON.parse(raw); } catch { return json({ ok: false, error: 'Bad payload' }, 400); }
  if (!ev || typeof ev.id !== 'string' || typeof ev.type !== 'string') return json({ ok: false, error: 'Bad payload' }, 400);
  try {
    const r = await processEvent(ev);
    console.info(`[billing] webhook ${ev.type} ${ev.id}: ${r}`);
    return json({ received: true });
  } catch (e: any) {
    console.error(`[billing] webhook ${ev.type} ${ev.id} failed:`, e?.message || e);
    return json({ ok: false, error: 'Handler failed' }, 500);
  }
}
