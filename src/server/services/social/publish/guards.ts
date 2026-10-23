// Edit locks on the existing pack and Brief actions (architecture.md §6 "Changed existing actions"). With the flag off these
// are no-ops, so leftover pubs never change today's behaviour.
import { RadarError } from '../../../errors';
import { socialOn } from '../../../flags';
import type { BizRow } from '../../../workspace';
import { COPY, isLocked } from '@/lib/socialPublish';
import type { Pub } from '@/lib/types';
import { accountRows, acctPublic } from './accounts';
import { pubOf, pubRow } from './pubs';

/** The pub behind a sid and whether it's locked; null when publishing is off for the business or there is no pub. */
export async function pubState(biz: Pick<BizRow, 'id' | 'ownerId'>, sid: string): Promise<{ pub: Pub; locked: boolean } | null> {
  if (!(await socialOn(biz))) return null;
  const r = await pubRow(biz.id, sid); if (!r) return null;
  const pub = pubOf(r, (await accountRows(biz.id)).map(acctPublic));
  return { pub, locked: isLocked(pub, Date.now()) };
}
export const lockedError = () => new RadarError(COPY.lockedEdit, 409, 'locked');
/** Refuse an edit to content that sends within 5 minutes (or is sending / past due and unconfirmed). */
export async function assertEditable(biz: Pick<BizRow, 'id' | 'ownerId'>, sid: string) {
  const s = await pubState(biz, sid);
  if (s?.locked) throw lockedError();
}
