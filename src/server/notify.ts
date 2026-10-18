import { db, schema } from './db';
/** Emit a toast to every online member of a business (delivered over SSE). Offline email is not designed (DIVERGENCES #11). */
export async function notify(businessId: string, msg: string, opts: { tone?: 'ok' | 'warn' | 'bad' | 'signal'; action?: { label: string; href: string } } = {}) {
  await db.insert(schema.notifications).values({ businessId, payload: { msg, tone: opts.tone, action: opts.action } });
}
