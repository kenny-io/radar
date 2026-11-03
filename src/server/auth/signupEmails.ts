import type { Tx } from '../billing/draft';
import { queueLifecycle } from '../services/lifecycle/queue';

/** Called only inside the transaction that creates a real account, never on sign-in or guest creation. */
export async function queueSignupEmails(tx: Tx, user: { id: string; name: string }) {
  await queueLifecycle(tx, { type: 'welcome', userId: user.id, eventKey: `welcome:${user.id}`, data: { name: user.name } });
  await queueLifecycle(tx, { type: 'founder_note', userId: user.id, eventKey: `founder:${user.id}`, data: { name: user.name }, sendAt: new Date(Date.now() + 24 * 3600e3) });
}
