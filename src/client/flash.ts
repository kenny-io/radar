// A toast that survives a full navigation (.factory/delete-business/architecture.md §9.4). Deleting or restoring a
// business ends in `location.assign`, so the message is left in sessionStorage and the next page's ToastHost shows it.
// React-free, and the store is a parameter, so the read-once rule is tested without a browser.
import { FLASH_KEY } from '@/lib/deletion';

export type FlashTone = 'ok' | 'warn' | 'bad';
export interface Flash { msg: string; tone?: FlashTone }
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** sessionStorage can be missing (server render) or throw (blocked storage, private modes): then there is no flash. */
function session(): Store | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

/** Leave a message for the next page. Never throws: a blocked store only costs the toast, not the navigation. */
export function setFlash(msg: string, tone?: FlashTone, store: Store | null = session()): void {
  try { store?.setItem(FLASH_KEY, JSON.stringify(tone ? { msg, tone } : { msg })); } catch { /* no toast */ }
}

/** Read the message and remove it in the same step, so it shows once: a reload, a second mount or React's repeated
 *  effect in development finds nothing. Anything that is not a flash is dropped. */
export function takeFlash(store: Store | null = session()): Flash | null {
  let raw: string | null = null;
  try { raw = store?.getItem(FLASH_KEY) ?? null; if (raw != null) store!.removeItem(FLASH_KEY); } catch { return null; }
  if (raw == null) return null;
  try {
    const f = JSON.parse(raw);
    if (!f || typeof f.msg !== 'string' || !f.msg.trim()) return null;
    return f.tone === 'ok' || f.tone === 'warn' || f.tone === 'bad' ? { msg: f.msg, tone: f.tone } : { msg: f.msg };
  } catch { return null; }
}
