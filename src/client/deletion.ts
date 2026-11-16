// Words and dates for deleting and restoring a business (.factory/delete-business/architecture.md §5, §9.3). Pure, so
// the copy and the 7 days are tested without a browser. Settings, /restore and the no-business screen all read from here.
import { DELETE_RETENTION_DAYS, DELETE_RETENTION_HOURS } from '@/lib/deletion';
import { fmtDeadline } from '@/features/billing/notice';
import type { DeletedBusiness } from '@/lib/types';

/** Shown to a member whose open business was deleted by its owner (decision I). */
export const LEFT_FLASH = 'That business was deleted.';

/** "Mon, Nov 23 at 4:05 PM" in the viewer's own time zone: the wipe is an instant, so the time is shown too. The same
 *  wording as the billing deadline. `timeZone` is for tests. Empty for a value that is not a date, never a throw. */
export function fmtWipe(iso: string, timeZone?: string): string {
  return Number.isNaN(Date.parse(iso)) ? '' : fmtDeadline(iso, timeZone);
}

/** When a business deleted at `now` would be wiped. The dialog shows this before the delete; afterwards the server's
 *  `purgeAt` is the only date used. */
export const wipeAfter = (now: number): string => new Date(now + DELETE_RETENTION_HOURS * 3600e3).toISOString();

const until = (purgeAt: string, timeZone?: string) => {
  const when = fmtWipe(purgeAt, timeZone);
  return when ? `until ${when}` : `for ${DELETE_RETENTION_DAYS} days`;
};

/** The toast after a delete. */
export const deletedFlash = (name: string, purgeAt: string, timeZone?: string) => `${name} deleted. You can restore it ${until(purgeAt, timeZone)}.`;
/** The toast after a restore. */
export const restoredFlash = (name: string) => `${name} restored.`;
/** One row of "Recently deleted". */
export const wipedOn = (purgeAt: string, timeZone?: string) => { const when = fmtWipe(purgeAt, timeZone); return when ? `Wiped on ${when}` : ''; };

/** The one line on the no-business screen, or null when there is nothing to restore. */
export function restoreLine(deleted: Pick<DeletedBusiness, 'name' | 'purgeAt'>[], timeZone?: string): { text: string; link: string } | null {
  if (!deleted.length) return null;
  if (deleted.length === 1) return { text: `You deleted ${deleted[0].name}. You can restore it ${until(deleted[0].purgeAt, timeZone)}.`, link: 'Restore' };
  return { text: `You have ${deleted.length} deleted businesses you can still restore.`, link: 'Restore a business' };
}
