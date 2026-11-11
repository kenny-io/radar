// Toast rules (first-five RL-6), kept React-free so they can be tested: which toasts stay, how each is announced, and
// what leaves when there is no room.
export const TOAST_MS = 4200;
export const TOAST_MAX = 3;
export interface ToastLike { id: number; msg: unknown; tone?: string | null }

const isError = (t: { tone?: string | null }) => t.tone === 'bad';

/** An error stays until it is dismissed, has a close button and is announced as an alert. Every other toast is a status
 *  and leaves by itself after `ms` (4.2 s unless the caller says otherwise). */
export function toastPlan(t: { tone?: string | null; ms?: number }): { sticky: boolean; role: 'alert' | 'status'; ms: number | null } {
  return isError(t) ? { sticky: true, role: 'alert', ms: null } : { sticky: false, role: 'status', ms: t.ms || TOAST_MS };
}

/** What shows after `t` arrives. At most `max` toasts, and an error the user has not dismissed is never pushed out by a
 *  status toast:
 *  - the same error message again replaces its earlier copy (no stack of identical errors);
 *  - when there is no room, the oldest status toast leaves first;
 *  - an error leaves only for a newer error, when `max` errors are already showing;
 *  - a status toast arriving while `max` errors show is shown as one extra and leaves by itself. */
export function retainToasts<T extends ToastLike>(list: T[], t: T, max = TOAST_MAX): T[] {
  const out = [...list.filter(x => !(isError(t) && isError(x) && x.msg === t.msg)), t];
  while (out.length > max) {
    const status = out.findIndex(x => !isError(x) && x !== t);
    const drop = status >= 0 ? status : isError(t) ? out.findIndex(x => x !== t) : -1;
    if (drop < 0) break;
    out.splice(drop, 1);
  }
  return out;
}
