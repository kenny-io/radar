import { getBiz } from '@/server/workspace';
import { bizAccess } from '@/server/billing/access';
import { authorized } from './policy';
/** Autonomous work fails closed when authorization or billing cannot be verified. */
export async function canRun(bid: string, activationId: string | null | undefined): Promise<boolean> {
  if (!activationId) return false;
  try { const b = await getBiz(bid); return authorized(b, activationId) && await bizAccess(b); }
  catch { return false; }
}
