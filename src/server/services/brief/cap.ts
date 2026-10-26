// Daily reply cap (DBR-8, owner decision 2026-10-26: "2 more later"). 02-system §9 says "Never exceed 2 replies per
// platform"; Radar caps the first scan of the day at 2 per platform per account and the day at 4, so later scans (Scan
// again, Keep this morning's brief, background rescans) can add up to 2 later finds. Every reply already in the day
// counts, whatever its status. Pure (no I/O): selection and the re-check under the row lock both use it.
import type { BriefAccount, BriefItem, BriefPlatform } from '@/lib/types';
import { acctOf, type ScanMode } from '@/features/brief/model';

/** Replies per platform per account the first scan of the day may pick. */
export const FIRST_SCAN_REPLIES = 2;
/** Replies per platform per account a day may hold once later scans have added theirs. */
export const DAY_REPLIES = 4;
/** The most replies one account may have on one platform after a scan in `mode`. */
export const replyCap = (mode: ScanMode): number => (mode === 'first' ? FIRST_SCAN_REPLIES : DAY_REPLIES);

const key = (a: BriefAccount, k: string) => `${a}:${k}`;
/** Replies in the day per account × platform (any status). */
function countReplies(items: BriefItem[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const i of items) if (i.kind === 'reply' && i.plat) c[key(acctOf(i), i.plat)] = (c[key(acctOf(i), i.plat)] || 0) + 1;
  return c;
}

/** Slots one account has left on each platform for a scan in `mode` (never below 0). */
export function slotsLeft(items: BriefItem[], acct: BriefAccount, plats: BriefPlatform[], mode: ScanMode): Partial<Record<BriefPlatform, number>> {
  const c = countReplies(items);
  return Object.fromEntries(plats.map(k => [k, Math.max(0, replyCap(mode) - (c[key(acct, k)] || 0))]));
}

/** The drafted replies that still fit the day (checked under the row lock): never a thread already in it, never past the
 *  cap for the reply's account and platform. */
export function fitToCap(items: BriefItem[], replies: BriefItem[], mode: ScanMode): BriefItem[] {
  const c = countReplies(items); const cap = replyCap(mode); const add: BriefItem[] = [];
  for (const r of replies) {
    const k = key(acctOf(r), r.plat || '');
    if (items.some(i => i.id === r.id) || (c[k] || 0) >= cap) continue;
    c[k] = (c[k] || 0) + 1; add.push(r);
  }
  return add;
}
