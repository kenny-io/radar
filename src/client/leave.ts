// Moving a tab out of a business that was deleted (.factory/delete-business/architecture.md §3.7, DEL-4). Once a
// business is deleted every call on it answers 404 `business_deleted`; the tab then leaves for /dashboard, where the
// server opens the member's next business or the no-business screen, and says why with one toast.
import { ApiError } from './api';
import { setFlash } from './flash';
import { LEFT_FLASH } from './deletion';

/** Only this code means "the business is gone". Any other 404 (an article, a pack) keeps its own handling. */
export const isBusinessDeleted = (e: unknown): boolean => e instanceof ApiError && e.status === 404 && e.code === 'business_deleted';

/** A leave that runs once however many calls fail together (the workspace, the stream probe and a save can all get the
 *  404 in the same second). `reset` re-arms it. The effects are parameters so this is tested without a browser. */
export function createLeave(fx: { flash: (msg: string) => void; go: (url: string) => void }) {
  let left = false;
  const leave = () => { if (left) return; left = true; fx.flash(LEFT_FLASH); fx.go('/dashboard'); };
  /** True when `e` said the business is deleted (the tab is leaving, so the caller shows nothing). */
  const onError = (e: unknown): boolean => { if (!isBusinessDeleted(e)) return false; leave(); return true; };
  return { leave, onError, reset: () => { left = false; } };
}

const tab = createLeave({ flash: msg => setFlash(msg), go: url => window.location.assign(url) });
// A page brought back from the back/forward cache keeps its module state: let it leave again.
if (typeof window !== 'undefined') window.addEventListener('pageshow', e => { if (e.persisted) tab.reset(); });

export const leave = tab.leave;
/** `if (leaveIfDeleted(e)) return;` in a catch: leaves when the error is 404 `business_deleted`, else does nothing. */
export const leaveIfDeleted = tab.onError;
