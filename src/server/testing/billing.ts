// Test-only: drive the real /api/billing/* route handlers with the stub provider. Callers mock next/headers with their
// cookie jar (see jar.ts) and set RADAR_DEV_STUBS=1 in vi.hoisted. No app code imports this.
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db';
import { POST as START } from '@/app/api/billing/start/route';
import { POST as RESTART } from '@/app/api/billing/restart/route';
import { POST as CONFIRM } from '@/app/api/billing/confirm/route';
import { GET as STATE } from '@/app/api/billing/state/route';
import { POST as CONFIRM_INTENT } from '@/app/api/billing/dev/confirm-intent/route';
import { POST as SIMULATE } from '@/app/api/billing/dev/simulate/route';
import { processEvent, type StripeEvent } from '../billing/webhook';
import { stubEvent, stubState } from '../billing/stub';

const post = async (h: (r: Request) => Promise<Response>, body: any, ip?: string) => {
  const r = await h(new Request('http://t/api/billing', { method: 'POST', body: JSON.stringify(body), headers: ip ? { 'x-forwarded-for': ip } : {} }));
  return { status: r.status, j: await r.json() as any };
};
export const randomIp = (prefix = '10.88') => `${prefix}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
export const billing = {
  start: (paymentMethodId: string, ip = randomIp()) => post(START, { paymentMethodId }, ip),
  restart: (paymentMethodId: string, ip = randomIp()) => post(RESTART, { paymentMethodId }, ip),
  confirm: (body: { paymentIntentId?: string; subscriptionId?: string }) => post(CONFIRM, body),
  confirmIntent: (paymentIntentId: string, outcome: 'succeed' | 'decline' | 'auth_fail' = 'succeed', webhook?: boolean) => post(CONFIRM_INTENT, { paymentIntentId, outcome, webhook }),
  simulate: (status: string) => post(SIMULATE, { status }),
  state: async () => { const r = await STATE(); return { status: r.status, j: await r.json() as any }; },
};

/** Webhook deliveries in tests, remembered for cleanup. */
export class Deliveries {
  ids: string[] = [];
  event(type: string, object: any): StripeEvent { const e = stubEvent(type, object); this.ids.push(e.id); return e; }
  deliver(type: string, object: any) { return processEvent(this.event(type, object)); }
  /** The stub PaymentIntent as Stripe would put it in an event. */
  pi(id: string) { const x = stubState().pis.get(id)!; return { id: x.id, object: 'payment_intent', metadata: x.metadata, customer: x.customer, status: x.status }; }
  cleanup() { return this.ids.length ? db.delete(schema.billingEvents).where(inArray(schema.billingEvents.id, this.ids)) : Promise.resolve(); }
}

export const account = async (uid: string) => (await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId, uid)))[0];
/** A user's events of one kind, oldest first (heap order is not insertion order once other tests delete rows). */
export const eventsOf = async (uid: string, kind: string) => (await db.select().from(schema.events).where(and(eq(schema.events.userId, uid), eq(schema.events.kind, kind))).orderBy(asc(schema.events.createdAt)));
export const stubSubsOf = (customer: string | null | undefined) => [...stubState().subs.values()].filter(s => s.customer === customer);
export const stubCalls = (method: string) => stubState().calls.filter(c => c.method === method).length;
/** A stub card nobody has trialed: `pm_stub_<scenario>_<last4>` with a random last4 in [lo, hi) (one range per test file,
 *  so parallel files never share a fingerprint), any leftover fingerprint row for it removed first. */
export async function card(lo: number, hi: number, scenario: 'succeed' | 'decline' | '3ds' = 'succeed') {
  const last4 = String(lo + Math.floor(Math.random() * (hi - lo))).padStart(4, '0');
  await db.delete(schema.trialFingerprints).where(eq(schema.trialFingerprints.fingerprint, `fp_stub_${last4}`));
  return `pm_stub_${scenario}_${last4}`;
}
