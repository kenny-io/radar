// POST raw body, Stripe-Signature → 200 {received: true} (architecture §7.3). 400 on a bad or missing signature (and
// when STRIPE_WEBHOOK_SECRET is unset: never verify against an empty secret); 500 on a handler failure so Stripe retries.
import { env } from '@/server/env';
import { json } from '@/server/http/handle';
import { verifySignature } from '@/server/billing/signature';
import { processEvent, type StripeEvent } from '@/server/billing/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1024 * 1024;
async function rawWebhookBody(req: Request): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}

export async function POST(req: Request) {
  if (!env.stripeWebhookSecret) { console.error('[billing] webhook refused: STRIPE_WEBHOOK_SECRET is not set'); return json({ ok: false, error: 'Webhook signing secret not configured' }, 400); }
  const signature = req.headers.get('stripe-signature');
  if (!signature) return json({ ok: false, error: 'Bad signature' }, 400);
  if (Number(req.headers.get('content-length')) > MAX_BODY_BYTES) return json({ ok: false, error: 'Payload too large' }, 413);
  let raw: string | null;
  try { raw = await rawWebhookBody(req); } catch { return json({ ok: false, error: 'Bad payload' }, 400); }
  if (raw === null) return json({ ok: false, error: 'Payload too large' }, 413);
  if (!verifySignature(raw, signature, env.stripeWebhookSecret)) return json({ ok: false, error: 'Bad signature' }, 400);
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
